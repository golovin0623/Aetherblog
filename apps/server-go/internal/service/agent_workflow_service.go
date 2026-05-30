package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/pkg/agentworkflow"
	"github.com/golovin0623/aetherblog-server/internal/repository"
)

// truncateForClient 把上游响应/错误信息按字符数截到适合返回给前端的长度,
// 避免把完整堆栈或 DB 错误明文经客户端可见的 fmt.Errorf 透出去。完整内容
// 保留到日志层供运维排查。
//
// 实现要点(#699 review): 用 for-range 按 rune 迭代而不是 s[:max] 直接按
// 字节切;后者在多字节字符(中文)落入中间字节时会切出无效 UTF-8 序列。
func truncateForClient(s string, max int) string {
	s = strings.TrimSpace(s)
	if max <= 0 {
		return s
	}
	count := 0
	for i := range s {
		if count == max {
			return s[:i] + "…"
		}
		count++
	}
	return s
}

type AgentWorkflowService struct {
	repo          *repository.AgentWorkflowRepo
	client        *AIClient
	internalToken string
	rateMu        sync.Mutex
	rateWindow    map[string][]time.Time
}

var agentPublicationSlugPattern = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

func NewAgentWorkflowService(repo *repository.AgentWorkflowRepo, client *AIClient, internalToken string) *AgentWorkflowService {
	return &AgentWorkflowService{
		repo:          repo,
		client:        client,
		internalToken: internalToken,
		rateWindow:    make(map[string][]time.Time),
	}
}

func (s *AgentWorkflowService) ListWorkflows(ctx context.Context, userID int64) ([]dto.AgentWorkflowSummary, error) {
	workflows, err := s.repo.ListWorkflows(ctx, userID)
	if err != nil {
		return nil, err
	}
	out := make([]dto.AgentWorkflowSummary, 0, len(workflows))
	for _, workflow := range workflows {
		out = append(out, toWorkflowSummary(workflow))
	}
	return out, nil
}

func (s *AgentWorkflowService) GetWorkflow(ctx context.Context, userID, id int64) (*dto.AgentWorkflowDetail, error) {
	workflow, err := s.repo.FindWorkflowByID(ctx, userID, id)
	if err != nil || workflow == nil {
		return nil, err
	}
	detail := toWorkflowDetail(*workflow)
	return &detail, nil
}

func (s *AgentWorkflowService) CreateWorkflow(ctx context.Context, userID int64, req dto.AgentWorkflowRequest) (*dto.AgentWorkflowDetail, error) {
	saveReq, err := normalizeWorkflowRequest(userID, req, nil)
	if err != nil {
		return nil, err
	}
	workflow, err := s.repo.CreateWorkflow(ctx, saveReq)
	if err != nil {
		return nil, err
	}
	detail := toWorkflowDetail(*workflow)
	return &detail, nil
}

func (s *AgentWorkflowService) UpdateWorkflow(ctx context.Context, userID, id int64, req dto.AgentWorkflowRequest) (*dto.AgentWorkflowDetail, error) {
	existing, err := s.repo.FindWorkflowByID(ctx, userID, id)
	if err != nil || existing == nil {
		return nil, err
	}
	saveReq, err := normalizeWorkflowRequest(userID, req, existing)
	if err != nil {
		return nil, err
	}
	workflow, err := s.repo.UpdateWorkflow(ctx, id, saveReq)
	if err != nil || workflow == nil {
		return nil, err
	}
	detail := toWorkflowDetail(*workflow)
	return &detail, nil
}

func (s *AgentWorkflowService) DeleteWorkflow(ctx context.Context, userID, id int64) (bool, error) {
	return s.repo.DeleteWorkflow(ctx, userID, id)
}

func (s *AgentWorkflowService) ListTools(ctx context.Context, userID int64) ([]dto.AgentToolSummary, error) {
	tools, err := s.repo.ListTools(ctx, userID)
	if err != nil {
		return nil, err
	}
	out := make([]dto.AgentToolSummary, 0, len(tools))
	for _, tool := range tools {
		desc := ""
		if tool.Description != nil {
			desc = *tool.Description
		}
		out = append(out, dto.AgentToolSummary{
			ID:               tool.ID,
			Code:             tool.Code,
			DisplayName:      tool.DisplayName,
			Description:      desc,
			Category:         tool.Category,
			Protocol:         tool.HandlerType,
			ArgsSchema:       jsonRawOrDefault(tool.ArgsSchema, "{}"),
			OutputSchema:     jsonRawOrDefault(tool.OutputSchema, "{}"),
			HandlerType:      tool.HandlerType,
			HandlerConfig:    jsonRawOrDefault(tool.HandlerConfig, "{}"),
			Public:           tool.IsPublic,
			Enabled:          tool.Enabled,
			RequiresApproval: tool.RequiresApproval,
			RateLimitPerMin:  tool.RateLimitPerMin,
			TimeoutMS:        tool.TimeoutMS,
		})
	}
	return out, nil
}

func (s *AgentWorkflowService) ListAgents(ctx context.Context, userID int64) ([]dto.AgentDefinitionSummary, error) {
	agents, err := s.repo.ListAgents(ctx, userID)
	if err != nil {
		return nil, err
	}
	out := make([]dto.AgentDefinitionSummary, 0, len(agents))
	for _, agent := range agents {
		desc := ""
		if agent.Description != nil {
			desc = *agent.Description
		}
		modelID := ""
		if agent.ModelID != nil {
			modelID = *agent.ModelID
		}
		providerCode := ""
		if agent.ProviderCode != nil {
			providerCode = *agent.ProviderCode
		}
		out = append(out, dto.AgentDefinitionSummary{
			ID:            agent.ID,
			Code:          agent.Code,
			Name:          agent.Name,
			Description:   desc,
			SystemPrompt:  agent.SystemPrompt,
			Model:         modelID,
			ProviderCode:  providerCode,
			MaxIterations: agent.MaxIterations,
			MaxToolCalls:  agent.MaxToolCalls,
			MaxTokens:     agent.MaxTokens,
			ToolCodes:     parseStringArray(agent.AllowedTools),
			Enabled:       agent.Enabled,
		})
	}
	return out, nil
}

func (s *AgentWorkflowService) ListSchedules(ctx context.Context, userID int64) ([]dto.AgentScheduleSummary, error) {
	schedules, err := s.repo.ListSchedules(ctx, userID)
	if err != nil {
		return nil, err
	}
	out := make([]dto.AgentScheduleSummary, 0, len(schedules))
	for _, schedule := range schedules {
		out = append(out, dto.AgentScheduleSummary{
			ID:              schedule.ID,
			WorkflowID:      schedule.WorkflowID,
			Enabled:         schedule.Enabled,
			CronExpr:        schedule.CronExpr,
			Timezone:        schedule.Timezone,
			Inputs:          jsonRawOrDefault(schedule.Inputs, "{}"),
			NextRunAt:       schedule.NextRunAt,
			LastRunAt:       schedule.LastRunAt,
			LastRunID:       schedule.LastRunID,
			MissedRunPolicy: schedule.MissedRunPolicy,
			LastError:       stringValue(schedule.LastError),
		})
	}
	return out, nil
}

func (s *AgentWorkflowService) Capabilities(_ context.Context, _ int64) dto.AgentWorkflowCapabilities {
	connected := s.client != nil && s.internalToken != ""
	return dto.AgentWorkflowCapabilities{
		DefaultRunMode: "real",
		RealLLM: dto.AgentWorkflowCapabilityStatus{
			Enabled: connected,
			State:   capabilityState(connected, "not_connected"),
			Label:   "真实 LLM",
			Detail:  "ai-service workflow runner 通过 LlmRouter 执行 LLM/Agent 节点；未配置内部服务令牌时真实模式会明确失败。",
		},
		RealTools: dto.AgentWorkflowCapabilityStatus{
			Enabled: connected,
			State:   capabilityState(connected, "not_connected"),
			Label:   "真实内置工具",
			Detail:  "kb_get_post / kb_search 通过 ai-service 查询真实 posts 数据，并受工具注册表快照约束。",
		},
		Sandbox: dto.AgentWorkflowCapabilityStatus{
			Enabled: connected,
			State:   capabilityState(connected, "not_connected"),
			Label:   "受限代码沙盒",
			Detail:  "Code 节点仅接入受限表达式沙盒；任意 JS/Python 文件隔离仍需独立 sandbox-worker。",
		},
		Scheduler: dto.AgentWorkflowCapabilityStatus{
			Enabled: true,
			State:   "available",
			Label:   "调度器",
			Detail:  "支持 schedule CRUD、nextRunAt 与 missed-run 策略；daemon 扫描入口已开放给仓库启动脚本/后台任务挂接。",
		},
		Autonomous: dto.AgentWorkflowCapabilityStatus{
			Enabled: connected,
			State:   capabilityState(connected, "not_connected"),
			Label:   "Autonomous",
			Detail:  "autonomous/hybrid 通过受限 Agent executor v1、allowedTools 与 maxIterations 执行，并可 canonicalize 为 fixed 草稿。",
		},
	}
}

func (s *AgentWorkflowService) CreateTool(ctx context.Context, userID int64, req dto.AgentToolRequest) (*dto.AgentToolSummary, error) {
	saveReq, err := normalizeToolRequest(userID, req)
	if err != nil {
		return nil, err
	}
	tool, err := s.repo.CreateTool(ctx, saveReq)
	if err != nil {
		return nil, err
	}
	item := toToolSummary(*tool)
	return &item, nil
}

func (s *AgentWorkflowService) UpdateTool(ctx context.Context, userID, id int64, req dto.AgentToolRequest) (*dto.AgentToolSummary, error) {
	saveReq, err := normalizeToolRequest(userID, req)
	if err != nil {
		return nil, err
	}
	tool, err := s.repo.UpdateTool(ctx, id, saveReq)
	if err != nil || tool == nil {
		return nil, err
	}
	item := toToolSummary(*tool)
	return &item, nil
}

func (s *AgentWorkflowService) DeleteTool(ctx context.Context, userID, id int64) (bool, error) {
	return s.repo.DeleteTool(ctx, userID, id)
}

func (s *AgentWorkflowService) TestTool(ctx context.Context, userID int64, code string, req dto.AgentToolTestRequest) (*dto.AgentToolTestResult, error) {
	start := time.Now()
	tool, err := s.repo.FindToolByCode(ctx, userID, strings.TrimSpace(code))
	if err != nil || tool == nil {
		return nil, err
	}
	if !tool.Enabled {
		return &dto.AgentToolTestResult{Status: "failed", ErrorMessage: "tool is disabled", DurationMS: elapsedMS(start)}, nil
	}
	if tool.RequiresApproval {
		return &dto.AgentToolTestResult{Status: "paused", ErrorMessage: "tool requires approval before execution", DurationMS: elapsedMS(start)}, nil
	}
	args := json.RawMessage(req.Args)
	if len(args) == 0 || !json.Valid(args) {
		args = json.RawMessage(`{}`)
	}
	output := json.RawMessage(`{"ok":true}`)
	switch tool.Code {
	case "echo":
		output = args
	case "text_join":
		var payload struct {
			Items     []any  `json:"items"`
			Separator string `json:"separator"`
		}
		_ = json.Unmarshal(args, &payload)
		parts := make([]string, 0, len(payload.Items))
		for _, item := range payload.Items {
			parts = append(parts, fmt.Sprint(item))
		}
		raw, _ := json.Marshal(strings.Join(parts, payload.Separator))
		output = raw
	default:
		output = json.RawMessage(fmt.Sprintf(`{"tool":"%s","status":"validated"}`, tool.Code))
	}
	return &dto.AgentToolTestResult{Status: "success", Output: output, DurationMS: elapsedMS(start)}, nil
}

func (s *AgentWorkflowService) CreateAgent(ctx context.Context, userID int64, req dto.AgentDefinitionRequest) (*dto.AgentDefinitionSummary, error) {
	saveReq, err := normalizeAgentRequest(userID, req)
	if err != nil {
		return nil, err
	}
	agent, err := s.repo.CreateAgent(ctx, saveReq)
	if err != nil {
		return nil, err
	}
	item := toAgentSummary(*agent)
	return &item, nil
}

func (s *AgentWorkflowService) UpdateAgent(ctx context.Context, userID, id int64, req dto.AgentDefinitionRequest) (*dto.AgentDefinitionSummary, error) {
	saveReq, err := normalizeAgentRequest(userID, req)
	if err != nil {
		return nil, err
	}
	agent, err := s.repo.UpdateAgent(ctx, id, saveReq)
	if err != nil || agent == nil {
		return nil, err
	}
	item := toAgentSummary(*agent)
	return &item, nil
}

func (s *AgentWorkflowService) DeleteAgent(ctx context.Context, userID, id int64) (bool, error) {
	return s.repo.DeleteAgent(ctx, userID, id)
}

func (s *AgentWorkflowService) CreateSchedule(ctx context.Context, userID int64, req dto.AgentScheduleRequest) (*dto.AgentScheduleSummary, error) {
	saveReq, err := normalizeScheduleRequest(userID, req)
	if err != nil {
		return nil, err
	}
	schedule, err := s.repo.CreateSchedule(ctx, saveReq)
	if err != nil {
		return nil, err
	}
	item := toScheduleSummary(*schedule)
	return &item, nil
}

func (s *AgentWorkflowService) UpdateSchedule(ctx context.Context, userID, id int64, req dto.AgentScheduleRequest) (*dto.AgentScheduleSummary, error) {
	saveReq, err := normalizeScheduleRequest(userID, req)
	if err != nil {
		return nil, err
	}
	schedule, err := s.repo.UpdateSchedule(ctx, id, saveReq)
	if err != nil || schedule == nil {
		return nil, err
	}
	item := toScheduleSummary(*schedule)
	return &item, nil
}

func (s *AgentWorkflowService) DeleteSchedule(ctx context.Context, userID, id int64) (bool, error) {
	return s.repo.DeleteSchedule(ctx, userID, id)
}

func (s *AgentWorkflowService) ListVariables(ctx context.Context, userID, workflowID int64) ([]dto.AgentVariableSummary, error) {
	variables, err := s.repo.ListVariables(ctx, userID, workflowID)
	if err != nil {
		return nil, err
	}
	out := make([]dto.AgentVariableSummary, 0, len(variables))
	for _, variable := range variables {
		out = append(out, toVariableSummary(variable))
	}
	return out, nil
}

func (s *AgentWorkflowService) UpsertVariable(ctx context.Context, userID int64, req dto.AgentVariableRequest) (*dto.AgentVariableSummary, error) {
	saveReq, err := normalizeVariableRequest(userID, req)
	if err != nil {
		return nil, err
	}
	variable, err := s.repo.UpsertVariable(ctx, saveReq)
	if err != nil {
		return nil, err
	}
	item := toVariableSummary(*variable)
	return &item, nil
}

func (s *AgentWorkflowService) DeleteVariable(ctx context.Context, userID, id int64) (bool, error) {
	return s.repo.DeleteVariable(ctx, userID, id)
}

func (s *AgentWorkflowService) ListVersions(ctx context.Context, userID, workflowID int64) ([]dto.AgentWorkflowVersionSummary, error) {
	versions, err := s.repo.ListVersions(ctx, userID, workflowID)
	if err != nil {
		return nil, err
	}
	out := make([]dto.AgentWorkflowVersionSummary, 0, len(versions))
	for _, version := range versions {
		out = append(out, toVersionSummary(version))
	}
	return out, nil
}

func (s *AgentWorkflowService) RollbackWorkflowVersion(ctx context.Context, userID, workflowID int64, version int) (*dto.AgentWorkflowDetail, error) {
	workflow, err := s.repo.RollbackWorkflowVersion(ctx, userID, workflowID, version)
	if err != nil || workflow == nil {
		return nil, err
	}
	detail := toWorkflowDetail(*workflow)
	return &detail, nil
}

func (s *AgentWorkflowService) ListTemplates(ctx context.Context) ([]dto.AgentWorkflowTemplateSummary, error) {
	templates, err := s.repo.ListTemplates(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]dto.AgentWorkflowTemplateSummary, 0, len(templates))
	for _, template := range templates {
		out = append(out, toTemplateSummary(template))
	}
	return out, nil
}

func (s *AgentWorkflowService) Metrics(ctx context.Context, userID, workflowID int64) (*dto.AgentWorkflowMetrics, error) {
	raw, err := s.repo.WorkflowMetrics(ctx, userID, workflowID)
	if err != nil {
		return nil, err
	}
	metrics := dto.AgentWorkflowMetrics{
		TotalRuns:     int64FromMap(raw, "total_runs"),
		SuccessRuns:   int64FromMap(raw, "success_runs"),
		FailedRuns:    int64FromMap(raw, "failed_runs"),
		CancelledRuns: int64FromMap(raw, "cancelled_runs"),
		SimulatedRuns: int64FromMap(raw, "simulated_runs"),
		TotalTokens:   int64FromMap(raw, "total_tokens"),
		TotalCostUSD:  float64FromMap(raw, "total_cost_usd"),
	}
	if value, ok := raw["avg_duration_ms"]; ok && value != nil {
		avg := float64FromAny(value)
		metrics.AvgDurationMS = &avg
	}
	if value, ok := raw["last_run_at"].(time.Time); ok {
		metrics.LastRunAt = &value
	}
	return &metrics, nil
}

func (s *AgentWorkflowService) PublishWorkflow(ctx context.Context, userID, workflowID int64, req dto.AgentPublicationRequest) (*dto.AgentPublicationSummary, error) {
	workflow, err := s.repo.FindWorkflowByID(ctx, userID, workflowID)
	if err != nil || workflow == nil {
		return nil, err
	}

	slug := strings.TrimSpace(req.Slug)
	if slug == "" {
		slug = slugFromWorkflowName(workflow.Name, workflow.ID)
	}
	slug, err = normalizePublicationSlug(slug)
	if err != nil {
		return nil, err
	}

	displayName := strings.TrimSpace(req.DisplayName)
	if displayName == "" {
		displayName = workflow.Name
	}
	description := req.Description
	if strings.TrimSpace(description) == "" && workflow.Description != nil {
		description = *workflow.Description
	}

	inputSchema, err := normalizeJSONDocument("inputSchema", req.InputSchema, defaultPublicationInputSchema(workflow.DefinitionJSON))
	if err != nil {
		return nil, err
	}
	outputSchema, err := normalizeJSONDocument("outputSchema", req.OutputSchema, "{}")
	if err != nil {
		return nil, err
	}
	allowedOrigins, err := normalizeJSONDocument("allowedOrigins", req.AllowedOrigins, "[]")
	if err != nil {
		return nil, err
	}

	rateLimit := req.RateLimitPerMin
	if rateLimit == 0 {
		rateLimit = 30
	}
	if rateLimit < 1 || rateLimit > 300 {
		return nil, fmt.Errorf("rateLimitPerMin must be between 1 and 300")
	}

	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}

	publication, err := s.repo.UpsertPublication(ctx, repository.AgentPublicationSaveRequest{
		UserID:          userID,
		WorkflowID:      workflow.ID,
		Version:         workflow.Version,
		Slug:            slug,
		DisplayName:     displayName,
		Description:     nullableDescription(description),
		InputSchema:     inputSchema,
		OutputSchema:    outputSchema,
		AllowedOrigins:  allowedOrigins,
		RateLimitPerMin: rateLimit,
		Enabled:         enabled,
	})
	if err != nil || publication == nil {
		return nil, err
	}
	summary := toPublicationSummary(*publication)
	return &summary, nil
}

func (s *AgentWorkflowService) UnpublishWorkflow(ctx context.Context, userID, workflowID int64) (bool, error) {
	return s.repo.UnpublishWorkflow(ctx, userID, workflowID)
}

func (s *AgentWorkflowService) ListPublished(ctx context.Context, limit int) ([]dto.AgentPublicationSummary, error) {
	items, err := s.repo.ListPublished(ctx, limit)
	if err != nil {
		return nil, err
	}
	out := make([]dto.AgentPublicationSummary, 0, len(items))
	for _, item := range items {
		out = append(out, toPublicationSummary(item))
	}
	return out, nil
}

func (s *AgentWorkflowService) InvokePublished(ctx context.Context, userID int64, slug string, req dto.AgentWorkflowRunRequest, origin, clientKey string) (*dto.AgentWorkflowRunSummary, error) {
	slug, err := normalizePublicationSlug(slug)
	if err != nil {
		return nil, err
	}
	publication, err := s.repo.FindPublishedBySlug(ctx, slug)
	if err != nil || publication == nil {
		return nil, err
	}
	if err := validatePublicationOrigin(publication.AllowedOrigins, origin); err != nil {
		return nil, err
	}
	if err := s.enforcePublicationRateLimit(ctx, userID, *publication, clientKey); err != nil {
		return nil, err
	}
	inputs := strings.TrimSpace(string(req.Inputs))
	if inputs == "" || inputs == "null" {
		inputs = "{}"
	}
	if err := validateWorkflowInputs(publication.InputSchema, inputs); err != nil {
		return nil, err
	}
	req.SimulateExternal = false
	req.SourceType = "publication"
	req.SourceRef = publication.Slug
	if strings.TrimSpace(req.RedactionPolicy) == "" {
		req.RedactionPolicy = "production"
	}
	return s.CreateRun(ctx, userID, publication.WorkflowID, req)
}

func (s *AgentWorkflowService) ListWorkflowRuns(ctx context.Context, userID, workflowID int64, limit int) ([]dto.AgentWorkflowRunSummary, error) {
	runs, err := s.repo.ListWorkflowRuns(ctx, userID, workflowID, limit)
	if err != nil {
		return nil, err
	}
	out := make([]dto.AgentWorkflowRunSummary, 0, len(runs))
	for _, run := range runs {
		out = append(out, toRunSummary(run))
	}
	return out, nil
}

func (s *AgentWorkflowService) GetRun(ctx context.Context, userID, runID int64) (*dto.AgentWorkflowRunDetail, error) {
	run, err := s.repo.FindRunByID(ctx, userID, runID)
	if err != nil || run == nil {
		return nil, err
	}
	logs, err := s.ListRunLogs(ctx, userID, runID)
	if err != nil {
		return nil, err
	}
	return &dto.AgentWorkflowRunDetail{
		AgentWorkflowRunSummary: toRunSummary(*run),
		Logs:                    logs,
	}, nil
}

func (s *AgentWorkflowService) ListRunLogs(ctx context.Context, userID, runID int64) ([]dto.AgentWorkflowNodeLog, error) {
	run, err := s.repo.FindRunByID(ctx, userID, runID)
	if err != nil || run == nil {
		return nil, err
	}
	logs, err := s.repo.ListRunLogs(ctx, userID, runID)
	if err != nil {
		return nil, err
	}
	out := make([]dto.AgentWorkflowNodeLog, 0, len(logs))
	for _, item := range logs {
		out = append(out, toWorkflowNodeLog(item))
	}
	return out, nil
}

func (s *AgentWorkflowService) CreateRun(ctx context.Context, userID, workflowID int64, req dto.AgentWorkflowRunRequest) (*dto.AgentWorkflowRunSummary, error) {
	workflow, err := s.repo.FindRunnableWorkflow(ctx, userID, workflowID)
	if err != nil || workflow == nil {
		return nil, err
	}
	inputs := strings.TrimSpace(string(req.Inputs))
	if inputs == "" || inputs == "null" {
		inputs = "{}"
	}
	if !json.Valid([]byte(inputs)) {
		return nil, fmt.Errorf("inputs must be valid JSON")
	}
	if err := validateWorkflowInputs(defaultPublicationInputSchema(workflow.DefinitionJSON), inputs); err != nil {
		return nil, err
	}
	totalNodes := countWorkflowNodes(workflow.DefinitionJSON)
	sourceType := normalizeRunSourceType(req.SourceType)
	redactionPolicy := normalizeRedactionPolicy(req.RedactionPolicy)
	var sourceRef *string
	if strings.TrimSpace(req.SourceRef) != "" {
		sourceRef = nullableDescription(req.SourceRef)
	}
	var resumeFromNode *string
	if strings.TrimSpace(req.ResumeFromNode) != "" {
		resumeFromNode = nullableDescription(req.ResumeFromNode)
	}
	run, err := s.repo.CreateRun(ctx, repository.AgentWorkflowRunCreateRequest{
		Workflow:        *workflow,
		UserID:          userID,
		Inputs:          inputs,
		TotalNodeCount:  totalNodes,
		Simulated:       req.SimulateExternal,
		ResumeFromNode:  resumeFromNode,
		SourceType:      sourceType,
		SourceRef:       sourceRef,
		RedactionPolicy: redactionPolicy,
		MaxTokens:       req.MaxTokens,
		MaxCostUSD:      req.MaxCostUSD,
		MaxDurationMS:   req.MaxDurationMS,
		MaxNodes:        req.MaxNodes,
	})
	if err != nil {
		return nil, err
	}
	if req.MaxNodes != nil && totalNodes > *req.MaxNodes {
		code, category, retryable := classifyWorkflowError("budget exceeded: max nodes")
		failed, finishErr := s.repo.FinishRunWithMeta(ctx, repository.AgentWorkflowRunFinishRequest{
			RunID:         run.ID,
			Status:        "budget_exceeded",
			Outputs:       "{}",
			ErrorMessage:  nullableDescription("budget exceeded: workflow node count exceeds maxNodes"),
			ErrorCode:     nullableDescription(code),
			ErrorCategory: nullableDescription(category),
			Retryable:     retryable,
		})
		if finishErr != nil {
			return nil, finishErr
		}
		summary := toRunSummary(*failed)
		return &summary, nil
	}
	if s.client == nil || s.internalToken == "" {
		code, category, retryable := classifyWorkflowError("AI workflow executor is not connected")
		failed, finishErr := s.repo.FinishRunWithMeta(ctx, repository.AgentWorkflowRunFinishRequest{
			RunID:         run.ID,
			Status:        "failed",
			Outputs:       "{}",
			ErrorMessage:  nullableDescription("AI workflow executor is not connected"),
			ErrorCode:     nullableDescription(code),
			ErrorCategory: nullableDescription(category),
			Retryable:     retryable,
		})
		if finishErr != nil {
			return nil, finishErr
		}
		summary := toRunSummary(*failed)
		return &summary, nil
	}

	go s.executeRunDetached(*workflow, *run, inputs, req.SimulateExternal)
	summary := toRunSummary(*run)
	return &summary, nil
}

func (s *AgentWorkflowService) CancelRun(ctx context.Context, userID, runID int64) (*dto.AgentWorkflowRunSummary, error) {
	run, err := s.repo.CancelRun(ctx, userID, runID)
	if err != nil || run == nil {
		return nil, err
	}
	summary := toRunSummary(*run)
	return &summary, nil
}

func (s *AgentWorkflowService) RetryRun(ctx context.Context, userID, runID int64, fromFailedNode bool) (*dto.AgentWorkflowRunSummary, error) {
	run, err := s.repo.FindRunByID(ctx, userID, runID)
	if err != nil || run == nil {
		return nil, err
	}
	workflow, err := s.repo.FindRunnableWorkflow(ctx, userID, run.WorkflowID)
	if err != nil || workflow == nil {
		return nil, err
	}
	req := dto.AgentWorkflowRunRequest{
		Inputs:           json.RawMessage(run.Inputs),
		SimulateExternal: run.Simulated,
		SourceType:       "retry",
		RedactionPolicy:  run.RedactionPolicy,
		MaxTokens:        run.MaxTokens,
		MaxCostUSD:       run.MaxCostUSD,
		MaxDurationMS:    run.MaxDurationMS,
		MaxNodes:         run.MaxNodes,
	}
	if fromFailedNode && run.CurrentNode != nil {
		req.ResumeFromNode = *run.CurrentNode
	}
	retry, err := s.repo.CreateRun(ctx, repository.AgentWorkflowRunCreateRequest{
		Workflow:        *workflow,
		UserID:          userID,
		Inputs:          run.Inputs,
		TotalNodeCount:  countWorkflowNodes(workflow.DefinitionJSON),
		Simulated:       req.SimulateExternal,
		RetryOfRunID:    &run.ID,
		ResumeFromNode:  nullableDescription(req.ResumeFromNode),
		SourceType:      "retry",
		RedactionPolicy: normalizeRedactionPolicy(req.RedactionPolicy),
		MaxTokens:       req.MaxTokens,
		MaxCostUSD:      req.MaxCostUSD,
		MaxDurationMS:   req.MaxDurationMS,
		MaxNodes:        req.MaxNodes,
	})
	if err != nil {
		return nil, err
	}
	if s.client != nil && s.internalToken != "" {
		go s.executeRunDetached(*workflow, *retry, run.Inputs, retry.Simulated)
	}
	summary := toRunSummary(*retry)
	return &summary, nil
}

func (s *AgentWorkflowService) ResumeRun(ctx context.Context, userID, runID int64, resumeFromNode string) (*dto.AgentWorkflowRunSummary, error) {
	run, err := s.repo.ResumeRun(ctx, userID, runID, nullableDescription(resumeFromNode))
	if err != nil || run == nil {
		return nil, err
	}
	workflow, err := s.repo.FindRunnableWorkflow(ctx, userID, run.WorkflowID)
	if err == nil && workflow != nil && s.client != nil && s.internalToken != "" {
		go s.executeRunDetached(*workflow, *run, run.Inputs, run.Simulated)
	}
	summary := toRunSummary(*run)
	return &summary, nil
}

func (s *AgentWorkflowService) TestNode(ctx context.Context, userID, workflowID int64, req dto.AgentWorkflowNodeTestRequest) (*dto.AgentWorkflowActionResult, error) {
	workflow, err := s.repo.FindRunnableWorkflow(ctx, userID, workflowID)
	if err != nil || workflow == nil {
		return nil, err
	}
	definition := workflow.DefinitionJSON
	if strings.TrimSpace(req.NodeID) == "" {
		return nil, fmt.Errorf("nodeId is required")
	}
	nodeOnly, err := definitionForSingleNode(definition, req.NodeID)
	if err != nil {
		return nil, err
	}
	inputs := strings.TrimSpace(string(req.Inputs))
	if inputs == "" || inputs == "null" {
		inputs = "{}"
	}
	runReq := dto.AgentWorkflowRunRequest{
		Inputs:           json.RawMessage(inputs),
		SimulateExternal: false,
		SourceType:       "node-test",
		SourceRef:        req.NodeID,
		RedactionPolicy:  "manual",
		MaxNodes:         intPtr(1),
	}
	tempWorkflow := *workflow
	tempWorkflow.DefinitionJSON = nodeOnly
	run, err := s.repo.CreateRun(ctx, repository.AgentWorkflowRunCreateRequest{
		Workflow:        tempWorkflow,
		UserID:          userID,
		Inputs:          inputs,
		TotalNodeCount:  1,
		Simulated:       runReq.SimulateExternal,
		SourceType:      runReq.SourceType,
		SourceRef:       nullableDescription(req.NodeID),
		RedactionPolicy: runReq.RedactionPolicy,
		MaxNodes:        runReq.MaxNodes,
	})
	if err != nil {
		return nil, err
	}
	if s.client != nil && s.internalToken != "" {
		go s.executeRunDetached(tempWorkflow, *run, inputs, false)
	}
	return &dto.AgentWorkflowActionResult{RunID: run.ID, Status: run.Status, Message: "节点测试已入队"}, nil
}

func (s *AgentWorkflowService) ExportWorkflow(ctx context.Context, userID, workflowID int64, format string) (*dto.AgentWorkflowExportResult, error) {
	workflow, err := s.repo.FindWorkflowByID(ctx, userID, workflowID)
	if err != nil || workflow == nil {
		return nil, err
	}
	format = strings.ToLower(strings.TrimSpace(format))
	if format == "" {
		format = "json"
	}
	if format != "json" {
		return nil, fmt.Errorf("only json export is currently supported")
	}
	return &dto.AgentWorkflowExportResult{Format: format, Definition: json.RawMessage(workflow.DefinitionJSON)}, nil
}

func (s *AgentWorkflowService) ImportWorkflow(ctx context.Context, userID int64, req dto.AgentWorkflowImportRequest) (*dto.AgentWorkflowDetail, error) {
	if strings.ToLower(strings.TrimSpace(req.Format)) != "" && strings.ToLower(strings.TrimSpace(req.Format)) != "json" {
		return nil, fmt.Errorf("only json import is currently supported")
	}
	return s.CreateWorkflow(ctx, userID, dto.AgentWorkflowRequest{Definition: req.Definition, ChangeNote: "Imported workflow"})
}

func (s *AgentWorkflowService) CanonicalizeRun(ctx context.Context, userID, runID int64) (*dto.AgentWorkflowDetail, error) {
	run, err := s.repo.FindRunByID(ctx, userID, runID)
	if err != nil || run == nil {
		return nil, err
	}
	logs, err := s.repo.ListRunLogs(ctx, userID, runID)
	if err != nil {
		return nil, err
	}
	definition, err := canonicalDefinitionFromRun(*run, logs)
	if err != nil {
		return nil, err
	}
	return s.CreateWorkflow(ctx, userID, dto.AgentWorkflowRequest{
		Name:        fmt.Sprintf("Canonicalized run %d", run.ID),
		Description: "由 autonomous/chat 运行轨迹固化的 fixed workflow 草稿。",
		Mode:        "fixed",
		Definition:  json.RawMessage(definition),
		IsTemplate:  boolPtr(false),
		IsPublic:    boolPtr(false),
		ChangeNote:  fmt.Sprintf("Canonicalized from run %d", run.ID),
	})
}

func (s *AgentWorkflowService) executeRunDetached(workflow model.AgentWorkflow, run model.AgentWorkflowRun, inputs string, simulateExternal bool) {
	timeout := 15 * time.Minute
	if run.MaxDurationMS != nil && *run.MaxDurationMS > 0 {
		timeout = time.Duration(*run.MaxDurationMS) * time.Millisecond
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	if _, err := s.repo.StartRun(ctx, run.ID); err != nil {
		log.Warn().Err(err).Int64("run_id", run.ID).Msg("agent workflow: start run failed")
		return
	}
	if nodeID, toolCode, payload, approval, err := s.firstApprovalRequiredTool(ctx, run.UserID, workflow.DefinitionJSON); err != nil {
		code, category, retryable := classifyWorkflowError(err.Error())
		_, _ = s.repo.FinishRunWithMeta(ctx, repository.AgentWorkflowRunFinishRequest{
			RunID:         run.ID,
			Status:        "failed",
			Outputs:       "{}",
			ErrorMessage:  nullableDescription(err.Error()),
			ErrorCode:     nullableDescription(code),
			ErrorCategory: nullableDescription(category),
			Retryable:     retryable,
		})
		return
	} else if approval {
		if err := s.repo.PauseRunForApproval(ctx, run.ID, nodeID, toolCode, payload); err != nil {
			log.Warn().Err(err).Int64("run_id", run.ID).Msg("agent workflow: pause for approval failed")
		}
		return
	}
	if _, err := s.executeWorkflow(ctx, workflow, run, inputs, simulateExternal); err != nil {
		code, category, retryable := classifyWorkflowError(err.Error())
		failed, finishErr := s.repo.FinishRunWithMeta(ctx, repository.AgentWorkflowRunFinishRequest{
			RunID:         run.ID,
			Status:        "failed",
			Outputs:       "{}",
			ErrorMessage:  nullableDescription(err.Error()),
			ErrorCode:     nullableDescription(code),
			ErrorCategory: nullableDescription(category),
			Retryable:     retryable,
		})
		if finishErr != nil {
			log.Warn().Err(finishErr).Int64("run_id", run.ID).Msg("agent workflow: finish failed run failed")
			return
		}
		_ = s.repo.CreateNotification(ctx, run.UserID, &run.ID, "workflow_failed", "工作流运行失败", stringValue(failed.ErrorMessage), fmt.Sprintf("/admin/agent-workflows?run=%d", run.ID))
	}
}

type workflowExecutePayload struct {
	RunID            int64                  `json:"runId"`
	Definition       json.RawMessage        `json:"definition"`
	Inputs           json.RawMessage        `json:"inputs"`
	SimulateExternal bool                   `json:"simulateExternal"`
	Tools            []workflowToolSnapshot `json:"tools,omitempty"`
	Budget           workflowBudgetSnapshot `json:"budget,omitempty"`
	RedactionPolicy  string                 `json:"redactionPolicy,omitempty"`
	ResumeFromNode   string                 `json:"resumeFromNode,omitempty"`
}

type workflowToolSnapshot struct {
	Code             string          `json:"code"`
	HandlerType      string          `json:"handlerType"`
	HandlerConfig    json.RawMessage `json:"handlerConfig"`
	Enabled          bool            `json:"enabled"`
	RequiresApproval bool            `json:"requiresApproval"`
	RateLimitPerMin  int             `json:"rateLimitPerMin"`
	TimeoutMS        int             `json:"timeoutMs"`
}

type workflowBudgetSnapshot struct {
	MaxTokens     *int     `json:"maxTokens,omitempty"`
	MaxCostUSD    *float64 `json:"maxCostUsd,omitempty"`
	MaxDurationMS *int     `json:"maxDurationMs,omitempty"`
	MaxNodes      *int     `json:"maxNodes,omitempty"`
}

type workflowExecuteEnvelope struct {
	Success      bool                   `json:"success"`
	Message      string                 `json:"message"`
	ErrorMessage string                 `json:"errorMessage"`
	Data         *workflowExecuteResult `json:"data"`
}

type workflowExecuteResult struct {
	Status           string              `json:"status"`
	Outputs          map[string]any      `json:"outputs"`
	CurrentNode      string              `json:"currentNode"`
	Trace            []workflowTraceItem `json:"trace"`
	ErrorMessage     string              `json:"errorMessage"`
	PromptTokens     int                 `json:"promptTokens"`
	CompletionTokens int                 `json:"completionTokens"`
	TotalCostUSD     float64             `json:"totalCostUsd"`
}

type workflowTraceItem struct {
	ID         string `json:"id"`
	NodeID     string `json:"nodeId"`
	NodeLabel  string `json:"nodeLabel"`
	NodeType   string `json:"nodeType"`
	Status     string `json:"status"`
	Summary    string `json:"summary"`
	Input      any    `json:"input"`
	Output     any    `json:"output"`
	Error      string `json:"error"`
	DurationMS int    `json:"durationMs"`
}

func (s *AgentWorkflowService) executeWorkflow(ctx context.Context, workflow model.AgentWorkflow, run model.AgentWorkflowRun, inputs string, simulateExternal bool) (*dto.AgentWorkflowRunSummary, error) {
	tools, err := s.workflowToolSnapshot(ctx, run.UserID, workflow.DefinitionJSON)
	if err != nil {
		return nil, err
	}
	body, err := json.Marshal(workflowExecutePayload{
		RunID:            run.ID,
		Definition:       json.RawMessage(workflow.DefinitionJSON),
		Inputs:           json.RawMessage(inputs),
		SimulateExternal: simulateExternal,
		Tools:            tools,
		Budget: workflowBudgetSnapshot{
			MaxTokens:     run.MaxTokens,
			MaxCostUSD:    run.MaxCostUSD,
			MaxDurationMS: run.MaxDurationMS,
			MaxNodes:      run.MaxNodes,
		},
		RedactionPolicy: run.RedactionPolicy,
		ResumeFromNode:  stringValue(run.ResumeFromNode),
	})
	if err != nil {
		return nil, err
	}
	respBody, statusCode, err := s.client.DoSync(ctx, http.MethodPost, "/api/v1/agent/workflows/execute", bytes.NewReader(body), map[string]string{
		"X-Internal-Service":  s.internalToken,
		"X-Forwarded-User-ID": fmt.Sprintf("%d", run.UserID),
	})
	if err != nil {
		return nil, err
	}
	defer respBody.Close()
	respBytes, readErr := io.ReadAll(respBody)
	if readErr != nil {
		return nil, fmt.Errorf("read AI workflow executor response: %w", readErr)
	}
	if statusCode != http.StatusOK {
		// 上游可能在 body 中携带堆栈或数据库错误明文 —— 截短再回给客户端,
		// 同时把完整 body 留到日志层供运维定位。
		log.Warn().Int("status", statusCode).Str("body", string(respBytes)).Msg("agent workflow: upstream non-200")
		return nil, fmt.Errorf("AI workflow executor returned HTTP %d: %s", statusCode, truncateForClient(string(respBytes), 200))
	}

	var envelope workflowExecuteEnvelope
	if err := json.Unmarshal(respBytes, &envelope); err != nil {
		return nil, err
	}
	if !envelope.Success || envelope.Data == nil {
		msg := envelope.ErrorMessage
		if msg == "" {
			msg = envelope.Message
		}
		if msg == "" {
			msg = "AI workflow executor returned empty response"
		}
		log.Warn().Str("upstream_msg", msg).Msg("agent workflow: upstream reported failure")
		return nil, fmt.Errorf("%s", truncateForClient(msg, 200))
	}

	status := normalizeRunStatus(envelope.Data.Status)
	outputs := "{}"
	if envelope.Data.Outputs != nil {
		if b, err := json.Marshal(envelope.Data.Outputs); err == nil {
			outputs = string(b)
		}
	}
	var currentNode *string
	if envelope.Data.CurrentNode != "" {
		currentNode = &envelope.Data.CurrentNode
	}
	var errorMessage *string
	if envelope.Data.ErrorMessage != "" {
		errorMessage = &envelope.Data.ErrorMessage
	}
	var promptTokens *int
	if envelope.Data.PromptTokens > 0 {
		promptTokens = &envelope.Data.PromptTokens
	}
	var completionTokens *int
	if envelope.Data.CompletionTokens > 0 {
		completionTokens = &envelope.Data.CompletionTokens
	}
	var totalCostUSD *float64
	if envelope.Data.TotalCostUSD > 0 {
		totalCostUSD = &envelope.Data.TotalCostUSD
	}
	code, category, retryable := classifyWorkflowError(envelope.Data.ErrorMessage)
	finished, err := s.repo.FinishRunWithMeta(ctx, repository.AgentWorkflowRunFinishRequest{
		RunID:            run.ID,
		Status:           status,
		Outputs:          outputs,
		CurrentNode:      currentNode,
		ErrorMessage:     errorMessage,
		ErrorCode:        nullableDescription(code),
		ErrorCategory:    nullableDescription(category),
		Retryable:        retryable,
		PromptTokens:     promptTokens,
		CompletionTokens: completionTokens,
		TotalCostUSD:     totalCostUSD,
		Logs:             toNodeLogInputs(envelope.Data.Trace),
	})
	if err != nil {
		return nil, err
	}
	summary := toRunSummary(*finished)
	summary.Trace = toRunTraceItems(envelope.Data.Trace)
	return &summary, nil
}

func normalizeRunStatus(status string) string {
	switch status {
	case "pending", "running", "paused", "success", "failed", "cancelled", "budget_exceeded":
		return status
	default:
		return "failed"
	}
}

func toNodeLogInputs(items []workflowTraceItem) []repository.AgentWorkflowNodeLogInput {
	logs := make([]repository.AgentWorkflowNodeLogInput, 0, len(items))
	for idx, item := range items {
		inputJSON := "{}"
		if item.Input != nil {
			if raw, err := json.Marshal(redactWorkflowPayload(item.Input)); err == nil {
				inputJSON = string(raw)
			}
		}
		var outputJSON *string
		if item.Output != nil {
			if raw, err := json.Marshal(redactWorkflowPayload(item.Output)); err == nil {
				value := string(raw)
				outputJSON = &value
			}
		}
		var errorMessage *string
		if item.Error != "" {
			errorMessage = &item.Error
		}
		logs = append(logs, repository.AgentWorkflowNodeLogInput{
			Sequence:     idx + 1,
			NodeID:       item.NodeID,
			NodeType:     item.NodeType,
			Status:       item.Status,
			InputJSON:    inputJSON,
			OutputJSON:   outputJSON,
			DurationMS:   item.DurationMS,
			ErrorMessage: errorMessage,
			MetadataJSON: `{"redacted":true}`,
		})
	}
	return logs
}

func toRunTraceItems(items []workflowTraceItem) []dto.AgentRunTraceItem {
	trace := make([]dto.AgentRunTraceItem, 0, len(items))
	for idx, item := range items {
		id := item.ID
		if id == "" {
			id = fmt.Sprintf("trace_%d_%s", idx+1, item.NodeID)
		}
		label := item.NodeLabel
		if label == "" {
			label = item.NodeID
		}
		trace = append(trace, dto.AgentRunTraceItem{
			ID:         id,
			NodeID:     item.NodeID,
			NodeLabel:  label,
			NodeType:   item.NodeType,
			Status:     item.Status,
			Summary:    item.Summary,
			DurationMS: item.DurationMS,
		})
	}
	return trace
}

func (s *AgentWorkflowService) workflowToolSnapshot(ctx context.Context, userID int64, definitionJSON string) ([]workflowToolSnapshot, error) {
	var def agentworkflow.Definition
	if err := json.Unmarshal([]byte(definitionJSON), &def); err != nil {
		return nil, fmt.Errorf("definition must be valid JSON: %w", err)
	}
	seen := map[string]bool{}
	snapshot := []workflowToolSnapshot{}
	for _, node := range def.Nodes {
		if node.Type != "tool" {
			continue
		}
		code, _ := node.Data["toolCode"].(string)
		code = strings.TrimSpace(code)
		if code == "" || seen[code] {
			continue
		}
		seen[code] = true
		tool, err := s.repo.FindToolByCode(ctx, userID, code)
		if err != nil {
			return nil, err
		}
		if tool == nil {
			return nil, fmt.Errorf("tool %s is not registered", code)
		}
		if !tool.Enabled {
			return nil, fmt.Errorf("tool %s is disabled", code)
		}
		snapshot = append(snapshot, workflowToolSnapshot{
			Code:             tool.Code,
			HandlerType:      tool.HandlerType,
			HandlerConfig:    jsonRawOrDefault(tool.HandlerConfig, "{}"),
			Enabled:          tool.Enabled,
			RequiresApproval: tool.RequiresApproval,
			RateLimitPerMin:  tool.RateLimitPerMin,
			TimeoutMS:        tool.TimeoutMS,
		})
	}
	return snapshot, nil
}

func (s *AgentWorkflowService) firstApprovalRequiredTool(ctx context.Context, userID int64, definitionJSON string) (string, string, string, bool, error) {
	var def agentworkflow.Definition
	if err := json.Unmarshal([]byte(definitionJSON), &def); err != nil {
		return "", "", "", false, err
	}
	for _, node := range def.Nodes {
		if node.Type != "tool" {
			continue
		}
		code, _ := node.Data["toolCode"].(string)
		code = strings.TrimSpace(code)
		if code == "" {
			continue
		}
		tool, err := s.repo.FindToolByCode(ctx, userID, code)
		if err != nil {
			return "", "", "", false, err
		}
		if tool == nil {
			return "", "", "", false, fmt.Errorf("tool %s is not registered", code)
		}
		if tool.RequiresApproval {
			payload, _ := json.Marshal(map[string]any{
				"nodeId":   node.ID,
				"toolCode": code,
				"args":     node.Data["args"],
			})
			return node.ID, code, string(payload), true, nil
		}
	}
	return "", "", "", false, nil
}

func normalizeToolRequest(userID int64, req dto.AgentToolRequest) (repository.AgentToolSaveRequest, error) {
	code := strings.TrimSpace(req.Code)
	if code == "" {
		return repository.AgentToolSaveRequest{}, fmt.Errorf("code is required")
	}
	displayName := strings.TrimSpace(req.DisplayName)
	if displayName == "" {
		return repository.AgentToolSaveRequest{}, fmt.Errorf("displayName is required")
	}
	handlerType := strings.TrimSpace(req.HandlerType)
	if handlerType == "" {
		handlerType = "http"
	}
	category := strings.TrimSpace(req.Category)
	if category == "" {
		category = "custom"
	}
	argsSchema, err := normalizeJSONDocument("argsSchema", req.ArgsSchema, "{}")
	if err != nil {
		return repository.AgentToolSaveRequest{}, err
	}
	outputSchema, err := normalizeJSONDocument("outputSchema", req.OutputSchema, "{}")
	if err != nil {
		return repository.AgentToolSaveRequest{}, err
	}
	handlerConfig, err := normalizeJSONDocument("handlerConfig", req.HandlerConfig, "{}")
	if err != nil {
		return repository.AgentToolSaveRequest{}, err
	}
	rateLimit := req.RateLimitPerMin
	if rateLimit == 0 {
		rateLimit = 60
	}
	timeoutMS := req.TimeoutMS
	if timeoutMS == 0 {
		timeoutMS = 30000
	}
	return repository.AgentToolSaveRequest{
		UserID:           userID,
		Code:             code,
		DisplayName:      displayName,
		Description:      nullableDescription(req.Description),
		Category:         category,
		HandlerType:      handlerType,
		ArgsSchema:       argsSchema,
		OutputSchema:     outputSchema,
		HandlerConfig:    handlerConfig,
		IsPublic:         req.Public,
		Enabled:          boolValueOrDefault(req.Enabled, true),
		RequiresApproval: boolValueOrDefault(req.RequiresApproval, handlerType != "builtin"),
		RateLimitPerMin:  rateLimit,
		TimeoutMS:        timeoutMS,
	}, nil
}

func normalizeAgentRequest(userID int64, req dto.AgentDefinitionRequest) (repository.AgentDefinitionSaveRequest, error) {
	code := strings.TrimSpace(req.Code)
	if code == "" {
		return repository.AgentDefinitionSaveRequest{}, fmt.Errorf("code is required")
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return repository.AgentDefinitionSaveRequest{}, fmt.Errorf("name is required")
	}
	prompt := strings.TrimSpace(req.SystemPrompt)
	if prompt == "" {
		prompt = "你是 AetherBlog 内容生产助手，只能使用允许的工具完成任务。"
	}
	allowedTools, err := normalizeJSONDocument("toolCodes", req.ToolCodes, "[]")
	if err != nil {
		return repository.AgentDefinitionSaveRequest{}, err
	}
	maxIterations := req.MaxIterations
	if maxIterations <= 0 {
		maxIterations = 8
	}
	maxToolCalls := req.MaxToolCalls
	if maxToolCalls <= 0 {
		maxToolCalls = 24
	}
	maxTokens := req.MaxTokens
	if maxTokens <= 0 {
		maxTokens = 60000
	}
	return repository.AgentDefinitionSaveRequest{
		UserID:        userID,
		Code:          code,
		Name:          name,
		Description:   nullableDescription(req.Description),
		SystemPrompt:  prompt,
		ModelID:       nullableDescription(req.Model),
		ProviderCode:  nullableDescription(req.ProviderCode),
		MaxIterations: maxIterations,
		MaxToolCalls:  maxToolCalls,
		MaxTokens:     maxTokens,
		AllowedTools:  allowedTools,
		Enabled:       boolValueOrDefault(req.Enabled, true),
	}, nil
}

func normalizeScheduleRequest(userID int64, req dto.AgentScheduleRequest) (repository.AgentScheduleSaveRequest, error) {
	if req.WorkflowID <= 0 {
		return repository.AgentScheduleSaveRequest{}, fmt.Errorf("workflowId is required")
	}
	cronExpr := strings.TrimSpace(req.CronExpr)
	if cronExpr == "" {
		return repository.AgentScheduleSaveRequest{}, fmt.Errorf("cronExpr is required")
	}
	timezone := strings.TrimSpace(req.Timezone)
	if timezone == "" {
		timezone = "Asia/Shanghai"
	}
	inputs, err := normalizeJSONDocument("inputs", req.Inputs, "{}")
	if err != nil {
		return repository.AgentScheduleSaveRequest{}, err
	}
	missedRunPolicy := strings.TrimSpace(req.MissedRunPolicy)
	if missedRunPolicy == "" {
		missedRunPolicy = "skip"
	}
	if missedRunPolicy != "skip" && missedRunPolicy != "catch-up" {
		return repository.AgentScheduleSaveRequest{}, fmt.Errorf("missedRunPolicy must be skip or catch-up")
	}
	return repository.AgentScheduleSaveRequest{
		UserID:          userID,
		WorkflowID:      req.WorkflowID,
		Enabled:         boolValueOrDefault(req.Enabled, false),
		CronExpr:        cronExpr,
		Timezone:        timezone,
		Inputs:          inputs,
		NextRunAt:       req.NextRunAt,
		MissedRunPolicy: missedRunPolicy,
	}, nil
}

func normalizeVariableRequest(userID int64, req dto.AgentVariableRequest) (repository.AgentVariableSaveRequest, error) {
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return repository.AgentVariableSaveRequest{}, fmt.Errorf("name is required")
	}
	scope := strings.TrimSpace(req.Scope)
	if scope == "" {
		scope = "workflow"
	}
	valueType := strings.TrimSpace(req.Type)
	if valueType == "" {
		valueType = "string"
	}
	var valueJSON *string
	if len(req.Value) > 0 && strings.TrimSpace(string(req.Value)) != "" && strings.TrimSpace(string(req.Value)) != "null" {
		if !json.Valid(req.Value) {
			return repository.AgentVariableSaveRequest{}, fmt.Errorf("value must be valid JSON")
		}
		valueJSON = nullableDescription(string(req.Value))
	}
	secretRef := nullableDescription(req.SecretRef)
	if valueJSON != nil && secretRef != nil {
		return repository.AgentVariableSaveRequest{}, fmt.Errorf("value and secretRef are mutually exclusive")
	}
	return repository.AgentVariableSaveRequest{
		UserID:     userID,
		WorkflowID: req.WorkflowID,
		Name:       name,
		Scope:      scope,
		ValueType:  valueType,
		ValueJSON:  valueJSON,
		SecretRef:  secretRef,
	}, nil
}

func normalizeWorkflowRequest(userID int64, req dto.AgentWorkflowRequest, existing *model.AgentWorkflow) (repository.AgentWorkflowSaveRequest, error) {
	raw := strings.TrimSpace(string(req.Definition))
	if raw == "" || raw == "null" {
		return repository.AgentWorkflowSaveRequest{}, fmt.Errorf("definition is required")
	}
	var def agentworkflow.Definition
	if err := json.Unmarshal([]byte(raw), &def); err != nil {
		return repository.AgentWorkflowSaveRequest{}, fmt.Errorf("definition must be valid JSON: %w", err)
	}
	if err := agentworkflow.ValidateDefinition(def, agentworkflow.ValidationOptions{}); err != nil {
		return repository.AgentWorkflowSaveRequest{}, err
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = strings.TrimSpace(def.Name)
	}
	if name == "" {
		return repository.AgentWorkflowSaveRequest{}, fmt.Errorf("name is required")
	}
	mode := strings.TrimSpace(req.Mode)
	if mode == "" {
		mode = def.Mode
	}
	description := req.Description
	if strings.TrimSpace(description) == "" {
		description = def.Description
	}
	isTemplate := boolValueOrDefault(req.IsTemplate, false)
	isPublic := boolValueOrDefault(req.IsPublic, false)
	if existing != nil {
		isTemplate = boolValueOrDefault(req.IsTemplate, existing.IsTemplate)
		isPublic = boolValueOrDefault(req.IsPublic, existing.IsPublic)
	}
	desc := nullableDescription(description)
	return repository.AgentWorkflowSaveRequest{
		UserID:         userID,
		Name:           name,
		Description:    desc,
		Mode:           mode,
		DefinitionJSON: raw,
		IsTemplate:     isTemplate,
		IsPublic:       isPublic,
		ChangeNote:     strings.TrimSpace(req.ChangeNote),
	}, nil
}

func boolValueOrDefault(value *bool, fallback bool) bool {
	if value == nil {
		return fallback
	}
	return *value
}

func normalizePublicationSlug(slug string) (string, error) {
	slug = strings.ToLower(strings.TrimSpace(slug))
	if slug == "" {
		return "", fmt.Errorf("slug is required")
	}
	if len(slug) > 120 {
		return "", fmt.Errorf("slug must be 120 characters or fewer")
	}
	if !agentPublicationSlugPattern.MatchString(slug) {
		return "", fmt.Errorf("slug may only contain lowercase letters, numbers, and single hyphens")
	}
	return slug, nil
}

func slugFromWorkflowName(name string, workflowID int64) string {
	name = strings.ToLower(strings.TrimSpace(name))
	var b strings.Builder
	lastDash := false
	for _, r := range name {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
			lastDash = false
			continue
		}
		if !lastDash && b.Len() > 0 {
			b.WriteByte('-')
			lastDash = true
		}
		if b.Len() >= 120 {
			break
		}
	}
	slug := strings.Trim(b.String(), "-")
	if slug == "" {
		slug = fmt.Sprintf("workflow-%d", workflowID)
	}
	if len(slug) > 120 {
		slug = strings.Trim(slug[:120], "-")
	}
	if slug == "" {
		return fmt.Sprintf("workflow-%d", workflowID)
	}
	return slug
}

func normalizeJSONDocument(name string, raw json.RawMessage, fallback string) (string, error) {
	text := strings.TrimSpace(string(raw))
	if text == "" || text == "null" {
		return fallback, nil
	}
	if !json.Valid([]byte(text)) {
		return "", fmt.Errorf("%s must be valid JSON", name)
	}
	return text, nil
}

func defaultPublicationInputSchema(definitionJSON string) string {
	var def struct {
		Inputs json.RawMessage `json:"inputs"`
	}
	if err := json.Unmarshal([]byte(definitionJSON), &def); err != nil {
		return "{}"
	}
	inputs := strings.TrimSpace(string(def.Inputs))
	if inputs == "" || inputs == "null" || !json.Valid(def.Inputs) {
		return "{}"
	}
	return inputs
}

func nullableDescription(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}

func boolPtr(value bool) *bool {
	return &value
}

func intPtr(value int) *int {
	return &value
}

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func capabilityState(enabled bool, fallback string) string {
	if enabled {
		return "available"
	}
	return fallback
}

func jsonRawOrDefault(raw string, fallback string) json.RawMessage {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "null" || !json.Valid([]byte(raw)) {
		raw = fallback
	}
	return json.RawMessage(raw)
}

func normalizeRunSourceType(sourceType string) string {
	sourceType = strings.TrimSpace(sourceType)
	switch sourceType {
	case "canvas", "publication", "schedule", "article", "chat", "cowork", "eval", "retry", "node-test", "canonicalize":
		return sourceType
	case "":
		return "canvas"
	default:
		return "canvas"
	}
}

func normalizeRedactionPolicy(policy string) string {
	policy = strings.TrimSpace(policy)
	switch policy {
	case "manual", "production", "full":
		return policy
	default:
		return "auto"
	}
}

func validateWorkflowInputs(schemaRaw string, inputsRaw string) error {
	schemaRaw = strings.TrimSpace(schemaRaw)
	if schemaRaw == "" || schemaRaw == "null" || schemaRaw == "{}" {
		return nil
	}
	var inputs map[string]any
	if err := json.Unmarshal([]byte(inputsRaw), &inputs); err != nil {
		return fmt.Errorf("inputs must be valid JSON object: %w", err)
	}
	var root map[string]json.RawMessage
	if err := json.Unmarshal([]byte(schemaRaw), &root); err != nil {
		return fmt.Errorf("input schema must be valid JSON: %w", err)
	}
	required := map[string]bool{}
	propertiesRaw := root
	if props, ok := root["properties"]; ok {
		var properties map[string]json.RawMessage
		if err := json.Unmarshal(props, &properties); err == nil {
			propertiesRaw = properties
		}
		if rawRequired, ok := root["required"]; ok {
			var names []string
			if err := json.Unmarshal(rawRequired, &names); err == nil {
				for _, name := range names {
					required[name] = true
				}
			}
		}
	}
	for name, rawSpec := range propertiesRaw {
		var spec struct {
			Type     string `json:"type"`
			Required bool   `json:"required"`
		}
		if err := json.Unmarshal(rawSpec, &spec); err != nil {
			continue
		}
		isRequired := spec.Required || required[name]
		value, exists := inputs[name]
		if isRequired && !exists {
			return fmt.Errorf("input %s is required", name)
		}
		if exists && spec.Type != "" && !workflowInputValueMatches(value, spec.Type) {
			return fmt.Errorf("input %s must be %s", name, spec.Type)
		}
	}
	return nil
}

func workflowInputValueMatches(value any, typeName string) bool {
	switch typeName {
	case "string":
		_, ok := value.(string)
		return ok
	case "number":
		_, ok := value.(float64)
		return ok
	case "integer":
		number, ok := value.(float64)
		return ok && number == float64(int64(number))
	case "boolean":
		_, ok := value.(bool)
		return ok
	case "object":
		_, ok := value.(map[string]any)
		return ok
	case "array", "array[string]", "array[number]", "array[object]", "array[boolean]":
		items, ok := value.([]any)
		if !ok {
			return false
		}
		switch typeName {
		case "array[string]":
			for _, item := range items {
				if _, ok := item.(string); !ok {
					return false
				}
			}
		case "array[number]":
			for _, item := range items {
				if _, ok := item.(float64); !ok {
					return false
				}
			}
		case "array[object]":
			for _, item := range items {
				if _, ok := item.(map[string]any); !ok {
					return false
				}
			}
		case "array[boolean]":
			for _, item := range items {
				if _, ok := item.(bool); !ok {
					return false
				}
			}
		}
		return true
	case "file":
		_, stringOK := value.(string)
		_, objectOK := value.(map[string]any)
		return stringOK || objectOK
	default:
		return true
	}
}

func validatePublicationOrigin(rawOrigins string, origin string) error {
	origin = strings.TrimSpace(origin)
	if origin == "" {
		return nil
	}
	var origins []string
	if err := json.Unmarshal([]byte(rawOrigins), &origins); err != nil {
		return fmt.Errorf("allowedOrigins must be an array")
	}
	if len(origins) == 0 {
		return nil
	}
	for _, allowed := range origins {
		allowed = strings.TrimSpace(allowed)
		if allowed == "*" || allowed == origin {
			return nil
		}
		if strings.Contains(allowed, "*.") {
			prefix, suffix, _ := strings.Cut(allowed, "*.")
			if strings.HasPrefix(origin, prefix) && strings.HasSuffix(origin, suffix) {
				return nil
			}
		}
	}
	return fmt.Errorf("origin is not allowed for this publication")
}

func (s *AgentWorkflowService) enforcePublicationRateLimit(ctx context.Context, userID int64, publication model.AgentPublication, clientKey string) error {
	if publication.RateLimitPerMin <= 0 {
		return nil
	}
	key := strings.TrimSpace(clientKey)
	if key == "" {
		key = fmt.Sprintf("u:%d", userID)
	}
	since := time.Now().Add(-time.Minute)
	if s.repo != nil {
		count, err := s.repo.CountRecentPublicationInvocations(ctx, publication.ID, key, since)
		if err != nil {
			return err
		}
		if count >= publication.RateLimitPerMin {
			return fmt.Errorf("publication rate limit exceeded")
		}
		_ = s.repo.RecordPublicationInvocation(ctx, publication.ID, &userID, key)
		return nil
	}
	s.rateMu.Lock()
	defer s.rateMu.Unlock()
	records := s.rateWindow[key]
	filtered := records[:0]
	for _, item := range records {
		if item.After(since) {
			filtered = append(filtered, item)
		}
	}
	if len(filtered) >= publication.RateLimitPerMin {
		s.rateWindow[key] = filtered
		return fmt.Errorf("publication rate limit exceeded")
	}
	s.rateWindow[key] = append(filtered, time.Now())
	return nil
}

func redactWorkflowPayload(value any) any {
	return redactWorkflowPayloadDepth(value, 0)
}

func redactWorkflowPayloadDepth(value any, depth int) any {
	if depth > 8 {
		return "[REDACTED_DEPTH]"
	}
	switch typed := value.(type) {
	case map[string]any:
		out := make(map[string]any, len(typed))
		for key, item := range typed {
			if isSecretLikeKey(key) {
				out[key] = "[REDACTED]"
				continue
			}
			out[key] = redactWorkflowPayloadDepth(item, depth+1)
		}
		return out
	case []any:
		out := make([]any, 0, len(typed))
		for _, item := range typed {
			out = append(out, redactWorkflowPayloadDepth(item, depth+1))
		}
		return out
	case string:
		if len([]rune(typed)) > 800 {
			runes := []rune(typed)
			return string(runes[:800]) + "...[truncated]"
		}
		return typed
	default:
		return value
	}
}

func isSecretLikeKey(key string) bool {
	key = strings.ToLower(key)
	return strings.Contains(key, "secret") ||
		strings.Contains(key, "token") ||
		strings.Contains(key, "password") ||
		strings.Contains(key, "api_key") ||
		strings.Contains(key, "apikey") ||
		key == "authorization" ||
		strings.Contains(key, "cookie")
}

func classifyWorkflowError(message string) (string, string, bool) {
	normalized := strings.ToLower(strings.TrimSpace(message))
	if normalized == "" {
		return "", "", false
	}
	switch {
	case strings.Contains(normalized, "budget"):
		return "budget_exceeded", "budget", false
	case strings.Contains(normalized, "permission") || strings.Contains(normalized, "unauthorized") || strings.Contains(normalized, "forbidden"):
		return "permission_denied", "permission", false
	case strings.Contains(normalized, "not connected") || strings.Contains(normalized, "not registered") || strings.Contains(normalized, "disabled") || strings.Contains(normalized, "schema"):
		return "runtime_not_configured", "configuration", false
	case strings.Contains(normalized, "timeout") || strings.Contains(normalized, "503") || strings.Contains(normalized, "502") || strings.Contains(normalized, "429"):
		return "upstream_unavailable", "upstream", true
	default:
		return "workflow_failed", "runtime", true
	}
}

func elapsedMS(start time.Time) int {
	return int(time.Since(start).Milliseconds())
}

func toToolSummary(tool model.AgentTool) dto.AgentToolSummary {
	return dto.AgentToolSummary{
		ID:               tool.ID,
		Code:             tool.Code,
		DisplayName:      tool.DisplayName,
		Description:      stringValue(tool.Description),
		Category:         tool.Category,
		Protocol:         tool.HandlerType,
		ArgsSchema:       jsonRawOrDefault(tool.ArgsSchema, "{}"),
		OutputSchema:     jsonRawOrDefault(tool.OutputSchema, "{}"),
		HandlerType:      tool.HandlerType,
		HandlerConfig:    jsonRawOrDefault(tool.HandlerConfig, "{}"),
		Public:           tool.IsPublic,
		Enabled:          tool.Enabled,
		RequiresApproval: tool.RequiresApproval,
		RateLimitPerMin:  tool.RateLimitPerMin,
		TimeoutMS:        tool.TimeoutMS,
	}
}

func toAgentSummary(agent model.AgentDefinition) dto.AgentDefinitionSummary {
	return dto.AgentDefinitionSummary{
		ID:            agent.ID,
		Code:          agent.Code,
		Name:          agent.Name,
		Description:   stringValue(agent.Description),
		SystemPrompt:  agent.SystemPrompt,
		Model:         stringValue(agent.ModelID),
		ProviderCode:  stringValue(agent.ProviderCode),
		MaxIterations: agent.MaxIterations,
		MaxToolCalls:  agent.MaxToolCalls,
		MaxTokens:     agent.MaxTokens,
		ToolCodes:     parseStringArray(agent.AllowedTools),
		Enabled:       agent.Enabled,
	}
}

func toScheduleSummary(schedule model.AgentSchedule) dto.AgentScheduleSummary {
	return dto.AgentScheduleSummary{
		ID:              schedule.ID,
		WorkflowID:      schedule.WorkflowID,
		Enabled:         schedule.Enabled,
		CronExpr:        schedule.CronExpr,
		Timezone:        schedule.Timezone,
		Inputs:          jsonRawOrDefault(schedule.Inputs, "{}"),
		NextRunAt:       schedule.NextRunAt,
		LastRunAt:       schedule.LastRunAt,
		LastRunID:       schedule.LastRunID,
		MissedRunPolicy: schedule.MissedRunPolicy,
		LastError:       stringValue(schedule.LastError),
	}
}

func toVariableSummary(variable model.AgentVariable) dto.AgentVariableSummary {
	value := json.RawMessage(nil)
	if variable.ValueJSON != nil && json.Valid([]byte(*variable.ValueJSON)) {
		value = json.RawMessage(*variable.ValueJSON)
	}
	return dto.AgentVariableSummary{
		ID:         variable.ID,
		WorkflowID: variable.WorkflowID,
		Name:       variable.Name,
		Scope:      variable.Scope,
		Type:       variable.ValueType,
		Value:      value,
		SecretRef:  stringValue(variable.SecretRef),
		UpdatedAt:  variable.UpdatedAt,
	}
}

func toVersionSummary(version model.AgentWorkflowVersion) dto.AgentWorkflowVersionSummary {
	return dto.AgentWorkflowVersionSummary{
		ID:         version.ID,
		WorkflowID: version.WorkflowID,
		Version:    version.Version,
		Definition: jsonRawOrDefault(version.DefinitionJSON, "{}"),
		ChangeNote: stringValue(version.ChangeNote),
		CreatedAt:  version.CreatedAt,
	}
}

func toTemplateSummary(template model.AgentWorkflowTemplate) dto.AgentWorkflowTemplateSummary {
	return dto.AgentWorkflowTemplateSummary{
		ID:                 template.ID,
		TemplateKey:        template.TemplateKey,
		Title:              template.Title,
		Description:        stringValue(template.Description),
		Category:           template.Category,
		Definition:         jsonRawOrDefault(template.DefinitionJSON, "{}"),
		DependencyManifest: jsonRawOrDefault(template.DependencyManifest, "{}"),
		InstalledCount:     template.InstalledCount,
	}
}

func int64FromMap(values map[string]any, key string) int64 {
	value, ok := values[key]
	if !ok || value == nil {
		return 0
	}
	switch typed := value.(type) {
	case int64:
		return typed
	case int:
		return int64(typed)
	case float64:
		return int64(typed)
	case []byte:
		var out int64
		_, _ = fmt.Sscan(string(typed), &out)
		return out
	case string:
		var out int64
		_, _ = fmt.Sscan(typed, &out)
		return out
	default:
		return 0
	}
}

func float64FromMap(values map[string]any, key string) float64 {
	value, ok := values[key]
	if !ok || value == nil {
		return 0
	}
	return float64FromAny(value)
}

func float64FromAny(value any) float64 {
	switch typed := value.(type) {
	case float64:
		return typed
	case float32:
		return float64(typed)
	case int64:
		return float64(typed)
	case int:
		return float64(typed)
	case []byte:
		var out float64
		_, _ = fmt.Sscan(string(typed), &out)
		return out
	case string:
		var out float64
		_, _ = fmt.Sscan(typed, &out)
		return out
	default:
		return 0
	}
}

func definitionForSingleNode(definitionJSON string, nodeID string) (string, error) {
	var raw struct {
		Version     int              `json:"version"`
		Name        string           `json:"name"`
		Mode        string           `json:"mode"`
		Description string           `json:"description,omitempty"`
		Inputs      map[string]any   `json:"inputs,omitempty"`
		Nodes       []map[string]any `json:"nodes"`
		Edges       []map[string]any `json:"edges,omitempty"`
		Viewport    map[string]any   `json:"viewport,omitempty"`
	}
	if err := json.Unmarshal([]byte(definitionJSON), &raw); err != nil {
		return "", err
	}
	for _, node := range raw.Nodes {
		if fmt.Sprint(node["id"]) != nodeID {
			continue
		}
		raw.Nodes = []map[string]any{
			{"id": "input_1", "type": "input", "label": "Test Input", "position": map[string]any{"x": 0, "y": 0}, "data": map[string]any{}},
			node,
			{"id": "output_1", "type": "output", "label": "Node Output", "position": map[string]any{"x": 520, "y": 0}, "data": map[string]any{"outputPath": "{{ nodes." + nodeID + ".output }}"}},
		}
		raw.Edges = []map[string]any{
			{"source": "input_1", "target": nodeID},
			{"source": nodeID, "target": "output_1"},
		}
		raw.Name = raw.Name + " node test"
		b, err := json.Marshal(raw)
		if err != nil {
			return "", err
		}
		return string(b), nil
	}
	return "", fmt.Errorf("node %s not found", nodeID)
}

func canonicalDefinitionFromRun(run model.AgentWorkflowRun, logs []model.AgentWorkflowNodeLog) (string, error) {
	nodes := make([]map[string]any, 0, len(logs)+1)
	edges := make([]map[string]any, 0, len(logs))
	inputs := map[string]any{"payload": map[string]any{"type": "object", "required": false}}
	nodes = append(nodes, map[string]any{
		"id": "input_1", "type": "input", "label": "固化输入", "position": map[string]any{"x": 0, "y": 0}, "data": map[string]any{},
	})
	previous := "input_1"
	for index, logItem := range logs {
		nodeID := fmt.Sprintf("step_%02d_%s", index+1, sanitizeNodeID(logItem.NodeID))
		var output any = nil
		if logItem.OutputJSON != nil && json.Valid([]byte(*logItem.OutputJSON)) {
			_ = json.Unmarshal([]byte(*logItem.OutputJSON), &output)
		}
		nodes = append(nodes, map[string]any{
			"id":       nodeID,
			"type":     "tool",
			"label":    fmt.Sprintf("%s · %s", logItem.NodeType, logItem.NodeID),
			"position": map[string]any{"x": 260 * (index + 1), "y": 0},
			"data": map[string]any{
				"toolCode": "echo",
				"args": map[string]any{
					"sourceRunId": run.ID,
					"nodeId":      logItem.NodeID,
					"output":      output,
				},
			},
		})
		edges = append(edges, map[string]any{"source": previous, "target": nodeID})
		previous = nodeID
	}
	nodes = append(nodes, map[string]any{
		"id": "final_output", "type": "output", "label": "固化输出", "position": map[string]any{"x": 260 * (len(logs) + 1), "y": 0}, "data": map[string]any{"outputPath": "{{ nodes." + previous + ".output }}"},
	})
	edges = append(edges, map[string]any{"source": previous, "target": "final_output"})
	definition := map[string]any{
		"version":     1,
		"name":        fmt.Sprintf("Canonicalized run %d", run.ID),
		"mode":        "fixed",
		"description": "由运行轨迹自动固化的可编辑 fixed workflow。",
		"inputs":      inputs,
		"nodes":       nodes,
		"edges":       edges,
	}
	raw, err := json.Marshal(definition)
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

func sanitizeNodeID(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "node"
	}
	var b strings.Builder
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' || r == '-' {
			b.WriteRune(r)
		}
	}
	if b.Len() == 0 {
		return "node"
	}
	return b.String()
}

func toWorkflowSummary(workflow model.AgentWorkflow) dto.AgentWorkflowSummary {
	desc := ""
	if workflow.Description != nil {
		desc = *workflow.Description
	}
	return dto.AgentWorkflowSummary{
		ID:          workflow.ID,
		Name:        workflow.Name,
		Description: desc,
		Mode:        workflow.Mode,
		Version:     workflow.Version,
		NodeCount:   countWorkflowNodes(workflow.DefinitionJSON),
		RunCount:    workflow.RunCount,
		LastRunAt:   workflow.LastRunAt,
		UpdatedAt:   workflow.UpdatedAt,
		Published:   workflow.IsPublic,
		Template:    workflow.IsTemplate,
	}
}

func toWorkflowDetail(workflow model.AgentWorkflow) dto.AgentWorkflowDetail {
	return dto.AgentWorkflowDetail{
		AgentWorkflowSummary: toWorkflowSummary(workflow),
		Definition:           json.RawMessage(workflow.DefinitionJSON),
		CreatedAt:            workflow.CreatedAt,
	}
}

func toPublicationSummary(publication model.AgentPublication) dto.AgentPublicationSummary {
	desc := ""
	if publication.Description != nil {
		desc = *publication.Description
	}
	inputSchema := json.RawMessage(publication.InputSchema)
	if len(inputSchema) == 0 || !json.Valid(inputSchema) {
		inputSchema = json.RawMessage(`{}`)
	}
	outputSchema := json.RawMessage(publication.OutputSchema)
	if len(outputSchema) == 0 || !json.Valid(outputSchema) {
		outputSchema = json.RawMessage(`{}`)
	}
	allowedOrigins := json.RawMessage(publication.AllowedOrigins)
	if len(allowedOrigins) == 0 || !json.Valid(allowedOrigins) {
		allowedOrigins = json.RawMessage(`[]`)
	}
	return dto.AgentPublicationSummary{
		ID:              publication.ID,
		WorkflowID:      publication.WorkflowID,
		Version:         publication.Version,
		Slug:            publication.Slug,
		DisplayName:     publication.DisplayName,
		Description:     desc,
		InputSchema:     inputSchema,
		OutputSchema:    outputSchema,
		AllowedOrigins:  allowedOrigins,
		RateLimitPerMin: publication.RateLimitPerMin,
		Enabled:         publication.Enabled,
		CreatedAt:       publication.CreatedAt,
		UpdatedAt:       publication.UpdatedAt,
	}
}

func countWorkflowNodes(raw string) int {
	var def struct {
		Nodes []any `json:"nodes"`
	}
	if err := json.Unmarshal([]byte(raw), &def); err != nil {
		return 0
	}
	return len(def.Nodes)
}

func parseStringArray(raw string) []string {
	var values []string
	if err := json.Unmarshal([]byte(raw), &values); err != nil {
		return []string{}
	}
	return values
}

func toRunSummary(run model.AgentWorkflowRun) dto.AgentWorkflowRunSummary {
	outputs := json.RawMessage(nil)
	if run.Outputs != nil {
		outputs = json.RawMessage(*run.Outputs)
	}
	currentNode := ""
	if run.CurrentNode != nil {
		currentNode = *run.CurrentNode
	}
	pausedReason := ""
	if run.PausedReason != nil {
		pausedReason = *run.PausedReason
	}
	errorMessage := ""
	if run.ErrorMessage != nil {
		errorMessage = *run.ErrorMessage
	}
	sourceRef := ""
	if run.SourceRef != nil {
		sourceRef = *run.SourceRef
	}
	errorCode := ""
	if run.ErrorCode != nil {
		errorCode = *run.ErrorCode
	}
	errorCategory := ""
	if run.ErrorCategory != nil {
		errorCategory = *run.ErrorCategory
	}
	resumeFromNode := ""
	if run.ResumeFromNode != nil {
		resumeFromNode = *run.ResumeFromNode
	}
	return dto.AgentWorkflowRunSummary{
		ID:                      run.ID,
		WorkflowID:              run.WorkflowID,
		Version:                 run.Version,
		Status:                  run.Status,
		Simulated:               run.Simulated,
		Inputs:                  json.RawMessage(run.Inputs),
		Outputs:                 outputs,
		CurrentNode:             currentNode,
		PausedReason:            pausedReason,
		TotalNodeCount:          run.TotalNodeCount,
		PromptTokens:            run.PromptTokens,
		CompletionTokens:        run.CompletionTokens,
		TotalCostUSD:            run.TotalCostUSD,
		ErrorMessage:            errorMessage,
		RetryOfRunID:            run.RetryOfRunID,
		ResumeFromNode:          resumeFromNode,
		CancelRequested:         run.CancelRequested,
		SourceType:              run.SourceType,
		SourceRef:               sourceRef,
		RedactionPolicy:         run.RedactionPolicy,
		MaxTokens:               run.MaxTokens,
		MaxCostUSD:              run.MaxCostUSD,
		MaxDurationMS:           run.MaxDurationMS,
		MaxNodes:                run.MaxNodes,
		ErrorCode:               errorCode,
		ErrorCategory:           errorCategory,
		Retryable:               run.Retryable,
		CanonicalizedWorkflowID: run.CanonicalizedWorkflowID,
		CreatedAt:               run.CreatedAt,
		StartedAt:               run.StartedAt,
		FinishedAt:              run.FinishedAt,
		DurationMS:              run.DurationMS,
	}
}

func toWorkflowNodeLog(log model.AgentWorkflowNodeLog) dto.AgentWorkflowNodeLog {
	input := json.RawMessage(log.InputJSON)
	if len(input) == 0 || !json.Valid(input) {
		input = json.RawMessage(`{}`)
	}
	output := json.RawMessage(nil)
	if log.OutputJSON != nil && json.Valid([]byte(*log.OutputJSON)) {
		output = json.RawMessage(*log.OutputJSON)
	}
	errorMessage := ""
	if log.ErrorMessage != nil {
		errorMessage = *log.ErrorMessage
	}
	metadata := json.RawMessage(log.MetadataJSON)
	if len(metadata) == 0 || !json.Valid(metadata) {
		metadata = nil
	}
	return dto.AgentWorkflowNodeLog{
		ID:           log.ID,
		RunID:        log.RunID,
		Sequence:     log.Sequence,
		NodeID:       log.NodeID,
		NodeType:     log.NodeType,
		Status:       log.Status,
		Input:        input,
		Output:       output,
		DurationMS:   log.DurationMS,
		ErrorMessage: errorMessage,
		StartedAt:    log.StartedAt,
		FinishedAt:   log.FinishedAt,
		Metadata:     metadata,
	}
}
