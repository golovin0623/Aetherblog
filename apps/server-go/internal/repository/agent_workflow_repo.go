package repository

import (
	"context"
	"database/sql"
	"errors"

	"github.com/jmoiron/sqlx"

	"github.com/golovin0623/aetherblog-server/internal/model"
)

type AgentWorkflowRepo struct {
	db *sqlx.DB
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
SELECT id, code, display_name, description, category, handler_type, enabled, requires_approval
FROM agent_tools
WHERE user_id = $1 OR user_id IS NULL OR is_public = TRUE
ORDER BY enabled DESC, category ASC, display_name ASC`, userID)
	return tools, err
}

func (r *AgentWorkflowRepo) ListAgents(ctx context.Context, userID int64) ([]model.AgentDefinition, error) {
	var agents []model.AgentDefinition
	err := r.db.SelectContext(ctx, &agents, `
SELECT
    id,
    code,
    name,
    description,
    model_id,
    max_iterations,
    allowed_tools::text AS allowed_tools,
    enabled
FROM agent_agents
WHERE user_id = $1
ORDER BY enabled DESC, updated_at DESC, id DESC`, userID)
	return agents, err
}

func (r *AgentWorkflowRepo) ListSchedules(ctx context.Context, userID int64) ([]model.AgentSchedule, error) {
	var schedules []model.AgentSchedule
	err := r.db.SelectContext(ctx, &schedules, `
SELECT id, workflow_id, enabled, cron_expr, timezone, next_run_at
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
    r.inputs::text AS inputs,
    r.outputs::text AS outputs,
    r.current_node,
    r.started_at,
    r.finished_at,
    r.duration_ms,
    r.total_node_count,
    r.error_message,
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
    r.inputs::text AS inputs,
    r.outputs::text AS outputs,
    r.current_node,
    r.started_at,
    r.finished_at,
    r.duration_ms,
    r.total_node_count,
    r.error_message,
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
    finished_at
FROM agent_workflow_node_logs
WHERE run_id = $1
ORDER BY sequence ASC, id ASC`, runID)
	return logs, err
}

func (r *AgentWorkflowRepo) CreateRun(ctx context.Context, workflow model.AgentWorkflow, userID int64, inputs string, totalNodeCount int) (*model.AgentWorkflowRun, error) {
	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var run model.AgentWorkflowRun
	if err := tx.GetContext(ctx, &run, `
INSERT INTO agent_workflow_runs
    (workflow_id, version, user_id, status, inputs, total_node_count)
VALUES
    ($1, $2, $3, 'pending', $4::jsonb, $5)
RETURNING
    id,
    workflow_id,
    version,
    user_id,
    status,
    inputs::text AS inputs,
    outputs::text AS outputs,
    current_node,
    started_at,
    finished_at,
    duration_ms,
    total_node_count,
    error_message,
    created_at`,
		workflow.ID,
		workflow.Version,
		userID,
		inputs,
		totalNodeCount,
	); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `
UPDATE agent_workflows
SET run_count = run_count + 1, last_run_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
WHERE id = $1`, workflow.ID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &run, nil
}

func (r *AgentWorkflowRepo) FinishRun(ctx context.Context, runID int64, status string, outputs string, currentNode *string, errorMessage *string, logs []AgentWorkflowNodeLogInput) (*model.AgentWorkflowRun, error) {
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
    finished_at = CURRENT_TIMESTAMP,
    duration_ms = GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - created_at)) * 1000)::int)
WHERE id = $1
RETURNING
    id,
    workflow_id,
    version,
    user_id,
    status,
    inputs::text AS inputs,
    outputs::text AS outputs,
    current_node,
    started_at,
    finished_at,
    duration_ms,
    total_node_count,
    error_message,
    created_at`,
		runID,
		status,
		outputs,
		currentNode,
		errorMessage,
	); err != nil {
		return nil, err
	}

	for _, item := range logs {
		if item.InputJSON == "" {
			item.InputJSON = "{}"
		}
		if _, err := tx.ExecContext(ctx, `
INSERT INTO agent_workflow_node_logs
    (run_id, sequence, node_id, node_type, status, input_json, output_json, duration_ms, error_message, finished_at)
VALUES
    ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, CURRENT_TIMESTAMP)`,
			runID,
			item.Sequence,
			item.NodeID,
			item.NodeType,
			item.Status,
			item.InputJSON,
			item.OutputJSON,
			item.DurationMS,
			item.ErrorMessage,
		); err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &run, nil
}

func nullableString(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}
