package handler

import (
	"errors"
	"strconv"

	"github.com/labstack/echo/v4"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/repository"
	"github.com/golovin0623/aetherblog-server/internal/service"
)

type MusicHandler struct {
	svc *service.MusicService
}

func NewMusicHandler(svc *service.MusicService) *MusicHandler {
	return &MusicHandler{svc: svc}
}

func (h *MusicHandler) MountAdmin(g *echo.Group) {
	g.GET("/summary", h.Summary)
	g.GET("/settings", h.GetSettings)
	g.PUT("/settings", h.UpdateSettings)

	g.GET("/tracks", h.ListTracks)
	g.POST("/tracks/scan", h.ScanAudioMedia)
	g.POST("/tracks/import", h.ImportMedia)
	g.POST("/tracks/batch-import", h.BatchImportMedia)
	g.GET("/tracks/:id", h.GetTrack)
	g.PUT("/tracks/:id", h.UpdateTrack)
	g.DELETE("/tracks/:id", h.DeleteTrack)

	g.GET("/playlists", h.ListPlaylists)
	g.POST("/playlists", h.CreatePlaylist)
	g.GET("/playlists/:id", h.GetPlaylist)
	g.PUT("/playlists/:id", h.UpdatePlaylist)
	g.DELETE("/playlists/:id", h.DeletePlaylist)
	g.POST("/playlists/:id/tracks", h.AddTrackToPlaylist)
	g.DELETE("/playlists/:id/tracks/:trackId", h.RemoveTrackFromPlaylist)
	g.PUT("/playlists/:id/tracks/reorder", h.ReorderPlaylist)
}

func (h *MusicHandler) MountPublic(g *echo.Group) {
	g.GET("/player", h.PublicPlayer)
}

func (h *MusicHandler) Summary(c echo.Context) error {
	vo, err := h.svc.Summary(c.Request().Context())
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, vo)
}

func (h *MusicHandler) GetSettings(c echo.Context) error {
	vo, err := h.svc.GetSettings(c.Request().Context())
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, vo)
}

func (h *MusicHandler) UpdateSettings(c echo.Context) error {
	var req dto.MusicSettingsRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	vo, err := h.svc.UpdateSettings(c.Request().Context(), req)
	if err != nil {
		return response.FailWith(c, response.BadRequest, err.Error())
	}
	return response.OK(c, vo)
}

func (h *MusicHandler) ListTracks(c echo.Context) error {
	var playlistID *int64
	if v := c.QueryParam("playlistId"); v != "" {
		id, err := strconv.ParseInt(v, 10, 64)
		if err != nil {
			return response.FailWith(c, response.BadRequest, "无效的歌单ID")
		}
		playlistID = &id
	}
	pr, err := h.svc.ListTracks(c.Request().Context(), repository.MusicTrackFilter{
		Keyword:    c.QueryParam("keyword"),
		Status:     c.QueryParam("status"),
		PlaylistID: playlistID,
		PageNum:    parseIntDefault(c.QueryParam("pageNum"), 1),
		PageSize:   parseIntDefault(c.QueryParam("pageSize"), 20),
	})
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, pr)
}

func (h *MusicHandler) ScanAudioMedia(c echo.Context) error {
	var req dto.MusicScanRequest
	if err := c.Bind(&req); err != nil {
		return response.FailWith(c, response.BadRequest, "请求参数格式错误")
	}
	if req.PageNum == 0 {
		req.PageNum = parseIntDefault(c.QueryParam("pageNum"), 1)
	}
	if req.PageSize == 0 {
		req.PageSize = parseIntDefault(c.QueryParam("pageSize"), 20)
	}
	if req.Keyword == "" {
		req.Keyword = c.QueryParam("keyword")
	}
	pr, err := h.svc.ScanAudioMedia(c.Request().Context(), req)
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, pr)
}

func (h *MusicHandler) ImportMedia(c echo.Context) error {
	var req dto.MusicImportMediaRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	vo, err := h.svc.ImportMedia(c.Request().Context(), req, "MEDIA_LIBRARY")
	if err != nil {
		return h.respondMusicError(c, err)
	}
	return response.OK(c, vo)
}

func (h *MusicHandler) BatchImportMedia(c echo.Context) error {
	var req dto.MusicBatchImportRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	items, err := h.svc.BatchImportMedia(c.Request().Context(), req)
	if err != nil {
		return h.respondMusicError(c, err)
	}
	return response.OK(c, items)
}

func (h *MusicHandler) GetTrack(c echo.Context) error {
	id, err := parseMusicID(c.Param("id"))
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的歌曲ID")
	}
	vo, err := h.svc.GetTrack(c.Request().Context(), id)
	if err != nil {
		return h.respondMusicError(c, err)
	}
	return response.OK(c, vo)
}

func (h *MusicHandler) UpdateTrack(c echo.Context) error {
	id, err := parseMusicID(c.Param("id"))
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的歌曲ID")
	}
	var req dto.MusicTrackRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	vo, err := h.svc.UpdateTrack(c.Request().Context(), id, req)
	if err != nil {
		return h.respondMusicError(c, err)
	}
	return response.OK(c, vo)
}

func (h *MusicHandler) DeleteTrack(c echo.Context) error {
	id, err := parseMusicID(c.Param("id"))
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的歌曲ID")
	}
	if err := h.svc.DeleteTrack(c.Request().Context(), id, c.QueryParam("deleteMedia") == "true"); err != nil {
		return h.respondMusicError(c, err)
	}
	return response.OKEmpty(c)
}

func (h *MusicHandler) ListPlaylists(c echo.Context) error {
	pr, err := h.svc.ListPlaylists(c.Request().Context(), repository.MusicPlaylistFilter{
		Status:     c.QueryParam("status"),
		Visibility: c.QueryParam("visibility"),
		PageNum:    parseIntDefault(c.QueryParam("pageNum"), 1),
		PageSize:   parseIntDefault(c.QueryParam("pageSize"), 20),
	})
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, pr)
}

func (h *MusicHandler) CreatePlaylist(c echo.Context) error {
	var req dto.MusicPlaylistRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	vo, err := h.svc.CreatePlaylist(c.Request().Context(), req)
	if err != nil {
		return h.respondMusicError(c, err)
	}
	return response.OK(c, vo)
}

func (h *MusicHandler) GetPlaylist(c echo.Context) error {
	id, err := parseMusicID(c.Param("id"))
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的歌单ID")
	}
	vo, err := h.svc.GetPlaylist(c.Request().Context(), id, c.QueryParam("includeTracks") == "true")
	if err != nil {
		return h.respondMusicError(c, err)
	}
	return response.OK(c, vo)
}

func (h *MusicHandler) UpdatePlaylist(c echo.Context) error {
	id, err := parseMusicID(c.Param("id"))
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的歌单ID")
	}
	var req dto.MusicPlaylistRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	vo, err := h.svc.UpdatePlaylist(c.Request().Context(), id, req)
	if err != nil {
		return h.respondMusicError(c, err)
	}
	return response.OK(c, vo)
}

func (h *MusicHandler) DeletePlaylist(c echo.Context) error {
	id, err := parseMusicID(c.Param("id"))
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的歌单ID")
	}
	if err := h.svc.DeletePlaylist(c.Request().Context(), id); err != nil {
		return h.respondMusicError(c, err)
	}
	return response.OKEmpty(c)
}

func (h *MusicHandler) AddTrackToPlaylist(c echo.Context) error {
	playlistID, err := parseMusicID(c.Param("id"))
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的歌单ID")
	}
	var req dto.MusicPlaylistTrackRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	if err := h.svc.AddTrackToPlaylist(c.Request().Context(), playlistID, req.TrackID); err != nil {
		return h.respondMusicError(c, err)
	}
	return response.OKEmpty(c)
}

func (h *MusicHandler) RemoveTrackFromPlaylist(c echo.Context) error {
	playlistID, err := parseMusicID(c.Param("id"))
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的歌单ID")
	}
	trackID, err := parseMusicID(c.Param("trackId"))
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的歌曲ID")
	}
	if err := h.svc.RemoveTrackFromPlaylist(c.Request().Context(), playlistID, trackID); err != nil {
		return h.respondMusicError(c, err)
	}
	return response.OKEmpty(c)
}

func (h *MusicHandler) ReorderPlaylist(c echo.Context) error {
	playlistID, err := parseMusicID(c.Param("id"))
	if err != nil {
		return response.FailWith(c, response.BadRequest, "无效的歌单ID")
	}
	var req dto.MusicPlaylistReorderRequest
	if err := bindAndValidate(c, &req); err != nil {
		return err
	}
	if err := h.svc.ReorderPlaylist(c.Request().Context(), playlistID, req); err != nil {
		return h.respondMusicError(c, err)
	}
	return response.OKEmpty(c)
}

func (h *MusicHandler) PublicPlayer(c echo.Context) error {
	vo, err := h.svc.PublicPlayer(c.Request().Context())
	if err != nil {
		return response.Error(c, err)
	}
	return response.OK(c, vo)
}

func (h *MusicHandler) respondMusicError(c echo.Context, err error) error {
	switch {
	case errors.Is(err, service.ErrMusicTrackNotFound), errors.Is(err, service.ErrMusicPlaylistNotFound):
		return response.FailWith(c, response.NotFound, err.Error())
	case errors.Is(err, service.ErrMusicMediaNotAudio):
		return response.FailWith(c, response.BadRequest, err.Error())
	default:
		return response.FailWith(c, response.BadRequest, err.Error())
	}
}

func parseMusicID(raw string) (int64, error) {
	if raw == "" {
		return 0, strconv.ErrSyntax
	}
	return strconv.ParseInt(raw, 10, 64)
}
