package service

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/model"
)

func TestToWorkflowNodeLogPreservesJSONPayloads(t *testing.T) {
	now := time.Now()
	duration := 17
	output := `{"report":"ok"}`
	item := toWorkflowNodeLog(model.AgentWorkflowNodeLog{
		ID:         10,
		RunID:      20,
		Sequence:   2,
		NodeID:     "final_report",
		NodeType:   "output",
		Status:     "success",
		InputJSON:  `{"score":0.91}`,
		OutputJSON: &output,
		DurationMS: &duration,
		StartedAt:  &now,
		FinishedAt: &now,
	})

	if item.ID != 10 || item.RunID != 20 || item.NodeID != "final_report" {
		t.Fatalf("unexpected identity fields: %#v", item)
	}
	if !json.Valid(item.Input) || string(item.Input) != `{"score":0.91}` {
		t.Fatalf("input = %s, want valid original JSON", item.Input)
	}
	if !json.Valid(item.Output) || string(item.Output) != output {
		t.Fatalf("output = %s, want valid original JSON", item.Output)
	}
	if item.DurationMS == nil || *item.DurationMS != duration {
		t.Fatalf("duration = %#v, want %d", item.DurationMS, duration)
	}
}

func TestToWorkflowNodeLogFallsBackForInvalidJSON(t *testing.T) {
	badOutput := `{not-json`
	errMsg := "node failed"
	item := toWorkflowNodeLog(model.AgentWorkflowNodeLog{
		ID:           10,
		RunID:        20,
		Sequence:     2,
		NodeID:       "bad_node",
		NodeType:     "tool",
		Status:       "failed",
		InputJSON:    `{not-json`,
		OutputJSON:   &badOutput,
		ErrorMessage: &errMsg,
	})

	if string(item.Input) != `{}` {
		t.Fatalf("invalid input should fall back to {}, got %s", item.Input)
	}
	if item.Output != nil {
		t.Fatalf("invalid output should be omitted, got %s", item.Output)
	}
	if item.ErrorMessage != errMsg {
		t.Fatalf("error message = %q, want %q", item.ErrorMessage, errMsg)
	}
}

func TestToRunSummaryHandlesOptionalFields(t *testing.T) {
	now := time.Now()
	outputs := `{"final_report":"ok"}`
	current := "final_report"
	errMsg := "done with warning"
	duration := 42
	run := toRunSummary(model.AgentWorkflowRun{
		ID:             101,
		WorkflowID:     11,
		Version:        3,
		UserID:         7,
		Status:         "success",
		Simulated:      true,
		Inputs:         `{"post_id":171}`,
		Outputs:        &outputs,
		CurrentNode:    &current,
		StartedAt:      &now,
		FinishedAt:     &now,
		DurationMS:     &duration,
		TotalNodeCount: 5,
		ErrorMessage:   &errMsg,
		CreatedAt:      now,
	})

	if run.ID != 101 || run.WorkflowID != 11 || run.Version != 3 || run.Status != "success" {
		t.Fatalf("unexpected run summary identity: %#v", run)
	}
	if !run.Simulated {
		t.Fatalf("simulated = false, want true")
	}
	if string(run.Inputs) != `{"post_id":171}` || string(run.Outputs) != outputs {
		t.Fatalf("unexpected JSON fields: inputs=%s outputs=%s", run.Inputs, run.Outputs)
	}
	if run.CurrentNode != current || run.ErrorMessage != errMsg {
		t.Fatalf("unexpected optional strings: current=%q error=%q", run.CurrentNode, run.ErrorMessage)
	}
	if run.DurationMS == nil || *run.DurationMS != duration {
		t.Fatalf("duration = %#v, want %d", run.DurationMS, duration)
	}
}

func TestCapabilitiesDefaultToSimulationModeButDisableUnwiredRuntime(t *testing.T) {
	svc := NewAgentWorkflowService(nil, nil, "")
	caps := svc.Capabilities(t.Context(), 7)

	if caps.DefaultRunMode != "simulate" {
		t.Fatalf("default run mode = %q, want simulate", caps.DefaultRunMode)
	}
	if caps.RealLLM.Enabled || caps.RealTools.Enabled || caps.Sandbox.Enabled || caps.Autonomous.Enabled {
		t.Fatalf("runtime capabilities requiring ai-service should be disabled by default: %#v", caps)
	}
	if caps.Scheduler.Enabled || caps.Scheduler.State != "coming_soon" {
		t.Fatalf("scheduler capability must remain unavailable until a daemon executes persisted plans: %#v", caps.Scheduler)
	}
	if !strings.Contains(caps.Scheduler.Detail, "仅可持久化周期配置") || !strings.Contains(caps.Scheduler.Detail, "daemon") {
		t.Fatalf("scheduler detail must distinguish persisted plans from automatic execution: %q", caps.Scheduler.Detail)
	}
	if caps.RealLLM.State != "not_connected" || caps.RealTools.State != "not_connected" {
		t.Fatalf("real runtime states = LLM:%q tools:%q, want not_connected", caps.RealLLM.State, caps.RealTools.State)
	}
}

func TestValidateWorkflowInputsHandlesRequiredFieldsAndTypes(t *testing.T) {
	schema := `{"post_id":{"type":"integer","required":true},"dry_run":{"type":"boolean"}}`
	if err := validateWorkflowInputs(schema, `{"post_id":171,"dry_run":true}`); err != nil {
		t.Fatalf("valid inputs returned error: %v", err)
	}
	if err := validateWorkflowInputs(schema, `{"dry_run":true}`); err == nil || !strings.Contains(err.Error(), "post_id") {
		t.Fatalf("missing required field error = %v, want post_id", err)
	}
	if err := validateWorkflowInputs(schema, `{"post_id":"171"}`); err == nil || !strings.Contains(err.Error(), "integer") {
		t.Fatalf("type mismatch error = %v, want integer", err)
	}
}

func TestPublicationOriginPolicy(t *testing.T) {
	if err := validatePublicationOrigin(`["https://blog.example.com","https://*.aether.local"]`, "https://blog.example.com"); err != nil {
		t.Fatalf("exact origin should pass: %v", err)
	}
	if err := validatePublicationOrigin(`["https://*.aether.local"]`, "https://admin.aether.local"); err != nil {
		t.Fatalf("wildcard origin should pass: %v", err)
	}
	if err := validatePublicationOrigin(`["https://blog.example.com"]`, "https://evil.example.com"); err == nil {
		t.Fatalf("disallowed origin returned nil error")
	}
	// Wildcard must only match a real dot-delimited subdomain, not a sibling domain
	// that merely ends with the same characters.
	if err := validatePublicationOrigin(`["https://*.example.com"]`, "https://badexample.com"); err == nil {
		t.Fatalf("wildcard must not accept sibling domain https://badexample.com")
	}
	if err := validatePublicationOrigin(`["https://*.example.com"]`, "https://foo.example.com"); err != nil {
		t.Fatalf("wildcard should accept real subdomain: %v", err)
	}
	// The wildcard label must be non-empty: the bare apex must not match "*.example.com".
	if err := validatePublicationOrigin(`["https://*.example.com"]`, "https://example.com"); err == nil {
		t.Fatalf("wildcard must not accept the bare apex domain")
	}
}

func TestRedactWorkflowPayloadRedactsSecretsAndTruncatesLongText(t *testing.T) {
	got := redactWorkflowPayload(map[string]any{
		"Authorization": "Bearer secret",
		"nested": map[string]any{
			"api_key": "abc",
			"body":    strings.Repeat("x", 900),
		},
	})
	obj, ok := got.(map[string]any)
	if !ok {
		t.Fatalf("redacted payload type = %T", got)
	}
	if obj["Authorization"] != "[REDACTED]" {
		t.Fatalf("authorization was not redacted: %#v", obj["Authorization"])
	}
	nested := obj["nested"].(map[string]any)
	if nested["api_key"] != "[REDACTED]" {
		t.Fatalf("api key was not redacted: %#v", nested["api_key"])
	}
	if body := nested["body"].(string); len(body) >= 900 || !strings.Contains(body, "truncated") {
		t.Fatalf("long body was not truncated: len=%d value=%q", len(body), body)
	}
}

func TestClassifyWorkflowError(t *testing.T) {
	tests := []struct {
		name      string
		message   string
		category  string
		retryable bool
	}{
		{name: "budget", message: "budget exceeded", category: "budget", retryable: false},
		{name: "permission", message: "permission denied", category: "permission", retryable: false},
		{name: "upstream", message: "AI workflow executor returned HTTP 503", category: "upstream", retryable: true},
		{name: "config", message: "llm executor is not connected", category: "configuration", retryable: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, category, retryable := classifyWorkflowError(tt.message)
			if category != tt.category || retryable != tt.retryable {
				t.Fatalf("classifyWorkflowError = category:%q retryable:%v, want %q/%v", category, retryable, tt.category, tt.retryable)
			}
		})
	}
}

func TestCanRetryWorkflowRunRequiresRetryableFailure(t *testing.T) {
	tests := []struct {
		name      string
		status    string
		retryable bool
		want      bool
	}{
		{name: "retryable failure", status: "failed", retryable: true, want: true},
		{name: "non-retryable failure", status: "failed", retryable: false, want: false},
		{name: "successful run", status: "success", retryable: true, want: false},
		{name: "retryable cancellation", status: "cancelled", retryable: true, want: true},
		{name: "non-retryable budget failure", status: "budget_exceeded", retryable: false, want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := canRetryWorkflowRun(tt.status, tt.retryable); got != tt.want {
				t.Fatalf("canRetryWorkflowRun(%q, %v) = %v, want %v", tt.status, tt.retryable, got, tt.want)
			}
		})
	}
}

func TestNormalizeWorkflowRequestPreservesPublicationFlagsWhenOmitted(t *testing.T) {
	existing := &model.AgentWorkflow{
		IsTemplate: true,
		IsPublic:   true,
	}

	req := dto.AgentWorkflowRequest{
		Definition: validWorkflowDefinitionPayload(),
	}

	saveReq, err := normalizeWorkflowRequest(7, req, existing)
	if err != nil {
		t.Fatalf("normalizeWorkflowRequest returned error: %v", err)
	}
	if !saveReq.IsTemplate || !saveReq.IsPublic {
		t.Fatalf("publication flags = template:%v public:%v, want both preserved true", saveReq.IsTemplate, saveReq.IsPublic)
	}
}

func TestNormalizeWorkflowRequestAllowsExplicitPublicationFlagsFalse(t *testing.T) {
	explicitFalse := false
	existing := &model.AgentWorkflow{
		IsTemplate: true,
		IsPublic:   true,
	}

	req := dto.AgentWorkflowRequest{
		Definition: validWorkflowDefinitionPayload(),
		IsTemplate: &explicitFalse,
		IsPublic:   &explicitFalse,
	}

	saveReq, err := normalizeWorkflowRequest(7, req, existing)
	if err != nil {
		t.Fatalf("normalizeWorkflowRequest returned error: %v", err)
	}
	if saveReq.IsTemplate || saveReq.IsPublic {
		t.Fatalf("publication flags = template:%v public:%v, want explicit false values", saveReq.IsTemplate, saveReq.IsPublic)
	}
}

func TestNormalizeWorkflowRequestDefaultsCreatePublicationFlagsFalse(t *testing.T) {
	req := dto.AgentWorkflowRequest{
		Definition: validWorkflowDefinitionPayload(),
	}

	saveReq, err := normalizeWorkflowRequest(7, req, nil)
	if err != nil {
		t.Fatalf("normalizeWorkflowRequest returned error: %v", err)
	}
	if saveReq.IsTemplate || saveReq.IsPublic {
		t.Fatalf("publication flags = template:%v public:%v, want create defaults false", saveReq.IsTemplate, saveReq.IsPublic)
	}
}

func validWorkflowDefinitionPayload() json.RawMessage {
	return json.RawMessage(`{"version":1,"name":"Article Audit","mode":"fixed","inputs":{"post_id":{"type":"integer","required":true}},"nodes":[{"id":"input_1","type":"input"},{"id":"load","type":"tool","data":{"toolCode":"kb_get_post"}},{"id":"answer","type":"output"}],"edges":[{"source":"input_1","target":"load"},{"source":"load","target":"answer"}]}`)
}

func TestNormalizePublicationSlugRejectsUnsafeValues(t *testing.T) {
	if slug, err := normalizePublicationSlug("Article-Audit"); err != nil || slug != "article-audit" {
		t.Fatalf("normalizePublicationSlug lowercase = %q, %v; want article-audit", slug, err)
	}
	for _, value := range []string{"", "-bad", "bad-", "bad--slug", "bad_slug", "中文"} {
		if _, err := normalizePublicationSlug(value); err == nil {
			t.Fatalf("normalizePublicationSlug(%q) returned nil error", value)
		}
	}
}

func TestSlugFromWorkflowNameFallsBackForNonASCIIName(t *testing.T) {
	if got := slugFromWorkflowName("文章审计智能体", 42); got != "workflow-42" {
		t.Fatalf("slugFromWorkflowName non-ascii = %q, want workflow-42", got)
	}
	if got := slugFromWorkflowName("Article Audit Agent", 42); got != "article-audit-agent" {
		t.Fatalf("slugFromWorkflowName ascii = %q, want article-audit-agent", got)
	}
}

func TestDefaultPublicationInputSchemaUsesDefinitionInputs(t *testing.T) {
	raw := `{"version":1,"inputs":{"post_id":{"type":"integer","required":true}}}`
	got := defaultPublicationInputSchema(raw)
	if !json.Valid([]byte(got)) || got != `{"post_id":{"type":"integer","required":true}}` {
		t.Fatalf("defaultPublicationInputSchema = %s", got)
	}
	if got := defaultPublicationInputSchema(`{bad-json`); got != "{}" {
		t.Fatalf("invalid definition fallback = %s, want {}", got)
	}
}

func TestToPublicationSummaryPreservesJSONSchemas(t *testing.T) {
	now := time.Now()
	desc := "Published workflow"
	item := toPublicationSummary(model.AgentPublication{
		ID:              501,
		WorkflowID:      11,
		Version:         3,
		Slug:            "article-audit-agent",
		DisplayName:     "Article Audit Agent",
		Description:     &desc,
		InputSchema:     `{"post_id":{"type":"integer"}}`,
		OutputSchema:    `{"report":{"type":"string"}}`,
		AllowedOrigins:  `["https://example.com"]`,
		RateLimitPerMin: 30,
		Enabled:         true,
		CreatedAt:       now,
		UpdatedAt:       now,
	})

	if item.ID != 501 || item.WorkflowID != 11 || item.Slug != "article-audit-agent" || !item.Enabled {
		t.Fatalf("unexpected publication summary identity: %#v", item)
	}
	if string(item.InputSchema) != `{"post_id":{"type":"integer"}}` || string(item.AllowedOrigins) != `["https://example.com"]` {
		t.Fatalf("unexpected JSON schemas: input=%s origins=%s", item.InputSchema, item.AllowedOrigins)
	}
}
