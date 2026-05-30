package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"

	"github.com/golovin0623/aetherblog-server/internal/model"
)

type AgentWorkflowRepo struct {
	db *sqlx.DB
}

type workflowRunGetter interface {
	GetContext(ctx context.Context, dest interface{}, query string, args ...interface{}) error
}

func NewAgentWorkflowRepo(db *sqlx.DB) *AgentWorkflowRepo {
	return &AgentWorkflowRepo{db: db}
}

type AgentWorkflowSaveRequest struct {
	UserID         int64
	Name           string
	Description    *string
	Mode           string
	DefinitionJSON string
	IsTemplate     bool
	IsPublic       bool
	ChangeNote     string
}

type AgentWorkflowNodeLogInput struct {
	Sequence     int
	NodeID       string
	NodeType     string
	Status       string
	InputJSON    string
	OutputJSON   *string
	DurationMS   int
	ErrorMessage *string
	MetadataJSON string
}

type AgentPublicationSaveRequest struct {
	UserID          int64
	WorkflowID      int64
	Version         int
	Slug            string
	DisplayName     string
	Description     *string
	InputSchema     string
	OutputSchema    string
	AllowedOrigins  string
	RateLimitPerMin int
	Enabled         bool
}

type AgentWorkflowRunCreateRequest struct {
	Workflow        model.AgentWorkflow
	UserID          int64
	Inputs          string
	TotalNodeCount  int
	Simulated       bool
	RetryOfRunID    *int64
	ResumeFromNode  *string
	SourceType      string
	SourceRef       *string
	RedactionPolicy string
	MaxTokens       *int
	MaxCostUSD      *float64
	MaxDurationMS   *int
	MaxNodes        *int
}

type AgentWorkflowRunFinishRequest struct {
	RunID            int64
	Status           string
	Outputs          string
	CurrentNode      *string
	ErrorMessage     *string
	ErrorCode        *string
	ErrorCategory    *string
	Retryable        bool
	PromptTokens     *int
	CompletionTokens *int
	TotalCostUSD     *float64
	Logs             []AgentWorkflowNodeLogInput
}

type AgentToolSaveRequest struct {
	UserID           int64
	Code             string
	DisplayName      string
	Description      *string
	Category         string
	HandlerType      string
	ArgsSchema       string
	OutputSchema     string
	HandlerConfig    string
	IsPublic         bool
	Enabled          bool
	RequiresApproval bool
	RateLimitPerMin  int
	TimeoutMS        int
}

type AgentDefinitionSaveRequest struct {
	UserID        int64
	Code          string
	Name          string
	Description   *string
	SystemPrompt  string
	ModelID       *string
	ProviderCode  *string
	MaxIterations int
	MaxToolCalls  int
	MaxTokens     int
	AllowedTools  string
	Enabled       bool
}

type AgentScheduleSaveRequest struct {
	UserID          int64
	WorkflowID      int64
	Enabled         bool
	CronExpr        string
	Timezone        string
	Inputs          string
	NextRunAt       *time.Time
	MissedRunPolicy string
}

type AgentVariableSaveRequest struct {
	UserID     int64
	WorkflowID *int64
	Name       string
	Scope      string
	ValueType  string
	ValueJSON  *string
	SecretRef  *string
}

func (r *AgentWorkflowRepo) ListWorkflows(ctx context.Context, userID int64) ([]model.AgentWorkflow, error) {
	var workflows []model.AgentWorkflow
	err := r.db.SelectContext(ctx, &workflows, `
SELECT
    id,
    user_id,
    name,
    description,
    mode,
    definition_json::text AS definition_json,
    definition_ast::text AS definition_ast,
    is_template,
    is_public,
    version,
    run_count,
    last_run_at,
    created_at,
    updated_at
FROM agent_workflows
WHERE user_id = $1
ORDER BY updated_at DESC, id DESC`, userID)
	return workflows, err
}

func (r *AgentWorkflowRepo) FindWorkflowByID(ctx context.Context, userID, id int64) (*model.AgentWorkflow, error) {
	return r.findWorkflow(ctx, `id = $1 AND user_id = $2`, id, userID)
}

func (r *AgentWorkflowRepo) FindRunnableWorkflow(ctx context.Context, userID, id int64) (*model.AgentWorkflow, error) {
	return r.findWorkflow(ctx, `id = $1 AND (user_id = $2 OR is_public = TRUE)`, id, userID)
}

func (r *AgentWorkflowRepo) FindWorkflowVersionSnapshot(ctx context.Context, workflowID int64, version int) (*model.AgentWorkflow, error) {
	var workflow model.AgentWorkflow
	err := r.db.GetContext(ctx, &workflow, `
SELECT
    w.id,
    w.user_id,
    w.name,
    w.description,
    w.mode,
    v.definition_json::text AS definition_json,
    v.definition_ast::text AS definition_ast,
    w.is_template,
    w.is_public,
    v.version,
    w.run_count,
    w.last_run_at,
    w.created_at,
    w.updated_at
FROM agent_workflow_versions v
JOIN agent_workflows w ON w.id = v.workflow_id
WHERE v.workflow_id = $1
  AND v.version = $2
LIMIT 1`, workflowID, version)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &workflow, nil
}

func (r *AgentWorkflowRepo) findWorkflow(ctx context.Context, where string, args ...any) (*model.AgentWorkflow, error) {
	var workflow model.AgentWorkflow
	err := r.db.GetContext(ctx, &workflow, `
SELECT
    id,
    user_id,
    name,
    description,
    mode,
    definition_json::text AS definition_json,
    definition_ast::text AS definition_ast,
    is_template,
    is_public,
    version,
    run_count,
    last_run_at,
    created_at,
    updated_at
FROM agent_workflows
WHERE `+where+`
LIMIT 1`, args...)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &workflow, nil
}

func (r *AgentWorkflowRepo) CreateWorkflow(ctx context.Context, req AgentWorkflowSaveRequest) (*model.AgentWorkflow, error) {
	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var workflow model.AgentWorkflow
	if err := tx.GetContext(ctx, &workflow, `
INSERT INTO agent_workflows
    (user_id, name, description, mode, definition_json, definition_ast, is_template, is_public, version)
VALUES
    ($1, $2, $3, $4, $5::jsonb, '{}'::jsonb, $6, $7, 1)
RETURNING
    id,
    user_id,
    name,
    description,
    mode,
    definition_json::text AS definition_json,
    definition_ast::text AS definition_ast,
    is_template,
    is_public,
    version,
    run_count,
    last_run_at,
    created_at,
    updated_at`,
		req.UserID,
		req.Name,
		req.Description,
		req.Mode,
		req.DefinitionJSON,
		req.IsTemplate,
		req.IsPublic,
	); err != nil {
		return nil, err
	}

	if _, err := tx.ExecContext(ctx, `
INSERT INTO agent_workflow_versions
    (workflow_id, version, definition_json, definition_ast, change_note)
VALUES
    ($1, $2, $3::jsonb, '{}'::jsonb, $4)`,
		workflow.ID,
		workflow.Version,
		req.DefinitionJSON,
		nullableString(req.ChangeNote),
	); err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &workflow, nil
}

func (r *AgentWorkflowRepo) UpdateWorkflow(ctx context.Context, id int64, req AgentWorkflowSaveRequest) (*model.AgentWorkflow, error) {
	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var workflow model.AgentWorkflow
	if err := tx.GetContext(ctx, &workflow, `
UPDATE agent_workflows
SET
    name = $1,
    description = $2,
    mode = $3,
    definition_json = $4::jsonb,
    definition_ast = '{}'::jsonb,
    is_template = $5,
    is_public = $6,
    version = version + 1,
    updated_at = CURRENT_TIMESTAMP
WHERE id = $7 AND user_id = $8
RETURNING
    id,
    user_id,
    name,
    description,
    mode,
    definition_json::text AS definition_json,
    definition_ast::text AS definition_ast,
    is_template,
    is_public,
    version,
    run_count,
    last_run_at,
    created_at,
    updated_at`,
		req.Name,
		req.Description,
		req.Mode,
		req.DefinitionJSON,
		req.IsTemplate,
		req.IsPublic,
		id,
		req.UserID,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}

	if _, err := tx.ExecContext(ctx, `
INSERT INTO agent_workflow_versions
    (workflow_id, version, definition_json, definition_ast, change_note)
VALUES
    ($1, $2, $3::jsonb, '{}'::jsonb, $4)`,
		workflow.ID,
		workflow.Version,
		req.DefinitionJSON,
		nullableString(req.ChangeNote),
	); err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &workflow, nil
}

func (r *AgentWorkflowRepo) DeleteWorkflow(ctx context.Context, userID, id int64) (bool, error) {
	res, err := r.db.ExecContext(ctx, `DELETE FROM agent_workflows WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		return false, err
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return false, err
	}
	return affected > 0, nil
}

func (r *AgentWorkflowRepo) ListTools(ctx context.Context, userID int64) ([]model.AgentTool, error) {
	var tools []model.AgentTool
	err := r.db.SelectContext(ctx, &tools, `
SELECT
    id,
    user_id,
    code,
    display_name,
    description,
    category,
    args_schema::text AS args_schema,
    output_schema::text AS output_schema,
    handler_type,
    handler_config::text AS handler_config,
    is_public,
    enabled,
    requires_approval,
    rate_limit_per_min,
    timeout_ms,
    created_at,
    updated_at
FROM agent_tools
WHERE user_id = $1 OR user_id IS NULL OR is_public = TRUE
ORDER BY enabled DESC, category ASC, display_name ASC`, userID)
	return tools, err
}

func (r *AgentWorkflowRepo) FindToolByCode(ctx context.Context, userID int64, code string) (*model.AgentTool, error) {
	var tool model.AgentTool
	err := r.db.GetContext(ctx, &tool, `
SELECT
    id,
    user_id,
    code,
    display_name,
    description,
    category,
    args_schema::text AS args_schema,
    output_schema::text AS output_schema,
    handler_type,
    handler_config::text AS handler_config,
    is_public,
    enabled,
    requires_approval,
    rate_limit_per_min,
    timeout_ms,
    created_at,
    updated_at
FROM agent_tools
WHERE code = $1
  AND (user_id = $2 OR user_id IS NULL OR is_public = TRUE)
ORDER BY
    CASE
        WHEN user_id = $2 THEN 0
        WHEN user_id IS NULL THEN 1
        ELSE 2
    END,
    id ASC
LIMIT 1`, code, userID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &tool, nil
}

func (r *AgentWorkflowRepo) ListAgents(ctx context.Context, userID int64) ([]model.AgentDefinition, error) {
	var agents []model.AgentDefinition
	err := r.db.SelectContext(ctx, &agents, `
SELECT
    id,
    user_id,
    code,
    name,
    description,
    system_prompt,
    model_id,
    provider_code,
    max_iterations,
    max_tool_calls,
    max_tokens,
    allowed_tools::text AS allowed_tools,
    enabled,
    created_at,
    updated_at
FROM agent_agents
WHERE user_id = $1
ORDER BY enabled DESC, updated_at DESC, id DESC`, userID)
	return agents, err
}

func (r *AgentWorkflowRepo) ListSchedules(ctx context.Context, userID int64) ([]model.AgentSchedule, error) {
	var schedules []model.AgentSchedule
	err := r.db.SelectContext(ctx, &schedules, `
SELECT
    id,
    workflow_id,
    user_id,
    enabled,
    cron_expr,
    timezone,
    inputs::text AS inputs,
    next_run_at,
    last_run_at,
    last_run_id,
    missed_run_policy,
    last_error,
    created_at,
    updated_at
FROM agent_schedules
WHERE user_id = $1
ORDER BY enabled DESC, next_run_at ASC NULLS LAST, id DESC`, userID)
	return schedules, err
}

func (r *AgentWorkflowRepo) UpsertPublication(ctx context.Context, req AgentPublicationSaveRequest) (*model.AgentPublication, error) {
	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var workflowID int64
	if err := tx.GetContext(ctx, &workflowID, `
UPDATE agent_workflows
SET is_public = TRUE, updated_at = CURRENT_TIMESTAMP
WHERE id = $1 AND user_id = $2
RETURNING id`, req.WorkflowID, req.UserID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}

	var publication model.AgentPublication
	if err := tx.GetContext(ctx, &publication, `
INSERT INTO agent_publications
    (workflow_id, version, slug, display_name, description, input_schema, output_schema, allowed_origins, rate_limit_per_min, enabled)
VALUES
    ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10)
ON CONFLICT (workflow_id) DO UPDATE SET
    version = EXCLUDED.version,
    slug = EXCLUDED.slug,
    display_name = EXCLUDED.display_name,
    description = EXCLUDED.description,
    input_schema = EXCLUDED.input_schema,
    output_schema = EXCLUDED.output_schema,
    allowed_origins = EXCLUDED.allowed_origins,
    rate_limit_per_min = EXCLUDED.rate_limit_per_min,
    enabled = EXCLUDED.enabled,
    updated_at = CURRENT_TIMESTAMP
RETURNING
    id,
    workflow_id,
    version,
    slug,
    display_name,
    description,
    input_schema::text AS input_schema,
    output_schema::text AS output_schema,
    allowed_origins::text AS allowed_origins,
    rate_limit_per_min,
    enabled,
    created_at,
    updated_at`,
		req.WorkflowID,
		req.Version,
		req.Slug,
		req.DisplayName,
		req.Description,
		req.InputSchema,
		req.OutputSchema,
		req.AllowedOrigins,
		req.RateLimitPerMin,
		req.Enabled,
	); err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &publication, nil
}

func (r *AgentWorkflowRepo) UnpublishWorkflow(ctx context.Context, userID, workflowID int64) (bool, error) {
	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()

	res, err := tx.ExecContext(ctx, `
UPDATE agent_workflows
SET is_public = FALSE, updated_at = CURRENT_TIMESTAMP
WHERE id = $1 AND user_id = $2`, workflowID, userID)
	if err != nil {
		return false, err
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return false, err
	}
	if affected == 0 {
		return false, nil
	}

	if _, err := tx.ExecContext(ctx, `
UPDATE agent_publications
SET enabled = FALSE, updated_at = CURRENT_TIMESTAMP
WHERE workflow_id = $1`, workflowID); err != nil {
		return false, err
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}
	return true, nil
}

func (r *AgentWorkflowRepo) ListPublished(ctx context.Context, limit int) ([]model.AgentPublication, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	var items []model.AgentPublication
	err := r.db.SelectContext(ctx, &items, `
SELECT
    p.id,
    p.workflow_id,
    p.version,
    p.slug,
    p.display_name,
    p.description,
    p.input_schema::text AS input_schema,
    p.output_schema::text AS output_schema,
    p.allowed_origins::text AS allowed_origins,
    p.rate_limit_per_min,
    p.enabled,
    p.created_at,
    p.updated_at
FROM agent_publications p
JOIN agent_workflows w ON w.id = p.workflow_id
WHERE p.enabled = TRUE
  AND w.is_public = TRUE
ORDER BY p.updated_at DESC, p.id DESC
LIMIT $1`, limit)
	return items, err
}

func (r *AgentWorkflowRepo) FindPublishedBySlug(ctx context.Context, slug string) (*model.AgentPublication, error) {
	var publication model.AgentPublication
	err := r.db.GetContext(ctx, &publication, `
SELECT
    p.id,
    p.workflow_id,
    p.version,
    p.slug,
    p.display_name,
    p.description,
    p.input_schema::text AS input_schema,
    p.output_schema::text AS output_schema,
    p.allowed_origins::text AS allowed_origins,
    p.rate_limit_per_min,
    p.enabled,
    p.created_at,
    p.updated_at
FROM agent_publications p
JOIN agent_workflows w ON w.id = p.workflow_id
WHERE p.slug = $1
  AND p.enabled = TRUE
  AND w.is_public = TRUE
LIMIT 1`, slug)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &publication, nil
}

func (r *AgentWorkflowRepo) ListWorkflowRuns(ctx context.Context, userID, workflowID int64, limit int) ([]model.AgentWorkflowRun, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	var runs []model.AgentWorkflowRun
	err := r.db.SelectContext(ctx, &runs, `
SELECT
    r.id,
    r.workflow_id,
    r.version,
    r.user_id,
    r.status,
    r.simulated,
    r.inputs::text AS inputs,
    r.outputs::text AS outputs,
    r.current_node,
    r.paused_reason,
    r.started_at,
    r.finished_at,
    r.duration_ms,
    r.total_node_count,
    r.prompt_tokens,
    r.completion_tokens,
    r.total_cost_usd,
    r.error_message,
    r.retry_of_run_id,
    r.resume_from_node,
    r.cancel_requested,
    r.source_type,
    r.source_ref,
    r.redaction_policy,
    r.max_tokens,
    r.max_cost_usd,
    r.max_duration_ms,
    r.max_nodes,
    r.error_code,
    r.error_category,
    r.retryable,
    r.canonicalized_workflow_id,
    r.created_at
FROM agent_workflow_runs r
JOIN agent_workflows w ON w.id = r.workflow_id
WHERE r.workflow_id = $1
  AND (r.user_id = $2 OR w.user_id = $2)
ORDER BY r.created_at DESC, r.id DESC
LIMIT $3`, workflowID, userID, limit)
	return runs, err
}

func (r *AgentWorkflowRepo) FindRunByID(ctx context.Context, userID, runID int64) (*model.AgentWorkflowRun, error) {
	var run model.AgentWorkflowRun
	err := r.db.GetContext(ctx, &run, `
SELECT
    r.id,
    r.workflow_id,
    r.version,
    r.user_id,
    r.status,
    r.simulated,
    r.inputs::text AS inputs,
    r.outputs::text AS outputs,
    r.current_node,
    r.paused_reason,
    r.started_at,
    r.finished_at,
    r.duration_ms,
    r.total_node_count,
    r.prompt_tokens,
    r.completion_tokens,
    r.total_cost_usd,
    r.error_message,
    r.retry_of_run_id,
    r.resume_from_node,
    r.cancel_requested,
    r.source_type,
    r.source_ref,
    r.redaction_policy,
    r.max_tokens,
    r.max_cost_usd,
    r.max_duration_ms,
    r.max_nodes,
    r.error_code,
    r.error_category,
    r.retryable,
    r.canonicalized_workflow_id,
    r.created_at
FROM agent_workflow_runs r
JOIN agent_workflows w ON w.id = r.workflow_id
WHERE r.id = $1
  AND (r.user_id = $2 OR w.user_id = $2)
LIMIT 1`, runID, userID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &run, nil
}

func (r *AgentWorkflowRepo) findRunByIDInternal(ctx context.Context, getter workflowRunGetter, runID int64) (*model.AgentWorkflowRun, error) {
	var run model.AgentWorkflowRun
	err := getter.GetContext(ctx, &run, `
SELECT
    r.id,
    r.workflow_id,
    r.version,
    r.user_id,
    r.status,
    r.simulated,
    r.inputs::text AS inputs,
    r.outputs::text AS outputs,
    r.current_node,
    r.paused_reason,
    r.started_at,
    r.finished_at,
    r.duration_ms,
    r.total_node_count,
    r.prompt_tokens,
    r.completion_tokens,
    r.total_cost_usd,
    r.error_message,
    r.retry_of_run_id,
    r.resume_from_node,
    r.cancel_requested,
    r.source_type,
    r.source_ref,
    r.redaction_policy,
    r.max_tokens,
    r.max_cost_usd,
    r.max_duration_ms,
    r.max_nodes,
    r.error_code,
    r.error_category,
    r.retryable,
    r.canonicalized_workflow_id,
    r.created_at
FROM agent_workflow_runs r
WHERE r.id = $1
LIMIT 1`, runID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &run, nil
}

func (r *AgentWorkflowRepo) ListRunLogs(ctx context.Context, userID, runID int64) ([]model.AgentWorkflowNodeLog, error) {
	if run, err := r.FindRunByID(ctx, userID, runID); err != nil || run == nil {
		return nil, err
	}
	var logs []model.AgentWorkflowNodeLog
	err := r.db.SelectContext(ctx, &logs, `
SELECT
    id,
    run_id,
    sequence,
    node_id,
    node_type,
    status,
    input_json::text AS input_json,
    output_json::text AS output_json,
    duration_ms,
    error_message,
    started_at,
    finished_at,
    metadata_json::text AS metadata_json
FROM agent_workflow_node_logs
WHERE run_id = $1
ORDER BY sequence ASC, id ASC`, runID)
	return logs, err
}

func (r *AgentWorkflowRepo) CreateRun(ctx context.Context, req AgentWorkflowRunCreateRequest) (*model.AgentWorkflowRun, error) {
	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var run model.AgentWorkflowRun
	if err := tx.GetContext(ctx, &run, `
INSERT INTO agent_workflow_runs
    (
        workflow_id,
        version,
        user_id,
        status,
        simulated,
        inputs,
        total_node_count,
        retry_of_run_id,
        resume_from_node,
        source_type,
        source_ref,
        redaction_policy,
        max_tokens,
        max_cost_usd,
        max_duration_ms,
        max_nodes
    )
VALUES
    ($1, $2, $3, 'pending', $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
RETURNING
    id,
    workflow_id,
    version,
    user_id,
    status,
    simulated,
    inputs::text AS inputs,
    outputs::text AS outputs,
    current_node,
    paused_reason,
    started_at,
    finished_at,
    duration_ms,
    total_node_count,
    prompt_tokens,
    completion_tokens,
    total_cost_usd,
    error_message,
    retry_of_run_id,
    resume_from_node,
    cancel_requested,
    source_type,
    source_ref,
    redaction_policy,
    max_tokens,
    max_cost_usd,
    max_duration_ms,
    max_nodes,
    error_code,
    error_category,
    retryable,
    canonicalized_workflow_id,
    created_at`,
		req.Workflow.ID,
		req.Workflow.Version,
		req.UserID,
		req.Simulated,
		req.Inputs,
		req.TotalNodeCount,
		req.RetryOfRunID,
		req.ResumeFromNode,
		emptyStringDefault(req.SourceType, "canvas"),
		req.SourceRef,
		emptyStringDefault(req.RedactionPolicy, "auto"),
		req.MaxTokens,
		req.MaxCostUSD,
		req.MaxDurationMS,
		req.MaxNodes,
	); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `
UPDATE agent_workflows
SET run_count = run_count + 1, last_run_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
WHERE id = $1`, req.Workflow.ID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &run, nil
}

func (r *AgentWorkflowRepo) FinishRun(ctx context.Context, runID int64, status string, outputs string, currentNode *string, errorMessage *string, logs []AgentWorkflowNodeLogInput) (*model.AgentWorkflowRun, error) {
	return r.FinishRunWithMeta(ctx, AgentWorkflowRunFinishRequest{
		RunID:        runID,
		Status:       status,
		Outputs:      outputs,
		CurrentNode:  currentNode,
		ErrorMessage: errorMessage,
		Logs:         logs,
	})
}

func (r *AgentWorkflowRepo) FinishRunWithMeta(ctx context.Context, req AgentWorkflowRunFinishRequest) (*model.AgentWorkflowRun, error) {
	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var run model.AgentWorkflowRun
	if err := tx.GetContext(ctx, &run, `
UPDATE agent_workflow_runs
SET
    status = $2,
    outputs = $3::jsonb,
    current_node = $4,
    error_message = $5,
    error_code = $6,
    error_category = $7,
    retryable = $8,
    prompt_tokens = $9,
    completion_tokens = $10,
    total_cost_usd = $11,
    finished_at = CURRENT_TIMESTAMP,
    started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
    duration_ms = GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - COALESCE(started_at, created_at))) * 1000)::int)
WHERE id = $1
  AND cancel_requested = FALSE
  AND status NOT IN ('cancelled', 'success', 'failed', 'budget_exceeded')
RETURNING
    id,
    workflow_id,
    version,
    user_id,
    status,
    simulated,
    inputs::text AS inputs,
    outputs::text AS outputs,
    current_node,
    paused_reason,
    started_at,
    finished_at,
    duration_ms,
    total_node_count,
    prompt_tokens,
    completion_tokens,
    total_cost_usd,
    error_message,
    retry_of_run_id,
    resume_from_node,
    cancel_requested,
    source_type,
    source_ref,
    redaction_policy,
    max_tokens,
    max_cost_usd,
    max_duration_ms,
    max_nodes,
    error_code,
    error_category,
    retryable,
    canonicalized_workflow_id,
    created_at`,
		req.RunID,
		req.Status,
		req.Outputs,
		req.CurrentNode,
		req.ErrorMessage,
		req.ErrorCode,
		req.ErrorCategory,
		req.Retryable,
		req.PromptTokens,
		req.CompletionTokens,
		req.TotalCostUSD,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			currentRun, findErr := r.findRunByIDInternal(ctx, tx, req.RunID)
			if findErr != nil {
				return nil, findErr
			}
			if currentRun != nil {
				return currentRun, nil
			}
		}
		return nil, err
	}

	for _, item := range req.Logs {
		if item.InputJSON == "" {
			item.InputJSON = "{}"
		}
		if item.MetadataJSON == "" {
			item.MetadataJSON = "{}"
		}
		if _, err := tx.ExecContext(ctx, `
INSERT INTO agent_workflow_node_logs
    (run_id, sequence, node_id, node_type, status, input_json, output_json, duration_ms, error_message, finished_at, metadata_json)
VALUES
    ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, CURRENT_TIMESTAMP, $10::jsonb)`,
			req.RunID,
			item.Sequence,
			item.NodeID,
			item.NodeType,
			item.Status,
			item.InputJSON,
			item.OutputJSON,
			item.DurationMS,
			item.ErrorMessage,
			item.MetadataJSON,
		); err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &run, nil
}

func (r *AgentWorkflowRepo) StartRun(ctx context.Context, runID int64) (*model.AgentWorkflowRun, error) {
	var run model.AgentWorkflowRun
	if err := r.db.GetContext(ctx, &run, `
UPDATE agent_workflow_runs
SET status = 'running', started_at = COALESCE(started_at, CURRENT_TIMESTAMP)
WHERE id = $1
  AND status IN ('pending', 'running')
RETURNING
    id,
    workflow_id,
    version,
    user_id,
    status,
    simulated,
    inputs::text AS inputs,
    outputs::text AS outputs,
    current_node,
    paused_reason,
    started_at,
    finished_at,
    duration_ms,
    total_node_count,
    prompt_tokens,
    completion_tokens,
    total_cost_usd,
    error_message,
    retry_of_run_id,
    resume_from_node,
    cancel_requested,
    source_type,
    source_ref,
    redaction_policy,
    max_tokens,
    max_cost_usd,
    max_duration_ms,
    max_nodes,
    error_code,
    error_category,
    retryable,
    canonicalized_workflow_id,
    created_at`, runID); err != nil {
		return nil, err
	}
	return &run, nil
}

func (r *AgentWorkflowRepo) CancelRun(ctx context.Context, userID, runID int64) (*model.AgentWorkflowRun, error) {
	var run model.AgentWorkflowRun
	err := r.db.GetContext(ctx, &run, `
UPDATE agent_workflow_runs r
SET
    cancel_requested = TRUE,
    status = CASE WHEN r.status IN ('pending', 'running', 'paused') THEN 'cancelled' ELSE r.status END,
    finished_at = CASE WHEN r.status IN ('pending', 'running', 'paused') THEN CURRENT_TIMESTAMP ELSE r.finished_at END,
    duration_ms = CASE
        WHEN r.status IN ('pending', 'running', 'paused')
        THEN GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - COALESCE(r.started_at, r.created_at))) * 1000)::int)
        ELSE r.duration_ms
    END
FROM agent_workflows w
WHERE r.id = $1
  AND w.id = r.workflow_id
  AND (r.user_id = $2 OR w.user_id = $2)
RETURNING
    r.id,
    r.workflow_id,
    r.version,
    r.user_id,
    r.status,
    r.simulated,
    r.inputs::text AS inputs,
    r.outputs::text AS outputs,
    r.current_node,
    r.paused_reason,
    r.started_at,
    r.finished_at,
    r.duration_ms,
    r.total_node_count,
    r.prompt_tokens,
    r.completion_tokens,
    r.total_cost_usd,
    r.error_message,
    r.retry_of_run_id,
    r.resume_from_node,
    r.cancel_requested,
    r.source_type,
    r.source_ref,
    r.redaction_policy,
    r.max_tokens,
    r.max_cost_usd,
    r.max_duration_ms,
    r.max_nodes,
    r.error_code,
    r.error_category,
    r.retryable,
    r.canonicalized_workflow_id,
    r.created_at`, runID, userID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &run, nil
}

func (r *AgentWorkflowRepo) PauseRunForApproval(ctx context.Context, runID int64, nodeID, toolCode, payload string) error {
	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(ctx, `
	UPDATE agent_workflow_runs
	SET status = 'paused', paused_reason = 'requires_approval', current_node = $2
	WHERE id = $1
	  AND cancel_requested = FALSE
	  AND status IN ('pending', 'running')`, runID, nodeID)
	if err != nil {
		return err
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return tx.Commit()
	}
	if payload == "" {
		payload = "{}"
	}
	if _, err := tx.ExecContext(ctx, `
INSERT INTO agent_workflow_approvals (run_id, node_id, tool_code, requested_payload)
VALUES ($1, $2, $3, $4::jsonb)`, runID, nodeID, toolCode, payload); err != nil {
		return err
	}
	return tx.Commit()
}

func (r *AgentWorkflowRepo) ResumeRun(ctx context.Context, userID, runID int64, resumeFromNode *string) (*model.AgentWorkflowRun, error) {
	var run model.AgentWorkflowRun
	err := r.db.GetContext(ctx, &run, `
UPDATE agent_workflow_runs r
SET status = 'pending',
    paused_reason = NULL,
    resume_from_node = COALESCE($3, r.resume_from_node),
    finished_at = NULL,
    error_message = NULL,
    error_code = NULL,
    error_category = NULL
FROM agent_workflows w
WHERE r.id = $1
  AND w.id = r.workflow_id
  AND (r.user_id = $2 OR w.user_id = $2)
  AND r.status = 'paused'
RETURNING
    r.id,
    r.workflow_id,
    r.version,
    r.user_id,
    r.status,
    r.simulated,
    r.inputs::text AS inputs,
    r.outputs::text AS outputs,
    r.current_node,
    r.paused_reason,
    r.started_at,
    r.finished_at,
    r.duration_ms,
    r.total_node_count,
    r.prompt_tokens,
    r.completion_tokens,
    r.total_cost_usd,
    r.error_message,
    r.retry_of_run_id,
    r.resume_from_node,
    r.cancel_requested,
    r.source_type,
    r.source_ref,
    r.redaction_policy,
    r.max_tokens,
    r.max_cost_usd,
    r.max_duration_ms,
    r.max_nodes,
    r.error_code,
    r.error_category,
    r.retryable,
    r.canonicalized_workflow_id,
    r.created_at`, runID, userID, resumeFromNode)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &run, nil
}

func (r *AgentWorkflowRepo) ListVersions(ctx context.Context, userID, workflowID int64) ([]model.AgentWorkflowVersion, error) {
	var versions []model.AgentWorkflowVersion
	err := r.db.SelectContext(ctx, &versions, `
SELECT
    v.id,
    v.workflow_id,
    v.version,
    v.definition_json::text AS definition_json,
    v.change_note,
    v.created_at
FROM agent_workflow_versions v
JOIN agent_workflows w ON w.id = v.workflow_id
WHERE v.workflow_id = $1
  AND w.user_id = $2
ORDER BY v.version DESC`, workflowID, userID)
	return versions, err
}

func (r *AgentWorkflowRepo) RollbackWorkflowVersion(ctx context.Context, userID, workflowID int64, version int) (*model.AgentWorkflow, error) {
	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var definition string
	if err := tx.GetContext(ctx, &definition, `
SELECT v.definition_json::text
FROM agent_workflow_versions v
JOIN agent_workflows w ON w.id = v.workflow_id
WHERE v.workflow_id = $1 AND v.version = $2 AND w.user_id = $3
LIMIT 1`, workflowID, version, userID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}

	var workflow model.AgentWorkflow
	if err := tx.GetContext(ctx, &workflow, `
UPDATE agent_workflows
SET definition_json = $3::jsonb,
    definition_ast = '{}'::jsonb,
    version = version + 1,
    updated_at = CURRENT_TIMESTAMP
WHERE id = $1 AND user_id = $2
RETURNING
    id,
    user_id,
    name,
    description,
    mode,
    definition_json::text AS definition_json,
    definition_ast::text AS definition_ast,
    is_template,
    is_public,
    version,
    run_count,
    last_run_at,
    created_at,
    updated_at`, workflowID, userID, definition); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `
INSERT INTO agent_workflow_versions (workflow_id, version, definition_json, definition_ast, change_note)
VALUES ($1, $2, $3::jsonb, '{}'::jsonb, $4)`,
		workflow.ID,
		workflow.Version,
		definition,
		nullableString(fmt.Sprintf("Rollback to v%d", version)),
	); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &workflow, nil
}

func (r *AgentWorkflowRepo) ListTemplates(ctx context.Context) ([]model.AgentWorkflowTemplate, error) {
	var templates []model.AgentWorkflowTemplate
	err := r.db.SelectContext(ctx, &templates, `
SELECT
    id,
    template_key,
    title,
    description,
    category,
    definition_json::text AS definition_json,
    dependency_manifest::text AS dependency_manifest,
    installed_count,
    created_at,
    updated_at
FROM agent_workflow_marketplace_items
WHERE review_status = 'approved'
ORDER BY category ASC, installed_count DESC, title ASC`)
	return templates, err
}

func (r *AgentWorkflowRepo) CreateTool(ctx context.Context, req AgentToolSaveRequest) (*model.AgentTool, error) {
	var tool model.AgentTool
	err := r.db.GetContext(ctx, &tool, `
INSERT INTO agent_tools
    (user_id, code, display_name, description, category, args_schema, output_schema, handler_type, handler_config, is_public, enabled, requires_approval, rate_limit_per_min, timeout_ms)
VALUES
    ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9::jsonb, $10, $11, $12, $13, $14)
RETURNING
    id, user_id, code, display_name, description, category, args_schema::text AS args_schema,
    output_schema::text AS output_schema, handler_type, handler_config::text AS handler_config,
    is_public, enabled, requires_approval, rate_limit_per_min, timeout_ms, created_at, updated_at`,
		req.UserID,
		req.Code,
		req.DisplayName,
		req.Description,
		req.Category,
		req.ArgsSchema,
		req.OutputSchema,
		req.HandlerType,
		req.HandlerConfig,
		req.IsPublic,
		req.Enabled,
		req.RequiresApproval,
		req.RateLimitPerMin,
		req.TimeoutMS,
	)
	if err != nil {
		return nil, err
	}
	return &tool, nil
}

func (r *AgentWorkflowRepo) UpdateTool(ctx context.Context, id int64, req AgentToolSaveRequest) (*model.AgentTool, error) {
	var tool model.AgentTool
	err := r.db.GetContext(ctx, &tool, `
UPDATE agent_tools
SET code = $1,
    display_name = $2,
    description = $3,
    category = $4,
    args_schema = $5::jsonb,
    output_schema = $6::jsonb,
    handler_type = $7,
    handler_config = $8::jsonb,
    is_public = $9,
    enabled = $10,
    requires_approval = $11,
    rate_limit_per_min = $12,
    timeout_ms = $13,
    updated_at = CURRENT_TIMESTAMP
WHERE id = $14 AND user_id = $15
RETURNING
    id, user_id, code, display_name, description, category, args_schema::text AS args_schema,
    output_schema::text AS output_schema, handler_type, handler_config::text AS handler_config,
    is_public, enabled, requires_approval, rate_limit_per_min, timeout_ms, created_at, updated_at`,
		req.Code,
		req.DisplayName,
		req.Description,
		req.Category,
		req.ArgsSchema,
		req.OutputSchema,
		req.HandlerType,
		req.HandlerConfig,
		req.IsPublic,
		req.Enabled,
		req.RequiresApproval,
		req.RateLimitPerMin,
		req.TimeoutMS,
		id,
		req.UserID,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &tool, nil
}

func (r *AgentWorkflowRepo) DeleteTool(ctx context.Context, userID, id int64) (bool, error) {
	res, err := r.db.ExecContext(ctx, `DELETE FROM agent_tools WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		return false, err
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return false, err
	}
	return affected > 0, nil
}

func (r *AgentWorkflowRepo) CreateAgent(ctx context.Context, req AgentDefinitionSaveRequest) (*model.AgentDefinition, error) {
	var agent model.AgentDefinition
	err := r.db.GetContext(ctx, &agent, `
INSERT INTO agent_agents
    (user_id, code, name, description, system_prompt, model_id, provider_code, max_iterations, max_tool_calls, max_tokens, allowed_tools, enabled)
VALUES
    ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)
RETURNING
    id, user_id, code, name, description, system_prompt, model_id, provider_code,
    max_iterations, max_tool_calls, max_tokens, allowed_tools::text AS allowed_tools,
    enabled, created_at, updated_at`,
		req.UserID,
		req.Code,
		req.Name,
		req.Description,
		req.SystemPrompt,
		req.ModelID,
		req.ProviderCode,
		req.MaxIterations,
		req.MaxToolCalls,
		req.MaxTokens,
		req.AllowedTools,
		req.Enabled,
	)
	if err != nil {
		return nil, err
	}
	return &agent, nil
}

func (r *AgentWorkflowRepo) UpdateAgent(ctx context.Context, id int64, req AgentDefinitionSaveRequest) (*model.AgentDefinition, error) {
	var agent model.AgentDefinition
	err := r.db.GetContext(ctx, &agent, `
UPDATE agent_agents
SET code = $1,
    name = $2,
    description = $3,
    system_prompt = $4,
    model_id = $5,
    provider_code = $6,
    max_iterations = $7,
    max_tool_calls = $8,
    max_tokens = $9,
    allowed_tools = $10::jsonb,
    enabled = $11,
    updated_at = CURRENT_TIMESTAMP
WHERE id = $12 AND user_id = $13
RETURNING
    id, user_id, code, name, description, system_prompt, model_id, provider_code,
    max_iterations, max_tool_calls, max_tokens, allowed_tools::text AS allowed_tools,
    enabled, created_at, updated_at`,
		req.Code,
		req.Name,
		req.Description,
		req.SystemPrompt,
		req.ModelID,
		req.ProviderCode,
		req.MaxIterations,
		req.MaxToolCalls,
		req.MaxTokens,
		req.AllowedTools,
		req.Enabled,
		id,
		req.UserID,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &agent, nil
}

func (r *AgentWorkflowRepo) DeleteAgent(ctx context.Context, userID, id int64) (bool, error) {
	res, err := r.db.ExecContext(ctx, `DELETE FROM agent_agents WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		return false, err
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return false, err
	}
	return affected > 0, nil
}

func (r *AgentWorkflowRepo) CreateSchedule(ctx context.Context, req AgentScheduleSaveRequest) (*model.AgentSchedule, error) {
	var schedule model.AgentSchedule
	err := r.db.GetContext(ctx, &schedule, `
	INSERT INTO agent_schedules
	    (workflow_id, user_id, enabled, cron_expr, timezone, inputs, next_run_at, missed_run_policy)
	SELECT
	    $1, $2, $3, $4, $5, $6::jsonb, $7, $8
	FROM agent_workflows w
	WHERE w.id = $1 AND w.user_id = $2
	RETURNING
	    id, workflow_id, user_id, enabled, cron_expr, timezone, inputs::text AS inputs,
    next_run_at, last_run_at, last_run_id, missed_run_policy, last_error, created_at, updated_at`,
		req.WorkflowID,
		req.UserID,
		req.Enabled,
		req.CronExpr,
		req.Timezone,
		req.Inputs,
		req.NextRunAt,
		req.MissedRunPolicy,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &schedule, nil
}

func (r *AgentWorkflowRepo) UpdateSchedule(ctx context.Context, id int64, req AgentScheduleSaveRequest) (*model.AgentSchedule, error) {
	var schedule model.AgentSchedule
	err := r.db.GetContext(ctx, &schedule, `
	UPDATE agent_schedules s
	SET workflow_id = $1,
	    enabled = $2,
	    cron_expr = $3,
    timezone = $4,
    inputs = $5::jsonb,
	    next_run_at = $6,
	    missed_run_policy = $7,
	    updated_at = CURRENT_TIMESTAMP
	FROM agent_workflows w
	WHERE s.id = $8
	  AND s.user_id = $9
	  AND w.id = $1
	  AND w.user_id = $9
	RETURNING
	    s.id, s.workflow_id, s.user_id, s.enabled, s.cron_expr, s.timezone, s.inputs::text AS inputs,
	    s.next_run_at, s.last_run_at, s.last_run_id, s.missed_run_policy, s.last_error, s.created_at, s.updated_at`,
		req.WorkflowID,
		req.Enabled,
		req.CronExpr,
		req.Timezone,
		req.Inputs,
		req.NextRunAt,
		req.MissedRunPolicy,
		id,
		req.UserID,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &schedule, nil
}

func (r *AgentWorkflowRepo) DeleteSchedule(ctx context.Context, userID, id int64) (bool, error) {
	res, err := r.db.ExecContext(ctx, `DELETE FROM agent_schedules WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		return false, err
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return false, err
	}
	return affected > 0, nil
}

func (r *AgentWorkflowRepo) ListVariables(ctx context.Context, userID, workflowID int64) ([]model.AgentVariable, error) {
	var variables []model.AgentVariable
	err := r.db.SelectContext(ctx, &variables, `
SELECT id, user_id, workflow_id, name, scope, value_type, value_json::text AS value_json, secret_ref, created_at, updated_at
FROM agent_variables
WHERE (user_id = $1 OR user_id IS NULL)
  AND (workflow_id = $2 OR workflow_id IS NULL)
ORDER BY scope ASC, name ASC`, userID, workflowID)
	return variables, err
}

func (r *AgentWorkflowRepo) UpsertVariable(ctx context.Context, req AgentVariableSaveRequest) (*model.AgentVariable, error) {
	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `
DELETE FROM agent_variables
WHERE user_id = $1
  AND workflow_id IS NOT DISTINCT FROM $2
  AND name = $3
  AND scope = $4`,
		req.UserID,
		req.WorkflowID,
		req.Name,
		req.Scope,
	); err != nil {
		return nil, err
	}

	var variable model.AgentVariable
	if err := tx.GetContext(ctx, &variable, `
INSERT INTO agent_variables (user_id, workflow_id, name, scope, value_type, value_json, secret_ref)
VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
RETURNING id, user_id, workflow_id, name, scope, value_type, value_json::text AS value_json, secret_ref, created_at, updated_at`,
		req.UserID,
		req.WorkflowID,
		req.Name,
		req.Scope,
		req.ValueType,
		req.ValueJSON,
		req.SecretRef,
	); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &variable, nil
}

func (r *AgentWorkflowRepo) DeleteVariable(ctx context.Context, userID, id int64) (bool, error) {
	res, err := r.db.ExecContext(ctx, `DELETE FROM agent_variables WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		return false, err
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return false, err
	}
	return affected > 0, nil
}

func (r *AgentWorkflowRepo) RecordPublicationInvocation(ctx context.Context, publicationID int64, userID *int64, clientKey string) error {
	_, err := r.db.ExecContext(ctx, `
INSERT INTO agent_publication_invocations (publication_id, user_id, client_key)
VALUES ($1, $2, $3)`, publicationID, userID, clientKey)
	return err
}

func (r *AgentWorkflowRepo) CountRecentPublicationInvocations(ctx context.Context, publicationID int64, clientKey string, since time.Time) (int, error) {
	var count int
	err := r.db.GetContext(ctx, &count, `
SELECT COUNT(*)
FROM agent_publication_invocations
WHERE publication_id = $1
  AND client_key = $2
  AND invoked_at >= $3`, publicationID, clientKey, since)
	return count, err
}

func (r *AgentWorkflowRepo) WorkflowMetrics(ctx context.Context, userID, workflowID int64) (map[string]any, error) {
	row := map[string]any{}
	rows, err := r.db.QueryxContext(ctx, `
SELECT
    COUNT(*)::bigint AS total_runs,
    COUNT(*) FILTER (WHERE r.status = 'success')::bigint AS success_runs,
    COUNT(*) FILTER (WHERE r.status = 'failed')::bigint AS failed_runs,
    COUNT(*) FILTER (WHERE r.status = 'cancelled')::bigint AS cancelled_runs,
    COUNT(*) FILTER (WHERE r.simulated = TRUE)::bigint AS simulated_runs,
    AVG(r.duration_ms)::float8 AS avg_duration_ms,
    COALESCE(SUM(COALESCE(r.prompt_tokens, 0) + COALESCE(r.completion_tokens, 0)), 0)::bigint AS total_tokens,
    COALESCE(SUM(r.total_cost_usd), 0)::float8 AS total_cost_usd,
    MAX(r.created_at) AS last_run_at
FROM agent_workflow_runs r
JOIN agent_workflows w ON w.id = r.workflow_id
WHERE r.workflow_id = $1
  AND (r.user_id = $2 OR w.user_id = $2)`, workflowID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	if rows.Next() {
		if err := rows.MapScan(row); err != nil {
			return nil, err
		}
	}
	return row, rows.Err()
}

func (r *AgentWorkflowRepo) CreateNotification(ctx context.Context, userID int64, runID *int64, kind, title, body, actionURL string) error {
	_, err := r.db.ExecContext(ctx, `
INSERT INTO agent_workflow_notifications (user_id, run_id, type, title, body, action_url)
VALUES ($1, $2, $3, $4, $5, $6)`,
		userID,
		runID,
		kind,
		title,
		nullableString(body),
		nullableString(actionURL),
	)
	return err
}

func emptyStringDefault(value, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	return value
}

func nullableString(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}
