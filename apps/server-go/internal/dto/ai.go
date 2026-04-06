package dto

// SummaryRequest 是 AI 摘要生成接口的请求 DTO。
type SummaryRequest struct {
	Content        string `json:"content" validate:"required"` // 需要生成摘要的正文内容（必填）
	MaxLength      int    `json:"maxLength,omitempty"`         // 摘要最大字数限制（可选）
	Style          string `json:"style,omitempty"`             // 旧版摘要风格字段（兼容保留，当前后端不再使用）
	Model          string `json:"model,omitempty"`             // 指定使用的模型名称（可选）
	PromptVersion  string `json:"promptVersion,omitempty"`     // 提示词版本号（可选）
	PromptTemplate string `json:"promptTemplate,omitempty"`    // 自定义提示词模板（可选）
	ModelID        string `json:"modelId,omitempty"`           // 模型 ID（可选）
	ProviderCode   string `json:"providerCode,omitempty"`      // AI 服务提供商代码（可选）
}

// TagsRequest 是 AI 标签推荐接口的请求 DTO。
type TagsRequest struct {
	Content        string `json:"content" validate:"required"` // 需要提取标签的正文内容（必填）
	MaxTags        int    `json:"maxTags,omitempty"`           // 最多返回的标签数量（可选）
	Model          string `json:"model,omitempty"`             // 指定使用的模型名称（可选）
	PromptVersion  string `json:"promptVersion,omitempty"`     // 提示词版本号（可选）
	PromptTemplate string `json:"promptTemplate,omitempty"`    // 自定义提示词模板（可选）
	ModelID        string `json:"modelId,omitempty"`           // 模型 ID（可选）
	ProviderCode   string `json:"providerCode,omitempty"`      // AI 服务提供商代码（可选）
}

// TitlesRequest 是 AI 标题推荐接口的请求 DTO。
type TitlesRequest struct {
	Content        string `json:"content" validate:"required"` // 需要生成标题的正文内容（必填）
	MaxTitles      int    `json:"maxTitles,omitempty"`         // 希望生成的标题数量（规范字段）
	Count          int    `json:"count,omitempty"`             // 旧版标题数量字段（兼容别名）
	Style          string `json:"style,omitempty"`             // 旧版标题风格字段（兼容保留，当前后端不再使用）
	Model          string `json:"model,omitempty"`             // 指定使用的模型名称（可选）
	PromptVersion  string `json:"promptVersion,omitempty"`     // 提示词版本号（可选）
	PromptTemplate string `json:"promptTemplate,omitempty"`    // 自定义提示词模板（可选）
	ModelID        string `json:"modelId,omitempty"`           // 模型 ID（可选）
	ProviderCode   string `json:"providerCode,omitempty"`      // AI 服务提供商代码（可选）
}

// PolishRequest 是 AI 内容润色接口的请求 DTO。
type PolishRequest struct {
	Content        string `json:"content" validate:"required"` // 需要润色的正文内容（必填）
	Tone           string `json:"tone,omitempty"`              // 润色语气/目标风格（规范字段）
	PolishType     string `json:"polishType,omitempty"`        // 旧版润色类型字段（兼容别名）
	Style          string `json:"style,omitempty"`             // 旧版润色风格字段（兼容别名）
	Model          string `json:"model,omitempty"`             // 指定使用的模型名称（可选）
	PromptVersion  string `json:"promptVersion,omitempty"`     // 提示词版本号（可选）
	PromptTemplate string `json:"promptTemplate,omitempty"`    // 自定义提示词模板（可选）
	ModelID        string `json:"modelId,omitempty"`           // 模型 ID（可选）
	ProviderCode   string `json:"providerCode,omitempty"`      // AI 服务提供商代码（可选）
}

// OutlineRequest 是 AI 文章大纲生成接口的请求 DTO。
type OutlineRequest struct {
	Topic           string `json:"topic,omitempty"`           // 文章主题（topic 或 content 至少一个）
	Content         string `json:"content,omitempty"`         // 作为主题补充的正文内容（可选）
	ExistingContent string `json:"existingContent,omitempty"` // 已有的正文内容，供 AI 参考（可选）
	Depth           int    `json:"depth,omitempty"`           // 大纲层级深度（可选）
	Style           string `json:"style,omitempty"`           // 文章风格（可选）
	Model           string `json:"model,omitempty"`           // 指定使用的模型名称（可选）
	PromptVersion   string `json:"promptVersion,omitempty"`   // 提示词版本号（可选）
	PromptTemplate  string `json:"promptTemplate,omitempty"`  // 自定义提示词模板（可选）
	ModelID         string `json:"modelId,omitempty"`         // 模型 ID（可选）
	ProviderCode    string `json:"providerCode,omitempty"`    // AI 服务提供商代码（可选）
}

// TranslateRequest 是 AI 翻译接口的请求 DTO。
type TranslateRequest struct {
	Content        string `json:"content" validate:"required"` // 需要翻译的原文内容（必填）
	TargetLanguage string `json:"targetLanguage,omitempty"`    // 目标语言（可选，如 zh/en/ja）
	SourceLanguage string `json:"sourceLanguage,omitempty"`    // 源语言（可选，不填则自动检测）
	PromptVersion  string `json:"promptVersion,omitempty"`     // 提示词版本号（可选）
	PromptTemplate string `json:"promptTemplate,omitempty"`    // 自定义提示词模板（可选）
	ModelID        string `json:"modelId,omitempty"`           // 模型 ID（可选）
	ProviderCode   string `json:"providerCode,omitempty"`      // AI 服务提供商代码（可选）
}

// PromptUpdateRequest 是更新 AI 提示词模板的请求 DTO。
type PromptUpdateRequest struct {
	PromptTemplate string `json:"prompt_template"` // 新的提示词模板内容
}

// TaskTypeCreateRequest 是创建 AI 任务类型的请求 DTO。
type TaskTypeCreateRequest struct {
	Code           string   `json:"code"`                      // 任务类型唯一代码标识
	Name           string   `json:"name"`                      // 任务类型显示名称
	Description    string   `json:"description,omitempty"`     // 任务类型描述（可选）
	ModelType      string   `json:"model_type,omitempty"`      // 适用的模型类型（可选）
	Temperature    *float64 `json:"temperature,omitempty"`     // 生成温度，控制随机性，范围 0~2（可选）
	MaxTokens      *int     `json:"max_tokens,omitempty"`      // 最大生成 token 数量（可选）
	PromptTemplate string   `json:"prompt_template,omitempty"` // 提示词模板内容（可选）
}

// TaskTypeUpdateRequest 是更新 AI 任务类型的请求 DTO，所有字段均为可选。
type TaskTypeUpdateRequest struct {
	Code           string   `json:"code,omitempty"`            // 任务类型唯一代码标识（可选）
	Name           string   `json:"name,omitempty"`            // 任务类型显示名称（可选）
	Description    string   `json:"description,omitempty"`     // 任务类型描述（可选）
	ModelType      string   `json:"model_type,omitempty"`      // 适用的模型类型（可选）
	Temperature    *float64 `json:"temperature,omitempty"`     // 生成温度，控制随机性，范围 0~2（可选）
	MaxTokens      *int     `json:"max_tokens,omitempty"`      // 最大生成 token 数量（可选）
	PromptTemplate string   `json:"prompt_template,omitempty"` // 提示词模板内容（可选）
}
