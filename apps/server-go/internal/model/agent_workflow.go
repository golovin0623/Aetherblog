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
	ID               int64     `db:"id"`
	UserID           *int64    `db:"user_id"`
	Code             string    `db:"code"`
	DisplayName      string    `db:"display_name"`
	Description      *string   `db:"description"`
	Category         string    `db:"category"`
	ArgsSchema       string    `db:"args_schema"`
	OutputSchema     string    `db:"output_schema"`
	HandlerType      string    `db:"handler_type"`
	HandlerConfig    string    `db:"handler_config"`
	IsPublic         bool      `db:"is_public"`
	Enabled          bool      `db:"enabled"`
	RequiresApproval bool      `db:"requires_approval"`
	RateLimitPerMin  int       `db:"rate_limit_per_min"`
	TimeoutMS        int       `db:"timeout_ms"`
	CreatedAt        time.Time `db:"created_at"`
	UpdatedAt        time.Time `db:"updated_at"`
}

type AgentDefinition struct {
	ID            int64     `db:"id"`
	UserID        int64     `db:"user_id"`
	Code          string    `db:"code"`
	Name          string    `db:"name"`
	Description   *string   `db:"description"`
	SystemPrompt  string    `db:"system_prompt"`
	ModelID       *string   `db:"model_id"`
	ProviderCode  *string   `db:"provider_code"`
	MaxIterations int       `db:"max_iterations"`
	MaxToolCalls  int       `db:"max_tool_calls"`
	MaxTokens     int       `db:"max_tokens"`
	AllowedTools  string    `db:"allowed_tools"`
	Enabled       bool      `db:"enabled"`
	CreatedAt     time.Time `db:"created_at"`
	UpdatedAt     time.Time `db:"updated_at"`
}

type AgentSchedule struct {
	ID              int64      `db:"id"`
	WorkflowID      int64      `db:"workflow_id"`
	UserID          int64      `db:"user_id"`
	Enabled         bool       `db:"enabled"`
	CronExpr        string     `db:"cron_expr"`
	Timezone        string     `db:"timezone"`
	Inputs          string     `db:"inputs"`
	NextRunAt       *time.Time `db:"next_run_at"`
	LastRunAt       *time.Time `db:"last_run_at"`
	LastRunID       *int64     `db:"last_run_id"`
	MissedRunPolicy string     `db:"missed_run_policy"`
	LastError       *string    `db:"last_error"`
	CreatedAt       time.Time  `db:"created_at"`
	UpdatedAt       time.Time  `db:"updated_at"`
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
	ID                      int64      `db:"id"`
	WorkflowID              int64      `db:"workflow_id"`
	Version                 int        `db:"version"`
	UserID                  int64      `db:"user_id"`
	Status                  string     `db:"status"`
	Simulated               bool       `db:"simulated"`
	Inputs                  string     `db:"inputs"`
	Outputs                 *string    `db:"outputs"`
	CurrentNode             *string    `db:"current_node"`
	PausedReason            *string    `db:"paused_reason"`
	StartedAt               *time.Time `db:"started_at"`
	FinishedAt              *time.Time `db:"finished_at"`
	DurationMS              *int       `db:"duration_ms"`
	TotalNodeCount          int        `db:"total_node_count"`
	PromptTokens            *int       `db:"prompt_tokens"`
	CompletionTokens        *int       `db:"completion_tokens"`
	TotalCostUSD            *float64   `db:"total_cost_usd"`
	ErrorMessage            *string    `db:"error_message"`
	RetryOfRunID            *int64     `db:"retry_of_run_id"`
	ResumeFromNode          *string    `db:"resume_from_node"`
	CancelRequested         bool       `db:"cancel_requested"`
	SourceType              string     `db:"source_type"`
	SourceRef               *string    `db:"source_ref"`
	RedactionPolicy         string     `db:"redaction_policy"`
	MaxTokens               *int       `db:"max_tokens"`
	MaxCostUSD              *float64   `db:"max_cost_usd"`
	MaxDurationMS           *int       `db:"max_duration_ms"`
	MaxNodes                *int       `db:"max_nodes"`
	ErrorCode               *string    `db:"error_code"`
	ErrorCategory           *string    `db:"error_category"`
	Retryable               bool       `db:"retryable"`
	CanonicalizedWorkflowID *int64     `db:"canonicalized_workflow_id"`
	CreatedAt               time.Time  `db:"created_at"`
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
	MetadataJSON string     `db:"metadata_json"`
}

type AgentWorkflowVersion struct {
	ID             int64     `db:"id"`
	WorkflowID     int64     `db:"workflow_id"`
	Version        int       `db:"version"`
	DefinitionJSON string    `db:"definition_json"`
	ChangeNote     *string   `db:"change_note"`
	CreatedAt      time.Time `db:"created_at"`
}

type AgentVariable struct {
	ID         int64     `db:"id"`
	UserID     *int64    `db:"user_id"`
	WorkflowID *int64    `db:"workflow_id"`
	Name       string    `db:"name"`
	Scope      string    `db:"scope"`
	ValueType  string    `db:"value_type"`
	ValueJSON  *string   `db:"value_json"`
	SecretRef  *string   `db:"secret_ref"`
	CreatedAt  time.Time `db:"created_at"`
	UpdatedAt  time.Time `db:"updated_at"`
}

type AgentWorkflowTemplate struct {
	ID                 int64     `db:"id"`
	TemplateKey        string    `db:"template_key"`
	Title              string    `db:"title"`
	Description        *string   `db:"description"`
	Category           string    `db:"category"`
	DefinitionJSON     string    `db:"definition_json"`
	DependencyManifest string    `db:"dependency_manifest"`
	InstalledCount     int64     `db:"installed_count"`
	CreatedAt          time.Time `db:"created_at"`
	UpdatedAt          time.Time `db:"updated_at"`
}

type AgentWorkflowNotification struct {
	ID        int64      `db:"id"`
	UserID    int64      `db:"user_id"`
	RunID     *int64     `db:"run_id"`
	Type      string     `db:"type"`
	Title     string     `db:"title"`
	Body      *string    `db:"body"`
	ActionURL *string    `db:"action_url"`
	ReadAt    *time.Time `db:"read_at"`
	CreatedAt time.Time  `db:"created_at"`
}
