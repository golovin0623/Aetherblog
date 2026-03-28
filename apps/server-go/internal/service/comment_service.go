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

type CommentService struct {
	repo     *repository.CommentRepo
	postRepo *repository.PostRepo
}

func NewCommentService(repo *repository.CommentRepo, postRepo *repository.PostRepo) *CommentService {
	return &CommentService{repo: repo, postRepo: postRepo}
}

// --- Admin ---

func (s *CommentService) GetPending(ctx context.Context, p pagination.Params) (*response.PageResult, error) {
	cs, total, err := s.repo.FindPending(ctx, p)
	if err != nil {
		return nil, err
	}
	pr := response.NewPageResult(toCommentVOs(cs), total, p.PageNum, p.PageSize)
	return &pr, nil
}

func (s *CommentService) GetForAdmin(ctx context.Context, f dto.CommentFilter) (*response.PageResult, error) {
	cs, total, err := s.repo.FindForAdmin(ctx, f)
	if err != nil {
		return nil, err
	}
	pr := response.NewPageResult(toCommentVOs(cs), total, f.PageNum, f.PageSize)
	return &pr, nil
}

func (s *CommentService) GetByID(ctx context.Context, id int64) (*dto.CommentVO, error) {
	c, err := s.repo.FindByID(ctx, id)
	if err != nil || c == nil {
		return nil, err
	}
	vo := toCommentVO(*c)
	return &vo, nil
}

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

func (s *CommentService) DeleteBatch(ctx context.Context, ids []int64) error {
	return s.repo.UpdateStatusBatch(ctx, ids, "DELETED")
}

func (s *CommentService) PermanentDeleteBatch(ctx context.Context, ids []int64) error {
	return s.repo.PermanentDeleteBatch(ctx, ids)
}

func (s *CommentService) ApproveBatch(ctx context.Context, ids []int64) error {
	return s.repo.UpdateStatusBatch(ctx, ids, "APPROVED")
}

// --- Public ---

func (s *CommentService) GetByPost(ctx context.Context, postID int64) ([]dto.CommentVO, error) {
	cs, err := s.repo.FindByPostApproved(ctx, postID)
	if err != nil {
		return nil, err
	}
	// Build tree structure
	return buildCommentTree(toCommentVOs(cs)), nil
}

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
