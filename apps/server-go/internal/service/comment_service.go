package service

import (
	"context"
	"errors"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/pkg/pagination"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/repository"
)

// CommentService manages comment moderation and public submission.
type CommentService struct {
	repo     *repository.CommentRepo
	postRepo *repository.PostRepo
}

// NewCommentService creates a CommentService backed by the given repositories.
func NewCommentService(repo *repository.CommentRepo, postRepo *repository.PostRepo) *CommentService {
	return &CommentService{repo: repo, postRepo: postRepo}
}

// --- Admin ---

// GetPending returns paginated PENDING comments for the admin moderation queue.
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

// GetForAdmin returns a paginated, filtered list of comments for the admin view.
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

// GetByID returns a single comment by primary key, or nil if not found.
func (s *CommentService) GetByID(ctx context.Context, id int64) (*dto.CommentVO, error) {
	c, err := s.repo.FindByID(ctx, id)
	if err != nil || c == nil {
		return nil, err
	}
	vo := toCommentVO(*c)
	return &vo, nil
}

// Approve sets the comment status to APPROVED and asynchronously updates the post's comment count.
func (s *CommentService) Approve(ctx context.Context, id int64) error {
	c, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return err
	}
	if c == nil {
		return errors.New("评论不存在")
	}
	if err := s.repo.UpdateStatus(ctx, id, "APPROVED"); err != nil {
		return err
	}
	go s.repo.UpdatePostCommentCount(context.Background(), c.PostID)
	return nil
}

// Reject sets the comment status to REJECTED.
func (s *CommentService) Reject(ctx context.Context, id int64) error {
	c, err := s.ensureExists(ctx, id)
	if err != nil {
		return err
	}
	if err := s.repo.UpdateStatus(ctx, id, "REJECTED"); err != nil {
		return err
	}
	go s.repo.UpdatePostCommentCount(context.Background(), c.PostID)
	return nil
}

// MarkSpam sets the comment status to SPAM.
func (s *CommentService) MarkSpam(ctx context.Context, id int64) error {
	c, err := s.ensureExists(ctx, id)
	if err != nil {
		return err
	}
	if err := s.repo.UpdateStatus(ctx, id, "SPAM"); err != nil {
		return err
	}
	go s.repo.UpdatePostCommentCount(context.Background(), c.PostID)
	return nil
}

// Restore moves a deleted/rejected comment back to PENDING for re-moderation.
func (s *CommentService) Restore(ctx context.Context, id int64) error {
	c, err := s.ensureExists(ctx, id)
	if err != nil {
		return err
	}
	if err := s.repo.UpdateStatus(ctx, id, "PENDING"); err != nil {
		return err
	}
	go s.repo.UpdatePostCommentCount(context.Background(), c.PostID)
	return nil
}

// Delete soft-deletes a comment (status=DELETED) without removing the row.
func (s *CommentService) Delete(ctx context.Context, id int64) error {
	c, err := s.ensureExists(ctx, id)
	if err != nil {
		return err
	}
	if err := s.repo.SoftDelete(ctx, id); err != nil {
		return err
	}
	go s.repo.UpdatePostCommentCount(context.Background(), c.PostID)
	return nil
}

// PermanentDelete removes a comment from the database permanently.
func (s *CommentService) PermanentDelete(ctx context.Context, id int64) error {
	c, err := s.ensureExists(ctx, id)
	if err != nil {
		return err
	}
	if err := s.repo.PermanentDelete(ctx, id); err != nil {
		return err
	}
	go s.repo.UpdatePostCommentCount(context.Background(), c.PostID)
	return nil
}

// DeleteBatch soft-deletes multiple comments in one query.
func (s *CommentService) DeleteBatch(ctx context.Context, ids []int64) error {
	return s.repo.UpdateStatusBatch(ctx, ids, "DELETED")
}

// PermanentDeleteBatch permanently removes multiple comments in one query.
func (s *CommentService) PermanentDeleteBatch(ctx context.Context, ids []int64) error {
	return s.repo.PermanentDeleteBatch(ctx, ids)
}

// ApproveBatch bulk-approves multiple comments in one query.
func (s *CommentService) ApproveBatch(ctx context.Context, ids []int64) error {
	return s.repo.UpdateStatusBatch(ctx, ids, "APPROVED")
}

// --- Public ---

// GetByPost returns all APPROVED comments for a post assembled into a nested tree.
func (s *CommentService) GetByPost(ctx context.Context, postID int64) ([]dto.CommentVO, error) {
	cs, err := s.repo.FindByPostApproved(ctx, postID)
	if err != nil {
		return nil, err
	}
	// Build tree structure
	return buildCommentTree(toCommentVOs(cs)), nil
}

// Submit creates a new comment with PENDING status.
// Validates that the parent comment (if given) belongs to the same post.
func (s *CommentService) Submit(ctx context.Context, postID int64, req dto.CreateCommentRequest, ip, userAgent string) (*dto.CommentVO, error) {
	// Verify parent if provided
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

	c := &model.Comment{
		PostID:    postID,
		ParentID:  req.ParentID,
		Nickname:  req.Nickname,
		Email:     email,
		Website:   website,
		Content:   req.Content,
		Status:    "PENDING",
		IP:        ipPtr,
		UserAgent: uaPtr,
		IsAdmin:   false,
	}

	if err := s.repo.Create(ctx, c); err != nil {
		return nil, err
	}

	vo := toCommentVO(*c)
	return &vo, nil
}

// --- Helpers ---

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

// enrichCommentRefs populates Post and Parent refs on comment VOs for admin views.
func (s *CommentService) enrichCommentRefs(ctx context.Context, cs []model.Comment, vos []dto.CommentVO) {
	// Collect unique post IDs
	postIDSet := make(map[int64]struct{})
	for _, c := range cs {
		postIDSet[c.PostID] = struct{}{}
	}

	// Batch fetch posts
	postMap := make(map[int64]*dto.CommentPostRef)
	for pid := range postIDSet {
		if p, err := s.postRepo.FindByID(ctx, pid); err == nil && p != nil {
			postMap[pid] = &dto.CommentPostRef{ID: p.ID, Title: p.Title, Slug: p.Slug}
		}
	}

	// Build a nickname lookup from the comments themselves (covers most parent refs)
	nicknameMap := make(map[int64]string, len(cs))
	for _, c := range cs {
		nicknameMap[c.ID] = c.Nickname
	}

	// Populate refs
	for i, c := range cs {
		if ref, ok := postMap[c.PostID]; ok {
			vos[i].Post = ref
		}
		if c.ParentID != nil {
			if nick, ok := nicknameMap[*c.ParentID]; ok {
				vos[i].Parent = &dto.CommentParentRef{ID: *c.ParentID, Nickname: nick}
			} else {
				// Parent not in current page — fetch individually
				if parent, err := s.repo.FindByID(ctx, *c.ParentID); err == nil && parent != nil {
					vos[i].Parent = &dto.CommentParentRef{ID: parent.ID, Nickname: parent.Nickname}
				}
			}
		}
	}
}

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

func toCommentVOs(cs []model.Comment) []dto.CommentVO {
	vos := make([]dto.CommentVO, len(cs))
	for i, c := range cs {
		vos[i] = toCommentVO(c)
	}
	return vos
}

// buildCommentTree converts flat list into nested tree by parent_id.
// Uses pointer-based linking to correctly handle multi-level nesting.
func buildCommentTree(vos []dto.CommentVO) []dto.CommentVO {
	byID := make(map[int64]*dto.CommentVO, len(vos))
	for i := range vos {
		vos[i].Children = nil // reset
		byID[vos[i].ID] = &vos[i]
	}
	// Link children to parents via pointers — mutations propagate through byID.
	var rootIDs []int64
	for i := range vos {
		if vos[i].ParentID != nil {
			if parent, ok := byID[*vos[i].ParentID]; ok {
				parent.Children = append(parent.Children, dto.CommentVO{}) // placeholder
				parent.Children[len(parent.Children)-1] = *byID[vos[i].ID]
				continue
			}
		}
		rootIDs = append(rootIDs, vos[i].ID)
	}
	// Collect roots. We must re-read from byID to get the fully linked structs.
	// For deep nesting we do a recursive copy from the pointer map.
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

func strPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
