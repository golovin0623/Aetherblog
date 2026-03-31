package handler

import (
	"context"
	"strconv"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/pkg/pagination"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

// CommentHandler handles comment moderation and public submission endpoints.
type CommentHandler struct{ svc *service.CommentService }

// NewCommentHandler creates a CommentHandler backed by the given CommentService.
func NewCommentHandler(svc *service.CommentService) *CommentHandler { return &CommentHandler{svc: svc} }

// MountAdmin registers admin moderation routes (list, approve, reject, delete, etc.) on g.
func (h *CommentHandler) MountAdmin(g *echo.Group) {
	g.GET("/pending", h.Pending)
	g.GET("", h.AdminList)
	g.GET("/:id", h.AdminGet)
	g.PATCH("/:id/approve", h.Approve)
	g.PATCH("/:id/reject", h.Reject)
	g.PATCH("/:id/spam", h.Spam)
	g.PATCH("/:id/restore", h.Restore)
	g.DELETE("/:id", h.Delete)
	g.DELETE("/:id/permanent", h.PermanentDelete)
	g.DELETE("/batch", h.DeleteBatch)
	g.DELETE("/batch/permanent", h.PermanentDeleteBatch)
	g.PATCH("/batch/approve", h.ApproveBatch)
}

// MountPublic registers the public comment listing route on g.
// The Submit endpoint is registered separately in server.go with rate limiting.
func (h *CommentHandler) MountPublic(g *echo.Group) {
	g.GET("/post/:postId", h.ListByPost)
	// Submit is registered in server.go with rate limiting
}

// --- Admin ---

// Pending handles GET /admin/comments/pending. Returns paginated comments awaiting moderation.
func (h *CommentHandler) Pending(c echo.Context) error {
	p := pagination.ParseWithDefaults(c, 1, 20)
	pr, err := h.svc.GetPending(c.Request().Context(), p)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, pr)
}

// AdminList handles GET /admin/comments with optional filters (status, keyword, postId).
func (h *CommentHandler) AdminList(c echo.Context) error {
	f := dto.CommentFilter{
		Status:   c.QueryParam("status"),
		Keyword:  c.QueryParam("keyword"),
		PageNum:  parseIntDefault(c.QueryParam("pageNum"), 1),
		PageSize: parseIntDefault(c.QueryParam("pageSize"), 10),
	}
	if v := c.QueryParam("postId"); v != "" {
		if id, err := strconv.ParseInt(v, 10, 64); err == nil {
			f.PostID = &id
		}
	}
	pr, err := h.svc.GetForAdmin(c.Request().Context(), f)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, pr)
}

// AdminGet handles GET /admin/comments/:id. Returns full comment detail.
func (h *CommentHandler) AdminGet(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	vo, err := h.svc.GetByID(c.Request().Context(), id)
	if err != nil {
		return response.Error(c, err)
	}
	if vo == nil {
		return response.FailWith(c, response.NotFound, "评论不存在")
	}
	return response.OK(c, vo)
}

// Approve handles PATCH /admin/comments/:id/approve. Approves a pending comment for public display.
func (h *CommentHandler) Approve(c echo.Context) error {
	return h.withID(c, h.svc.Approve)
}

// Reject handles PATCH /admin/comments/:id/reject. Marks a comment as rejected.
func (h *CommentHandler) Reject(c echo.Context) error {
	return h.withID(c, h.svc.Reject)
}

// Spam handles PATCH /admin/comments/:id/spam. Marks a comment as spam.
func (h *CommentHandler) Spam(c echo.Context) error {
	return h.withID(c, h.svc.MarkSpam)
}

// Restore handles PATCH /admin/comments/:id/restore. Restores a rejected/spam comment to pending.
func (h *CommentHandler) Restore(c echo.Context) error {
	return h.withID(c, h.svc.Restore)
}

// Delete handles DELETE /admin/comments/:id. Soft-deletes the comment.
func (h *CommentHandler) Delete(c echo.Context) error {
	return h.withID(c, h.svc.Delete)
}

// PermanentDelete handles DELETE /admin/comments/:id/permanent. Irreversibly removes the comment.
func (h *CommentHandler) PermanentDelete(c echo.Context) error {
	return h.withID(c, h.svc.PermanentDelete)
}

// DeleteBatch handles DELETE /admin/comments/batch. Soft-deletes multiple comments by ID.
func (h *CommentHandler) DeleteBatch(c echo.Context) error {
	ids, err := bindIDs(c)
	if err != nil {
		return err
	}
	if err := h.svc.DeleteBatch(c.Request().Context(), ids); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}

// PermanentDeleteBatch handles DELETE /admin/comments/batch/permanent. Irreversibly removes multiple comments.
func (h *CommentHandler) PermanentDeleteBatch(c echo.Context) error {
	ids, err := bindIDs(c)
	if err != nil {
		return err
	}
	if err := h.svc.PermanentDeleteBatch(c.Request().Context(), ids); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}

// ApproveBatch handles PATCH /admin/comments/batch/approve. Approves multiple comments in bulk.
func (h *CommentHandler) ApproveBatch(c echo.Context) error {
	ids, err := bindIDs(c)
	if err != nil {
		return err
	}
	if err := h.svc.ApproveBatch(c.Request().Context(), ids); err != nil {
		return response.Error(c, err)
	}
	return response.OKEmpty(c)
}

// --- Public ---

// ListByPost handles GET /public/comments/post/:postId. Returns approved comments for a post in a tree.
func (h *CommentHandler) ListByPost(c echo.Context) error {
	postID, err := strconv.ParseInt(c.Param("postId"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的文章ID")
	}
	vos, err := h.svc.GetByPost(c.Request().Context(), postID)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, map[string]any{"list": vos})
}

// Submit handles POST /public/comments/post/:postId (rate-limited).
// Records the visitor's IP and User-Agent for anti-spam purposes.
func (h *CommentHandler) Submit(c echo.Context) error {
	postID, err := strconv.ParseInt(c.Param("postId"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的文章ID")
	}
	var req dto.CreateCommentRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	ip := c.RealIP()
	ua := c.Request().UserAgent()
	vo, err := h.svc.Submit(c.Request().Context(), postID, req, ip, ua)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OK(c, vo)
}

// withID parses :id from path, calls fn, returns OKEmpty on success.
func (h *CommentHandler) withID(c echo.Context, fn func(context.Context, int64) error) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	if err := fn(c.Request().Context(), id); err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OKEmpty(c)
}
