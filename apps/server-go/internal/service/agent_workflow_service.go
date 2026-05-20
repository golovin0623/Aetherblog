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
}

var agentPublicationSlugPattern = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

func NewAgentWorkflowService(repo *repository.AgentWorkflowRepo, client *AIClient, internalToken string) *AgentWorkflowService {
	return &AgentWorkflowService{repo: repo, client: client, internalToken: internalToken}
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
			Enabled:          tool.Enabled,
			RequiresApproval: tool.RequiresApproval,
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
		out = append(out, dto.AgentDefinitionSummary{
			ID:            agent.ID,
			Code:          agent.Code,
			Name:          agent.Name,
			Description:   desc,
			Model:         modelID,
			MaxIterations: agent.MaxIterations,
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
			ID:         schedule.ID,
			WorkflowID: schedule.WorkflowID,
			Enabled:    schedule.Enabled,
			CronExpr:   schedule.CronExpr,
			Timezone:   schedule.Timezone,
			NextRunAt:  schedule.NextRunAt,
		})
	}
	return out, nil
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

func (s *AgentWorkflowService) InvokePublished(ctx context.Context, userID int64, slug string, req dto.AgentWorkflowRunRequest) (*dto.AgentWorkflowRunSummary, error) {
	slug, err := normalizePublicationSlug(slug)
	if err != nil {
		return nil, err
	}
	publication, err := s.repo.FindPublishedBySlug(ctx, slug)
	if err != nil || publication == nil {
		return nil, err
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
	run, err := s.repo.CreateRun(ctx, *workflow, userID, inputs, countWorkflowNodes(workflow.DefinitionJSON))
	if err != nil {
		return nil, err
	}
	if s.client == nil || s.internalToken == "" {
		summary := toRunSummary(*run)
		return &summary, nil
	}

	executed, execErr := s.executeWorkflow(ctx, *workflow, *run, inputs, req.SimulateExternal)
	if execErr != nil {
		failed, finishErr := s.repo.FinishRun(
			ctx,
			run.ID,
			"failed",
			"{}",
			nil,
			nullableDescription(execErr.Error()),
			nil,
		)
		if finishErr != nil {
			return nil, finishErr
		}
		summary := toRunSummary(*failed)
		return &summary, nil
	}
	return executed, nil
}

type workflowExecutePayload struct {
	RunID            int64           `json:"runId"`
	Definition       json.RawMessage `json:"definition"`
	Inputs           json.RawMessage `json:"inputs"`
	SimulateExternal bool            `json:"simulateExternal"`
}

type workflowExecuteEnvelope struct {
	Success      bool                   `json:"success"`
	Message      string                 `json:"message"`
	ErrorMessage string                 `json:"errorMessage"`
	Data         *workflowExecuteResult `json:"data"`
}

type workflowExecuteResult struct {
	Status       string              `json:"status"`
	Outputs      map[string]any      `json:"outputs"`
	CurrentNode  string              `json:"currentNode"`
	Trace        []workflowTraceItem `json:"trace"`
	ErrorMessage string              `json:"errorMessage"`
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
	body, err := json.Marshal(workflowExecutePayload{
		RunID:            run.ID,
		Definition:       json.RawMessage(workflow.DefinitionJSON),
		Inputs:           json.RawMessage(inputs),
		SimulateExternal: simulateExternal,
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
	finished, err := s.repo.FinishRun(ctx, run.ID, status, outputs, currentNode, errorMessage, toNodeLogInputs(envelope.Data.Trace))
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
			if raw, err := json.Marshal(item.Input); err == nil {
				inputJSON = string(raw)
			}
		}
		var outputJSON *string
		if item.Output != nil {
			if raw, err := json.Marshal(item.Output); err == nil {
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
	errorMessage := ""
	if run.ErrorMessage != nil {
		errorMessage = *run.ErrorMessage
	}
	return dto.AgentWorkflowRunSummary{
		ID:             run.ID,
		WorkflowID:     run.WorkflowID,
		Version:        run.Version,
		Status:         run.Status,
		Inputs:         json.RawMessage(run.Inputs),
		Outputs:        outputs,
		CurrentNode:    currentNode,
		TotalNodeCount: run.TotalNodeCount,
		ErrorMessage:   errorMessage,
		CreatedAt:      run.CreatedAt,
		StartedAt:      run.StartedAt,
		FinishedAt:     run.FinishedAt,
		DurationMS:     run.DurationMS,
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
	}
}
