package handler

import (
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

const immutableUploadCacheControl = "public, max-age=31536000, immutable"

// PublicMediaHandler 提供面向博客前台的稳定媒体访问入口。
//
// 文章正文保存 /api/v1/public/media/{id},这里在请求时按当前媒体状态跳转到
// 主存储 CDN、本地文件或已验证备份 URL,避免文章内容被绑定到某次上传时的存储地址。
type PublicMediaHandler struct {
	svc *service.MediaService
}

func NewPublicMediaHandler(svc *service.MediaService) *PublicMediaHandler {
	return &PublicMediaHandler{svc: svc}
}

func (h *PublicMediaHandler) Mount(g *echo.Group) {
	g.GET("/:id", h.Redirect)
}

func (h *PublicMediaHandler) Redirect(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的ID")
	}
	target, err := h.svc.PublicAccessURL(c.Request().Context(), id)
	if err != nil {
		if errors.Is(err, service.ErrMediaNotFound) {
			return response.FailWith(c, response.NotFound, "文件不存在")
		}
		return response.Error(c, err)
	}
	if target == "" {
		return response.FailWith(c, response.NotFound, "文件不可访问")
	}
	c.Response().Header().Set("Cache-Control", "public, max-age=60")
	return c.Redirect(http.StatusFound, target)
}

// UploadAccessHandler 兼容历史 /api/uploads/{key} URL。
//
// 原先该路径由 Echo Static 直接读本地磁盘。现在先尝试用 key 反查 media_files:
// 如果该文件已经被备份到云端或迁移到对象存储,则跳转到当前最佳访问地址;
// 如果 catalog 中不存在该 key,仍回退为本地静态文件访问,避免破坏手工放入 uploads 的资源。
type UploadAccessHandler struct {
	svc      *service.MediaService
	baseDir  string
	basePath string
}

func NewUploadAccessHandler(svc *service.MediaService, baseDir string) *UploadAccessHandler {
	return &UploadAccessHandler{svc: svc, baseDir: baseDir, basePath: "/api/uploads"}
}

func (h *UploadAccessHandler) Mount(g *echo.Group) {
	g.GET("/*", h.Serve)
}

func (h *UploadAccessHandler) Serve(c echo.Context) error {
	key := strings.Trim(strings.TrimSpace(c.Param("*")), "/")
	if key == "" {
		return response.FailWith(c, response.NotFound, "文件不存在")
	}

	if h.svc != nil {
		// 目录查找对于遗留路径是尽力而为的；在查找失败时保持静态回退可用。
		target, err := h.svc.PublicAccessURLByPath(c.Request().Context(), key)
		if err == nil && target != "" && !h.pointsToUploadsKey(target, key) {
			c.Response().Header().Set("Cache-Control", "public, max-age=60")
			return c.Redirect(http.StatusFound, target)
		}
	}

	path, err := safeUploadFilePath(h.baseDir, key)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的文件路径")
	}
	c.Response().Header().Set("Cache-Control", immutableUploadCacheControl)
	return c.File(path)
}

func (h *UploadAccessHandler) pointsToUploadsKey(target, key string) bool {
	target = strings.TrimSpace(target)
	key = strings.Trim(key, "/")
	if target == "" || key == "" {
		return false
	}

	targetPath := target
	if parsed, err := url.Parse(target); err == nil && parsed.Path != "" {
		targetPath = parsed.Path
	}
	targetPath = strings.TrimRight(targetPath, "/")
	return targetPath == strings.TrimRight(h.basePath, "/")+"/"+key || targetPath == "/uploads/"+key
}

func safeUploadFilePath(baseDir, key string) (string, error) {
	if strings.TrimSpace(baseDir) == "" {
		return "", fmt.Errorf("upload base dir is empty")
	}
	cleanKey := filepath.Clean(filepath.FromSlash(strings.Trim(key, "/")))
	if cleanKey == "." || strings.HasPrefix(cleanKey, ".."+string(filepath.Separator)) || cleanKey == ".." {
		return "", fmt.Errorf("invalid upload key")
	}
	baseAbs, err := filepath.Abs(baseDir)
	if err != nil {
		return "", err
	}
	destAbs, err := filepath.Abs(filepath.Join(baseAbs, cleanKey))
	if err != nil {
		return "", err
	}
	rel, err := filepath.Rel(baseAbs, destAbs)
	if err != nil {
		return "", err
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("invalid upload key")
	}
	return destAbs, nil
}
