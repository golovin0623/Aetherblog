package handler

import (
	"encoding/json"
	"strconv"
	"strings"
	"time"

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
	g.GET("/capabilities", h.GetCapabilities)
	g.GET("/templates", h.ListTemplates)
	g.POST("/import", h.ImportWorkflow)
	g.DELETE("/variables/:id", h.DeleteVariable)
	g.GET("/:id", h.GetWorkflow)
	g.GET("/:id/runs", h.ListWorkflowRuns)
	g.GET("/:id/versions", h.ListWorkflowVersions)
	g.POST("/:id/versions/:version/rollback", h.RollbackWorkflowVersion)
	g.GET("/:id/export", h.ExportWorkflow)
	g.GET("/:id/variables", h.ListVariables)
	g.PUT("/:id/variables", h.UpsertVariable)
	g.POST("/:id/node-test", h.TestNode)
	g.GET("/:id/metrics", h.WorkflowMetrics)
	g.PATCH("/:id", h.UpdateWorkflow)
	g.PUT("/:id", h.UpdateWorkflow)
	g.PUT("/:id/publication", h.PublishWorkflow)
	g.DELETE("/:id/publication", h.UnpublishWorkflow)
	g.DELETE("/:id", h.DeleteWorkflow)
}

func (h *AgentWorkflowHandler) MountAdminCatalog(g *echo.Group) {
	g.GET("/agent-tools", h.ListTools)
	g.POST("/agent-tools", h.CreateTool)
	g.PUT("/agent-tools/:id", h.UpdateTool)
	g.DELETE("/agent-tools/:id", h.DeleteTool)
	g.POST("/agent-tools/:code/test", h.TestTool)
	g.GET("/agent-definitions", h.ListAgents)
	g.POST("/agent-definitions", h.CreateAgent)
	g.PUT("/agent-definitions/:id", h.UpdateAgent)
	g.DELETE("/agent-definitions/:id", h.DeleteAgent)
	g.GET("/agent-schedules", h.ListSchedules)
	g.POST("/agent-schedules", h.CreateSchedule)
	g.PUT("/agent-schedules/:id", h.UpdateSchedule)
	g.DELETE("/agent-schedules/:id", h.DeleteSchedule)
}

func (h *AgentWorkflowHandler) MountRuntime(g *echo.Group) {
	g.GET("/published", h.ListPublished)
	g.POST("/published/:slug/invoke", h.InvokePublished)
	g.POST("/workflows/:id/runs", h.CreateRun)
	g.GET("/runs/:runID", h.GetRun)
	g.GET("/runs/:runID/logs", h.ListRunLogs)
	g.GET("/runs/:runID/stream", h.StreamRun)
	g.POST("/runs/:runID/cancel", h.CancelRun)
	g.POST("/runs/:runID/retry", h.RetryRun)
	g.POST("/runs/:runID/resume", h.ResumeRun)
	g.POST("/runs/:runID/canonicalize", h.CanonicalizeRun)
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

func (h *AgentWorkflowHandler) CreateTool(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}
	var req dto.AgentToolRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求参数格式错误")
	}
	item, err := h.svc.CreateTool(c.Request().Context(), lu.UserID, req)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OK(c, item)
}

func (h *AgentWorkflowHandler) UpdateTool(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}
	id, err := parseIDParam(c, "id", "无效的 ID")
	if err != nil {
		return err
	}
	var req dto.AgentToolRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求参数格式错误")
	}
	item, err := h.svc.UpdateTool(c.Request().Context(), lu.UserID, id, req)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	if item == nil {
		return response.FailWith(c, response.NotFound, "工具不存在")
	}
	return response.OK(c, item)
}

func (h *AgentWorkflowHandler) DeleteTool(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}
	id, err := parseIDParam(c, "id", "无效的 ID")
	if err != nil {
		return err
	}
	ok, err := h.svc.DeleteTool(c.Request().Context(), lu.UserID, id)
	if err != nil {
		return response.Error(c, err)
	}
	if !ok {
		return response.FailWith(c, response.NotFound, "工具不存在")
	}
	return response.OKEmpty(c)
}

func (h *AgentWorkflowHandler) TestTool(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}
	var req dto.AgentToolTestRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求参数格式错误")
	}
	item, err := h.svc.TestTool(c.Request().Context(), lu.UserID, c.Param("code"), req)
	if err != nil {
		return response.Error(c, err)
	}
	if item == nil {
		return response.FailWith(c, response.NotFound, "工具不存在")
	}
	return response.OK(c, item)
}

func (h *AgentWorkflowHandler) CreateAgent(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}
	var req dto.AgentDefinitionRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求参数格式错误")
	}
	item, err := h.svc.CreateAgent(c.Request().Context(), lu.UserID, req)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OK(c, item)
}

func (h *AgentWorkflowHandler) UpdateAgent(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}
	id, err := parseIDParam(c, "id", "无效的 ID")
	if err != nil {
		return err
	}
	var req dto.AgentDefinitionRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求参数格式错误")
	}
	item, err := h.svc.UpdateAgent(c.Request().Context(), lu.UserID, id, req)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	if item == nil {
		return response.FailWith(c, response.NotFound, "Agent 不存在")
	}
	return response.OK(c, item)
}

func (h *AgentWorkflowHandler) DeleteAgent(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}
	id, err := parseIDParam(c, "id", "无效的 ID")
	if err != nil {
		return err
	}
	ok, err := h.svc.DeleteAgent(c.Request().Context(), lu.UserID, id)
	if err != nil {
		return response.Error(c, err)
	}
	if !ok {
		return response.FailWith(c, response.NotFound, "Agent 不存在")
	}
	return response.OKEmpty(c)
}

func (h *AgentWorkflowHandler) CreateSchedule(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}
	var req dto.AgentScheduleRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求参数格式错误")
	}
	item, err := h.svc.CreateSchedule(c.Request().Context(), lu.UserID, req)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OK(c, item)
}

func (h *AgentWorkflowHandler) UpdateSchedule(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}
	id, err := parseIDParam(c, "id", "无效的 ID")
	if err != nil {
		return err
	}
	var req dto.AgentScheduleRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求参数格式错误")
	}
	item, err := h.svc.UpdateSchedule(c.Request().Context(), lu.UserID, id, req)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	if item == nil {
		return response.FailWith(c, response.NotFound, "调度不存在")
	}
	return response.OK(c, item)
}

func (h *AgentWorkflowHandler) DeleteSchedule(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}
	id, err := parseIDParam(c, "id", "无效的 ID")
	if err != nil {
		return err
	}
	ok, err := h.svc.DeleteSchedule(c.Request().Context(), lu.UserID, id)
	if err != nil {
		return response.Error(c, err)
	}
	if !ok {
		return response.FailWith(c, response.NotFound, "调度不存在")
	}
	return response.OKEmpty(c)
}

func (h *AgentWorkflowHandler) GetCapabilities(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}
	return response.OK(c, h.svc.Capabilities(c.Request().Context(), lu.UserID))
}

func (h *AgentWorkflowHandler) ListTemplates(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}
	items, err := h.svc.ListTemplates(c.Request().Context())
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, items)
}

func (h *AgentWorkflowHandler) ImportWorkflow(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}
	var req dto.AgentWorkflowImportRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求参数格式错误")
	}
	item, err := h.svc.ImportWorkflow(c.Request().Context(), lu.UserID, req)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OK(c, item)
}

func (h *AgentWorkflowHandler) ExportWorkflow(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}
	id, err := parseAgentWorkflowID(c)
	if err != nil {
		return err
	}
	item, err := h.svc.ExportWorkflow(c.Request().Context(), lu.UserID, id, c.QueryParam("format"))
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	if item == nil {
		return response.FailWith(c, response.NotFound, "工作流不存在")
	}
	return response.OK(c, item)
}

func (h *AgentWorkflowHandler) ListWorkflowVersions(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}
	id, err := parseAgentWorkflowID(c)
	if err != nil {
		return err
	}
	items, err := h.svc.ListVersions(c.Request().Context(), lu.UserID, id)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, items)
}

func (h *AgentWorkflowHandler) RollbackWorkflowVersion(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}
	id, err := parseAgentWorkflowID(c)
	if err != nil {
		return err
	}
	version, err := strconv.Atoi(c.Param("version"))
	if err != nil || version <= 0 {
		return response.FailWith(c, response.BadRequest, "无效的版本号")
	}
	item, err := h.svc.RollbackWorkflowVersion(c.Request().Context(), lu.UserID, id, version)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	if item == nil {
		return response.FailWith(c, response.NotFound, "版本不存在")
	}
	return response.OK(c, item)
}

func (h *AgentWorkflowHandler) ListVariables(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}
	id, err := parseAgentWorkflowID(c)
	if err != nil {
		return err
	}
	items, err := h.svc.ListVariables(c.Request().Context(), lu.UserID, id)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, items)
}

func (h *AgentWorkflowHandler) UpsertVariable(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}
	id, err := parseAgentWorkflowID(c)
	if err != nil {
		return err
	}
	var req dto.AgentVariableRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求参数格式错误")
	}
	req.WorkflowID = &id
	item, err := h.svc.UpsertVariable(c.Request().Context(), lu.UserID, req)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OK(c, item)
}

func (h *AgentWorkflowHandler) DeleteVariable(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}
	id, err := parseIDParam(c, "id", "无效的 ID")
	if err != nil {
		return err
	}
	ok, err := h.svc.DeleteVariable(c.Request().Context(), lu.UserID, id)
	if err != nil {
		return response.Error(c, err)
	}
	if !ok {
		return response.FailWith(c, response.NotFound, "变量不存在")
	}
	return response.OKEmpty(c)
}

func (h *AgentWorkflowHandler) TestNode(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}
	id, err := parseAgentWorkflowID(c)
	if err != nil {
		return err
	}
	var req dto.AgentWorkflowNodeTestRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求参数格式错误")
	}
	item, err := h.svc.TestNode(c.Request().Context(), lu.UserID, id, req)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OK(c, item)
}

func (h *AgentWorkflowHandler) WorkflowMetrics(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}
	id, err := parseAgentWorkflowID(c)
	if err != nil {
		return err
	}
	item, err := h.svc.Metrics(c.Request().Context(), lu.UserID, id)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, item)
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
	run, err := h.svc.InvokePublished(c.Request().Context(), lu.UserID, c.Param("slug"), req, c.Request().Header.Get("Origin"), clientRateKey(c))
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

func (h *AgentWorkflowHandler) StreamRun(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}
	id, err := parseAgentRunID(c)
	if err != nil {
		return err
	}
	c.Response().Header().Set(echo.HeaderContentType, "text/event-stream")
	c.Response().Header().Set(echo.HeaderCacheControl, "no-cache")
	c.Response().WriteHeader(200)
	for i := 0; i < 12; i++ {
		run, err := h.svc.GetRun(c.Request().Context(), lu.UserID, id)
		if err != nil {
			_, _ = c.Response().Write([]byte("event: error\ndata: {\"message\":\"stream failed\"}\n\n"))
			c.Response().Flush()
			return nil
		}
		if run == nil {
			_, _ = c.Response().Write([]byte("event: error\ndata: {\"message\":\"run not found\"}\n\n"))
			c.Response().Flush()
			return nil
		}
		payload, _ := jsonMarshal(run)
		_, _ = c.Response().Write([]byte("event: run\ndata: " + payload + "\n\n"))
		c.Response().Flush()
		if isTerminalRunStatus(run.Status) {
			return nil
		}
		select {
		case <-c.Request().Context().Done():
			return nil
		case <-time.After(2 * time.Second):
		}
	}
	_, _ = c.Response().Write([]byte("event: heartbeat\ndata: {}\n\n"))
	c.Response().Flush()
	return nil
}

func (h *AgentWorkflowHandler) CancelRun(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}
	id, err := parseAgentRunID(c)
	if err != nil {
		return err
	}
	run, err := h.svc.CancelRun(c.Request().Context(), lu.UserID, id)
	if err != nil {
		return response.Error(c, err)
	}
	if run == nil {
		return response.FailWith(c, response.NotFound, "运行记录不存在")
	}
	return response.OK(c, run)
}

func (h *AgentWorkflowHandler) RetryRun(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}
	id, err := parseAgentRunID(c)
	if err != nil {
		return err
	}
	var req struct {
		FromFailedNode bool `json:"fromFailedNode"`
	}
	_ = c.Bind(&req)
	run, err := h.svc.RetryRun(c.Request().Context(), lu.UserID, id, req.FromFailedNode)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	if run == nil {
		return response.FailWith(c, response.NotFound, "运行记录不存在")
	}
	return response.OK(c, run)
}

func (h *AgentWorkflowHandler) ResumeRun(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}
	id, err := parseAgentRunID(c)
	if err != nil {
		return err
	}
	var req struct {
		ResumeFromNode string `json:"resumeFromNode"`
	}
	_ = c.Bind(&req)
	run, err := h.svc.ResumeRun(c.Request().Context(), lu.UserID, id, req.ResumeFromNode)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	if run == nil {
		return response.FailWith(c, response.NotFound, "运行记录不存在")
	}
	return response.OK(c, run)
}

func (h *AgentWorkflowHandler) CanonicalizeRun(c echo.Context) error {
	lu := middleware.GetLoginUser(c)
	if lu == nil {
		return response.FailWith(c, response.Unauthorized, "未登录")
	}
	id, err := parseAgentRunID(c)
	if err != nil {
		return err
	}
	item, err := h.svc.CanonicalizeRun(c.Request().Context(), lu.UserID, id)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	if item == nil {
		return response.FailWith(c, response.NotFound, "运行记录不存在")
	}
	return response.OK(c, item)
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

func clientRateKey(c echo.Context) string {
	parts := []string{strings.TrimSpace(c.Request().Header.Get("X-Forwarded-For")), strings.TrimSpace(c.RealIP())}
	for _, part := range parts {
		if part == "" {
			continue
		}
		if strings.Contains(part, ",") {
			part = strings.TrimSpace(strings.Split(part, ",")[0])
		}
		if part != "" {
			return "ip:" + part
		}
	}
	return "ip:unknown"
}

func jsonMarshal(value any) (string, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return "{}", err
	}
	return string(raw), nil
}

func isTerminalRunStatus(status string) bool {
	switch status {
	case "success", "failed", "cancelled", "budget_exceeded":
		return true
	default:
		return false
	}
}
