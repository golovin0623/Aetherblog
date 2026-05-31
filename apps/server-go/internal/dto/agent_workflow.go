package dto

import (
	"encoding/json"
	"time"
)

type AgentWorkflowRequest struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Mode        string          `json:"mode"`
	Definition  json.RawMessage `json:"definition"`
	IsTemplate  *bool           `json:"isTemplate"`
	IsPublic    *bool           `json:"isPublic"`
	ChangeNote  string          `json:"changeNote"`
}

type AgentWorkflowSummary struct {
	ID          int64      `json:"id"`
	Name        string     `json:"name"`
	Description string     `json:"description,omitempty"`
	Mode        string     `json:"mode"`
	Version     int        `json:"version"`
	NodeCount   int        `json:"nodeCount"`
	RunCount    int64      `json:"runCount"`
	LastRunAt   *time.Time `json:"lastRunAt,omitempty"`
	UpdatedAt   time.Time  `json:"updatedAt"`
	Published   bool       `json:"published"`
	Template    bool       `json:"template"`
}

type AgentWorkflowDetail struct {
	AgentWorkflowSummary
	Definition json.RawMessage `json:"definition"`
	CreatedAt  time.Time       `json:"createdAt"`
}

type AgentToolSummary struct {
	ID               int64           `json:"id"`
	Code             string          `json:"code"`
	DisplayName      string          `json:"displayName"`
	Description      string          `json:"description,omitempty"`
	Category         string          `json:"category"`
	Protocol         string          `json:"protocol"`
	ArgsSchema       json.RawMessage `json:"argsSchema,omitempty"`
	OutputSchema     json.RawMessage `json:"outputSchema,omitempty"`
	HandlerType      string          `json:"handlerType,omitempty"`
	HandlerConfig    json.RawMessage `json:"handlerConfig,omitempty"`
	Public           bool            `json:"public"`
	Enabled          bool            `json:"enabled"`
	RequiresApproval bool            `json:"requiresApproval"`
	RateLimitPerMin  int             `json:"rateLimitPerMin,omitempty"`
	TimeoutMS        int             `json:"timeoutMs,omitempty"`
}

type AgentToolRequest struct {
	Code             string          `json:"code"`
	DisplayName      string          `json:"displayName"`
	Description      string          `json:"description"`
	Category         string          `json:"category"`
	HandlerType      string          `json:"handlerType"`
	ArgsSchema       json.RawMessage `json:"argsSchema"`
	OutputSchema     json.RawMessage `json:"outputSchema"`
	HandlerConfig    json.RawMessage `json:"handlerConfig"`
	Public           bool            `json:"public"`
	Enabled          *bool           `json:"enabled"`
	RequiresApproval *bool           `json:"requiresApproval"`
	RateLimitPerMin  int             `json:"rateLimitPerMin"`
	TimeoutMS        int             `json:"timeoutMs"`
}

type AgentToolTestRequest struct {
	Args json.RawMessage `json:"args"`
}

type AgentToolTestResult struct {
	Status       string          `json:"status"`
	Output       json.RawMessage `json:"output,omitempty"`
	ErrorMessage string          `json:"errorMessage,omitempty"`
	DurationMS   int             `json:"durationMs"`
}

type AgentDefinitionSummary struct {
	ID            int64    `json:"id"`
	Code          string   `json:"code"`
	Name          string   `json:"name"`
	Description   string   `json:"description,omitempty"`
	SystemPrompt  string   `json:"systemPrompt,omitempty"`
	Model         string   `json:"model,omitempty"`
	ProviderCode  string   `json:"providerCode,omitempty"`
	MaxIterations int      `json:"maxIterations"`
	MaxToolCalls  int      `json:"maxToolCalls,omitempty"`
	MaxTokens     int      `json:"maxTokens,omitempty"`
	ToolCodes     []string `json:"toolCodes"`
	Enabled       bool     `json:"enabled"`
}

type AgentDefinitionRequest struct {
	Code          string          `json:"code"`
	Name          string          `json:"name"`
	Description   string          `json:"description"`
	SystemPrompt  string          `json:"systemPrompt"`
	Model         string          `json:"model"`
	ProviderCode  string          `json:"providerCode"`
	MaxIterations int             `json:"maxIterations"`
	MaxToolCalls  int             `json:"maxToolCalls"`
	MaxTokens     int             `json:"maxTokens"`
	ToolCodes     json.RawMessage `json:"toolCodes"`
	Enabled       *bool           `json:"enabled"`
}

type AgentScheduleSummary struct {
	ID              int64           `json:"id"`
	WorkflowID      int64           `json:"workflowId"`
	Enabled         bool            `json:"enabled"`
	CronExpr        string          `json:"cronExpr"`
	Timezone        string          `json:"timezone"`
	Inputs          json.RawMessage `json:"inputs"`
	NextRunAt       *time.Time      `json:"nextRunAt,omitempty"`
	LastRunAt       *time.Time      `json:"lastRunAt,omitempty"`
	LastRunID       *int64          `json:"lastRunId,omitempty"`
	MissedRunPolicy string          `json:"missedRunPolicy"`
	LastError       string          `json:"lastError,omitempty"`
}

type AgentScheduleRequest struct {
	WorkflowID      int64           `json:"workflowId"`
	Enabled         *bool           `json:"enabled"`
	CronExpr        string          `json:"cronExpr"`
	Timezone        string          `json:"timezone"`
	Inputs          json.RawMessage `json:"inputs"`
	NextRunAt       *time.Time      `json:"nextRunAt"`
	MissedRunPolicy string          `json:"missedRunPolicy"`
}

type AgentVariableSummary struct {
	ID         int64           `json:"id"`
	WorkflowID *int64          `json:"workflowId,omitempty"`
	Name       string          `json:"name"`
	Scope      string          `json:"scope"`
	Type       string          `json:"type"`
	Value      json.RawMessage `json:"value,omitempty"`
	SecretRef  string          `json:"secretRef,omitempty"`
	UpdatedAt  time.Time       `json:"updatedAt"`
}

type AgentVariableRequest struct {
	WorkflowID *int64          `json:"workflowId"`
	Name       string          `json:"name"`
	Scope      string          `json:"scope"`
	Type       string          `json:"type"`
	Value      json.RawMessage `json:"value"`
	SecretRef  string          `json:"secretRef"`
}

type AgentWorkflowCapabilityStatus struct {
	Enabled bool   `json:"enabled"`
	State   string `json:"state"`
	Label   string `json:"label"`
	Detail  string `json:"detail,omitempty"`
}

type AgentWorkflowCapabilities struct {
	DefaultRunMode string                        `json:"defaultRunMode"`
	RealLLM        AgentWorkflowCapabilityStatus `json:"realLLM"`
	RealTools      AgentWorkflowCapabilityStatus `json:"realTools"`
	Sandbox        AgentWorkflowCapabilityStatus `json:"sandbox"`
	Scheduler      AgentWorkflowCapabilityStatus `json:"scheduler"`
	Autonomous     AgentWorkflowCapabilityStatus `json:"autonomous"`
}

type AgentPublicationRequest struct {
	Slug            string          `json:"slug"`
	DisplayName     string          `json:"displayName"`
	Description     string          `json:"description"`
	InputSchema     json.RawMessage `json:"inputSchema"`
	OutputSchema    json.RawMessage `json:"outputSchema"`
	AllowedOrigins  json.RawMessage `json:"allowedOrigins"`
	RateLimitPerMin int             `json:"rateLimitPerMin"`
	Enabled         *bool           `json:"enabled"`
}

type AgentPublicationSummary struct {
	ID              int64           `json:"id"`
	WorkflowID      int64           `json:"workflowId"`
	Version         int             `json:"version"`
	Slug            string          `json:"slug"`
	DisplayName     string          `json:"displayName"`
	Description     string          `json:"description,omitempty"`
	InputSchema     json.RawMessage `json:"inputSchema"`
	OutputSchema    json.RawMessage `json:"outputSchema"`
	AllowedOrigins  json.RawMessage `json:"allowedOrigins"`
	RateLimitPerMin int             `json:"rateLimitPerMin"`
	Enabled         bool            `json:"enabled"`
	CreatedAt       time.Time       `json:"createdAt"`
	UpdatedAt       time.Time       `json:"updatedAt"`
}

type AgentWorkflowRunRequest struct {
	Inputs           json.RawMessage `json:"inputs"`
	SimulateExternal bool            `json:"simulateExternal"`
	SourceType       string          `json:"sourceType"`
	SourceRef        string          `json:"sourceRef"`
	RedactionPolicy  string          `json:"redactionPolicy"`
	MaxTokens        *int            `json:"maxTokens"`
	MaxCostUSD       *float64        `json:"maxCostUsd"`
	MaxDurationMS    *int            `json:"maxDurationMs"`
	MaxNodes         *int            `json:"maxNodes"`
	ResumeFromNode   string          `json:"resumeFromNode"`
}

type AgentWorkflowRunSummary struct {
	ID                      int64               `json:"id"`
	WorkflowID              int64               `json:"workflowId"`
	Version                 int                 `json:"version"`
	Status                  string              `json:"status"`
	Simulated               bool                `json:"simulated"`
	Inputs                  json.RawMessage     `json:"inputs"`
	Outputs                 json.RawMessage     `json:"outputs,omitempty"`
	CurrentNode             string              `json:"currentNode,omitempty"`
	PausedReason            string              `json:"pausedReason,omitempty"`
	TotalNodeCount          int                 `json:"totalNodeCount"`
	PromptTokens            *int                `json:"promptTokens,omitempty"`
	CompletionTokens        *int                `json:"completionTokens,omitempty"`
	TotalCostUSD            *float64            `json:"totalCostUsd,omitempty"`
	ErrorMessage            string              `json:"errorMessage,omitempty"`
	RetryOfRunID            *int64              `json:"retryOfRunId,omitempty"`
	ResumeFromNode          string              `json:"resumeFromNode,omitempty"`
	CancelRequested         bool                `json:"cancelRequested"`
	SourceType              string              `json:"sourceType,omitempty"`
	SourceRef               string              `json:"sourceRef,omitempty"`
	RedactionPolicy         string              `json:"redactionPolicy,omitempty"`
	MaxTokens               *int                `json:"maxTokens,omitempty"`
	MaxCostUSD              *float64            `json:"maxCostUsd,omitempty"`
	MaxDurationMS           *int                `json:"maxDurationMs,omitempty"`
	MaxNodes                *int                `json:"maxNodes,omitempty"`
	ErrorCode               string              `json:"errorCode,omitempty"`
	ErrorCategory           string              `json:"errorCategory,omitempty"`
	Retryable               bool                `json:"retryable"`
	CanonicalizedWorkflowID *int64              `json:"canonicalizedWorkflowId,omitempty"`
	CreatedAt               time.Time           `json:"createdAt"`
	StartedAt               *time.Time          `json:"startedAt,omitempty"`
	FinishedAt              *time.Time          `json:"finishedAt,omitempty"`
	DurationMS              *int                `json:"durationMs,omitempty"`
	Trace                   []AgentRunTraceItem `json:"trace,omitempty"`
}

type AgentWorkflowRunDetail struct {
	AgentWorkflowRunSummary
	Logs []AgentWorkflowNodeLog `json:"logs"`
}

type AgentWorkflowNodeLog struct {
	ID           int64           `json:"id"`
	RunID        int64           `json:"runId"`
	Sequence     int             `json:"sequence"`
	NodeID       string          `json:"nodeId"`
	NodeType     string          `json:"nodeType"`
	Status       string          `json:"status"`
	Input        json.RawMessage `json:"input"`
	Output       json.RawMessage `json:"output,omitempty"`
	DurationMS   *int            `json:"durationMs,omitempty"`
	ErrorMessage string          `json:"errorMessage,omitempty"`
	StartedAt    *time.Time      `json:"startedAt,omitempty"`
	FinishedAt   *time.Time      `json:"finishedAt,omitempty"`
	Metadata     json.RawMessage `json:"metadata,omitempty"`
}

type AgentRunTraceItem struct {
	ID         string `json:"id"`
	NodeID     string `json:"nodeId"`
	NodeLabel  string `json:"nodeLabel"`
	NodeType   string `json:"nodeType"`
	Status     string `json:"status"`
	Summary    string `json:"summary,omitempty"`
	DurationMS int    `json:"durationMs,omitempty"`
}

type AgentWorkflowVersionSummary struct {
	ID         int64           `json:"id"`
	WorkflowID int64           `json:"workflowId"`
	Version    int             `json:"version"`
	Definition json.RawMessage `json:"definition,omitempty"`
	ChangeNote string          `json:"changeNote,omitempty"`
	CreatedAt  time.Time       `json:"createdAt"`
}

type AgentWorkflowTemplateSummary struct {
	ID                 int64           `json:"id"`
	TemplateKey        string          `json:"templateKey"`
	Title              string          `json:"title"`
	Description        string          `json:"description,omitempty"`
	Category           string          `json:"category"`
	Definition         json.RawMessage `json:"definition"`
	DependencyManifest json.RawMessage `json:"dependencyManifest"`
	InstalledCount     int64           `json:"installedCount"`
}

type AgentWorkflowMetrics struct {
	TotalRuns     int64      `json:"totalRuns"`
	SuccessRuns   int64      `json:"successRuns"`
	FailedRuns    int64      `json:"failedRuns"`
	CancelledRuns int64      `json:"cancelledRuns"`
	SimulatedRuns int64      `json:"simulatedRuns"`
	AvgDurationMS *float64   `json:"avgDurationMs,omitempty"`
	TotalTokens   int64      `json:"totalTokens"`
	TotalCostUSD  float64    `json:"totalCostUsd"`
	LastRunAt     *time.Time `json:"lastRunAt,omitempty"`
}

type AgentWorkflowActionResult struct {
	RunID      int64           `json:"runId,omitempty"`
	WorkflowID int64           `json:"workflowId,omitempty"`
	Status     string          `json:"status"`
	Message    string          `json:"message,omitempty"`
	Definition json.RawMessage `json:"definition,omitempty"`
}

type AgentWorkflowNodeTestRequest struct {
	NodeID string          `json:"nodeId"`
	Inputs json.RawMessage `json:"inputs"`
}

type AgentWorkflowImportRequest struct {
	Format     string          `json:"format"`
	Definition json.RawMessage `json:"definition"`
}

type AgentWorkflowExportResult struct {
	Format     string          `json:"format"`
	Definition json.RawMessage `json:"definition"`
}
