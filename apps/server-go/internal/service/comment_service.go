package service

import (
	"context"
	"errors"
	"strings"

	"github.com/rs/zerolog/log"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/pkg/pagination"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/repository"
)

// CommentService 管理评论审核流程与公开评论提交业务。
type CommentService struct {
	repo     *repository.CommentRepo
	postRepo *repository.PostRepo
	// settings 可选；用于读取站点级评论开关（comment_enabled）与审核策略
	// （comment_audit）。为 nil 时退化为「允许评论 + 强制审核」的安全默认值，
	// 保证旧调用路径与单测不受影响。
	settings *SiteSettingService
}

// NewCommentService 使用给定的评论仓储、文章仓储与站点设置服务创建 CommentService 实例。
// settings 可传 nil（退化为安全默认值），生产路径应注入以使后台评论开关真实生效。
func NewCommentService(repo *repository.CommentRepo, postRepo *repository.PostRepo, settings *SiteSettingService) *CommentService {
	return &CommentService{repo: repo, postRepo: postRepo, settings: settings}
}

// boolSetting 读取布尔型站点配置；服务未注入、键缺失或解析为空时返回 fallback。
// "true" / "1" / "yes" 视为 true，其余非空值视为 false。
func (s *CommentService) boolSetting(ctx context.Context, key string, fallback bool) bool {
	if s.settings == nil {
		return fallback
	}
	v, err := s.settings.GetValue(ctx, key)
	if err != nil {
		log.Warn().Err(err).Str("key", key).Msg("comment: read site setting failed, using fallback")
		return fallback
	}
	// 大小写/空白不敏感：兼容 DB 里存的 "True" / "TRUE" / " true " 等写法
	lv := strings.ToLower(strings.TrimSpace(v))
	if lv == "" {
		return fallback
	}
	return lv == "true" || lv == "1" || lv == "yes"
}

// --- 管理端接口 ---

// GetPending 返回分页的待审核（PENDING）评论列表，供管理员审核队列使用。
func (s *CommentService) GetPending(ctx context.Context, p pagination.Params) (*response.PageResult, error) {
	cs, total, err := s.repo.FindPending(ctx, p)
	if err != nil {
		return nil, err
	}
	vos := toCommentVOs(cs)
	s.enrichCommentRefs(ctx, cs, vos)
	pr := response.NewPageResult(vos, total, p.PageNum, p.PageSize)
	return &pr, nil
}

// GetForAdmin 返回支持多条件过滤的分页评论列表，供管理后台评论管理页使用。
func (s *CommentService) GetForAdmin(ctx context.Context, f dto.CommentFilter) (*response.PageResult, error) {
	cs, total, err := s.repo.FindForAdmin(ctx, f)
	if err != nil {
		return nil, err
	}
	vos := toCommentVOs(cs)
	s.enrichCommentRefs(ctx, cs, vos)
	pr := response.NewPageResult(vos, total, f.PageNum, f.PageSize)
	return &pr, nil
}

// GetByID 通过主键查询单条评论，不存在时返回 nil, nil。
func (s *CommentService) GetByID(ctx context.Context, id int64) (*dto.CommentVO, error) {
	c, err := s.repo.FindByID(ctx, id)
	if err != nil || c == nil {
		return nil, err
	}
	vo := toCommentVO(*c)
	return &vo, nil
}

// Approve 将评论状态设为 APPROVED（已通过）。
// 审核通过后异步更新该文章的评论计数缓存。
// 错误场景：评论不存在;评论已被软删除(防止"复活"墓碑评论到公开列表)。
func (s *CommentService) Approve(ctx context.Context, id int64) error {
	c, err := s.ensureExists(ctx, id)
	if err != nil {
		return err
	}
	if c.Status == "DELETED" {
		return errors.New("评论已被删除,请先恢复后再审核")
	}
	if err := s.repo.UpdateStatus(ctx, id, "APPROVED"); err != nil {
		return err
	}
	// 异步更新文章评论数，避免阻塞当前请求
	s.refreshPostCommentCountAsync(c.PostID)
	return nil
}

// Reject 将评论状态设为 REJECTED（已拒绝），并异步更新文章评论计数。
// 错误场景：评论不存在。
func (s *CommentService) Reject(ctx context.Context, id int64) error {
	c, err := s.ensureExists(ctx, id)
	if err != nil {
		return err
	}
	if err := s.repo.UpdateStatus(ctx, id, "REJECTED"); err != nil {
		return err
	}
	s.refreshPostCommentCountAsync(c.PostID)
	return nil
}

// MarkSpam 将评论状态设为 SPAM（垃圾评论），并异步更新文章评论计数。
// 错误场景：评论不存在。
func (s *CommentService) MarkSpam(ctx context.Context, id int64) error {
	c, err := s.ensureExists(ctx, id)
	if err != nil {
		return err
	}
	if err := s.repo.UpdateStatus(ctx, id, "SPAM"); err != nil {
		return err
	}
	s.refreshPostCommentCountAsync(c.PostID)
	return nil
}

// Restore 将已删除或已拒绝的评论恢复为 PENDING（待审核）状态，以便重新审核。
// 错误场景：评论不存在。
func (s *CommentService) Restore(ctx context.Context, id int64) error {
	c, err := s.ensureExists(ctx, id)
	if err != nil {
		return err
	}
	if err := s.repo.UpdateStatus(ctx, id, "PENDING"); err != nil {
		return err
	}
	s.refreshPostCommentCountAsync(c.PostID)
	return nil
}

// Delete 软删除评论（状态设为 DELETED），数据库行保留，不物理删除。
// 异步更新文章评论计数。错误场景：评论不存在。
func (s *CommentService) Delete(ctx context.Context, id int64) error {
	c, err := s.ensureExists(ctx, id)
	if err != nil {
		return err
	}
	if err := s.repo.SoftDelete(ctx, id); err != nil {
		return err
	}
	s.refreshPostCommentCountAsync(c.PostID)
	return nil
}

// PermanentDelete 从数据库中彻底删除一条评论记录，不可恢复。
// 异步更新文章评论计数。错误场景：评论不存在。
func (s *CommentService) PermanentDelete(ctx context.Context, id int64) error {
	c, err := s.ensureExists(ctx, id)
	if err != nil {
		return err
	}
	if err := s.repo.PermanentDelete(ctx, id); err != nil {
		return err
	}
	s.refreshPostCommentCountAsync(c.PostID)
	return nil
}

// DeleteBatch 批量软删除多条评论（状态设为 DELETED）。
func (s *CommentService) DeleteBatch(ctx context.Context, ids []int64) error {
	return s.repo.UpdateStatusBatch(ctx, ids, "DELETED")
}

// PermanentDeleteBatch 批量彻底删除多条评论记录，不可恢复。
func (s *CommentService) PermanentDeleteBatch(ctx context.Context, ids []int64) error {
	return s.repo.PermanentDeleteBatch(ctx, ids)
}

// ApproveBatch 批量审核通过多条评论（状态设为 APPROVED）。
func (s *CommentService) ApproveBatch(ctx context.Context, ids []int64) error {
	return s.repo.UpdateStatusBatch(ctx, ids, "APPROVED")
}

// ReplyAsAdmin 以当前管理员身份创建已通过的评论回复。
func (s *CommentService) ReplyAsAdmin(ctx context.Context, parentID int64, req dto.AdminReplyCommentRequest, username, ip, userAgent string) (*dto.CommentVO, error) {
	parent, err := s.ensureExists(ctx, parentID)
	if err != nil {
		return nil, err
	}
	if parent.Status == "DELETED" {
		return nil, errors.New("不能回复已删除评论")
	}

	nickname := strings.TrimSpace(username)
	if nickname == "" {
		nickname = "管理员"
	}
	parentRefID := parent.ID
	c := &model.Comment{
		PostID:    parent.PostID,
		ParentID:  &parentRefID,
		Nickname:  nickname,
		Content:   req.Content,
		Status:    "APPROVED",
		IP:        strPtr(ip),
		UserAgent: strPtr(userAgent),
		IsAdmin:   true,
	}
	if err := s.repo.Create(ctx, c); err != nil {
		return nil, err
	}
	s.refreshPostCommentCountAsync(c.PostID)

	vo := toCommentVO(*c)
	vo.Parent = &dto.CommentParentRef{ID: parent.ID, Nickname: parent.Nickname}
	if post, err := s.postRepo.FindByID(ctx, parent.PostID); err == nil && post != nil {
		vo.Post = &dto.CommentPostRef{ID: post.ID, Title: post.Title, Slug: post.Slug}
	}
	return &vo, nil
}

// --- 公开接口 ---

// GetByPost 返回指定文章下所有已审核通过（APPROVED）的评论，并组装为嵌套树形结构。
func (s *CommentService) GetByPost(ctx context.Context, postID int64) ([]dto.CommentVO, error) {
	cs, err := s.repo.FindByPostApproved(ctx, postID)
	if err != nil {
		return nil, err
	}
	// 将平铺评论列表构建为树形结构
	return buildCommentTree(toCommentVOs(cs)), nil
}

// Submit 提交一条新评论，初始状态为 PENDING（待审核）。
// 业务规则：若提供了 ParentID，则父评论必须存在且归属于同一篇文章。
// 错误场景：父评论不存在或不属于当前文章。
func (s *CommentService) Submit(ctx context.Context, postID int64, req dto.CreateCommentRequest, ip, userAgent string) (*dto.CommentVO, error) {
	// 站点级评论总开关：管理员在「系统设置 → 评论设置」关闭后，公开提交接口
	// 必须拒绝，避免直接打 API 绕过前端隐藏的评论框继续灌评论。默认 true（缺配置不误伤）。
	if !s.boolSetting(ctx, "comment_enabled", true) {
		return nil, errors.New("站点已关闭评论功能")
	}

	// SECURITY (VULN-043): 校验文章状态 —— 草稿 / 软删除 / 隐藏 / 关闭评论 的文章
	// 不应接受新评论。旧实现任何 postID 都放行，会污染审核队列并为幽灵评论
	// 提供落地点。
	post, err := s.postRepo.FindByID(ctx, postID)
	if err != nil {
		return nil, err
	}
	if post == nil || post.Deleted || post.IsHidden || !post.AllowComment || post.Status != "PUBLISHED" {
		return nil, errors.New("文章不允许评论或不存在")
	}

	// 验证父评论的合法性
	if req.ParentID != nil {
		parent, err := s.repo.FindByID(ctx, *req.ParentID)
		if err != nil {
			return nil, err
		}
		if parent == nil || parent.PostID != postID {
			return nil, errors.New("无效的父评论")
		}
	}

	email := strPtr(req.Email)
	website := strPtr(req.Website)
	ipPtr := strPtr(ip)
	uaPtr := strPtr(userAgent)

	// 审核策略：comment_audit 开启（默认）时新评论进入 PENDING 待审核队列；
	// 关闭时直接 APPROVED 立即对外可见，使后台「评论需审核」开关真实生效。
	initialStatus := "PENDING"
	if !s.boolSetting(ctx, "comment_audit", true) {
		initialStatus = "APPROVED"
	}

	c := &model.Comment{
		PostID:    postID,
		ParentID:  req.ParentID,
		Nickname:  req.Nickname,
		Email:     email,
		Website:   website,
		Content:   req.Content,
		Status:    initialStatus,
		IP:        ipPtr,
		UserAgent: uaPtr,
		IsAdmin:   false,
	}

	if err := s.repo.Create(ctx, c); err != nil {
		return nil, err
	}

	// 审核关闭时评论即时 APPROVED，需刷新文章评论数缓存使公开计数准确
	// （PENDING 不计入公开计数，无需刷新）。对齐 Approve() 的异步刷新模式。
	if initialStatus == "APPROVED" {
		s.refreshPostCommentCountAsync(c.PostID)
	}

	vo := toCommentVO(*c)
	return &vo, nil
}

// --- 内部辅助方法 ---

// refreshPostCommentCountAsync 把"文章评论数刷新"放到 detached goroutine 跑。
// 必须自带 panic recover —— 之前裸 `go s.repo.UpdatePostCommentCount(...)` 一旦
// 仓储层 panic 会直接打掉整个进程。批量审核场景下也会同时拉起大量 goroutine,
// 这里不做并发限流(单条请求最多 1 个 goroutine; 批量接口已经走 *Batch 同步路径)。
func (s *CommentService) refreshPostCommentCountAsync(postID int64) {
	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Error().Interface("recover", r).Int64("post_id", postID).Msg("comment: update post comment count panicked")
			}
		}()
		if err := s.repo.UpdatePostCommentCount(context.Background(), postID); err != nil {
			log.Warn().Err(err).Int64("post_id", postID).Msg("comment: update post comment count failed")
		}
	}()
}

// ensureExists 查询评论是否存在，不存在时返回 "评论不存在" 错误。
func (s *CommentService) ensureExists(ctx context.Context, id int64) (*model.Comment, error) {
	c, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if c == nil {
		return nil, errors.New("评论不存在")
	}
	return c, nil
}

// enrichCommentRefs 为管理端视图中的评论 VO 批量填充关联的文章信息和父评论信息。
// 文章信息通过批量查询获取；父评论昵称优先从当前页数据中查找，未找到时再单条查询。
func (s *CommentService) enrichCommentRefs(ctx context.Context, cs []model.Comment, vos []dto.CommentVO) {
	// 收集所有不重复的文章 ID
	postIDSet := make(map[int64]struct{})
	for _, c := range cs {
		postIDSet[c.PostID] = struct{}{}
	}

	// 批量查询文章信息并构建映射表
	postMap := make(map[int64]*dto.CommentPostRef)
	for pid := range postIDSet {
		if p, err := s.postRepo.FindByID(ctx, pid); err == nil && p != nil {
			postMap[pid] = &dto.CommentPostRef{ID: p.ID, Title: p.Title, Slug: p.Slug}
		}
	}

	// 从当前页评论中构建昵称映射，用于快速查找父评论昵称
	nicknameMap := make(map[int64]string, len(cs))
	for _, c := range cs {
		nicknameMap[c.ID] = c.Nickname
	}

	// 回填文章引用和父评论引用
	for i, c := range cs {
		if ref, ok := postMap[c.PostID]; ok {
			vos[i].Post = ref
		}
		if c.ParentID != nil {
			if nick, ok := nicknameMap[*c.ParentID]; ok {
				// 父评论在当前页内，直接使用
				vos[i].Parent = &dto.CommentParentRef{ID: *c.ParentID, Nickname: nick}
			} else {
				// 父评论不在当前页，单独查询
				if parent, err := s.repo.FindByID(ctx, *c.ParentID); err == nil && parent != nil {
					vos[i].Parent = &dto.CommentParentRef{ID: parent.ID, Nickname: parent.Nickname}
				}
			}
		}
	}
}

// toCommentVO 将单个 model.Comment 转换为 dto.CommentVO。
func toCommentVO(c model.Comment) dto.CommentVO {
	return dto.CommentVO{
		ID:        c.ID,
		PostID:    c.PostID,
		ParentID:  c.ParentID,
		Nickname:  c.Nickname,
		Email:     c.Email,
		Website:   c.Website,
		Avatar:    c.Avatar,
		Content:   c.Content,
		Status:    c.Status,
		IP:        c.IP,
		IsAdmin:   c.IsAdmin,
		LikeCount: c.LikeCount,
		CreatedAt: c.CreatedAt,
	}
}

// toCommentVOs 将 model.Comment 切片批量转换为 dto.CommentVO 切片。
func toCommentVOs(cs []model.Comment) []dto.CommentVO {
	vos := make([]dto.CommentVO, len(cs))
	for i, c := range cs {
		vos[i] = toCommentVO(c)
	}
	return vos
}

// buildCommentTree 将平铺的评论列表按 parent_id 构建为嵌套树形结构。
// 使用指针链接实现，可正确处理多级嵌套。根节点为 ParentID 为 nil 的评论。
func buildCommentTree(vos []dto.CommentVO) []dto.CommentVO {
	byID := make(map[int64]*dto.CommentVO, len(vos))
	for i := range vos {
		vos[i].Children = nil // 重置子节点列表，防止重复构建
		byID[vos[i].ID] = &vos[i]
	}
	// 第一轮：通过指针将子节点挂载到对应父节点，变更会通过 byID 映射传播
	var rootIDs []int64
	for i := range vos {
		if vos[i].ParentID != nil {
			if parent, ok := byID[*vos[i].ParentID]; ok {
				parent.Children = append(parent.Children, dto.CommentVO{}) // 占位
				parent.Children[len(parent.Children)-1] = *byID[vos[i].ID]
				continue
			}
		}
		rootIDs = append(rootIDs, vos[i].ID)
	}
	// 第二轮：从 byID 中递归收集完整的树形结构
	// 必须重新从指针映射读取，以获取已完整挂载子节点的数据
	var collectTree func(id int64) dto.CommentVO
	collectTree = func(id int64) dto.CommentVO {
		node := byID[id]
		result := *node
		if len(node.Children) > 0 {
			result.Children = make([]dto.CommentVO, len(node.Children))
			for i, child := range node.Children {
				result.Children[i] = collectTree(child.ID)
			}
		}
		return result
	}
	roots := make([]dto.CommentVO, 0, len(rootIDs))
	for _, id := range rootIDs {
		roots = append(roots, collectTree(id))
	}
	return roots
}

// strPtr 将非空字符串转换为指针，空字符串返回 nil。
func strPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
