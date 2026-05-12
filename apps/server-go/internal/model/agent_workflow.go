package model

import "time"

// AgentWorkflow 是后台智能体编排画布的持久化定义。
//
// JSONB 字段在 repository 查询时统一转成 text 扫描，避免 sqlx 直接扫描
// JSONB 到结构体时的兼容性问题。
type AgentWorkflow struct {
	ID             int64      `db:"id"`
	UserID         int64      `db:"user_id"`
	Name           string     `db:"name"`
	Description    *string    `db:"description"`
	Mode           string     `db:"mode"`
	DefinitionJSON string     `db:"definition_json"`
	DefinitionAST  string     `db:"definition_ast"`
	IsTemplate     bool       `db:"is_template"`
	IsPublic       bool       `db:"is_public"`
	Version        int        `db:"version"`
	RunCount       int64      `db:"run_count"`
	LastRunAt      *time.Time `db:"last_run_at"`
	CreatedAt      time.Time  `db:"created_at"`
	UpdatedAt      time.Time  `db:"updated_at"`
}

type AgentTool struct {
	ID               int64   `db:"id"`
	Code             string  `db:"code"`
	DisplayName      string  `db:"display_name"`
	Description      *string `db:"description"`
	Category         string  `db:"category"`
	HandlerType      string  `db:"handler_type"`
	Enabled          bool    `db:"enabled"`
	RequiresApproval bool    `db:"requires_approval"`
}

type AgentDefinition struct {
	ID            int64   `db:"id"`
	Code          string  `db:"code"`
	Name          string  `db:"name"`
	Description   *string `db:"description"`
	ModelID       *string `db:"model_id"`
	MaxIterations int     `db:"max_iterations"`
	AllowedTools  string  `db:"allowed_tools"`
	Enabled       bool    `db:"enabled"`
}

type AgentSchedule struct {
	ID         int64      `db:"id"`
	WorkflowID int64      `db:"workflow_id"`
	Enabled    bool       `db:"enabled"`
	CronExpr   string     `db:"cron_expr"`
	Timezone   string     `db:"timezone"`
	NextRunAt  *time.Time `db:"next_run_at"`
}

type AgentPublication struct {
	ID              int64     `db:"id"`
	WorkflowID      int64     `db:"workflow_id"`
	Version         int       `db:"version"`
	Slug            string    `db:"slug"`
	DisplayName     string    `db:"display_name"`
	Description     *string   `db:"description"`
	InputSchema     string    `db:"input_schema"`
	OutputSchema    string    `db:"output_schema"`
	AllowedOrigins  string    `db:"allowed_origins"`
	RateLimitPerMin int       `db:"rate_limit_per_min"`
	Enabled         bool      `db:"enabled"`
	CreatedAt       time.Time `db:"created_at"`
	UpdatedAt       time.Time `db:"updated_at"`
}

type AgentWorkflowRun struct {
	ID             int64      `db:"id"`
	WorkflowID     int64      `db:"workflow_id"`
	Version        int        `db:"version"`
	UserID         int64      `db:"user_id"`
	Status         string     `db:"status"`
	Inputs         string     `db:"inputs"`
	Outputs        *string    `db:"outputs"`
	CurrentNode    *string    `db:"current_node"`
	StartedAt      *time.Time `db:"started_at"`
	FinishedAt     *time.Time `db:"finished_at"`
	DurationMS     *int       `db:"duration_ms"`
	TotalNodeCount int        `db:"total_node_count"`
	ErrorMessage   *string    `db:"error_message"`
	CreatedAt      time.Time  `db:"created_at"`
}

type AgentWorkflowNodeLog struct {
	ID           int64      `db:"id"`
	RunID        int64      `db:"run_id"`
	Sequence     int        `db:"sequence"`
	NodeID       string     `db:"node_id"`
	NodeType     string     `db:"node_type"`
	Status       string     `db:"status"`
	InputJSON    string     `db:"input_json"`
	OutputJSON   *string    `db:"output_json"`
	DurationMS   *int       `db:"duration_ms"`
	ErrorMessage *string    `db:"error_message"`
	StartedAt    *time.Time `db:"started_at"`
	FinishedAt   *time.Time `db:"finished_at"`
}
