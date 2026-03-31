package model

import "time"

// Comment 对应数据库 `comments` 表，表示访客在已发布文章下提交的评论。
// 支持通过 ParentID 构建嵌套回复结构（二级评论树）。
type Comment struct {
	ID        int64      `db:"id"`
	PostID    int64      `db:"post_id"`    // 所属文章 ID（外键），必填
	ParentID  *int64     `db:"parent_id"`  // 父评论 ID，用于嵌套回复；nil 表示顶级评论
	Nickname  string     `db:"nickname"`   // 评论者显示昵称
	Email     *string    `db:"email"`      // 评论者邮箱，可选；用于从 Gravatar 获取头像
	Website   *string    `db:"website"`    // 评论者个人网站 URL，可选
	Avatar    *string    `db:"avatar"`     // 头像图片 URL；nil 时通过邮箱从 Gravatar 派生
	Content   string     `db:"content"`    // 评论正文（纯文本或受限 Markdown）
	Status    string     `db:"status"`     // 审核状态：PENDING（待审）| APPROVED（已通过）| REJECTED（已拒绝）| SPAM（垃圾评论）
	IP        *string    `db:"ip"`         // 提交者 IP 地址，用于反垃圾检测
	UserAgent *string    `db:"user_agent"` // 提交者 User-Agent 字符串，用于反垃圾检测
	IsAdmin   bool       `db:"is_admin"`   // 是否为博客管理员发布的评论
	LikeCount int        `db:"like_count"` // 评论获得的点赞数
	CreatedAt *time.Time `db:"created_at"` // 评论提交时间
	UpdatedAt *time.Time `db:"updated_at"` // 评论最后更新时间
}
