package dto

import "time"

// 请求 DTO

// CreateCommentRequest 是创建评论接口的请求体 DTO。
type CreateCommentRequest struct {
	Nickname string `json:"nickname" validate:"required,max=50"`         // 评论者昵称，最多 50 个字符（必填）
	Email    string `json:"email"    validate:"omitempty,email,max=100"` // 评论者邮箱，最多 100 个字符（可选，需符合邮箱格式）
	Website  string `json:"website"  validate:"omitempty,url,max=200"`   // 评论者个人网站 URL，最多 200 个字符（可选）
	Content  string `json:"content"  validate:"required,min=1,max=5000"` // 评论内容，长度 1~5000 个字符（必填）
	ParentID *int64 `json:"parentId"`                                     // 父评论 ID，用于回复嵌套（为空则为顶级评论）
}

// BatchCommentRequest 是批量操作评论接口的请求体 DTO。
type BatchCommentRequest struct {
	IDs []int64 `json:"ids" validate:"required,min=1"` // 需要批量操作的评论 ID 列表（必填，至少 1 条）
}

// 响应 DTO

// CommentVO 是评论信息的响应视图对象（View Object）。
type CommentVO struct {
	ID        int64             `json:"id"`                  // 评论唯一 ID
	PostID    int64             `json:"postId"`              // 所属文章 ID
	ParentID  *int64            `json:"parentId"`            // 父评论 ID（顶级评论为空）
	Nickname  string            `json:"nickname"`            // 评论者昵称
	Email     *string           `json:"email,omitempty"`     // 评论者邮箱（管理员可见）
	Website   *string           `json:"website,omitempty"`   // 评论者个人网站 URL（可为空）
	Avatar    *string           `json:"avatar,omitempty"`    // 评论者头像 URL，通常由邮箱 Gravatar 生成（可为空）
	Content   string            `json:"content"`             // 评论内容
	Status    string            `json:"status"`              // 评论审核状态（如 PENDING/APPROVED/REJECTED）
	IP        *string           `json:"ip,omitempty"`        // 评论者 IP 地址（管理员可见）
	IsAdmin   bool              `json:"isAdmin"`             // 是否为管理员评论
	LikeCount int               `json:"likeCount"`           // 点赞数量
	CreatedAt *time.Time        `json:"createdAt"`           // 评论创建时间
	Children  []CommentVO       `json:"children,omitempty"`  // 子评论列表（树形结构时返回）
	Post      *CommentPostRef   `json:"post,omitempty"`      // 所属文章的简要信息（列表场景下返回）
	Parent    *CommentParentRef `json:"parent,omitempty"`    // 父评论的简要信息（回复场景下返回）
}

// CommentPostRef 是评论中内嵌的文章简要引用信息。
type CommentPostRef struct {
	ID    int64  `json:"id"`    // 文章 ID
	Title string `json:"title"` // 文章标题
	Slug  string `json:"slug"`  // 文章 URL 别名
}

// CommentParentRef 是评论中内嵌的父评论简要引用信息。
type CommentParentRef struct {
	ID       int64  `json:"id"`       // 父评论 ID
	Nickname string `json:"nickname"` // 父评论者昵称
}

// CommentFilter 是管理后台查询评论列表的过滤条件。
type CommentFilter struct {
	Status   string // 评论审核状态过滤（如 PENDING/APPROVED/REJECTED，为空则不过滤）
	PostID   *int64 // 按文章 ID 过滤（为空则不过滤）
	Keyword  string // 关键词搜索（匹配评论内容或昵称）
	PageNum  int    // 当前页码（从 1 开始）
	PageSize int    // 每页条数
}
