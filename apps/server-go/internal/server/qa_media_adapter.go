package server

import (
	"context"
	"fmt"

	coresvc "github.com/golovin0623/aetherblog-server/internal/service"
)

// qaMediaReader 适配 MediaService 以满足 service.QAMediaReader，
// 给 QA 流水线 PREPROCESS 阶段解析上传文件的可访问 URL 与 MIME。
type qaMediaReader struct {
	media *coresvc.MediaService
}

// ResolveURL 返回媒体文件的最佳可访问 URL 与 MIME 类型。
func (r qaMediaReader) ResolveURL(ctx context.Context, mediaFileID int64) (string, string, error) {
	if r.media == nil {
		return "", "", fmt.Errorf("media service 未注入")
	}
	vo, err := r.media.GetByID(ctx, mediaFileID)
	if err != nil {
		return "", "", err
	}
	if vo == nil || vo.Deleted {
		return "", "", fmt.Errorf("媒体文件 %d 不存在", mediaFileID)
	}
	mime := ""
	if vo.MimeType != nil {
		mime = *vo.MimeType
	}
	return firstNonEmptyServer(vo.PublicURL, vo.CdnURL, vo.FileURL), mime, nil
}
