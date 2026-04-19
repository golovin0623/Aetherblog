package service

import (
	"encoding/json"
)

// VanBlogBackup 对应 VanBlog 后台 "Backup & Restore" 导出的顶层 JSON 结构。
// 字段命名基于真实 4.5MB 生产导出的实测结构，而非上游 Mongoose schema 推理：
//   - meta/user 是单对象（非数组），key 为单数
//   - categories/tags 是字符串数组（非 {name} 对象数组）
//   - viewer/visit/static/setting 是我们不导入的分析/站点数据，但为避免旧版
//     DisallowUnknownFields 误杀，这里用 json.RawMessage 显式接收并丢弃。
type VanBlogBackup struct {
	Articles   []VanBlogArticle `json:"articles"`
	Drafts     []VanBlogArticle `json:"drafts"`
	Categories []string         `json:"categories"`
	Tags       []string         `json:"tags"`
	Meta       *VanBlogMeta     `json:"meta,omitempty"`
	User       *VanBlogUser     `json:"user,omitempty"`

	// 以下 4 个字段是 VanBlog 附带的站点数据/分析埋点，当前迁移不消费；
	// 声明为 RawMessage 仅用于在 analyze 阶段做 "detected but not imported" 提示。
	Viewer  json.RawMessage `json:"viewer,omitempty"`
	Visit   json.RawMessage `json:"visit,omitempty"`
	Static  json.RawMessage `json:"static,omitempty"`
	Setting json.RawMessage `json:"setting,omitempty"`
}

// VanBlogArticle 代表单篇文章或草稿。所有字段都按 VanBlog 导出的真实形状声明，
// 且大多数设为可选（zero-value 可容忍）以兼容不同 VanBlog 版本。
//
// 关键点：VanBlog 导出里 _id 被投影掉了，真正的唯一键是数字 `id`。74/74 样本
// 全部具有唯一 id，因此 source_key 使用 `vanblog:<id>`；若 id 缺失则回退
// `vanblog:title-sha1:<hex>`（由 service 层处理）。
type VanBlogArticle struct {
	ID              *int     `json:"id,omitempty"`
	Title           string   `json:"title"`
	Content         string   `json:"content"`
	Category        string   `json:"category"`
	Tags            []string `json:"tags"`
	Top             int      `json:"top"`
	Hidden          bool     `json:"hidden"`
	Private         bool     `json:"private"`
	Password        string   `json:"password"`
	Pathname        string   `json:"pathname"`
	Author          string   `json:"author"`
	Viewer          int64    `json:"viewer"`
	Visited         int64    `json:"visited"`
	Copyright       string   `json:"copyright"`
	CreatedAt       string   `json:"createdAt"`
	UpdatedAt       string   `json:"updatedAt"`
	LastVisitedTime string   `json:"lastVisitedTime"`
	Deleted         *bool    `json:"deleted,omitempty"`
}

// VanBlogMeta 是站点 meta 对象。当前版本不导入到 site_settings，声明仅用于结构兼容。
type VanBlogMeta struct {
	SiteInfo *json.RawMessage `json:"siteInfo,omitempty"`
	About    *json.RawMessage `json:"about,omitempty"`
	Socials  *json.RawMessage `json:"socials,omitempty"`
	Menus    *json.RawMessage `json:"menus,omitempty"`
	Links    *json.RawMessage `json:"links,omitempty"`
}

// VanBlogUser 是 VanBlog 的用户对象。当前不导入，仅用于结构兼容。
type VanBlogUser struct {
	Name string `json:"name"`
}

// --- 冲突策略常量 ---

const (
	ConflictStrategySkip      = "skip"      // 遇到重复 source_key 时跳过
	ConflictStrategyOverwrite = "overwrite" // 覆盖现有记录（更新）
	ConflictStrategyRename    = "rename"    // 作为新记录导入（source_key 追加后缀）
)

// ImportOptions 是前端向导传入的导入选项 JSON 体。
// 所有字段都有合理默认值，默认保持与 VanBlog 2.0 计划中确认的决策一致：
//   - ConflictStrategy: skip
//   - PreserveTimestamps: true
//   - ImportHidden: true
//   - ImportDrafts: true
//   - ImportDeleted: false
//   - PreservePasswords: true（overwrite 时保留旧 bcrypt，不用 VanBlog 明文覆盖）
type ImportOptions struct {
	ConflictStrategy   string `json:"conflictStrategy,omitempty"`
	PreserveTimestamps *bool  `json:"preserveTimestamps,omitempty"`
	ImportHidden       *bool  `json:"importHidden,omitempty"`
	ImportDrafts       *bool  `json:"importDrafts,omitempty"`
	ImportDeleted      *bool  `json:"importDeleted,omitempty"`
	PreservePasswords  *bool  `json:"preservePasswords,omitempty"`
	OnlyArticleIDs     []int  `json:"onlyArticleIds,omitempty"`
}

// ApplyDefaults 在 zero-value 字段上填充约定的默认值，便于 service 层统一消费。
func (o *ImportOptions) ApplyDefaults() {
	if o.ConflictStrategy == "" {
		o.ConflictStrategy = ConflictStrategySkip
	}
	if o.PreserveTimestamps == nil {
		v := true
		o.PreserveTimestamps = &v
	}
	if o.ImportHidden == nil {
		v := true
		o.ImportHidden = &v
	}
	if o.ImportDrafts == nil {
		v := true
		o.ImportDrafts = &v
	}
	if o.ImportDeleted == nil {
		v := false
		o.ImportDeleted = &v
	}
	if o.PreservePasswords == nil {
		v := true
		o.PreservePasswords = &v
	}
}

// --- Analyze 阶段返回的数据结构 ---

// AnalysisReport 是 dry-run/analyze 返回的完整计划报告。前端用它渲染 Step 3 预览页。
type AnalysisReport struct {
	Summary       AnalysisSummary `json:"summary"`
	CategoryPlans []EntityPlan    `json:"categoryPlans"`
	TagPlans      []EntityPlan    `json:"tagPlans"`
	ArticlePlans  []ArticlePlan   `json:"articlePlans"`
	Warnings      []string        `json:"warnings"`
	Unsupported   []string        `json:"unsupported"`
}

// AnalysisSummary 给前端展示的汇总计数。
type AnalysisSummary struct {
	TotalArticles        int `json:"totalArticles"`
	TotalDrafts          int `json:"totalDrafts"`
	ImportableArticles   int `json:"importableArticles"`
	SkippedHidden        int `json:"skippedHidden"`
	SkippedDeleted       int `json:"skippedDeleted"`
	CreatedCategories    int `json:"createdCategories"`
	ReusedCategories     int `json:"reusedCategories"`
	CreatedTags          int `json:"createdTags"`
	ReusedTags           int `json:"reusedTags"`
	WillCreatePosts      int `json:"willCreatePosts"`
	WillOverwritePosts   int `json:"willOverwritePosts"`
	WillSkipDuplicates   int `json:"willSkipDuplicates"`
	WillRenameDuplicates int `json:"willRenameDuplicates"`
	SlugCollisions       int `json:"slugCollisions"`
	InvalidRecords       int `json:"invalidRecords"`
}

// EntityPlan 用于分类、标签的 "新建 vs. 复用" 列表。
type EntityPlan struct {
	Name   string `json:"name"`
	Action string `json:"action"` // "create" | "reuse"
}

// ArticlePlan 描述单篇文章的拟定处置。action 枚举：
//   - create            全新导入
//   - skip_duplicate    source_key 已存在，根据 Skip 策略跳过
//   - overwrite         source_key 已存在，按 Overwrite 策略更新
//   - rename            source_key 已存在，按 Rename 策略作新记录导入
//   - skip_hidden       hidden=true 且 importHidden=false
//   - skip_deleted      deleted=true 且 importDeleted=false
//   - skip_filtered     不在 onlyArticleIds 指定的白名单里
//   - invalid           标题为空等明显非法
type ArticlePlan struct {
	SourceID       string   `json:"sourceId"` // 数字 id 或 title-hash
	SourceKey      string   `json:"sourceKey"`
	Title          string   `json:"title"`
	Status         string   `json:"status"` // PUBLISHED | DRAFT
	Category       string   `json:"category,omitempty"`
	Tags           []string `json:"tags,omitempty"`
	Slug           string   `json:"slug"`
	Action         string   `json:"action"`
	Reason         string   `json:"reason,omitempty"`
	ExistingPostID *int64   `json:"existingPostId,omitempty"`
	// MatchedSourceKey 是 Analyze 阶段在 DB 里实际命中的那条 source_key。
	// 新导入 → 空串；命中新格式 `vanblog:<id>` → 等于 SourceKey；
	// 命中老格式 `vanblog:<title>` → 等于老值。Execute 在 overwrite 路径里
	// 用它做 WHERE 匹配、并把 source_key 列升级到新格式（顺便一石二鸟）。
	MatchedSourceKey string `json:"matchedSourceKey,omitempty"`
	IsPinned       bool     `json:"isPinned"`
	IsHidden       bool     `json:"isHidden"`
	HasPassword    bool     `json:"hasPassword"`
	WordCount      int      `json:"wordCount"`
}

// --- Execute 阶段的 SSE 事件 ---
//
// 事件以 NDJSON 形式写入 response body（每行一个 JSON，前缀 "data: "，末尾 "\n\n"），
// 以便和 SSE 兼容（虽然这里用 fetch+ReadableStream，不走 EventSource）。

// ProgressEvent 是流式事件的公共载体。不同 Type 下使用不同字段。
type ProgressEvent struct {
	Type string `json:"type"`

	// Phase 事件专用
	Phase string `json:"phase,omitempty"`
	Total int    `json:"total,omitempty"`

	// Item 事件专用
	Kind     string  `json:"kind,omitempty"` // article|category|tag|post_tag
	SourceID string  `json:"sourceId,omitempty"`
	Title    string  `json:"title,omitempty"`
	Action   string  `json:"action,omitempty"`
	PostID   *int64  `json:"postId,omitempty"`
	Error    string  `json:"error,omitempty"`

	// Done 事件专用
	Summary *ExecutionSummary `json:"summary,omitempty"`
}

// ExecutionSummary 是 Execute 结束时写入最终 "done" 事件的计数汇总。
type ExecutionSummary struct {
	CreatedCategories int      `json:"createdCategories"`
	ReusedCategories  int      `json:"reusedCategories"`
	CreatedTags       int      `json:"createdTags"`
	ReusedTags        int      `json:"reusedTags"`
	CreatedPosts      int      `json:"createdPosts"`
	OverwrittenPosts  int      `json:"overwrittenPosts"`
	SkippedPosts      int      `json:"skippedPosts"`
	FailedPosts       int      `json:"failedPosts"`
	CreatedPostTags   int      `json:"createdPostTags"`
	DurationMs        int64    `json:"durationMs"`
	Warnings          []string `json:"warnings"`
	Errors            []string `json:"errors"`
}
