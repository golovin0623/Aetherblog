// Atlas — carrier_handler
//
// 路径 (/v1/admin/atlas, RBAC + AtlasScopeMiddleware):
//   POST /carriers/markdown       懒创建/返回 markdown 类型 carrier
//   POST /carriers/pdf            懒创建/返回 pdf 类型 carrier
//   POST /carriers/post           懒创建/返回 blog_post 类型 carrier
//   POST /carriers/web            创建/更新 web clip 类型 carrier
//   POST /carriers/web/fetch      抓取网页并返回可编辑正文快照
//   POST /carriers/media-transcript 创建/更新 video/audio transcript carrier
//   POST /carriers/image          创建/更新 image description carrier
//   GET  /carriers/:id            读 carrier 详情
//   GET  /carriers/:id/text-layer  读 pdf/blog_post/web/video/audio/image carrier 当前文本层

package handler

import (
	"encoding/json"
	"errors"
	"strconv"

	"github.com/labstack/echo/v4"

	atlasdto "github.com/golovin0623/aetherblog-server/internal/knowledge/dto"
	atlasmodel "github.com/golovin0623/aetherblog-server/internal/knowledge/model"
	atlassvc "github.com/golovin0623/aetherblog-server/internal/knowledge/service"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
)

// CarrierHandler 处理 /carriers/*。
type CarrierHandler struct {
	atlas *atlassvc.AtlasService
}

// NewCarrierHandler 创建。
func NewCarrierHandler(svc *atlassvc.AtlasService) *CarrierHandler {
	return &CarrierHandler{atlas: svc}
}

// Mount 挂载到 /atlas 子组。
// 红线 RBAC (PR #724 review fix): POST 需 content.atlas.write，由 server.go 传入。
func (h *CarrierHandler) Mount(g *echo.Group, write echo.MiddlewareFunc) {
	g.POST("/carriers/markdown/source", h.CreateMarkdownSource, write)
	g.GET("/carriers/markdown/:noteId/source", h.GetMarkdownSource)
	g.GET("/carriers/markdown/:noteId", h.GetMarkdownCarrier)
	g.POST("/carriers/markdown", h.EnsureMarkdown, write)
	g.POST("/carriers/pdf", h.EnsurePDF, write)
	g.GET("/carriers/post/:postId", h.GetPostCarrier)
	g.POST("/carriers/post", h.EnsurePost, write)
	g.GET("/carriers/media/:mediaFileId", h.GetMediaCarrier)
	g.POST("/carriers/web", h.EnsureWeb, write)
	g.POST("/carriers/web/fetch", h.FetchWeb, write)
	g.POST("/carriers/media-transcript", h.EnsureMediaTranscript, write)
	g.POST("/carriers/image", h.EnsureImage, write)
	g.GET("/carriers/:id/text-layer", h.GetTextLayer)
	g.GET("/carriers/:id", h.Get)
}

// CreateMarkdownSource 创建当前用户拥有的 Markdown source note，供非 admin Atlas Reader smoke 使用。
func (h *CarrierHandler) CreateMarkdownSource(c echo.Context) error {
	var req atlasdto.CreateMarkdownSourceRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求体无法解析")
	}
	if err := c.Validate(&req); err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	md := h.atlas.Markdown()
	if md == nil {
		return response.FailWith(c, response.InternalError, "markdown carrier service 未配置")
	}
	scope, err := currentAtlasScope(c)
	if err != nil {
		return writeAtlasError(c, err)
	}
	note, err := md.CreateNoteSourceAs(c.Request().Context(), req.Title, req.ContentMarkdown, scope.UserID)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OK(c, toMarkdownSourceResponse(note))
}

// GetMarkdownSource 返回当前调用者可访问的 Markdown note source 内容。
func (h *CarrierHandler) GetMarkdownSource(c echo.Context) error {
	noteID, err := strconv.ParseInt(c.Param("noteId"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的笔记 ID")
	}
	md := h.atlas.Markdown()
	if md == nil {
		return response.FailWith(c, response.InternalError, "markdown carrier service 未配置")
	}
	scope, err := currentAtlasScope(c)
	if err != nil {
		return writeAtlasError(c, err)
	}
	note, err := md.GetNoteSourceAs(c.Request().Context(), noteID, scope.UserID, scope.CanAdmin)
	if err != nil {
		if errors.Is(err, atlassvc.ErrAtlasForbidden) {
			return response.FailWith(c, response.Forbidden, "无权访问该笔记的 Atlas source")
		}
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OK(c, toMarkdownSourceResponse(note))
}

// EnsureMarkdown 懒创建 / 返回 markdown 类型 carrier。
func (h *CarrierHandler) EnsureMarkdown(c echo.Context) error {
	var req atlasdto.EnsureMarkdownCarrierRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求体无法解析")
	}
	if err := c.Validate(&req); err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	md := h.atlas.Markdown()
	if md == nil {
		return response.FailWith(c, response.InternalError, "markdown carrier service 未配置")
	}
	scope, err := currentAtlasScope(c)
	if err != nil {
		return writeAtlasError(c, err)
	}
	carrier, err := md.GetOrCreateForNoteAs(c.Request().Context(), req.NoteID, scope.UserID, scope.CanAdmin)
	if err != nil {
		if errors.Is(err, atlassvc.ErrAtlasForbidden) {
			return response.FailWith(c, response.Forbidden, "无权访问该笔记的 Atlas 载体")
		}
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OK(c, toCarrierResponse(carrier))
}

// GetMarkdownCarrier 返回已存在的 markdown carrier，不触发懒创建。
func (h *CarrierHandler) GetMarkdownCarrier(c echo.Context) error {
	noteID, err := strconv.ParseInt(c.Param("noteId"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的笔记 ID")
	}
	return h.getCarrierBySourceURI(c, atlassvc.MarkdownSourceURI(noteID), "markdown")
}

// EnsurePDF 懒创建 / 返回 pdf 类型 carrier。
func (h *CarrierHandler) EnsurePDF(c echo.Context) error {
	var req atlasdto.EnsurePDFCarrierRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求体无法解析")
	}
	if err := c.Validate(&req); err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	pdf := h.atlas.PDF()
	if pdf == nil {
		return response.FailWith(c, response.InternalError, "pdf carrier service 未配置")
	}
	scope, err := currentAtlasScope(c)
	if err != nil {
		return writeAtlasError(c, err)
	}
	carrier, err := pdf.GetOrCreateForMediaFileAs(c.Request().Context(), req.MediaFileID, scope.UserID, scope.CanAdmin)
	if err != nil {
		if errors.Is(err, atlassvc.ErrAtlasForbidden) {
			return response.FailWith(c, response.Forbidden, "无权访问该媒体的 Atlas 载体")
		}
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OK(c, toCarrierResponse(carrier))
}

// EnsurePost 懒创建 / 返回 blog_post 类型 carrier。
func (h *CarrierHandler) EnsurePost(c echo.Context) error {
	var req atlasdto.EnsurePostCarrierRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求体无法解析")
	}
	if err := c.Validate(&req); err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	posts := h.atlas.BlogPosts()
	if posts == nil {
		return response.FailWith(c, response.InternalError, "blog post carrier service 未配置")
	}
	scope, err := currentAtlasScope(c)
	if err != nil {
		return writeAtlasError(c, err)
	}
	carrier, err := posts.GetOrCreateForPostAs(c.Request().Context(), req.PostID, scope.UserID, scope.CanAdmin)
	if err != nil {
		if errors.Is(err, atlassvc.ErrAtlasForbidden) {
			return response.FailWith(c, response.Forbidden, "无权访问该文章的 Atlas 载体")
		}
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OK(c, toCarrierResponse(carrier))
}

// GetPostCarrier 返回已存在的 blog post carrier，不触发懒创建。
func (h *CarrierHandler) GetPostCarrier(c echo.Context) error {
	postID, err := strconv.ParseInt(c.Param("postId"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的文章 ID")
	}
	return h.getCarrierBySourceURI(c, atlassvc.BlogPostSourceURI(postID), "blog_post")
}

// GetMediaCarrier 返回已存在的 media-backed carrier，不触发懒创建/抽取。
func (h *CarrierHandler) GetMediaCarrier(c echo.Context) error {
	mediaFileID, err := strconv.ParseInt(c.Param("mediaFileId"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的媒体 ID")
	}
	return h.getCarrierBySourceURI(c, atlassvc.MediaSourceURI(mediaFileID), "pdf", "image", "video", "audio")
}

// EnsureWeb 创建 / 更新 web clip 类型 carrier。
func (h *CarrierHandler) EnsureWeb(c echo.Context) error {
	var req atlasdto.EnsureWebCarrierRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求体无法解析")
	}
	if err := c.Validate(&req); err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	web := h.atlas.WebClips()
	if web == nil {
		return response.FailWith(c, response.InternalError, "web clip carrier service 未配置")
	}
	scope, err := currentAtlasScope(c)
	if err != nil {
		return writeAtlasError(c, err)
	}
	carrier, err := web.CreateOrUpdateWebClipAs(c.Request().Context(), atlassvc.WebClipInput{
		SourceURL:       req.SourceURL,
		Title:           req.Title,
		ContentMarkdown: req.ContentMarkdown,
		Author:          req.Author,
		Language:        req.Language,
	}, scope.UserID)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OK(c, toCarrierResponse(carrier))
}

// FetchWeb 抓取网页 URL 并返回可编辑的 Web 快照草稿。
func (h *CarrierHandler) FetchWeb(c echo.Context) error {
	var req atlasdto.FetchWebCarrierRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求体无法解析")
	}
	if err := c.Validate(&req); err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	web := h.atlas.WebClips()
	if web == nil {
		return response.FailWith(c, response.InternalError, "web clip carrier service 未配置")
	}
	snapshot, err := web.FetchSnapshot(c.Request().Context(), req.SourceURL)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OK(c, atlasdto.FetchWebCarrierResponse{
		SourceURL:       snapshot.SourceURL,
		Title:           snapshot.Title,
		ContentMarkdown: snapshot.ContentMarkdown,
		Author:          snapshot.Author,
		Language:        snapshot.Language,
	})
}

// EnsureMediaTranscript 创建 / 更新 video/audio 转录文本 carrier。
func (h *CarrierHandler) EnsureMediaTranscript(c echo.Context) error {
	var req atlasdto.EnsureMediaTranscriptCarrierRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求体无法解析")
	}
	if err := c.Validate(&req); err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	transcripts := h.atlas.TranscriptMedia()
	if transcripts == nil {
		return response.FailWith(c, response.InternalError, "media transcript carrier service 未配置")
	}
	scope, err := currentAtlasScope(c)
	if err != nil {
		return writeAtlasError(c, err)
	}
	carrier, err := transcripts.CreateOrUpdateForMediaAs(c.Request().Context(), atlassvc.TranscriptCarrierInput{
		MediaFileID:        req.MediaFileID,
		TranscriptMarkdown: req.TranscriptMarkdown,
		Language:           req.Language,
	}, scope.UserID, scope.CanAdmin)
	if err != nil {
		if errors.Is(err, atlassvc.ErrAtlasForbidden) {
			return response.FailWith(c, response.Forbidden, "无权访问该媒体的 Atlas 转录")
		}
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OK(c, toCarrierResponse(carrier))
}

// EnsureImage 创建 / 更新 image 描述文本 carrier。
func (h *CarrierHandler) EnsureImage(c echo.Context) error {
	var req atlasdto.EnsureImageCarrierRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求体无法解析")
	}
	if err := c.Validate(&req); err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	images := h.atlas.ImageMedia()
	if images == nil {
		return response.FailWith(c, response.InternalError, "image carrier service 未配置")
	}
	scope, err := currentAtlasScope(c)
	if err != nil {
		return writeAtlasError(c, err)
	}
	carrier, err := images.CreateOrUpdateForMediaAs(c.Request().Context(), atlassvc.ImageCarrierInput{
		MediaFileID:         req.MediaFileID,
		DescriptionMarkdown: req.DescriptionMarkdown,
		Language:            req.Language,
	}, scope.UserID, scope.CanAdmin)
	if err != nil {
		if errors.Is(err, atlassvc.ErrAtlasForbidden) {
			return response.FailWith(c, response.Forbidden, "无权访问该图片的 Atlas 描述")
		}
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OK(c, toCarrierResponse(carrier))
}

// Get 返回 carrier 详情。
func (h *CarrierHandler) Get(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的 ID")
	}
	carrier, err := h.atlas.Carriers().FindByID(c.Request().Context(), id)
	if err != nil {
		return response.Error(c, err)
	}
	if carrier == nil {
		return response.FailWith(c, response.NotFound, "载体不存在")
	}
	scope, err := currentAtlasScope(c)
	if err != nil {
		return writeAtlasError(c, err)
	}
	if !scope.canAccessOwner(carrier.OwnerID) {
		return response.FailWith(c, response.Forbidden, "无权访问该载体")
	}
	return response.OK(c, toCarrierResponse(carrier))
}

func (h *CarrierHandler) getCarrierBySourceURI(c echo.Context, sourceURI string, allowedTypes ...string) error {
	scope, err := currentAtlasScope(c)
	if err != nil {
		return writeAtlasError(c, err)
	}
	var carrier *atlasmodel.Carrier
	if scope.CanAdmin {
		carrier, err = h.atlas.Carriers().FindBySourceURI(c.Request().Context(), sourceURI)
	} else {
		carrier, err = h.atlas.Carriers().FindBySourceURIForOwner(c.Request().Context(), sourceURI, &scope.UserID)
	}
	if err != nil {
		return response.Error(c, err)
	}
	if carrier == nil {
		return response.FailWith(c, response.NotFound, "载体不存在")
	}
	if len(allowedTypes) > 0 {
		allowed := false
		for _, t := range allowedTypes {
			if carrier.Type == t {
				allowed = true
				break
			}
		}
		if !allowed {
			return response.FailWith(c, response.NotFound, "载体不存在")
		}
	}
	if !scope.canAccessOwner(carrier.OwnerID) {
		return response.FailWith(c, response.Forbidden, "无权访问该载体")
	}
	return response.OK(c, toCarrierResponse(carrier))
}

// GetTextLayer 返回 PDF/BlogPost/Web/Transcript/Image carrier 当前 content_hash 对应的页级文本层。
func (h *CarrierHandler) GetTextLayer(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的 ID")
	}
	carrier, err := h.atlas.Carriers().FindByID(c.Request().Context(), id)
	if err != nil {
		return response.Error(c, err)
	}
	if carrier == nil {
		return response.FailWith(c, response.NotFound, "载体不存在")
	}
	scope, err := currentAtlasScope(c)
	if err != nil {
		return writeAtlasError(c, err)
	}
	if !scope.canAccessOwner(carrier.OwnerID) {
		return response.FailWith(c, response.Forbidden, "无权访问该载体")
	}
	if carrier.Type != "pdf" && carrier.Type != "blog_post" && carrier.Type != "web" && carrier.Type != "video" && carrier.Type != "audio" && carrier.Type != "image" {
		return response.FailWith(c, response.BadRequest, "仅 PDF/BlogPost/Web/Transcript/Image 载体支持文本层读取")
	}
	layer, err := h.atlas.Carriers().FindTextLayerByCarrierAndHash(c.Request().Context(), carrier.ID, carrier.ContentHash)
	if err != nil {
		return response.Error(c, err)
	}
	if layer == nil {
		return response.FailWith(c, response.NotFound, "载体文本层不存在或尚未完成抽取")
	}
	out, err := toCarrierTextLayerResponse(layer)
	if err != nil {
		return response.FailWith(c, response.InternalError, "载体文本层页数据损坏")
	}
	return response.OK(c, out)
}

func toCarrierResponse(c *atlasmodel.Carrier) atlasdto.CarrierResponse {
	return atlasdto.CarrierResponse{
		ID:            c.ID,
		Type:          c.Type,
		SourceURI:     c.SourceURI,
		ContentHash:   c.ContentHash,
		Title:         c.Title,
		Author:        c.Author,
		Language:      c.Language,
		Metadata:      c.Metadata,
		OwnerID:       c.OwnerID,
		Status:        c.Status,
		StatusMessage: c.StatusMessage,
		CreatedAt:     c.CreatedAt,
		UpdatedAt:     c.UpdatedAt,
	}
}

func toMarkdownSourceResponse(n *atlassvc.NoteSnapshot) atlasdto.MarkdownSourceResponse {
	if n == nil {
		return atlasdto.MarkdownSourceResponse{}
	}
	return atlasdto.MarkdownSourceResponse{
		ID:              n.ID,
		Title:           n.Title,
		ContentMarkdown: n.Content,
	}
}

type storedPDFTextPage struct {
	Page      int    `json:"page"`
	Text      string `json:"text"`
	CharStart int    `json:"char_start"`
	CharEnd   int    `json:"char_end"`
}

func toCarrierTextLayerResponse(layer *atlasmodel.CarrierTextLayer) (atlasdto.CarrierTextLayerResponse, error) {
	var storedPages []storedPDFTextPage
	if len(layer.Pages) > 0 {
		if err := json.Unmarshal(layer.Pages, &storedPages); err != nil {
			return atlasdto.CarrierTextLayerResponse{}, err
		}
	}
	pages := make([]atlasdto.CarrierTextPageResponse, 0, len(storedPages))
	for _, p := range storedPages {
		pages = append(pages, atlasdto.CarrierTextPageResponse{
			Page:      p.Page,
			Text:      p.Text,
			CharStart: p.CharStart,
			CharEnd:   p.CharEnd,
		})
	}
	return atlasdto.CarrierTextLayerResponse{
		CarrierID:   layer.CarrierID,
		ContentHash: layer.ContentHash,
		StorageURI:  layer.StorageURI,
		PageCount:   layer.PageCount,
		CharCount:   layer.CharCount,
		Text:        layer.TextContent,
		Pages:       pages,
	}, nil
}
