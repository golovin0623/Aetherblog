// Package service · kb_service.go — 知识库业务编排。
//
// 职责：
//  1. KB CRUD（含自动创建归档目录 + 默认 profile）
//  2. 权限解析（owner ∪ admin ∪ kb_members；返回 EffectivePermission）
//  3. 文件上传桥接（自动归档到 /root/_system_kb/<slug>/<yyyy>/<mm>/<dd>，触发 ai-service 向量化）
//  4. Profile CRUD + 蓝绿激活
//  5. 成员授权 CRUD
//
// 大多数 handler 只调本 service，不会直接打 repo。
package service

import (
	"context"
	"errors"
	"fmt"
	"mime/multipart"
	"path"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/rs/zerolog/log"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/pkg/dbutil"
	"github.com/golovin0623/aetherblog-server/internal/repository"
)

// =====================================================================
// 错误定义
// =====================================================================
var (
	ErrKBNotFound          = errors.New("知识库不存在")
	ErrKBSlugConflict      = errors.New("知识库 slug 已存在")
	ErrKBPermission        = errors.New("无权访问该知识库")
	ErrKBForbidSystem      = errors.New("系统级知识库不可执行该操作")
	ErrKBProfileNotFound   = errors.New("索引档案不存在")
	ErrKBProfileBadState   = errors.New("索引档案当前状态不允许该操作")
	ErrKBProfileBadConfig  = errors.New("索引档案配置无效")
	ErrKBFileNotFound      = errors.New("知识库文件不存在")
	ErrKBFileWrongKB       = errors.New("文件不属于该知识库")
	ErrKBMemberWrongKB     = errors.New("成员不属于该知识库")
	ErrKBMigrateInProgress = errors.New("该知识库已有一个迁移任务在进行中，请稍后再试")
)

// kbMigrateAdvisoryClass 是 pg_try_advisory_lock 的 classid（key1）部分。
// 用于隔离 KB 迁移锁与其他 advisory lock 业务命名空间（901 = 'KB' ASCII 之和 + offset）。
const kbMigrateAdvisoryClass = 901

// =====================================================================
// 用户上下文（用于权限判定）
// =====================================================================

// KBUserContext 携带请求者的身份与团队/角色集合，service 内部使用。
type KBUserContext struct {
	UserID  int64
	Role    string // legacy role: "admin" | "user" | ...
	IsAdmin bool   // = strings.EqualFold(Role, "admin")
	TeamIDs []int64
	RoleIDs []int64
}

// =====================================================================
// 主 service
// =====================================================================

// KBService 编排知识库业务。
type KBService struct {
	db           *sqlx.DB
	kbRepo       *repository.KBRepo
	profileRepo  *repository.KBProfileRepo
	memberRepo   *repository.KBMemberRepo
	fileRepo     *repository.KBFileRepo
	mediaSvc     *MediaService
	folderSvc    *FolderService
	indexer      *KBIndexerClient
	defaultModel string // 创建 CUSTOM KB 时默认 profile 的 model_id（同 search_profiles seed 策略）
}

func NewKBService(
	db *sqlx.DB,
	kbRepo *repository.KBRepo,
	profileRepo *repository.KBProfileRepo,
	memberRepo *repository.KBMemberRepo,
	fileRepo *repository.KBFileRepo,
	mediaSvc *MediaService,
	folderSvc *FolderService,
	indexer *KBIndexerClient,
	defaultEmbeddingModel string,
) *KBService {
	if defaultEmbeddingModel == "" {
		defaultEmbeddingModel = "text-embedding-3-large"
	}
	return &KBService{
		db:           db,
		kbRepo:       kbRepo,
		profileRepo:  profileRepo,
		memberRepo:   memberRepo,
		fileRepo:     fileRepo,
		mediaSvc:     mediaSvc,
		folderSvc:    folderSvc,
		indexer:      indexer,
		defaultModel: defaultEmbeddingModel,
	}
}

// =====================================================================
// 用户上下文构建（团队/角色查询封装）
// =====================================================================

// BuildUserContext 给定登录用户的最小信息，反查其 team_ids / role_ids。
// 该函数在每个 handler 入口调用一次，避免重复 SQL。
func (s *KBService) BuildUserContext(ctx context.Context, userID int64, legacyRole string) (*KBUserContext, error) {
	uc := &KBUserContext{
		UserID:  userID,
		Role:    legacyRole,
		IsAdmin: strings.EqualFold(legacyRole, "admin"),
	}
	// 查 team_ids
	rows, err := s.db.QueryContext(ctx,
		`SELECT team_id FROM team_members WHERE user_id=$1 AND status='ACTIVE'`, userID)
	if err == nil {
		for rows.Next() {
			var tid int64
			if scanErr := rows.Scan(&tid); scanErr == nil {
				uc.TeamIDs = append(uc.TeamIDs, tid)
			}
		}
		rows.Close()
	}
	// 查 role_ids
	rrows, err := s.db.QueryContext(ctx, `SELECT role_id FROM user_roles WHERE user_id=$1`, userID)
	if err == nil {
		for rrows.Next() {
			var rid int64
			if scanErr := rrows.Scan(&rid); scanErr == nil {
				uc.RoleIDs = append(uc.RoleIDs, rid)
			}
		}
		rrows.Close()
	}
	return uc, nil
}

// =====================================================================
// 列表 & 详情
// =====================================================================

// ListAccessible 列表查询（仅返回当前用户可见的 KB）。
func (s *KBService) ListAccessible(ctx context.Context, uc *KBUserContext, kind, keyword string) ([]dto.KnowledgeBaseVO, error) {
	rows, err := s.kbRepo.ListAccessible(ctx, repository.AccessibleFilter{
		UserID:  uc.UserID,
		IsAdmin: uc.IsAdmin,
		TeamIDs: uc.TeamIDs,
		RoleIDs: uc.RoleIDs,
		Kind:    kind,
		Keyword: keyword,
	})
	if err != nil {
		return nil, err
	}
	out := make([]dto.KnowledgeBaseVO, 0, len(rows))
	for _, kb := range rows {
		vo := toKBVO(kb)
		level := s.resolveEffectivePermission(ctx, &kb, uc)
		vo.EffectivePermission = level
		if kb.ActiveProfileID != nil {
			if p, perr := s.profileRepo.FindByID(ctx, *kb.ActiveProfileID); perr == nil && p != nil {
				pv := toKBProfileVO(*p)
				vo.ActiveProfile = &pv
			}
		}
		out = append(out, vo)
	}
	return out, nil
}

// GetByIDForUser 详情；自动做权限校验并附带 EffectivePermission。
func (s *KBService) GetByIDForUser(ctx context.Context, id int64, uc *KBUserContext) (*dto.KnowledgeBaseVO, error) {
	kb, err := s.kbRepo.FindByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if kb == nil {
		return nil, ErrKBNotFound
	}
	level := s.resolveEffectivePermission(ctx, kb, uc)
	if level == "" {
		return nil, ErrKBPermission
	}
	vo := toKBVO(*kb)
	vo.EffectivePermission = level
	if kb.ActiveProfileID != nil {
		if p, perr := s.profileRepo.FindByID(ctx, *kb.ActiveProfileID); perr == nil && p != nil {
			pv := toKBProfileVO(*p)
			vo.ActiveProfile = &pv
		}
	}
	return &vo, nil
}

// GetBySlugForUser 按 slug 查详情。
func (s *KBService) GetBySlugForUser(ctx context.Context, slug string, uc *KBUserContext) (*dto.KnowledgeBaseVO, error) {
	kb, err := s.kbRepo.FindBySlug(ctx, slug)
	if err != nil {
		return nil, err
	}
	if kb == nil {
		return nil, ErrKBNotFound
	}
	return s.GetByIDForUser(ctx, kb.ID, uc)
}

// =====================================================================
// 创建 / 更新 / 删除
// =====================================================================

// Create 创建 CUSTOM 知识库。事务流程：
//  1. slug 解析（若未提供则从 name 派生）
//  2. INSERT knowledge_bases 取得 id
//  3. EnsureFolderByPath /root/_system_kb/<slug>
//  4.更新knowledge_bases.folder_id
//  5. INSERT 默认 profile（status='active', model 取 defaultModel, chunker='recursive'）
//  6.更新knowledge_bases.active_profile_id
//
// 任何步骤失败都让上层 tx 回滚（这里用 sql 而非显式 begin，因为 EnsureFolderByPath
// 跨多 row，且文件夹幂等创建本身不需要回滚保护——失败的目录留着无害）。
func (s *KBService) Create(ctx context.Context, req dto.CreateKnowledgeBaseRequest, uc *KBUserContext) (*dto.KnowledgeBaseVO, error) {
	slug := strings.TrimSpace(req.Slug)
	if slug == "" {
		slug = slugFromName(req.Name)
	} else {
		// review chatgpt-codex P2 修复：用户显式 slug 不能盲信，可能含 `/`/空白/中文
		// → 后面拼到 /root/_system_kb/<slug> 会污染路径，或 folder.slug 不规范。
		// 用 slugifyStrict 规范化；若与原始不同（说明含非法字符），返错引导用户改正。
		normalized := slugifyStrict(slug)
		if normalized == "" {
			return nil, fmt.Errorf("slug 必须为小写字母/数字/短横线，1-120 字符")
		}
		if normalized != slug {
			return nil, fmt.Errorf("slug 含非法字符（仅允许小写字母/数字/短横线），建议改为 %q", normalized)
		}
		slug = normalized
	}
	if slug == "" {
		return nil, fmt.Errorf("无法从名称推导 slug，请显式指定 slug")
	}
	// 唯一性预检（仅排查常见冲突；并发场景靠 repo 层 ErrKBSlugDuplicate 兜底）
	if existing, _ := s.kbRepo.FindBySlug(ctx, slug); existing != nil {
		return nil, ErrKBSlugConflict
	}
	visibility := req.Visibility
	if visibility == "" {
		visibility = "PRIVATE"
	}

	// Step 1+2：插入 KB row
	kbID, err := s.kbRepo.Create(ctx, repository.KBCreateRequest{
		Slug:        slug,
		Name:        req.Name,
		Description: req.Description,
		Icon:        req.Icon,
		Color:       req.Color,
		Kind:        model.KBKindCustom,
		OwnerID:     &uc.UserID,
		Visibility:  visibility,
		CreatedBy:   &uc.UserID,
	})
	if err != nil {
		// 并发预检之外的 uniq 冲突 → 转为客户端可识别的业务错误（review chatgpt-codex P2）
		if errors.Is(err, repository.ErrKBSlugDuplicate) {
			return nil, ErrKBSlugConflict
		}
		return nil, fmt.Errorf("insert knowledge_base: %w", err)
	}
	// 补偿删除（review chatgpt-codex P1 修复）：插 KB row 后任何步骤失败都要
	// rollback，否则会留下没 active_profile_id 的"孤儿 KB"，下次重试同 slug
	// 会撞 uniq 冲突，admin 没办法清理。这里用 defer + named return 在出错路径
	// 自动 DELETE。folder 留着无害（幂等可复用），不补偿。
	var createErr error
	defer func() {
		if createErr != nil {
			if delErr := s.kbRepo.Delete(context.Background(), kbID); delErr != nil {
				log.Error().Err(delErr).Int64("kb_id", kbID).Msg("compensating delete on create-fail failed; leaving orphan KB row")
			} else {
				log.Info().Int64("kb_id", kbID).Str("reason", createErr.Error()).Msg("compensating delete: rolled back KB on create-fail")
			}
		}
	}()

	// Step 3+4：创建/复用归档根目录 /root/_system_kb/<slug>
	folderVO, err := s.folderSvc.EnsureFolderByPath(ctx,
		[]string{"_system_kb", slug}, nil, true, false)
	if err != nil {
		log.Warn().Err(err).Int64("kb_id", kbID).Msg("ensure kb folder failed (continuing without folder)")
	} else if folderVO != nil {
		fid := folderVO.ID
		_ = s.kbRepo.Update(ctx, kbID, map[string]any{"folder_id": fid}, &uc.UserID)
	}

	// Step 5+6：默认 profile
	defaultProfile, err := s.profileRepo.Create(ctx, repository.KBProfileCreateRequest{
		KBID:               kbID,
		Code:               "default",
		Name:               "默认 · 递归 Markdown 切片",
		Description:        pStr("自动创建。chunk_size=512, overlap=64, top_k=6, score_threshold=0.20"),
		ModelID:            s.defaultModel,
		ChunkerKind:        "recursive",
		ChunkSizeTokens:    512,
		ChunkOverlapTokens: 64,
		TopK:               6,
		ScoreThreshold:     ptrFloat(0.200),
		Status:             model.KBProfileStatusActive,
	})
	if err != nil {
		createErr = fmt.Errorf("insert default profile: %w", err)
		return nil, createErr
	}
	if err := s.kbRepo.SetActiveProfile(ctx, kbID, defaultProfile.ID); err != nil {
		createErr = fmt.Errorf("set active profile: %w", err)
		return nil, createErr
	}

	// 如果调用方还传了一个 initialProfile，再插一条 shadow 备选
	if req.InitialProfile != nil {
		ip := req.InitialProfile
		_, err := s.profileRepo.Create(ctx, repository.KBProfileCreateRequest{
			KBID:               kbID,
			Code:               ip.Code,
			Name:               ip.Name,
			Description:        ip.Description,
			ModelID:            ip.ModelID,
			ChunkerKind:        ip.ChunkerKind,
			ChunkSizeTokens:    ip.ChunkSizeTokens,
			ChunkOverlapTokens: ip.ChunkOverlapTokens,
			TopK:               ip.TopK,
			ScoreThreshold:     ip.ScoreThreshold,
			Status:             model.KBProfileStatusShadow,
		})
		if err != nil {
			log.Warn().Err(err).Int64("kb_id", kbID).Msg("create initial shadow profile failed (ignored)")
		}
	}
	// review chatgpt-codex P2：最后的 GetByIDForUser 如果失败（ctx cancel /
	// 临时 DB 抖动），也要把 KB 行回滚 —— 否则客户端收到错误以为创建失败，
	// 重试会撞 slug uniq 冲突，留下"看不见的"已持久化 KB。
	vo, err := s.GetByIDForUser(ctx, kbID, uc)
	if err != nil {
		createErr = fmt.Errorf("fetch created kb: %w", err)
		return nil, createErr
	}
	return vo, nil
}

// Update 修改 KB 可变属性。仅 MANAGE 权限可用。
func (s *KBService) Update(ctx context.Context, id int64, req dto.UpdateKnowledgeBaseRequest, uc *KBUserContext) (*dto.KnowledgeBaseVO, error) {
	kb, err := s.kbRepo.FindByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if kb == nil {
		return nil, ErrKBNotFound
	}
	if !s.canManage(ctx, kb, uc) {
		return nil, ErrKBPermission
	}
	sets := map[string]any{}
	if req.Name != nil {
		sets["name"] = *req.Name
	}
	if req.Description != nil {
		sets["description"] = req.Description
	}
	if req.Icon != nil {
		sets["icon"] = req.Icon
	}
	if req.Color != nil {
		sets["color"] = req.Color
	}
	if req.CoverImage != nil {
		sets["cover_image"] = req.CoverImage
	}
	if req.Visibility != nil {
		sets["visibility"] = *req.Visibility
	}
	if req.ActiveProfileID != nil {
		// review chatgpt-codex P1：activeProfileId 必须属于当前 KB。
		// 否则 MANAGE 用户可借 Update 把 KB A 的 active_profile_id 指向 KB B 的
		// profile —— Activate 事务仍会执行（旧 active deprecate + 新 profile active +
		// 改 knowledge_bases.active_profile_id），但 active_profile_id 指向跨 KB
		// 行，召回时 profile.kb_id != kb_id 错配，整个 KB 检索废掉。
		targetProfile, perr := s.profileRepo.FindByID(ctx, *req.ActiveProfileID)
		if perr != nil {
			return nil, fmt.Errorf("verify active profile: %w", perr)
		}
		if targetProfile == nil || targetProfile.KBID != id {
			return nil, ErrKBProfileNotFound
		}
		if err := s.profileRepo.Activate(ctx, id, *req.ActiveProfileID); err != nil {
			return nil, fmt.Errorf("activate profile: %w", err)
		}
	}
	if len(sets) > 0 {
		if err := s.kbRepo.Update(ctx, id, sets, &uc.UserID); err != nil {
			return nil, err
		}
	}
	return s.GetByIDForUser(ctx, id, uc)
}

// Delete 删除 KB。SYSTEM_POSTS 库被拦截。
func (s *KBService) Delete(ctx context.Context, id int64, uc *KBUserContext) error {
	kb, err := s.kbRepo.FindByID(ctx, id)
	if err != nil {
		return err
	}
	if kb == nil {
		return ErrKBNotFound
	}
	if kb.Kind == model.KBKindSystemPosts {
		return ErrKBForbidSystem
	}
	if !s.canManage(ctx, kb, uc) {
		return ErrKBPermission
	}
	return s.kbRepo.Delete(ctx, id)
}

// =====================================================================
// 权限解析
// =====================================================================

// resolveEffectivePermission 返回 uc 对 kb 的最高有效权限：
//   - 系统管理员：MANAGE
//   - 所有者：MANAGE
//   - kb_members 解析最高级
//   - SYSTEM_POSTS + Visibility=PUBLIC：至少 USE（任何登录用户能用于对话）
//   - 其他：空串（无权限）
func (s *KBService) resolveEffectivePermission(ctx context.Context, kb *model.KnowledgeBase, uc *KBUserContext) string {
	if uc.IsAdmin {
		return model.KBPermissionManage
	}
	if kb.OwnerID != nil && *kb.OwnerID == uc.UserID {
		return model.KBPermissionManage
	}
	level, err := s.memberRepo.ResolvePermission(ctx, kb.ID, uc.UserID, uc.TeamIDs, uc.RoleIDs)
	if err == nil && level != "" {
		return level
	}
	if kb.Visibility == "PUBLIC" {
		// 兜底：PUBLIC 库对登录用户至少 USE（看不到管理动作）
		return model.KBPermissionUse
	}
	return ""
}

func (s *KBService) canManage(ctx context.Context, kb *model.KnowledgeBase, uc *KBUserContext) bool {
	lv := s.resolveEffectivePermission(ctx, kb, uc)
	return lv == model.KBPermissionManage
}

func (s *KBService) canEdit(ctx context.Context, kb *model.KnowledgeBase, uc *KBUserContext) bool {
	lv := s.resolveEffectivePermission(ctx, kb, uc)
	return lv == model.KBPermissionManage || lv == model.KBPermissionEdit
}

// =====================================================================
// 文件上传 & 向量化
// =====================================================================

// UploadFile 桥接到 MediaService：
//  1. 校验 EDIT 权限 + 库类型必须是 CUSTOM
//  2. EnsureFolderByPath /root/_system_kb/<slug>/<yyyy>/<mm>/<dd>
//  3. 在 KB 上传 context 下调用 MediaService.Upload
//  4. 插入 kb_files row（PENDING）
//  5. 启动 goroutine 调 ai-service 触发向量化（成功/失败状态写回 kb_files）
func (s *KBService) UploadFile(ctx context.Context, kbID int64, fh *multipart.FileHeader, category *string, uc *KBUserContext) (*dto.KBFileVO, error) {
	kb, err := s.kbRepo.FindByID(ctx, kbID)
	if err != nil {
		return nil, err
	}
	if kb == nil {
		return nil, ErrKBNotFound
	}
	if kb.Kind != model.KBKindCustom {
		return nil, ErrKBForbidSystem
	}
	if !s.canEdit(ctx, kb, uc) {
		return nil, ErrKBPermission
	}

	now := time.Now()
	segments := []string{
		"_system_kb",
		kb.Slug,
		fmt.Sprintf("%04d", now.Year()),
		fmt.Sprintf("%02d", int(now.Month())),
		fmt.Sprintf("%02d", now.Day()),
	}
	folderVO, err := s.folderSvc.EnsureFolderByPath(ctx, segments, nil, true, false)
	if err != nil {
		return nil, fmt.Errorf("ensure date folder: %w", err)
	}

	kbCtx := WithKBUploadContext(ctx)
	folderID := folderVO.ID
	mediaVO, err := s.mediaSvc.Upload(kbCtx, fh, &uc.UserID, &folderID)
	if err != nil {
		return nil, fmt.Errorf("media upload: %w", err)
	}

	title := fh.Filename
	mediaID := mediaVO.ID
	fileID, err := s.fileRepo.Create(ctx, repository.KBFileCreateRequest{
		KBID:        kbID,
		MediaFileID: &mediaID,
		Title:       &title,
		Category:    category,
		CreatedBy:   &uc.UserID,
		ArchivedAt:  now,
	})
	if err != nil {
		return nil, fmt.Errorf("insert kb_files: %w", err)
	}

	// 启动后台向量化（不阻塞 HTTP 响应）
	s.scheduleIndex(kbID, fileID, kb.ActiveProfileID)
	_ = s.kbRepo.RefreshStats(ctx, kbID)
	return s.GetFile(ctx, kbID, fileID, uc)
}

// scheduleIndex 在后台 goroutine 中调用 ai-service 触发向量化。
// 失败结果写回 kb_files.vector_error，不影响主流程。
//
// 流程：
//  1. 标 RUNNING + 自增 attempt
//  2. 从 MediaService 下载文件原始字节（限 10MB）
//  3. POST 到 ai-service /v1/kb/.../index，传 base64 content + mime
//  4. 写 SUCCEEDED / FAILED
const kbMaxBytes = 10 * 1024 * 1024 // 10 MB

func (s *KBService) scheduleIndex(kbID, fileID int64, activeProfileID *int64) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		defer cancel()
		var profileID int64
		if activeProfileID != nil {
			profileID = *activeProfileID
		}
		if err := s.fileRepo.MarkRunning(ctx, fileID, profileID); err != nil {
			log.Warn().Err(err).Int64("file_id", fileID).Msg("mark running failed")
		}
		f, err := s.fileRepo.FindByID(ctx, fileID)
		if err != nil || f == nil || f.MediaFileID == nil {
			msg := "找不到关联的媒体文件"
			if err != nil {
				msg = err.Error()
			}
			_ = s.fileRepo.MarkFailed(ctx, fileID, truncate(msg, 2048))
			_ = s.kbRepo.RefreshStats(ctx, kbID)
			return
		}
		content, mime, filename, err := s.mediaSvc.DownloadBytes(ctx, *f.MediaFileID, kbMaxBytes)
		if err != nil {
			_ = s.fileRepo.MarkFailed(ctx, fileID, truncate("下载文件失败: "+err.Error(), 2048))
			_ = s.kbRepo.RefreshStats(ctx, kbID)
			return
		}
		// review chatgpt-codex P2：与 runIndexJob 同款 race —— IndexFile 必须显式
		// 传 TargetProfileID，否则 admin 在 goroutine 排队期间切换 profile，会让
		// 新 active 接管写入而 kb_files.vector_profile_id 还指向旧 profile，
		// 出现"文件元数据 vs 实际 embedding 所属 profile"双标记冲突。
		payload := KBIndexPayload{
			Filename: filename,
			MimeType: mime,
			Content:  content,
		}
		if profileID > 0 {
			payload.TargetProfileID = profileID
			payload.TargetStatus = model.KBProfileStatusActive
		}
		result, err := s.indexer.IndexFile(ctx, kbID, fileID, payload)
		if err != nil {
			log.Error().Err(err).Int64("kb_id", kbID).Int64("file_id", fileID).Msg("kb index failed")
			_ = s.fileRepo.MarkFailed(ctx, fileID, truncate(err.Error(), 2048))
			_ = s.kbRepo.RefreshStats(ctx, kbID)
			return
		}
		if result.Status == model.KBVectorStatusFailed || result.Error != "" {
			_ = s.fileRepo.MarkFailed(ctx, fileID, truncate(result.Error, 2048))
		} else {
			_ = s.fileRepo.MarkSucceeded(ctx, fileID, result.ChunkCount, result.DocChars, result.DocTokens)
		}
		_ = s.kbRepo.RefreshStats(ctx, kbID)
	}()
}

// ReindexFile 立即重新向量化（同步等结果，由 admin UI 调用）。
func (s *KBService) ReindexFile(ctx context.Context, kbID, fileID int64, uc *KBUserContext) error {
	kb, err := s.kbRepo.FindByID(ctx, kbID)
	if err != nil {
		return err
	}
	if kb == nil {
		return ErrKBNotFound
	}
	if !s.canEdit(ctx, kb, uc) {
		return ErrKBPermission
	}
	// SECURITY (review chatgpt-codex P1)：必须验证 fileID 属于本 KB，否则有 EDIT
	// A 的用户可传入 KB B 的 fileID，把 B 的文件以 A 的 active profile 重新向量化，
	// 跨 KB 污染 embeddings 所有权 + 召回时可能泄漏内容。
	f, err := s.fileRepo.FindByID(ctx, fileID)
	if err != nil {
		return err
	}
	if f == nil {
		return ErrKBFileNotFound
	}
	if f.KBID != kbID {
		return ErrKBFileWrongKB
	}
	s.scheduleIndex(kbID, fileID, kb.ActiveProfileID)
	return nil
}

// ReindexAll 异步重建整库 —— 后台 goroutine 顺序对 KB 全部 kb_files 触发 scheduleIndex。
// HTTP 立即返回 ack；进度通过文件列表的 vector_status 轮询观察（前端 UI 已支持）。
//
// 历史 bug（review chatgpt-codex P1）：曾经直接转发到 ai-service 的 /reindex 端点，
// 而该端点只回 ack 不真正 reindex —— 这里改为 Go 端自己迭代 kb_files 调度。
func (s *KBService) ReindexAll(ctx context.Context, kbID int64, uc *KBUserContext) error {
	kb, err := s.kbRepo.FindByID(ctx, kbID)
	if err != nil {
		return err
	}
	if kb == nil {
		return ErrKBNotFound
	}
	if !s.canEdit(ctx, kb, uc) {
		return ErrKBPermission
	}
	if kb.Kind != model.KBKindCustom {
		// SYSTEM_POSTS 的索引由 search 模块管理；本端点显式返错而非 no-op
		// 成功，避免 admin UI "重建索引" 弹 success toast 但实际什么都没做
		// （review chatgpt-codex P2 修复：之前 return nil 让客户端误判为成功）。
		return ErrKBForbidSystem
	}
	activeProfile := kb.ActiveProfileID
	// 拉全量文件（分页迭代避免 OOM；当前 PageSize 5000，足够实际 admin 操作）
	var fileIDs []int64
	page := 1
	for {
		rows, total, err := s.fileRepo.ListByKB(ctx, repository.KBFileListFilter{
			KBID: kbID, PageNum: page, PageSize: 500,
		})
		if err != nil {
			return fmt.Errorf("list kb files (page %d): %w", page, err)
		}
		for _, f := range rows {
			if f.MediaFileID != nil {
				fileIDs = append(fileIDs, f.ID)
			}
		}
		if int64(page*500) >= total || len(rows) == 0 {
			break
		}
		page++
	}
	if len(fileIDs) == 0 {
		return nil
	}
	// 异步 worker pool 限制并发（review chatgpt-codex P2 修复）：
	// scheduleIndex 内部本身是 goroutine 立即返回，外层循环串行 ≠ 串行执行
	// —— 大库会瞬间触发 N 个并发下载/embed/upsert，打爆 LLM 速率限和 DB 写。
	// 这里用 reindexBatchConcurrency 个 worker 串行消费 channel，每个 worker
	// 等 scheduleIndex 真正落库后再拉下一个，确保稳定 throughput。
	go func() {
		bg := context.Background()
		log.Info().Int64("kb_id", kbID).Int("files", len(fileIDs)).Msg("kb: reindex all started")
		jobs := make(chan int64)
		var wg sync.WaitGroup
		for w := 0; w < reindexBatchConcurrency; w++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				for fid := range jobs {
					// 同步版本：直接走 scheduleIndex 的内部流程而不再开新 goroutine。
					s.runIndexJob(bg, kbID, fid, activeProfile)
				}
			}()
		}
		for _, fid := range fileIDs {
			jobs <- fid
		}
		close(jobs)
		wg.Wait()
		_ = s.kbRepo.RefreshStats(bg, kbID)
		log.Info().Int64("kb_id", kbID).Int("files", len(fileIDs)).Msg("kb: reindex all completed")
	}()
	return nil
}

// reindexBatchConcurrency 是 ReindexAll 批量重建的 worker 数。
// 太小则浪费 LLM 并发额度；太大则瞬间打爆中转网关 / 触发上游 429。
// 3 这个值与 ai-service 端 chunk 并发（5/file）相乘约 15 并发，是绝大多数
// embedding provider 默认账户的安全区间。如需在生产调高建议先观察 429 比例。
const reindexBatchConcurrency = 3

// runIndexJob 同步执行单个文件的"下载 → 调 ai-service → 写状态"流程，
// 不再开 goroutine。给 worker pool 用，便于限制并发。
// 与 scheduleIndex 的差别：scheduleIndex 自己开 goroutine 立即返回。
func (s *KBService) runIndexJob(ctx context.Context, kbID, fileID int64, activeProfileID *int64) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	var profileID int64
	if activeProfileID != nil {
		profileID = *activeProfileID
	}
	if err := s.fileRepo.MarkRunning(ctx, fileID, profileID); err != nil {
		log.Warn().Err(err).Int64("file_id", fileID).Msg("mark running failed")
	}
	f, err := s.fileRepo.FindByID(ctx, fileID)
	if err != nil || f == nil || f.MediaFileID == nil {
		msg := "找不到关联的媒体文件"
		if err != nil {
			msg = err.Error()
		}
		_ = s.fileRepo.MarkFailed(ctx, fileID, truncate(msg, 2048))
		return
	}
	content, mime, filename, err := s.mediaSvc.DownloadBytes(ctx, *f.MediaFileID, kbMaxBytes)
	if err != nil {
		_ = s.fileRepo.MarkFailed(ctx, fileID, truncate("下载文件失败: "+err.Error(), 2048))
		return
	}
	// review chatgpt-codex P1：显式把 snapshot 的 activeProfileID 传给 ai-service。
	// 否则 ai-service 退化到"当前 active profile"，若批处理执行中 admin 切换了
	// active 指针，已 dispatch 的剩余文件会写入新 profile → 新旧 profile 各持
	// 部分文件向量 → 召回不一致。
	// kbID > 0 时 ai-service 会做 profile.kb_id == kb_id 校验（同轮另一处修复），
	// 既防错配又防迁移竞态。
	payload := KBIndexPayload{
		Filename: filename,
		MimeType: mime,
		Content:  content,
	}
	if activeProfileID != nil {
		payload.TargetProfileID = *activeProfileID
		payload.TargetStatus = model.KBProfileStatusActive
	}
	result, err := s.indexer.IndexFile(ctx, kbID, fileID, payload)
	if err != nil {
		log.Error().Err(err).Int64("kb_id", kbID).Int64("file_id", fileID).Msg("kb index failed (batch)")
		_ = s.fileRepo.MarkFailed(ctx, fileID, truncate(err.Error(), 2048))
		return
	}
	if result.Status == model.KBVectorStatusFailed || result.Error != "" {
		_ = s.fileRepo.MarkFailed(ctx, fileID, truncate(result.Error, 2048))
	} else {
		_ = s.fileRepo.MarkSucceeded(ctx, fileID, result.ChunkCount, result.DocChars, result.DocTokens)
	}
}

// =====================================================================
// 文件列表 & 详情 & 删除
// =====================================================================

// ListFiles 列表查询。
// SYSTEM_POSTS 库走特殊路径：反查 posts + post_embeddings 拼成 KBFileVO，
// 不读 kb_files 表（该表对 SYSTEM_POSTS 而言为空）。
func (s *KBService) ListFiles(ctx context.Context, kbID int64, q dto.KBFileListQuery, uc *KBUserContext) ([]dto.KBFileVO, int64, error) {
	kb, err := s.kbRepo.FindByID(ctx, kbID)
	if err != nil {
		return nil, 0, err
	}
	if kb == nil {
		return nil, 0, ErrKBNotFound
	}
	if s.resolveEffectivePermission(ctx, kb, uc) == "" {
		return nil, 0, ErrKBPermission
	}
	if kb.Kind == model.KBKindSystemPosts {
		return s.listPostsAsKBFiles(ctx, kb, q)
	}
	rows, total, err := s.fileRepo.ListByKB(ctx, repository.KBFileListFilter{
		KBID:     kbID,
		Status:   q.Status,
		Category: q.Category,
		Keyword:  q.Keyword,
		Year:     q.Year,
		Month:    q.Month,
		Day:      q.Day,
		PageNum:  q.PageNum,
		PageSize: q.PageSize,
	})
	if err != nil {
		return nil, 0, err
	}
	out := make([]dto.KBFileVO, 0, len(rows))
	for _, f := range rows {
		out = append(out, s.enrichFileVO(ctx, f))
	}
	return out, total, nil
}

// listPostsAsKBFiles 把 posts 视为 SYSTEM_POSTS 库的虚拟文件。
// 状态映射：
//
//	posts.embedding_status='索引' → 成功
//	posts.embedding_status='待处理' → 待处理
//	posts.embedding_status='失败' → 失败
//
// chunk_count 来自 post_embeddings 的 active 行数。
func (s *KBService) listPostsAsKBFiles(ctx context.Context, kb *model.KnowledgeBase, q dto.KBFileListQuery) ([]dto.KBFileVO, int64, error) {
	pageNum := q.PageNum
	if pageNum < 1 {
		pageNum = 1
	}
	pageSize := q.PageSize
	if pageSize < 1 {
		pageSize = 20
	}
	// 状态过滤映射（KB 侧 SUCCEEDED/PENDING/FAILED 对应 posts 侧 INDEXED/PENDING/FAILED）
	var statusFilter string
	switch q.Status {
	case model.KBVectorStatusSucceeded:
		statusFilter = "INDEXED"
	case model.KBVectorStatusFailed:
		statusFilter = "FAILED"
	case model.KBVectorStatusPending, model.KBVectorStatusRunning:
		statusFilter = "PENDING"
	}
	// 关键字 / 状态拼 WHERE
	args := []any{}
	sb := strings.Builder{}
	sb.WriteString(`FROM posts p WHERE p.deleted = FALSE`)
	idx := 1
	if statusFilter != "" {
		sb.WriteString(fmt.Sprintf(" AND p.embedding_status = $%d", idx))
		args = append(args, statusFilter)
		idx++
	}
	if q.Keyword != "" {
		sb.WriteString(fmt.Sprintf(" AND (p.title ILIKE $%d OR p.slug ILIKE $%d)", idx, idx))
		args = append(args, "%"+dbutil.EscapeLike(q.Keyword)+"%")
		idx++
	}
	base := sb.String()

	var total int64
	if err := s.db.GetContext(ctx, &total, "SELECT COUNT(*) "+base, args...); err != nil {
		return nil, 0, err
	}
	args = append(args, pageSize, (pageNum-1)*pageSize)
	q1 := fmt.Sprintf(`
        SELECT p.id, p.title, p.slug, p.embedding_status, p.created_at, p.updated_at,
               COALESCE((SELECT COUNT(*) FROM post_embeddings pe WHERE pe.post_id = p.id AND pe.status = 'active'), 0) AS chunk_count
        %s
        ORDER BY p.updated_at DESC
        LIMIT $%d OFFSET $%d`, base, idx, idx+1)

	rows, err := s.db.QueryxContext(ctx, q1, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []dto.KBFileVO{}
	for rows.Next() {
		var (
			id       int64
			title    string
			slug     string
			status   string
			created  time.Time
			updated  time.Time
			chunkCnt int
		)
		if err := rows.Scan(&id, &title, &slug, &status, &created, &updated, &chunkCnt); err != nil {
			return nil, 0, err
		}
		vStatus := model.KBVectorStatusPending
		switch status {
		case "INDEXED":
			vStatus = model.KBVectorStatusSucceeded
		case "FAILED":
			vStatus = model.KBVectorStatusFailed
		}
		t := title
		titlePtr := &t
		pid := id
		out = append(out, dto.KBFileVO{
			ID:           id,
			KBID:         kb.ID,
			PostID:       &pid,
			Title:        titlePtr,
			ChunkCount:   chunkCnt,
			VectorStatus: vStatus,
			SourceURL:    pStr("/posts/" + slug),
			CreatedAt:    created,
			UpdatedAt:    updated,
		})
	}
	return out, total, nil
}

// GetFile 文件详情。
// GetFile 文件详情。
// kbID > 0 时强制校验文件属于该 KB（防 nested-resource scoping 绕过）；
// kbID == 0 由可信内部调用使用（如 UploadFile 拿刚插入的 row）。
func (s *KBService) GetFile(ctx context.Context, kbID, fileID int64, uc *KBUserContext) (*dto.KBFileVO, error) {
	f, err := s.fileRepo.FindByID(ctx, fileID)
	if err != nil {
		return nil, err
	}
	if f == nil {
		return nil, ErrKBFileNotFound
	}
	if kbID > 0 && f.KBID != kbID {
		return nil, ErrKBFileWrongKB
	}
	kb, err := s.kbRepo.FindByID(ctx, f.KBID)
	if err != nil {
		return nil, err
	}
	if kb == nil || s.resolveEffectivePermission(ctx, kb, uc) == "" {
		return nil, ErrKBPermission
	}
	vo := s.enrichFileVO(ctx, *f)
	return &vo, nil
}

// DeleteFile 删除 kb_files 行。media_files 不同步删除（用户可能想保留物理文件）。
// DeleteFile 删除 kb_files 行。
// kbID 是 URL 路径上的父资源 id，必须与文件实际所属 kb_id 匹配 —— 否则
// 拒绝（review chatgpt-codex P2 修复：避免 nested-resource scoping 被绕过 ——
// 即使 user 对 KB A 有 EDIT，也不能用 /kbs/A/files/<fid_B> 删 KB B 的文件）。
func (s *KBService) DeleteFile(ctx context.Context, kbID, fileID int64, uc *KBUserContext) error {
	f, err := s.fileRepo.FindByID(ctx, fileID)
	if err != nil {
		return err
	}
	if f == nil {
		return nil // idempotent
	}
	if f.KBID != kbID {
		return ErrKBFileWrongKB
	}
	kb, err := s.kbRepo.FindByID(ctx, kbID)
	if err != nil {
		return err
	}
	if kb == nil || !s.canEdit(ctx, kb, uc) {
		return ErrKBPermission
	}
	if err := s.fileRepo.Delete(ctx, fileID); err != nil {
		return err
	}
	_ = s.kbRepo.RefreshStats(ctx, kb.ID)
	return nil
}

// =====================================================================
// 统计 / 时间轴
// =====================================================================

func (s *KBService) Stats(ctx context.Context, kbID int64, uc *KBUserContext) (*dto.KBStatsVO, error) {
	kb, err := s.kbRepo.FindByID(ctx, kbID)
	if err != nil {
		return nil, err
	}
	if kb == nil {
		return nil, ErrKBNotFound
	}
	if s.resolveEffectivePermission(ctx, kb, uc) == "" {
		return nil, ErrKBPermission
	}
	counts, _ := s.fileRepo.CountByStatus(ctx, kbID)
	timeline, _ := s.fileRepo.TimelineBuckets(ctx, kbID)
	out := &dto.KBStatsVO{
		FileCount:       kb.FileCount,
		ChunkCount:      kb.ChunkCount,
		VectorizedCount: counts[model.KBVectorStatusSucceeded],
		FailedCount:     counts[model.KBVectorStatusFailed],
		PendingCount:    counts[model.KBVectorStatusPending] + counts[model.KBVectorStatusRunning],
		TotalTokens:     kb.TotalTokens,
	}
	for _, b := range timeline {
		out.TimelineBuckets = append(out.TimelineBuckets, dto.KBTimelineBucket{Year: b.Year, Month: b.Month, Count: b.Count})
	}
	return out, nil
}

// =====================================================================
// 灵境 picker
// =====================================================================

// FilterAuthorizedKBIDs 给灵境 chat 走 SECURITY 防线：客户端传上来的 kbIds
// 必须先在服务端按当前用户权限（≥ USE）过滤，未授权的直接剔除。
//
// 这是为了防止已登录用户通过手工拼装 kbIds 注入不属于自己的私有库内容到 prompt
// （review chatgpt-codex P1 修复）。SYSTEM_POSTS 库走 visibility=PUBLIC 兜底；其他
// 私有库严格走 owner ∪ kb_members ≥ USE。
func (s *KBService) FilterAuthorizedKBIDs(ctx context.Context, ids []int64, uc *KBUserContext) []int64 {
	if len(ids) == 0 {
		return nil
	}
	allowed := make([]int64, 0, len(ids))
	seen := map[int64]bool{}
	for _, id := range ids {
		if id <= 0 || seen[id] {
			continue
		}
		seen[id] = true
		kb, err := s.kbRepo.FindByID(ctx, id)
		if err != nil || kb == nil {
			continue
		}
		level := s.resolveEffectivePermission(ctx, kb, uc)
		// USE / EDIT / MANAGE 都允许参与对话；VIEW 仅看清单不能用
		if level == model.KBPermissionUse || level == model.KBPermissionEdit || level == model.KBPermissionManage {
			allowed = append(allowed, id)
		}
	}
	return allowed
}

// ListForPicker 返回用户在权限 ≥ USE 的 KB（含 SYSTEM_POSTS、用户自有、被授权的）。
// 与 ListAccessible 不同：精简为 AgentKnowledgeBaseVO + 只过滤 USE 以上权限。
func (s *KBService) ListForPicker(ctx context.Context, uc *KBUserContext, keyword string) ([]dto.AgentKnowledgeBaseVO, error) {
	full, err := s.ListAccessible(ctx, uc, "", keyword)
	if err != nil {
		return nil, err
	}
	out := make([]dto.AgentKnowledgeBaseVO, 0, len(full))
	for _, kb := range full {
		switch kb.EffectivePermission {
		case model.KBPermissionUse, model.KBPermissionEdit, model.KBPermissionManage:
			out = append(out, dto.AgentKnowledgeBaseVO{
				ID:            kb.ID,
				Slug:          kb.Slug,
				Name:          kb.Name,
				Icon:          kb.Icon,
				Color:         kb.Color,
				Kind:          kb.Kind,
				ActiveProfile: kb.ActiveProfile,
				FileCount:     kb.FileCount,
				ChunkCount:    kb.ChunkCount,
			})
		}
	}
	return out, nil
}

// =====================================================================
// 轮廓
// =====================================================================

func (s *KBService) ListProfiles(ctx context.Context, kbID int64, uc *KBUserContext) ([]dto.KBProfileVO, error) {
	kb, err := s.kbRepo.FindByID(ctx, kbID)
	if err != nil {
		return nil, err
	}
	if kb == nil {
		return nil, ErrKBNotFound
	}
	if s.resolveEffectivePermission(ctx, kb, uc) == "" {
		return nil, ErrKBPermission
	}
	rows, err := s.profileRepo.ListByKB(ctx, kbID)
	if err != nil {
		return nil, err
	}
	out := make([]dto.KBProfileVO, len(rows))
	for i, p := range rows {
		out[i] = toKBProfileVO(p)
	}
	return out, nil
}

func (s *KBService) CreateProfile(ctx context.Context, kbID int64, req dto.CreateKBProfileRequest, uc *KBUserContext) (*dto.KBProfileVO, error) {
	kb, err := s.kbRepo.FindByID(ctx, kbID)
	if err != nil {
		return nil, err
	}
	if kb == nil {
		return nil, ErrKBNotFound
	}
	if !s.canManage(ctx, kb, uc) {
		return nil, ErrKBPermission
	}
	if req.ChunkOverlapTokens >= req.ChunkSizeTokens {
		return nil, fmt.Errorf("%w: chunkOverlapTokens 必须小于 chunkSizeTokens", ErrKBProfileBadConfig)
	}
	p, err := s.profileRepo.Create(ctx, repository.KBProfileCreateRequest{
		KBID:               kbID,
		Code:               req.Code,
		Name:               req.Name,
		Description:        req.Description,
		ModelID:            req.ModelID,
		ChunkerKind:        req.ChunkerKind,
		ChunkSizeTokens:    req.ChunkSizeTokens,
		ChunkOverlapTokens: req.ChunkOverlapTokens,
		TopK:               req.TopK,
		ScoreThreshold:     req.ScoreThreshold,
		Status:             model.KBProfileStatusShadow, // 新 profile 一律以 shadow 开始
	})
	if err != nil {
		return nil, err
	}
	vo := toKBProfileVO(*p)
	return &vo, nil
}

func (s *KBService) UpdateProfile(ctx context.Context, kbID, profileID int64, req dto.UpdateKBProfileRequest, uc *KBUserContext) (*dto.KBProfileVO, error) {
	kb, err := s.kbRepo.FindByID(ctx, kbID)
	if err != nil {
		return nil, err
	}
	if kb == nil {
		return nil, ErrKBNotFound
	}
	if !s.canManage(ctx, kb, uc) {
		return nil, ErrKBPermission
	}
	p, err := s.profileRepo.FindByID(ctx, profileID)
	if err != nil {
		return nil, err
	}
	if p == nil || p.KBID != kbID {
		return nil, ErrKBProfileNotFound
	}
	sets := map[string]any{}
	if req.Name != nil {
		sets["name"] = *req.Name
	}
	if req.Description != nil {
		sets["description"] = req.Description
	}
	if p.Status == model.KBProfileStatusShadow {
		// shadow profile 允许改结构性字段
		if req.ModelID != nil {
			sets["model_id"] = *req.ModelID
		}
		if req.ChunkerKind != nil {
			sets["chunker_kind"] = *req.ChunkerKind
		}
		// review chatgpt-codex P2：chunk_size / overlap 是 DB CHECK 约束
		// (chk_kb_profile_overlap: overlap < size) 的两个字段，必须在写库前
		// 算"有效值"做关系校验。否则单独传 overlap 但不传 size、或者反过来，
		// 都会触发 PG 23514 → handler 500（业务校验 should be 4xx）。
		effSize := p.ChunkSizeTokens
		if req.ChunkSizeTokens != nil {
			effSize = *req.ChunkSizeTokens
		}
		effOverlap := p.ChunkOverlapTokens
		if req.ChunkOverlapTokens != nil {
			effOverlap = *req.ChunkOverlapTokens
		}
		if effOverlap >= effSize {
			return nil, fmt.Errorf("%w: chunk_overlap_tokens (%d) 必须小于 chunk_size_tokens (%d)", ErrKBProfileBadConfig, effOverlap, effSize)
		}
		if req.ChunkSizeTokens != nil {
			sets["chunk_size_tokens"] = *req.ChunkSizeTokens
		}
		if req.ChunkOverlapTokens != nil {
			sets["chunk_overlap_tokens"] = *req.ChunkOverlapTokens
		}
	}
	// active 与 shadow 都允许改运行时召回参数
	if req.TopK != nil {
		sets["top_k"] = *req.TopK
	}
	if req.ScoreThreshold != nil {
		sets["score_threshold"] = *req.ScoreThreshold
	}
	if err := s.profileRepo.Update(ctx, profileID, sets); err != nil {
		return nil, err
	}
	updated, _ := s.profileRepo.FindByID(ctx, profileID)
	if updated == nil {
		return nil, ErrKBProfileNotFound
	}
	vo := toKBProfileVO(*updated)
	return &vo, nil
}

// MigrateProfile 蓝绿迁移 + 激活：
//  1. 校验：MANAGE 权限、profile 属于该 kb 且不是 active
//  2. 立即返回（HTTP 202 语义） —— 后台 goroutine 遍历 KB 全部 kb_files：
//     下载字节 → 用 target profile 索引到 status='shadow' 行
//  3. 全部成功后 CommitBlueGreen 事务做最终切换
//  4. 任一文件失败：abort，部分 shadow 行保留，可重试（不影响 active）
//
// 修复评审：
//   - chatgpt-codex P2：用 cursor 分页迭代全部文件，不再单页 10000 上限
//   - gemini High：改为后台 goroutine 异步，避免大库超 Nginx 60s timeout
func (s *KBService) MigrateProfile(ctx context.Context, kbID, profileID int64, uc *KBUserContext) error {
	kb, err := s.kbRepo.FindByID(ctx, kbID)
	if err != nil {
		return err
	}
	if kb == nil {
		return ErrKBNotFound
	}
	if !s.canManage(ctx, kb, uc) {
		return ErrKBPermission
	}
	p, err := s.profileRepo.FindByID(ctx, profileID)
	if err != nil {
		return err
	}
	if p == nil || p.KBID != kbID {
		return ErrKBProfileNotFound
	}
	if p.Status == model.KBProfileStatusActive {
		return nil
	}
	if p.Status == model.KBProfileStatusDeprecated {
		return ErrKBProfileBadState
	}

	// review chatgpt-codex P1：拿 PG advisory lock 防同 KB 并发迁移。
	// 重复 /migrate 同 KB 会让两个 goroutine 同时改 (kb_file_id, profile_id) embeddings →
	// 一方的 DELETE/INSERT 覆盖另一方 → CommitBlueGreen 时数据不一致甚至少行。
	// 用 advisory lock 的好处：
	//   - 多实例部署也安全（同 PG 集群锁是全局的）
	//   - 连接关闭时自动释放，不会因 goroutine panic 而永久锁住
	//   - 不需要 schema 修改
	migrateConn, err := s.db.Connx(ctx)
	if err != nil {
		return fmt.Errorf("acquire conn for migrate lock: %w", err)
	}
	var locked bool
	if err := migrateConn.GetContext(ctx, &locked,
		`SELECT pg_try_advisory_lock($1, $2)`, kbMigrateAdvisoryClass, kbID); err != nil {
		_ = migrateConn.Close()
		return fmt.Errorf("try advisory lock: %w", err)
	}
	if !locked {
		_ = migrateConn.Close()
		return ErrKBMigrateInProgress
	}

	// 立即异步调度。前端通过文件列表 vector_status 轮询观察 shadow 进度；
	// 全部 shadow SUCCEEDED + CommitBlueGreen 完成后，profile 状态会翻成 active
	// （前端 useEffect 在用户切回 profile tab 时拉新即可看到）。
	go func() {
		bg := context.Background()
		// 释放 advisory lock + 关 conn（即便连 panic 也保证）
		defer func() {
			if r := recover(); r != nil {
				log.Error().Interface("panic", r).Int64("kb_id", kbID).Msg("kb migrate: panic, releasing lock")
			}
			_, _ = migrateConn.ExecContext(context.Background(),
				`SELECT pg_advisory_unlock($1, $2)`, kbMigrateAdvisoryClass, kbID)
			_ = migrateConn.Close()
		}()
		log.Info().Int64("kb_id", kbID).Int64("target_profile_id", profileID).Msg("kb: blue-green migration started")

		// 全量分页迭代 kb_files（不再一次性 pageSize=10000 截断）
		page := 1
		var totalFiles, doneFiles int
		for {
			rows, total, lerr := s.fileRepo.ListByKB(bg, repository.KBFileListFilter{
				KBID: kbID, PageNum: page, PageSize: 200,
			})
			if lerr != nil {
				log.Error().Err(lerr).Int64("kb_id", kbID).Int("page", page).Msg("kb migrate: list page failed, abort")
				return
			}
			totalFiles = int(total)
			if len(rows) == 0 {
				break
			}
			for _, f := range rows {
				if f.MediaFileID == nil {
					continue
				}
				// review chatgpt-codex P2：每个文件落进度状态到 kb_files，admin UI
				// 才能轮询观察 shadow reindex 进度 / 失败原因（之前 goroutine 全程
				// 不写状态 → 失败时 abort 静默，操作员无从诊断）。
				// 注：MarkRunning/MarkFailed/MarkSucceeded 写的是 vector_profile_id =
				// 目标 profile（即 shadow profile），表达"该文件当前正在被该 profile
				// 重建"。CommitBlueGreen 成功后这些状态自然成为 active。
				if err := s.fileRepo.MarkRunning(bg, f.ID, profileID); err != nil {
					log.Warn().Err(err).Int64("file_id", f.ID).Msg("kb migrate: mark running failed")
				}
				content, mime, filename, derr := s.mediaSvc.DownloadBytes(bg, *f.MediaFileID, kbMaxBytes)
				if derr != nil {
					_ = s.fileRepo.MarkFailed(bg, f.ID, truncate("迁移阶段下载失败: "+derr.Error(), 2048))
					_ = s.kbRepo.RefreshStats(bg, kbID)
					log.Error().Err(derr).Int64("kb_id", kbID).Int64("file_id", f.ID).Msg("kb migrate: download failed, abort")
					return
				}
				result, ierr := s.indexer.IndexFile(bg, kbID, f.ID, KBIndexPayload{
					Filename:        filename,
					MimeType:        mime,
					Content:         content,
					TargetProfileID: profileID,
					TargetStatus:    model.KBProfileStatusShadow,
				})
				if ierr != nil {
					_ = s.fileRepo.MarkFailed(bg, f.ID, truncate("迁移阶段索引调用失败: "+ierr.Error(), 2048))
					_ = s.kbRepo.RefreshStats(bg, kbID)
					log.Error().Err(ierr).Int64("kb_id", kbID).Int64("file_id", f.ID).Msg("kb migrate: index call failed, abort")
					return
				}
				if result.Status == model.KBVectorStatusFailed || result.Error != "" {
					_ = s.fileRepo.MarkFailed(bg, f.ID, truncate("迁移阶段索引返回失败: "+result.Error, 2048))
					_ = s.kbRepo.RefreshStats(bg, kbID)
					log.Error().Str("err", result.Error).Int64("kb_id", kbID).Int64("file_id", f.ID).Msg("kb migrate: index returned failed, abort")
					return
				}
				_ = s.fileRepo.MarkSucceeded(bg, f.ID, result.ChunkCount, result.DocChars, result.DocTokens)
				doneFiles++
			}
			if int64(page*200) >= total {
				break
			}
			page++
		}

		if err := s.profileRepo.CommitBlueGreen(bg, kbID, profileID); err != nil {
			log.Error().Err(err).Int64("kb_id", kbID).Msg("kb migrate: commit blue-green failed")
			return
		}
		_ = s.kbRepo.RefreshStats(bg, kbID)
		log.Info().
			Int64("kb_id", kbID).
			Int64("target_profile_id", profileID).
			Int("total", totalFiles).
			Int("done", doneFiles).
			Msg("kb: blue-green migration finished + activated")
	}()
	return nil
}

func (s *KBService) ActivateProfile(ctx context.Context, kbID, profileID int64, uc *KBUserContext) error {
	kb, err := s.kbRepo.FindByID(ctx, kbID)
	if err != nil {
		return err
	}
	if kb == nil {
		return ErrKBNotFound
	}
	if !s.canManage(ctx, kb, uc) {
		return ErrKBPermission
	}
	p, err := s.profileRepo.FindByID(ctx, profileID)
	if err != nil {
		return err
	}
	if p == nil || p.KBID != kbID {
		return ErrKBProfileNotFound
	}
	if p.Status == model.KBProfileStatusActive {
		return nil
	}
	if p.Status == model.KBProfileStatusShadow {
		// Shadow profile 还没有可供检索的 active embeddings。必须走蓝绿迁移：
		// 先按目标 profile 写 shadow embeddings，再由 CommitBlueGreen 原子提升。
		return ErrKBProfileBadState
	}
	return s.profileRepo.Activate(ctx, kbID, profileID)
}

func (s *KBService) DeleteProfile(ctx context.Context, kbID, profileID int64, uc *KBUserContext) error {
	kb, err := s.kbRepo.FindByID(ctx, kbID)
	if err != nil {
		return err
	}
	if kb == nil {
		return ErrKBNotFound
	}
	if !s.canManage(ctx, kb, uc) {
		return ErrKBPermission
	}
	p, err := s.profileRepo.FindByID(ctx, profileID)
	if err != nil {
		return err
	}
	if p == nil || p.KBID != kbID {
		return ErrKBProfileNotFound
	}
	if p.Status == model.KBProfileStatusActive {
		return ErrKBProfileBadState
	}
	return s.profileRepo.Delete(ctx, profileID)
}

// =====================================================================
// 成员
// =====================================================================

func (s *KBService) ListMembers(ctx context.Context, kbID int64, uc *KBUserContext) ([]dto.KBMemberVO, error) {
	kb, err := s.kbRepo.FindByID(ctx, kbID)
	if err != nil {
		return nil, err
	}
	if kb == nil {
		return nil, ErrKBNotFound
	}
	if s.resolveEffectivePermission(ctx, kb, uc) == "" {
		return nil, ErrKBPermission
	}
	rows, err := s.memberRepo.ListByKBWithNames(ctx, kbID)
	if err != nil {
		return nil, err
	}
	out := make([]dto.KBMemberVO, len(rows))
	for i, m := range rows {
		vo := toKBMemberVO(m.KBMember)
		vo.PrincipalName = m.PrincipalName
		vo.GrantedByName = m.GrantedByName
		out[i] = vo
	}
	return out, nil
}

func (s *KBService) UpsertMember(ctx context.Context, kbID int64, req dto.CreateKBMemberRequest, uc *KBUserContext) (*dto.KBMemberVO, error) {
	kb, err := s.kbRepo.FindByID(ctx, kbID)
	if err != nil {
		return nil, err
	}
	if kb == nil {
		return nil, ErrKBNotFound
	}
	if !s.canManage(ctx, kb, uc) {
		return nil, ErrKBPermission
	}
	var expiresAt any
	if req.ExpiresAt != nil {
		expiresAt = *req.ExpiresAt
	}
	id, err := s.memberRepo.Upsert(ctx, kbID, req.PrincipalType, req.PrincipalID, req.PermissionLevel, &uc.UserID, expiresAt)
	if err != nil {
		return nil, err
	}
	m, err := s.memberRepo.FindByID(ctx, id)
	if err != nil || m == nil {
		return nil, fmt.Errorf("成员写入后查不到")
	}
	vo := toKBMemberVO(*m)
	return &vo, nil
}

func (s *KBService) DeleteMember(ctx context.Context, kbID, memberID int64, uc *KBUserContext) error {
	kb, err := s.kbRepo.FindByID(ctx, kbID)
	if err != nil {
		return err
	}
	if kb == nil {
		return ErrKBNotFound
	}
	if !s.canManage(ctx, kb, uc) {
		return ErrKBPermission
	}
	// SECURITY (review chatgpt-codex P1)：必须验证 memberID 属于本 KB，否则 KB A
	// 的 MANAGE 用户可猜测 ID 删除 KB B 的成员授权，造成跨 KB 权限篡改。
	m, err := s.memberRepo.FindByID(ctx, memberID)
	if err != nil {
		return err
	}
	if m == nil {
		return nil // 已不存在 → idempotent 成功
	}
	if m.KBID != kbID {
		return ErrKBMemberWrongKB
	}
	return s.memberRepo.Delete(ctx, memberID)
}

// =====================================================================
// 内部辅助
// =====================================================================

func (s *KBService) enrichFileVO(ctx context.Context, f model.KBFile) dto.KBFileVO {
	vo := toKBFileVO(f)
	// 关联 media_files / posts 取展示字段
	if f.MediaFileID != nil {
		mediaVO, err := s.mediaSvc.GetByID(ctx, *f.MediaFileID)
		if err == nil && mediaVO != nil {
			fn := mediaVO.OriginalName
			vo.Filename = &fn
			size := mediaVO.FileSize
			vo.FileSize = &size
			if mediaVO.MimeType != nil {
				vo.MimeType = mediaVO.MimeType
			}
			fu := mediaVO.FileURL
			vo.FileURL = &fu
		}
	}
	return vo
}

func toKBVO(kb model.KnowledgeBase) dto.KnowledgeBaseVO {
	return dto.KnowledgeBaseVO{
		ID:              kb.ID,
		Slug:            kb.Slug,
		Name:            kb.Name,
		Description:     kb.Description,
		Icon:            kb.Icon,
		Color:           kb.Color,
		CoverImage:      kb.CoverImage,
		Kind:            kb.Kind,
		OwnerID:         kb.OwnerID,
		Visibility:      kb.Visibility,
		FolderID:        kb.FolderID,
		ActiveProfileID: kb.ActiveProfileID,
		FileCount:       kb.FileCount,
		ChunkCount:      kb.ChunkCount,
		VectorizedCount: kb.VectorizedCount,
		FailedCount:     kb.FailedCount,
		TotalTokens:     kb.TotalTokens,
		IsArchived:      kb.IsArchived,
		CreatedAt:       kb.CreatedAt,
		UpdatedAt:       kb.UpdatedAt,
	}
}

func toKBProfileVO(p model.KBProfile) dto.KBProfileVO {
	return dto.KBProfileVO{
		ID:                 p.ID,
		KBID:               p.KBID,
		Code:               p.Code,
		Name:               p.Name,
		Description:        p.Description,
		ModelID:            p.ModelID,
		ChunkerKind:        p.ChunkerKind,
		ChunkSizeTokens:    p.ChunkSizeTokens,
		ChunkOverlapTokens: p.ChunkOverlapTokens,
		TopK:               p.TopK,
		ScoreThreshold:     p.ScoreThreshold,
		Status:             p.Status,
		CreatedAt:          p.CreatedAt,
		UpdatedAt:          p.UpdatedAt,
	}
}

func toKBMemberVO(m model.KBMember) dto.KBMemberVO {
	return dto.KBMemberVO{
		ID:              m.ID,
		KBID:            m.KBID,
		PrincipalType:   m.PrincipalType,
		PrincipalID:     m.PrincipalID,
		PermissionLevel: m.PermissionLevel,
		GrantedBy:       m.GrantedBy,
		GrantedAt:       m.GrantedAt,
		ExpiresAt:       m.ExpiresAt,
	}
}

func toKBFileVO(f model.KBFile) dto.KBFileVO {
	return dto.KBFileVO{
		ID:              f.ID,
		KBID:            f.KBID,
		MediaFileID:     f.MediaFileID,
		PostID:          f.PostID,
		Category:        f.Category,
		Title:           f.Title,
		SourceURL:       f.SourceURL,
		DocChars:        f.DocChars,
		DocTokens:       f.DocTokens,
		ChunkCount:      f.ChunkCount,
		VectorStatus:    f.VectorStatus,
		VectorError:     f.VectorError,
		VectorProfileID: f.VectorProfileID,
		VectorizedAt:    f.VectorizedAt,
		AttemptCount:    f.AttemptCount,
		ArchivedYear:    f.ArchivedYear,
		ArchivedMonth:   f.ArchivedMonth,
		ArchivedDay:     f.ArchivedDay,
		CreatedAt:       f.CreatedAt,
		UpdatedAt:       f.UpdatedAt,
	}
}

var slugReg = regexp.MustCompile(`[^a-z0-9-]+`)
var slugStrictReg = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,118}[a-z0-9]?$`)

// slugifyStrict 对显式 slug 做严格校验（不丢字符，只判合法）。
// 合法：1-120 字符，全小写字母/数字/短横线，首尾非短横线。
// 返回值：合法返回原 slug；不合法返回经 slugifySimple 清洗后的"建议值"
// （由 caller 决定是接受清洗 vs 报错让用户修正）。
//
// 设计：分两步而非合一是为了让 caller 区分"未提供 vs 输入非法"两种语义。
func slugifyStrict(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	if slugStrictReg.MatchString(s) {
		return s
	}
	// 不合法 → 返回 sanitize 后的建议值；caller 决定是否报错
	return slugifySimple(s)
}

// slugifySimple 见 folder_repo.go（包内复用），这里仅声明引用占位避免 lint 抱怨。
// 实际 import 已经在 service 包内通过 repository.slugifySimple 不可直接调用，
// 因此我们在 service 包内复制一份等价实现 —— 见上方 slugFromName 已经走的清洗逻辑。
func slugifySimple(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = strings.ReplaceAll(s, " ", "-")
	s = slugReg.ReplaceAllString(s, "")
	s = strings.Trim(s, "-")
	if len(s) > 120 {
		s = s[:120]
	}
	return s
}

// slugFromName 派生 URL/路径友好 slug。
// 兼容中文/特殊字符：当 ASCII 子集为空（如纯中文名）时，回退到 "kb-<unix秒>"，
// 保证 CREATE TABLE knowledge_bases(slug UNIQUE) 不会因为空 slug 失败。
func slugFromName(name string) string {
	s := strings.ToLower(strings.TrimSpace(name))
	s = strings.ReplaceAll(s, " ", "-")
	s = slugReg.ReplaceAllString(s, "")
	s = strings.Trim(s, "-")
	if len(s) > 120 {
		s = s[:120]
	}
	if s == "" {
		s = fmt.Sprintf("kb-%d", time.Now().Unix())
	}
	return s
}

func pStr(v string) *string { return &v }

func ptrFloat(v float64) *float64 { return &v }

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

// 防 path 未使用警告（保留供未来文件路径派生使用）。
var _ = path.Join
