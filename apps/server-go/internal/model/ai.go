package model

import "time"

// AITaskType maps the `ai_task_types` table.
// Note: config_schema (JSONB) is intentionally excluded to avoid scanning issues.
type AITaskType struct {
	ID               int64     `db:"id"`
	Code             string    `db:"code"`
	Name             string    `db:"name"`
	Description      *string   `db:"description"`
	DefaultModelType *string   `db:"default_model_type"`
	DefaultTemperature float64 `db:"default_temperature"`
	DefaultMaxTokens *int      `db:"default_max_tokens"`
	PromptTemplate   *string   `db:"prompt_template"`
	CreatedAt        time.Time `db:"created_at"`
}
