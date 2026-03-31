package model

import "time"

// MediaVersion 对应数据库 `media_versions` 表，记录媒体文件的历史版本信息。
// 每次替换文件内容时会创建一条新的版本记录，以支持版本回溯。
type MediaVersion struct {
	ID                int64      `db:"id"`
	MediaFileID       int64      `db:"media_file_id"`       // 所属媒体文件 ID（外键，关联 media_files）
	VersionNumber     int        `db:"version_number"`      // 版本号，从 1 开始递增
	FilePath          string     `db:"file_path"`           // 该版本文件的存储路径
	FileURL           string     `db:"file_url"`            // 该版本文件的公开访问 URL
	FileSize          int64      `db:"file_size"`           // 该版本文件大小（字节）
	ChangeDescription *string    `db:"change_description"`  // 本次版本变更的说明，可为空
	CreatedBy         *int64     `db:"created_by"`          // 创建该版本的用户 ID，可为空
	CreatedAt         *time.Time `db:"created_at"`          // 版本创建时间
}
