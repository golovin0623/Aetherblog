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
	ID               int64  `json:"id"`
	Code             string `json:"code"`
	DisplayName      string `json:"displayName"`
	Description      string `json:"description,omitempty"`
	Category         string `json:"category"`
	Protocol         string `json:"protocol"`
	Enabled          bool   `json:"enabled"`
	RequiresApproval bool   `json:"requiresApproval"`
}

type AgentDefinitionSummary struct {
	ID            int64    `json:"id"`
	Code          string   `json:"code"`
	Name          string   `json:"name"`
	Description   string   `json:"description,omitempty"`
	Model         string   `json:"model,omitempty"`
	MaxIterations int      `json:"maxIterations"`
	ToolCodes     []string `json:"toolCodes"`
	Enabled       bool     `json:"enabled"`
}

type AgentScheduleSummary struct {
	ID         int64      `json:"id"`
	WorkflowID int64      `json:"workflowId"`
	Enabled    bool       `json:"enabled"`
	CronExpr   string     `json:"cronExpr"`
	Timezone   string     `json:"timezone"`
	NextRunAt  *time.Time `json:"nextRunAt,omitempty"`
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
}

type AgentWorkflowRunSummary struct {
	ID             int64               `json:"id"`
	WorkflowID     int64               `json:"workflowId"`
	Version        int                 `json:"version"`
	Status         string              `json:"status"`
	Inputs         json.RawMessage     `json:"inputs"`
	Outputs        json.RawMessage     `json:"outputs,omitempty"`
	CurrentNode    string              `json:"currentNode,omitempty"`
	TotalNodeCount int                 `json:"totalNodeCount"`
	ErrorMessage   string              `json:"errorMessage,omitempty"`
	CreatedAt      time.Time           `json:"createdAt"`
	StartedAt      *time.Time          `json:"startedAt,omitempty"`
	FinishedAt     *time.Time          `json:"finishedAt,omitempty"`
	DurationMS     *int                `json:"durationMs,omitempty"`
	Trace          []AgentRunTraceItem `json:"trace,omitempty"`
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
