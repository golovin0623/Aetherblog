package handler

import (
	"strconv"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/middleware"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

// AgentWorkflowHandler 承接后台智能体编排的 authoring API 和前后台复用的
// runtime run 入口。真正节点执行器后续由 ai-service workflow engine 消费 run。
type AgentWorkflowHandler struct {
	svc *service.AgentWorkflowService
}

func NewAgentWorkflowHandler(svc *service.AgentWorkflowService) *AgentWorkflowHandler {
	return &AgentWorkflowHandler{svc: svc}
}

func (h *AgentWorkflowHandler) MountAdmin(g *echo.Group) {
	g.GET("", h.ListWorkflows)
	g.POST("", h.CreateWorkflow)
	g.GET("/:id", h.GetWorkflow)
	g.GET("/:id/runs", h.ListWorkflowRuns)
	g.PATCH("/:id", h.UpdateWorkflow)
	g.PUT("/:id", h.UpdateWorkflow)
	g.PUT("/:id/publication", h.PublishWorkflow)
	g.DELETE("/:id/publication", h.UnpublishWorkflow)
	g.DELETE("/:id", h.DeleteWorkflow)
}

func (h *AgentWorkflowHandler) MountAdminCatalog(g *echo.Group) {
	g.GET("/agent-tools", h.ListTools)
	g.GET("/agent-definitions", h.ListAgents)
	g.GET("/agent-schedules", h.ListSchedules)
}

func (h *AgentWorkflowHandler) MountRuntime(g *echo.Group) {
	g.GET("/published", h.ListPublished)
	g.POST("/published/:slug/invoke", h.InvokePublished)
	g.POST("/workflows/:id/runs", h.CreateRun)
	g.GET("/runs/:runID", h.GetRun)
	g.GET("/runs/:runID/logs", h.ListRunLogs)
}

func (h *AgentWorkflowHandler) ListWorkflows(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}
	items, err := h.svc.ListWorkflows(c.Request().Context(), lu.UserID)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, items)
}

func (h *AgentWorkflowHandler) GetWorkflow(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}
	id, err := parseAgentWorkflowID(c)
	if err != nil {
		return err
	}
	item, err := h.svc.GetWorkflow(c.Request().Context(), lu.UserID, id)
	if err != nil {
		return response.Error(c, err)
	}
	if item == nil {
		return response.FailWith(c, response.NotFound, "工作流不存在")
	}
	return response.OK(c, item)
}

func (h *AgentWorkflowHandler) CreateWorkflow(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}
	var req dto.AgentWorkflowRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求参数格式错误")
	}
	item, err := h.svc.CreateWorkflow(c.Request().Context(), lu.UserID, req)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OK(c, item)
}

func (h *AgentWorkflowHandler) UpdateWorkflow(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}
	id, err := parseAgentWorkflowID(c)
	if err != nil {
		return err
	}
	var req dto.AgentWorkflowRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求参数格式错误")
	}
	item, err := h.svc.UpdateWorkflow(c.Request().Context(), lu.UserID, id, req)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	if item == nil {
		return response.FailWith(c, response.NotFound, "工作流不存在")
	}
	return response.OK(c, item)
}

func (h *AgentWorkflowHandler) DeleteWorkflow(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}
	id, err := parseAgentWorkflowID(c)
	if err != nil {
		return err
	}
	deleted, err := h.svc.DeleteWorkflow(c.Request().Context(), lu.UserID, id)
	if err != nil {
		return response.Error(c, err)
	}
	if !deleted {
		return response.FailWith(c, response.NotFound, "工作流不存在")
	}
	return response.OKEmpty(c)
}

func (h *AgentWorkflowHandler) ListTools(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}
	items, err := h.svc.ListTools(c.Request().Context(), lu.UserID)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, items)
}

func (h *AgentWorkflowHandler) ListAgents(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}
	items, err := h.svc.ListAgents(c.Request().Context(), lu.UserID)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, items)
}

func (h *AgentWorkflowHandler) ListSchedules(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}
	items, err := h.svc.ListSchedules(c.Request().Context(), lu.UserID)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, items)
}

func (h *AgentWorkflowHandler) PublishWorkflow(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}
	id, err := parseAgentWorkflowID(c)
	if err != nil {
		return err
	}
	var req dto.AgentPublicationRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求参数格式错误")
	}
	item, err := h.svc.PublishWorkflow(c.Request().Context(), lu.UserID, id, req)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	if item == nil {
		return response.FailWith(c, response.NotFound, "工作流不存在")
	}
	return response.OK(c, item)
}

func (h *AgentWorkflowHandler) UnpublishWorkflow(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}
	id, err := parseAgentWorkflowID(c)
	if err != nil {
		return err
	}
	ok, err := h.svc.UnpublishWorkflow(c.Request().Context(), lu.UserID, id)
	if err != nil {
		return response.Error(c, err)
	}
	if !ok {
		return response.FailWith(c, response.NotFound, "工作流不存在")
	}
	return response.OKEmpty(c)
}

func (h *AgentWorkflowHandler) ListPublished(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}
	items, err := h.svc.ListPublished(c.Request().Context(), parseRunLimit(c))
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, items)
}

func (h *AgentWorkflowHandler) ListWorkflowRuns(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}
	id, err := parseAgentWorkflowID(c)
	if err != nil {
		return err
	}
	items, err := h.svc.ListWorkflowRuns(c.Request().Context(), lu.UserID, id, parseRunLimit(c))
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, items)
}

func (h *AgentWorkflowHandler) CreateRun(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}
	id, err := parseAgentWorkflowID(c)
	if err != nil {
		return err
	}
	var req dto.AgentWorkflowRunRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求参数格式错误")
	}
	run, err := h.svc.CreateRun(c.Request().Context(), lu.UserID, id, req)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	if run == nil {
		return response.FailWith(c, response.NotFound, "工作流不存在或未发布")
	}
	return response.OK(c, run)
}

func (h *AgentWorkflowHandler) InvokePublished(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}
	var req dto.AgentWorkflowRunRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求参数格式错误")
	}
	run, err := h.svc.InvokePublished(c.Request().Context(), lu.UserID, c.Param("slug"), req)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	if run == nil {
		return response.FailWith(c, response.NotFound, "发布智能体不存在或已停用")
	}
	return response.OK(c, run)
}

func (h *AgentWorkflowHandler) GetRun(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}
	id, err := parseAgentRunID(c)
	if err != nil {
		return err
	}
	run, err := h.svc.GetRun(c.Request().Context(), lu.UserID, id)
	if err != nil {
		return response.Error(c, err)
	}
	if run == nil {
		return response.FailWith(c, response.NotFound, "运行记录不存在")
	}
	return response.OK(c, run)
}

func (h *AgentWorkflowHandler) ListRunLogs(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}
	id, err := parseAgentRunID(c)
	if err != nil {
		return err
	}
	items, err := h.svc.ListRunLogs(c.Request().Context(), lu.UserID, id)
	if err != nil {
		return response.Error(c, err)
	}
	if items == nil {
		return response.FailWith(c, response.NotFound, "运行记录不存在")
	}
	return response.OK(c, items)
}

func parseAgentWorkflowID(c echo.Context) (int64, error) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		return 0, response.FailWith(c, response.BadRequest, "无效的工作流 ID")
	}
	return id, nil
}

func parseAgentRunID(c echo.Context) (int64, error) {
	id, err := strconv.ParseInt(c.Param("runID"), 10, 64)
	if err != nil || id <= 0 {
		return 0, response.FailWith(c, response.BadRequest, "无效的运行记录 ID")
	}
	return id, nil
}

func parseRunLimit(c echo.Context) int {
	limit, err := strconv.Atoi(c.QueryParam("limit"))
	if err != nil || limit <= 0 {
		return 50
	}
	if limit > 100 {
		return 100
	}
	return limit
}
