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

// CommentHandler 负责处理评论审核和公开提交相关接口。
type CommentHandler struct{ svc *service.CommentService }

// NewCommentHandler 创建一个由指定 CommentService 驱动的 CommentHandler 实例。
func NewCommentHandler(svc *service.CommentService) *CommentHandler { return &CommentHandler{svc: svc} }

// MountAdmin 在指定路由组上注册管理端审核路由（列表、审批、拒绝、删除等）。
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

// MountPublic 在指定路由组上注册公开评论列表路由。
// Submit 接口单独在 server.go 中注册（附加限流中间件）。
func (h *CommentHandler) MountPublic(g *echo.Group) {
	g.GET("/post/:postId", h.ListByPost)
	// Submit 在 server.go 中附加限流中间件后单独注册
}

// --- 管理端接口 ---

// Pending 处理 GET /admin/comments/pending 请求，
// 返回待审核评论的分页列表。
func (h *CommentHandler) Pending(c echo.Context) error {
	p := pagination.ParseWithDefaults(c, 1, 20)
	pr, err := h.svc.GetPending(c.Request().Context(), p)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, pr)
}

// AdminList 处理 GET /admin/comments 请求，
// 支持按状态、关键词、文章 ID 过滤，返回分页评论列表。
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

// AdminGet 处理 GET /admin/comments/:id 请求，
// 返回单条评论的完整详情。
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

// Approve 处理 PATCH /admin/comments/:id/approve 请求，
// 将待审核评论审批通过，使其公开展示。
func (h *CommentHandler) Approve(c echo.Context) error {
	return h.withID(c, h.svc.Approve)
}

// Reject 处理 PATCH /admin/comments/:id/reject 请求，
// 将评论标记为已拒绝。
func (h *CommentHandler) Reject(c echo.Context) error {
	return h.withID(c, h.svc.Reject)
}

// Spam 处理 PATCH /admin/comments/:id/spam 请求，
// 将评论标记为垃圾评论。
func (h *CommentHandler) Spam(c echo.Context) error {
	return h.withID(c, h.svc.MarkSpam)
}

// Restore 处理 PATCH /admin/comments/:id/restore 请求，
// 将已拒绝或垃圾评论恢复为待审核状态。
func (h *CommentHandler) Restore(c echo.Context) error {
	return h.withID(c, h.svc.Restore)
}

// Delete 处理 DELETE /admin/comments/:id 请求，
// 软删除指定评论。
func (h *CommentHandler) Delete(c echo.Context) error {
	return h.withID(c, h.svc.Delete)
}

// PermanentDelete 处理 DELETE /admin/comments/:id/permanent 请求，
// 不可逆地彻底删除指定评论。
func (h *CommentHandler) PermanentDelete(c echo.Context) error {
	return h.withID(c, h.svc.PermanentDelete)
}

// DeleteBatch 处理 DELETE /admin/comments/batch 请求，
// 根据 ID 列表批量软删除评论。
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

// PermanentDeleteBatch 处理 DELETE /admin/comments/batch/permanent 请求，
// 不可逆地彻底删除多条评论。
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

// ApproveBatch 处理 PATCH /admin/comments/batch/approve 请求，
// 批量审批通过多条评论。
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

// --- 公开接口 ---

// ListByPost 处理 GET /public/comments/post/:postId 请求，
// 以树形结构返回指定文章下已审核通过的评论列表。
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

// Submit 处理 POST /public/comments/post/:postId 请求（附有限流控制），
// 提交新评论，同时记录访客 IP 和 User-Agent 用于反垃圾检测。
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

// withID 从路径参数中解析 :id，调用 fn 处理，成功后返回空 OK 响应。
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
