package model

import "time"

// AITaskType 对应数据库 `ai_task_types` 表，描述一种 AI 任务的类型配置。
// 注意：config_schema（JSONB 列）已被有意排除在外，以避免 sqlx 扫描问题。
type AITaskType struct {
	ID                 int64     `db:"id"`                   // 任务类型主键 ID
	Code               string    `db:"code"`                  // 任务类型唯一标识码（如 "summary"、"translate"）
	Name               string    `db:"name"`                  // 任务类型显示名称
	Description        *string   `db:"description"`           // 任务类型说明，可为空
	DefaultModelType   *string   `db:"default_model_type"`    // 默认使用的模型类型，可为空（使用系统默认值）
	DefaultTemperature float64   `db:"default_temperature"`   // 默认采样温度，控制输出随机性
	DefaultMaxTokens   *int      `db:"default_max_tokens"`    // 默认最大输出 token 数，可为空
	PromptTemplate     *string   `db:"prompt_template"`       // 任务使用的提示词模板，可为空
	CreatedAt          time.Time `db:"created_at"`            // 记录创建时间
}
