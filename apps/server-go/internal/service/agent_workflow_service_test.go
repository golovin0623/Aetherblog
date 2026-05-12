package service

import (
	"encoding/json"
	"testing"
	"time"

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
