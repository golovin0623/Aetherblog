// Package service · kb_service.go — 知识库业务编排。
//
// 职责：
//   1. KB CRUD（含自动创建归档目录 + 默认 profile）
//   2. 权限解析（owner ∪ admin ∪ kb_members；返回 EffectivePermission）
//   3. 文件上传桥接（自动归档到 /root/_system_kb/<slug>/<yyyy>/<mm>/<dd>，触发 ai-service 向量化）
//   4. Profile CRUD + 蓝绿激活
//   5. 成员授权 CRUD
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
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/rs/zerolog/log"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/repository"
)

// =====================================================================
// 错误定义
// =====================================================================
var (
	ErrKBNotFound        = errors.New("知识库不存在")
	ErrKBSlugConflict    = errors.New("知识库 slug 已存在")
	ErrKBPermission      = errors.New("无权访问该知识库")
	ErrKBForbidSystem    = errors.New("系统级知识库不可执行该操作")
	ErrKBProfileNotFound = errors.New("索引档案不存在")
	ErrKBProfileBadState = errors.New("索引档案当前状态不允许该操作")
)

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
	db            *sqlx.DB
	kbRepo        *repository.KBRepo
	profileRepo   *repository.KBProfileRepo
	memberRepo    *repository.KBMemberRepo
	fileRepo      *repository.KBFileRepo
	mediaSvc      *MediaService
	folderSvc     *FolderService
	indexer       *KBIndexerClient
	defaultModel  string // 创建 CUSTOM KB 时默认 profile 的 model_id（同 search_profiles seed 策略）
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
//   1. slug 解析（若未提供则从 name 派生）
//   2. INSERT knowledge_bases 取得 id
//   3. EnsureFolderByPath /root/_system_kb/<slug>
//   4. UPDATE knowledge_bases.folder_id
//   5. INSERT 默认 profile（status='active', model 取 defaultModel, chunker='recursive'）
//   6. UPDATE knowledge_bases.active_profile_id
//
// 任何步骤失败都让上层 tx 回滚（这里用 sql 而非显式 begin，因为 EnsureFolderByPath
// 跨多 row，且文件夹幂等创建本身不需要回滚保护——失败的目录留着无害）。
func (s *KBService) Create(ctx context.Context, req dto.CreateKnowledgeBaseRequest, uc *KBUserContext) (*dto.KnowledgeBaseVO, error) {
	slug := strings.TrimSpace(req.Slug)
	if slug == "" {
		slug = slugFromName(req.Name)
	}
	if slug == "" {
		return nil, fmt.Errorf("无法从名称推导 slug，请显式指定 slug")
	}
	// 唯一性预检
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
		return nil, fmt.Errorf("insert knowledge_base: %w", err)
	}

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
		ScoreThreshold:     0.200,
		Status:             model.KBProfileStatusActive,
	})
	if err != nil {
		return nil, fmt.Errorf("insert default profile: %w", err)
	}
	if err := s.kbRepo.SetActiveProfile(ctx, kbID, defaultProfile.ID); err != nil {
		return nil, fmt.Errorf("set active profile: %w", err)
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
	return s.GetByIDForUser(ctx, kbID, uc)
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
//   - owner：MANAGE
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
//   1. 校验 EDIT 权限 + 库类型必须是 CUSTOM
//   2. EnsureFolderByPath /root/_system_kb/<slug>/<yyyy>/<mm>/<dd>
//   3. 在 KB 上传 context 下调用 MediaService.Upload
//   4. 插入 kb_files row（PENDING）
//   5. 启动 goroutine 调 ai-service 触发向量化（成功/失败状态写回 kb_files）
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
	return s.GetFile(ctx, fileID, uc)
}

// scheduleIndex 在后台 goroutine 中调用 ai-service 触发向量化。
// 失败结果写回 kb_files.vector_error，不影响主流程。
//
// 流程：
//   1. 标 RUNNING + 自增 attempt
//   2. 从 MediaService 下载文件原始字节（限 10MB）
//   3. POST 到 ai-service /v1/kb/.../index，传 base64 content + mime
//   4. 写 SUCCEEDED / FAILED
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
		result, err := s.indexer.IndexFile(ctx, kbID, fileID, KBIndexPayload{
			Filename: filename,
			MimeType: mime,
			Content:  content,
		})
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
	s.scheduleIndex(kbID, fileID, kb.ActiveProfileID)
	return nil
}

// ReindexAll 触发整库重建（异步）。
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
	return s.indexer.ReindexAll(ctx, kbID)
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
//   posts.embedding_status='INDEXED' → SUCCEEDED
//   posts.embedding_status='PENDING' → PENDING
//   posts.embedding_status='FAILED'  → FAILED
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
		args = append(args, "%"+q.Keyword+"%")
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
func (s *KBService) GetFile(ctx context.Context, fileID int64, uc *KBUserContext) (*dto.KBFileVO, error) {
	f, err := s.fileRepo.FindByID(ctx, fileID)
	if err != nil {
		return nil, err
	}
	if f == nil {
		return nil, fmt.Errorf("文件不存在")
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
func (s *KBService) DeleteFile(ctx context.Context, fileID int64, uc *KBUserContext) error {
	f, err := s.fileRepo.FindByID(ctx, fileID)
	if err != nil {
		return err
	}
	if f == nil {
		return nil
	}
	kb, err := s.kbRepo.FindByID(ctx, f.KBID)
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
// Profile
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
		return nil, fmt.Errorf("chunkOverlapTokens 必须小于 chunkSizeTokens")
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
//   1. 校验：MANAGE 权限、profile 属于该 kb 且不是 active
//   2. 遍历 KB 全部 kb_files：下载字节 → 用 target profile 索引到 status='shadow' 行
//   3. 全部成功后 CommitBlueGreen 事务做最终切换
//
// 任一文件失败：abort，状态保留为部分 shadow 行，后续可重试。
// 同步执行（admin 在 UI 上等待）；大库适合 Phase3 改 SSE 推流式进度。
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

	// 遍历 KB 文件并 shadow reindex
	files, _, err := s.fileRepo.ListByKB(ctx, repository.KBFileListFilter{
		KBID: kbID, PageNum: 1, PageSize: 10000,
	})
	if err != nil {
		return fmt.Errorf("list kb files: %w", err)
	}
	for _, f := range files {
		if f.MediaFileID == nil {
			continue // SYSTEM_POSTS 等非媒体文件目前不参与迁移
		}
		content, mime, filename, derr := s.mediaSvc.DownloadBytes(ctx, *f.MediaFileID, kbMaxBytes)
		if derr != nil {
			return fmt.Errorf("download kb_file %d: %w", f.ID, derr)
		}
		result, ierr := s.indexer.IndexFile(ctx, kbID, f.ID, KBIndexPayload{
			Filename:        filename,
			MimeType:        mime,
			Content:         content,
			TargetProfileID: profileID,
			TargetStatus:    model.KBProfileStatusShadow, // 写入 shadow 行
		})
		if ierr != nil {
			return fmt.Errorf("reindex kb_file %d: %w", f.ID, ierr)
		}
		if result.Status == model.KBVectorStatusFailed || result.Error != "" {
			return fmt.Errorf("reindex kb_file %d failed: %s", f.ID, result.Error)
		}
	}
	// 全部成功 → 最终切换事务
	if err := s.profileRepo.CommitBlueGreen(ctx, kbID, profileID); err != nil {
		return fmt.Errorf("commit blue-green: %w", err)
	}
	_ = s.kbRepo.RefreshStats(ctx, kbID)
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

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

// 防 path 未使用警告（保留供未来文件路径派生使用）。
var _ = path.Join
