package dto

// SummaryRequest is the DTO for AI summary generation.
type SummaryRequest struct {
	Content        string  `json:"content" validate:"required"`
	MaxLength      int     `json:"maxLength,omitempty"`
	Style          string  `json:"style,omitempty"`
	Model          string  `json:"model,omitempty"`
	PromptVersion  string  `json:"promptVersion,omitempty"`
	ModelID        string  `json:"modelId,omitempty"`
	ProviderCode   string  `json:"providerCode,omitempty"`
}

// TagsRequest is the DTO for AI tag suggestion.
type TagsRequest struct {
	Content       string `json:"content" validate:"required"`
	MaxTags       int    `json:"maxTags,omitempty"`
	Model         string `json:"model,omitempty"`
	PromptVersion string `json:"promptVersion,omitempty"`
	ModelID       string `json:"modelId,omitempty"`
	ProviderCode  string `json:"providerCode,omitempty"`
}

// TitlesRequest is the DTO for AI title suggestion.
type TitlesRequest struct {
	Content       string `json:"content" validate:"required"`
	Count         int    `json:"count,omitempty"`
	Style         string `json:"style,omitempty"`
	Model         string `json:"model,omitempty"`
	PromptVersion string `json:"promptVersion,omitempty"`
	ModelID       string `json:"modelId,omitempty"`
	ProviderCode  string `json:"providerCode,omitempty"`
}

// PolishRequest is the DTO for AI content polishing.
type PolishRequest struct {
	Content       string `json:"content" validate:"required"`
	PolishType    string `json:"polishType,omitempty"`
	Style         string `json:"style,omitempty"`
	Model         string `json:"model,omitempty"`
	PromptVersion string `json:"promptVersion,omitempty"`
	ModelID       string `json:"modelId,omitempty"`
	ProviderCode  string `json:"providerCode,omitempty"`
}

// OutlineRequest is the DTO for AI outline generation.
type OutlineRequest struct {
	Topic           string `json:"topic" validate:"required"`
	ExistingContent string `json:"existingContent,omitempty"`
	Depth           int    `json:"depth,omitempty"`
	Style           string `json:"style,omitempty"`
	Model           string `json:"model,omitempty"`
	PromptVersion   string `json:"promptVersion,omitempty"`
	ModelID         string `json:"modelId,omitempty"`
	ProviderCode    string `json:"providerCode,omitempty"`
}

// TranslateRequest is the DTO for AI translation.
type TranslateRequest struct {
	Content        string `json:"content" validate:"required"`
	TargetLanguage string `json:"targetLanguage,omitempty"`
	SourceLanguage string `json:"sourceLanguage,omitempty"`
	PromptVersion  string `json:"promptVersion,omitempty"`
	ModelID        string `json:"modelId,omitempty"`
	ProviderCode   string `json:"providerCode,omitempty"`
}

// PromptUpdateRequest is the DTO for updating an AI prompt template.
type PromptUpdateRequest struct {
	PromptTemplate string `json:"prompt_template"`
}

// TaskTypeCreateRequest is the DTO for creating an AI task type.
type TaskTypeCreateRequest struct {
	Code           string   `json:"code"`
	Name           string   `json:"name"`
	Description    string   `json:"description,omitempty"`
	ModelType      string   `json:"model_type,omitempty"`
	Temperature    *float64 `json:"temperature,omitempty"`
	MaxTokens      *int     `json:"max_tokens,omitempty"`
	PromptTemplate string   `json:"prompt_template,omitempty"`
}

// TaskTypeUpdateRequest is the DTO for updating an AI task type.
type TaskTypeUpdateRequest struct {
	Code           string   `json:"code,omitempty"`
	Name           string   `json:"name,omitempty"`
	Description    string   `json:"description,omitempty"`
	ModelType      string   `json:"model_type,omitempty"`
	Temperature    *float64 `json:"temperature,omitempty"`
	MaxTokens      *int     `json:"max_tokens,omitempty"`
	PromptTemplate string   `json:"prompt_template,omitempty"`
}
