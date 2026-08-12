package service

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/golovin0623/aetherblog-server/internal/dto"
	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/pkg/response"
	"github.com/golovin0623/aetherblog-server/internal/repository"
)

var (
	ErrMusicTrackNotFound    = errors.New("歌曲不存在")
	ErrMusicPlaylistNotFound = errors.New("歌单不存在")
	ErrMusicLyricNotFound    = errors.New("歌词资产不存在")
	ErrMusicLyricEmpty       = errors.New("歌词内容不能为空")
	ErrMusicMediaNotAudio    = errors.New("请选择媒体库中的音频文件")
)

const maxMusicMetadataBytes int64 = 64 * 1024 * 1024

type MusicService struct {
	repo     *repository.MusicRepo
	mediaSvc *MediaService
}

func NewMusicService(repo *repository.MusicRepo, mediaSvc *MediaService) *MusicService {
	return &MusicService{repo: repo, mediaSvc: mediaSvc}
}

func (s *MusicService) GetSettings(ctx context.Context) (*dto.MusicSettingsVO, error) {
	settings, err := s.repo.GetSettings(ctx)
	if err != nil {
		return nil, err
	}
	return s.toSettingsVO(ctx, settings)
}

func (s *MusicService) UpdateSettings(ctx context.Context, req dto.MusicSettingsRequest) (*dto.MusicSettingsVO, error) {
	playbackMode := strings.TrimSpace(req.PlaybackMode)
	if playbackMode == "" {
		playbackMode = "SEQUENTIAL"
	}
	interval := req.CarouselIntervalSeconds
	if interval == 0 {
		interval = 8
	}
	skinMode := strings.TrimSpace(req.SkinMode)
	if skinMode != "custom" {
		skinMode = "preset"
	}
	skinPreset := strings.TrimSpace(req.SkinPreset)
	if skinPreset == "" {
		skinPreset = "crimson"
	}
	settings := model.MusicSettings{
		Enabled:                 req.Enabled,
		ShowOnHomePage:          req.ShowOnHomePage,
		ShowOnProfileCard:       req.ShowOnProfileCard,
		FeaturedPlaylistID:      req.FeaturedPlaylistID,
		MediaFolderID:           req.MediaFolderID,
		PlaybackMode:            playbackMode,
		CarouselEnabled:         req.CarouselEnabled,
		CarouselIntervalSeconds: interval,
		RandomEnabled:           req.RandomEnabled,
		SkinMode:                skinMode,
		SkinPreset:              skinPreset,
		SkinColorLight:          trimOptColor(req.SkinColorLight),
		SkinColorDark:           trimOptColor(req.SkinColorDark),
	}
	updated, err := s.repo.UpdateSettings(ctx, settings)
	if err != nil {
		return nil, err
	}
	return s.toSettingsVO(ctx, updated)
}

func (s *MusicService) Summary(ctx context.Context) (*dto.MusicLibrarySummaryVO, error) {
	counts, err := s.repo.SummaryCounts(ctx)
	if err != nil {
		return nil, err
	}
	settings, err := s.GetSettings(ctx)
	if err != nil {
		return nil, err
	}
	return &dto.MusicLibrarySummaryVO{
		TrackCount:            counts.TrackCount,
		ActiveTrackCount:      counts.ActiveTrackCount,
		PlaylistCount:         counts.PlaylistCount,
		MappedMediaCount:      counts.MappedMediaCount,
		AvailableAudioCount:   counts.AvailableAudioCount,
		FavoriteTrackCount:    counts.FavoriteTrackCount,
		FavoritePlaylistCount: counts.FavoritePlaylistCount,
		LyricCount:            counts.LyricCount,
		ReadyLyricCount:       counts.ReadyLyricCount,
		MissingLyricCount:     counts.MissingLyricCount,
		MissingCoverCount:     counts.MissingCoverCount,
		TaggedTrackCount:      counts.TaggedTrackCount,
		Settings:              *settings,
	}, nil
}

func (s *MusicService) ScanAudioMedia(ctx context.Context, req dto.MusicScanRequest) (*response.PageResult, error) {
	rows, total, err := s.repo.ScanAudioMedia(ctx, repository.MusicScanFilter{
		FolderID:      req.FolderID,
		Keyword:       req.Keyword,
		IncludeMapped: req.IncludeMapped,
		PageNum:       req.PageNum,
		PageSize:      req.PageSize,
	})
	if err != nil {
		return nil, err
	}
	items := make([]dto.MusicAudioCandidateVO, 0, len(rows))
	for _, row := range rows {
		items = append(items, s.audioCandidateToVO(row))
	}
	pageNum, pageSize := normalizeMusicServicePage(req.PageNum, req.PageSize)
	pr := response.NewPageResult(items, total, pageNum, pageSize)
	return &pr, nil
}

func (s *MusicService) ImportMedia(ctx context.Context, req dto.MusicImportMediaRequest, source string) (*dto.MusicTrackVO, error) {
	row, err := s.repo.FindAudioMediaByID(ctx, req.MediaFileID)
	if err != nil {
		return nil, err
	}
	if row == nil || row.Deleted || row.FileType != "AUDIO" {
		return nil, ErrMusicMediaNotAudio
	}
	var metadata *audioTrackMetadata
	if s.mediaSvc != nil && (strings.TrimSpace(req.Title) == "" || strings.TrimSpace(req.Artist) == "" || strings.TrimSpace(req.Album) == "") {
		if data, mimeType, originalName, metadataErr := s.mediaSvc.DownloadBytes(ctx, req.MediaFileID, maxMusicMetadataBytes); metadataErr == nil {
			mimeType = resolveMusicMetadataMime(mimeType, row.MimeType, originalName, row.OriginalName)
			metadata = extractAudioTrackMetadata(bytes.NewReader(data), mimeType)
		}
	}
	title, artist, album := resolveMusicImportFields(req, metadata, row.OriginalName)
	if source == "" {
		source = "MEDIA_LIBRARY"
	}
	id, err := s.repo.CreateTrack(ctx, model.MusicTrack{
		MediaFileID: req.MediaFileID,
		Title:       title,
		Artist:      artist,
		Album:       album,
		Source:      source,
		Status:      "ACTIVE",
	})
	if err != nil {
		return nil, err
	}
	return s.GetTrack(ctx, id)
}

func resolveMusicImportFields(
	req dto.MusicImportMediaRequest,
	metadata *audioTrackMetadata,
	originalName string,
) (title, artist, album string) {
	title = strings.TrimSpace(req.Title)
	artist = strings.TrimSpace(req.Artist)
	album = strings.TrimSpace(req.Album)
	if metadata != nil {
		if title == "" {
			title = metadata.Title
		}
		if artist == "" {
			artist = metadata.Artist
		}
		if album == "" {
			album = metadata.Album
		}
	}
	if title == "" {
		title = titleFromFilename(originalName)
	}
	if artist == "" {
		artist = "未知艺术家"
	}
	title = normalizeMusicImportField(title, musicTrackTitleMaxRunes)
	artist = normalizeMusicImportField(artist, musicTrackArtistMaxRunes)
	album = normalizeMusicImportField(album, musicTrackAlbumMaxRunes)
	if title == "" {
		title = "未命名音频"
	}
	if artist == "" {
		artist = "未知艺术家"
	}
	return title, artist, album
}

// resolveMusicMetadataMime narrows MIME fallback to audio formats before ID3/tag extraction.
// Storage backends can legitimately return application/octet-stream for opaque object keys,
// so music import reuses the catalog MIME first, then the downloaded and query-row original
// names. Filename inference is accepted only when it resolves to audio/*; an unrelated or
// attacker-controlled extension must not turn this metadata-only path into a generic parser.
func resolveMusicMetadataMime(
	downloadedMime string,
	persistedMime *string,
	downloadedOriginalName string,
	rowOriginalName string,
) string {
	mimeType := strings.TrimSpace(downloadedMime)
	if mimeType != "" && !strings.EqualFold(mimeType, "application/octet-stream") {
		return mimeType
	}

	if persistedMime != nil {
		persisted := strings.TrimSpace(*persistedMime)
		if strings.HasPrefix(strings.ToLower(persisted), "audio/") {
			return persisted
		}
	}

	for _, originalName := range []string{downloadedOriginalName, rowOriginalName} {
		guessed := strings.TrimSpace(resolveMimeWithFallback("application/octet-stream", originalName))
		if strings.HasPrefix(strings.ToLower(guessed), "audio/") {
			return guessed
		}
	}
	return mimeType
}

func (s *MusicService) BatchImportMedia(ctx context.Context, req dto.MusicBatchImportRequest) ([]dto.MusicTrackVO, error) {
	out := make([]dto.MusicTrackVO, 0, len(req.MediaFileIDs))
	for _, mediaID := range req.MediaFileIDs {
		track, err := s.ImportMedia(ctx, dto.MusicImportMediaRequest{MediaFileID: mediaID}, "MEDIA_LIBRARY")
		if err != nil {
			return nil, err
		}
		out = append(out, *track)
	}
	return out, nil
}

func (s *MusicService) ListTracks(ctx context.Context, f repository.MusicTrackFilter) (*response.PageResult, error) {
	rows, total, err := s.repo.ListTracks(ctx, f)
	if err != nil {
		return nil, err
	}
	items := make([]dto.MusicTrackVO, 0, len(rows))
	for _, row := range rows {
		items = append(items, s.trackRowToVO(row))
	}
	pageNum, pageSize := normalizeMusicServicePage(f.PageNum, f.PageSize)
	pr := response.NewPageResult(items, total, pageNum, pageSize)
	return &pr, nil
}

func (s *MusicService) GetTrack(ctx context.Context, id int64) (*dto.MusicTrackVO, error) {
	row, err := s.repo.FindTrackByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, ErrMusicTrackNotFound
	}
	vo := s.trackRowToVO(*row)
	return &vo, nil
}

var musicLyricTimestampPattern = regexp.MustCompile(`\[[0-9]{1,3}:[0-9]{1,2}(?:[.:][0-9]{1,3})?\]`)

func inferMusicLyricFormat(content string) string {
	if musicLyricTimestampPattern.MatchString(content) {
		return "LRC"
	}
	return "PLAIN"
}

func normalizeMusicLyricSourceFileName(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

const musicLyricNameMaxRunes = 180

func truncateMusicLyricName(name string) string {
	runes := []rune(name)
	if len(runes) <= musicLyricNameMaxRunes {
		return name
	}
	return string(runes[:musicLyricNameMaxRunes])
}

func normalizeMusicLyricName(name string, sourceFileName *string) string {
	name = strings.TrimSpace(name)
	if name != "" {
		return truncateMusicLyricName(name)
	}
	if sourceFileName != nil {
		base := strings.TrimSpace(strings.TrimSuffix(*sourceFileName, filepath.Ext(*sourceFileName)))
		if base != "" {
			return truncateMusicLyricName(base)
		}
	}
	return "未命名歌词"
}

func normalizeMusicLyricModel(req dto.MusicLyricRequest, existing *repository.MusicLyricRow) (model.MusicLyric, error) {
	content := strings.TrimSpace(req.Content)
	if content == "" {
		return model.MusicLyric{}, ErrMusicLyricEmpty
	}
	sourceFileName := normalizeMusicLyricSourceFileName(req.SourceFileName)
	format := strings.ToUpper(strings.TrimSpace(req.Format))
	if format == "" {
		format = inferMusicLyricFormat(content)
	}
	language := strings.TrimSpace(req.Language)
	if language == "" && existing != nil {
		language = existing.Language
	}
	if language == "" {
		language = "und"
	}
	status := strings.ToUpper(strings.TrimSpace(req.Status))
	if status == "" && existing != nil {
		status = existing.Status
	}
	if status == "" {
		status = "DRAFT"
	}
	name := normalizeMusicLyricName(req.Name, sourceFileName)
	if strings.TrimSpace(req.Name) == "" && existing != nil {
		name = existing.Name
	}
	return model.MusicLyric{
		Name:           name,
		Content:        content,
		Format:         format,
		Language:       language,
		SourceFileName: sourceFileName,
		TimingOffsetMs: req.TimingOffsetMs,
		Status:         status,
	}, nil
}

func (s *MusicService) CreateLyric(ctx context.Context, req dto.MusicLyricRequest) (*dto.MusicLyricVO, error) {
	lyric, err := normalizeMusicLyricModel(req, nil)
	if err != nil {
		return nil, err
	}
	id, err := s.repo.CreateLyric(ctx, lyric)
	if err != nil {
		return nil, err
	}
	return s.GetLyric(ctx, id)
}

func (s *MusicService) GetLyric(ctx context.Context, id int64) (*dto.MusicLyricVO, error) {
	row, err := s.repo.FindLyricByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, ErrMusicLyricNotFound
	}
	vo := musicLyricRowToVO(*row)
	return &vo, nil
}

func (s *MusicService) ListLyrics(ctx context.Context, filter repository.MusicLyricFilter) (*response.PageResult, error) {
	rows, total, err := s.repo.ListLyrics(ctx, filter)
	if err != nil {
		return nil, err
	}
	items := make([]dto.MusicLyricVO, 0, len(rows))
	for _, row := range rows {
		items = append(items, musicLyricRowToVO(row))
	}
	pageNum, pageSize := normalizeMusicServicePage(filter.PageNum, filter.PageSize)
	result := response.NewPageResult(items, total, pageNum, pageSize)
	return &result, nil
}

func (s *MusicService) UpdateLyric(ctx context.Context, id int64, req dto.MusicLyricRequest) (*dto.MusicLyricVO, error) {
	existing, err := s.repo.FindLyricByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if existing == nil {
		return nil, ErrMusicLyricNotFound
	}
	lyric, err := normalizeMusicLyricModel(req, existing)
	if err != nil {
		return nil, err
	}
	if err := s.repo.UpdateLyric(ctx, id, lyric); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrMusicLyricNotFound
		}
		return nil, err
	}
	return s.GetLyric(ctx, id)
}

func (s *MusicService) BindLyric(ctx context.Context, lyricID int64, trackID *int64) (*dto.MusicLyricVO, error) {
	if _, err := s.GetLyric(ctx, lyricID); err != nil {
		return nil, err
	}
	if trackID == nil {
		if err := s.repo.UnbindLyric(ctx, lyricID); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, ErrMusicLyricNotFound
			}
			return nil, err
		}
		return s.GetLyric(ctx, lyricID)
	}
	if _, err := s.GetTrack(ctx, *trackID); err != nil {
		return nil, err
	}
	if err := s.repo.BindLyric(ctx, lyricID, *trackID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrMusicLyricNotFound
		}
		return nil, err
	}
	return s.GetLyric(ctx, lyricID)
}

func (s *MusicService) DeleteLyric(ctx context.Context, id int64) error {
	if err := s.repo.DeleteLyric(ctx, id); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrMusicLyricNotFound
		}
		return err
	}
	return nil
}

func (s *MusicService) UpdateTrack(ctx context.Context, id int64, req dto.MusicTrackRequest) (*dto.MusicTrackVO, error) {
	existing, err := s.repo.FindTrackByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if existing == nil {
		return nil, ErrMusicTrackNotFound
	}
	title := strings.TrimSpace(req.Title)
	if title == "" {
		title = existing.Title
	}
	status := strings.TrimSpace(req.Status)
	if status == "" {
		status = existing.Status
	}
	if req.CoverMediaFileID != nil {
		if err := s.assertCoverMedia(ctx, *req.CoverMediaFileID); err != nil {
			return nil, err
		}
	}
	isFavorite := existing.IsFavorite
	if req.IsFavorite != nil {
		isFavorite = *req.IsFavorite
	}
	err = s.repo.UpdateTrack(ctx, id, model.MusicTrack{
		Title:            title,
		Artist:           strings.TrimSpace(req.Artist),
		Album:            strings.TrimSpace(req.Album),
		DurationSeconds:  req.DurationSeconds,
		CoverMediaFileID: req.CoverMediaFileID,
		Lyric:            normalizeOptionalText(req.Lyric),
		Status:           status,
		SortOrder:        req.SortOrder,
		IsFeatured:       req.IsFeatured,
		IsFavorite:       isFavorite,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrMusicTrackNotFound
		}
		return nil, err
	}
	return s.GetTrack(ctx, id)
}

func (s *MusicService) DeleteTrack(ctx context.Context, id int64, deleteMedia bool) error {
	track, err := s.repo.FindTrackByID(ctx, id)
	if err != nil {
		return err
	}
	if track == nil {
		return ErrMusicTrackNotFound
	}
	if err := s.repo.DeleteTrack(ctx, id); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrMusicTrackNotFound
		}
		return err
	}
	if deleteMedia && s.mediaSvc != nil {
		return s.mediaSvc.Delete(ctx, track.MediaFileID)
	}
	return nil
}

func (s *MusicService) ListPlaylists(ctx context.Context, f repository.MusicPlaylistFilter) (*response.PageResult, error) {
	rows, total, err := s.repo.ListPlaylists(ctx, f)
	if err != nil {
		return nil, err
	}
	items := make([]dto.MusicPlaylistVO, 0, len(rows))
	for _, row := range rows {
		items = append(items, s.playlistRowToVO(row))
	}
	pageNum, pageSize := normalizeMusicServicePage(f.PageNum, f.PageSize)
	pr := response.NewPageResult(items, total, pageNum, pageSize)
	return &pr, nil
}

func (s *MusicService) GetPlaylist(ctx context.Context, id int64, includeTracks bool) (*dto.MusicPlaylistVO, error) {
	row, err := s.repo.FindPlaylistByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, ErrMusicPlaylistNotFound
	}
	vo := s.playlistRowToVO(*row)
	if includeTracks {
		tracks, _, err := s.repo.ListTracks(ctx, repository.MusicTrackFilter{
			PlaylistID: &id,
			PageNum:    1,
			PageSize:   100,
		})
		if err != nil {
			return nil, err
		}
		vo.Tracks = make([]dto.MusicTrackVO, 0, len(tracks))
		for _, track := range tracks {
			vo.Tracks = append(vo.Tracks, s.trackRowToVO(track))
		}
	}
	return &vo, nil
}

func (s *MusicService) CreatePlaylist(ctx context.Context, req dto.MusicPlaylistRequest) (*dto.MusicPlaylistVO, error) {
	if req.CoverMediaFileID != nil {
		if err := s.assertCoverMedia(ctx, *req.CoverMediaFileID); err != nil {
			return nil, err
		}
	}
	visibility := strings.TrimSpace(req.Visibility)
	if visibility == "" {
		visibility = "PUBLIC"
	}
	status := strings.TrimSpace(req.Status)
	if status == "" {
		status = "ACTIVE"
	}
	id, err := s.repo.CreatePlaylist(ctx, model.MusicPlaylist{
		Name:             strings.TrimSpace(req.Name),
		Slug:             uniqueMusicSlug(req.Name),
		Description:      normalizeOptionalText(req.Description),
		CoverMediaFileID: req.CoverMediaFileID,
		Visibility:       visibility,
		Status:           status,
		DisplayOnHome:    req.DisplayOnHome,
		DisplayOnProfile: req.DisplayOnProfile,
		CarouselEnabled:  req.CarouselEnabled,
		RandomEnabled:    req.RandomEnabled,
		IsFavorite:       req.IsFavorite != nil && *req.IsFavorite,
		SortOrder:        req.SortOrder,
	})
	if err != nil {
		return nil, err
	}
	return s.GetPlaylist(ctx, id, false)
}

func (s *MusicService) UpdatePlaylist(ctx context.Context, id int64, req dto.MusicPlaylistRequest) (*dto.MusicPlaylistVO, error) {
	existing, err := s.repo.FindPlaylistByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if existing == nil {
		return nil, ErrMusicPlaylistNotFound
	}
	if req.CoverMediaFileID != nil {
		if err := s.assertCoverMedia(ctx, *req.CoverMediaFileID); err != nil {
			return nil, err
		}
	}
	visibility := strings.TrimSpace(req.Visibility)
	if visibility == "" {
		visibility = existing.Visibility
	}
	status := strings.TrimSpace(req.Status)
	if status == "" {
		status = existing.Status
	}
	isFavorite := existing.IsFavorite
	if req.IsFavorite != nil {
		isFavorite = *req.IsFavorite
	}
	err = s.repo.UpdatePlaylist(ctx, id, model.MusicPlaylist{
		Name:             strings.TrimSpace(req.Name),
		Description:      normalizeOptionalText(req.Description),
		CoverMediaFileID: req.CoverMediaFileID,
		Visibility:       visibility,
		Status:           status,
		DisplayOnHome:    req.DisplayOnHome,
		DisplayOnProfile: req.DisplayOnProfile,
		CarouselEnabled:  req.CarouselEnabled,
		RandomEnabled:    req.RandomEnabled,
		IsFavorite:       isFavorite,
		SortOrder:        req.SortOrder,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrMusicPlaylistNotFound
		}
		return nil, err
	}
	return s.GetPlaylist(ctx, id, false)
}

func (s *MusicService) DeletePlaylist(ctx context.Context, id int64) error {
	if err := s.repo.DeletePlaylist(ctx, id); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrMusicPlaylistNotFound
		}
		return err
	}
	return nil
}

func (s *MusicService) AddTrackToPlaylist(ctx context.Context, playlistID, trackID int64) error {
	if _, err := s.GetPlaylist(ctx, playlistID, false); err != nil {
		return err
	}
	if _, err := s.GetTrack(ctx, trackID); err != nil {
		return err
	}
	return s.repo.AddTrackToPlaylist(ctx, playlistID, trackID)
}

func (s *MusicService) RemoveTrackFromPlaylist(ctx context.Context, playlistID, trackID int64) error {
	return s.repo.RemoveTrackFromPlaylist(ctx, playlistID, trackID)
}

func (s *MusicService) ReorderPlaylist(ctx context.Context, playlistID int64, req dto.MusicPlaylistReorderRequest) error {
	if _, err := s.GetPlaylist(ctx, playlistID, false); err != nil {
		return err
	}
	tracks := make([]model.MusicPlaylistTrack, 0, len(req.Tracks))
	for i, item := range req.Tracks {
		sortOrder := item.SortOrder
		if sortOrder == 0 {
			sortOrder = i
		}
		tracks = append(tracks, model.MusicPlaylistTrack{
			PlaylistID: playlistID,
			TrackID:    item.TrackID,
			SortOrder:  sortOrder,
		})
	}
	return s.repo.UpdatePlaylistTrackOrders(ctx, playlistID, tracks)
}

func (s *MusicService) PublicPlayer(ctx context.Context) (*dto.MusicPlayerVO, error) {
	settings, err := s.repo.GetSettings(ctx)
	if err != nil {
		return nil, err
	}
	out := &dto.MusicPlayerVO{
		Enabled:                 settings.Enabled,
		ShowOnHomePage:          settings.ShowOnHomePage,
		ShowOnProfileCard:       settings.ShowOnProfileCard,
		PlaybackMode:            settings.PlaybackMode,
		CarouselEnabled:         settings.CarouselEnabled,
		CarouselIntervalSeconds: settings.CarouselIntervalSeconds,
		RandomEnabled:           settings.RandomEnabled,
		SkinMode:                settings.SkinMode,
		SkinPreset:              settings.SkinPreset,
		SkinColorLight:          settings.SkinColorLight,
		SkinColorDark:           settings.SkinColorDark,
		Tracks:                  []dto.MusicTrackVO{},
	}
	if !settings.Enabled {
		return out, nil
	}

	var playlist *dto.MusicPlaylistVO
	var playlistID *int64
	if settings.FeaturedPlaylistID != nil {
		p, err := s.GetPlaylist(ctx, *settings.FeaturedPlaylistID, false)
		if err == nil && p.Status == "ACTIVE" && p.Visibility == "PUBLIC" {
			playlist = p
			playlistID = settings.FeaturedPlaylistID
		}
	}
	if playlistID == nil {
		p, err := s.repo.FirstPublicPlaylist(ctx)
		if err != nil {
			return nil, err
		}
		if p != nil {
			vo := s.playlistRowToVO(*p)
			playlist = &vo
			playlistID = &p.ID
		}
	}
	if playlistID == nil {
		out.Tracks = []dto.MusicTrackVO{}
		return out, nil
	}

	out.Playlist = playlist
	out.Tracks = []dto.MusicTrackVO{}
	for pageNum := 1; ; pageNum++ {
		rows, total, err := s.repo.ListTracks(ctx, repository.MusicTrackFilter{
			PlaylistID: playlistID,
			PageNum:    pageNum,
			PageSize:   100,
			PublicOnly: true,
		})
		if err != nil {
			return nil, err
		}
		for _, row := range rows {
			out.Tracks = append(out.Tracks, s.trackRowToVO(row))
		}
		if len(rows) == 0 || int64(len(out.Tracks)) >= total {
			break
		}
	}
	return out, nil
}

func (s *MusicService) toSettingsVO(ctx context.Context, settings *model.MusicSettings) (*dto.MusicSettingsVO, error) {
	vo := &dto.MusicSettingsVO{
		Enabled:                 settings.Enabled,
		ShowOnHomePage:          settings.ShowOnHomePage,
		ShowOnProfileCard:       settings.ShowOnProfileCard,
		FeaturedPlaylistID:      settings.FeaturedPlaylistID,
		MediaFolderID:           settings.MediaFolderID,
		PlaybackMode:            settings.PlaybackMode,
		CarouselEnabled:         settings.CarouselEnabled,
		CarouselIntervalSeconds: settings.CarouselIntervalSeconds,
		RandomEnabled:           settings.RandomEnabled,
		SkinMode:                settings.SkinMode,
		SkinPreset:              settings.SkinPreset,
		SkinColorLight:          settings.SkinColorLight,
		SkinColorDark:           settings.SkinColorDark,
	}
	if settings.FeaturedPlaylistID != nil {
		if playlist, err := s.GetPlaylist(ctx, *settings.FeaturedPlaylistID, false); err == nil {
			vo.FeaturedPlaylist = playlist
		}
	}
	return vo, nil
}

// trimOptColor 去除自定义皮肤色值首尾空白;空串归一为 nil,避免空字符串落库。
func trimOptColor(p *string) *string {
	if p == nil {
		return nil
	}
	v := strings.TrimSpace(*p)
	if v == "" {
		return nil
	}
	return &v
}

func derefString(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func decodeMusicTags(raw []byte) []dto.MusicTagVO {
	if len(raw) == 0 {
		return []dto.MusicTagVO{}
	}
	var tags []dto.MusicTagVO
	if err := json.Unmarshal(raw, &tags); err != nil || tags == nil {
		return []dto.MusicTagVO{}
	}
	return tags
}

func musicLyricRowToVO(row repository.MusicLyricRow) dto.MusicLyricVO {
	return dto.MusicLyricVO{
		ID:               row.ID,
		Name:             row.Name,
		Content:          row.Content,
		Format:           row.Format,
		Language:         row.Language,
		SourceFileName:   row.SourceFileName,
		TimingOffsetMs:   row.TimingOffsetMs,
		Status:           row.Status,
		BoundTrackID:     row.TrackID,
		BoundTrackTitle:  row.BoundTrackTitle,
		BoundTrackArtist: row.BoundTrackArtist,
		CreatedAt:        row.CreatedAt,
		UpdatedAt:        row.UpdatedAt,
	}
}

func (s *MusicService) trackRowToVO(row repository.MusicTrackRow) dto.MusicTrackVO {
	coverURL := publicMediaURLForID(row.CoverMediaFileID)
	if coverURL == "" && row.MediaThumbnailURL != nil {
		coverURL = *row.MediaThumbnailURL
	}
	var lyricAsset *dto.MusicLyricSummaryVO
	if row.LyricAssetID != nil {
		lyricAsset = &dto.MusicLyricSummaryVO{
			ID:             *row.LyricAssetID,
			Name:           derefString(row.LyricAssetName),
			Format:         derefString(row.LyricFormat),
			Language:       derefString(row.LyricLanguage),
			SourceFileName: row.LyricSourceFileName,
			TimingOffsetMs: func() int {
				if row.LyricTimingOffsetMs == nil {
					return 0
				}
				return *row.LyricTimingOffsetMs
			}(),
			Status: derefString(row.LyricStatus),
		}
	}
	return dto.MusicTrackVO{
		ID:               row.ID,
		MediaFileID:      row.MediaFileID,
		Title:            row.Title,
		Artist:           row.Artist,
		Album:            row.Album,
		DurationSeconds:  row.DurationSeconds,
		CoverMediaFileID: row.CoverMediaFileID,
		CoverURL:         coverURL,
		Lyric:            row.Lyric,
		Source:           row.Source,
		Status:           row.Status,
		SortOrder:        row.SortOrder,
		IsFeatured:       row.IsFeatured,
		IsFavorite:       row.IsFavorite,
		PlayCount:        row.PlayCount,
		PlaylistCount:    row.PlaylistCount,
		Tags:             decodeMusicTags(row.TagsJSON),
		LyricAsset:       lyricAsset,
		Media: dto.MusicMediaVO{
			ID:           row.MediaFileID,
			OriginalName: row.MediaOriginalName,
			FileURL:      row.MediaFileURL,
			PublicURL:    fmt.Sprintf("/api/v1/public/media/%d", row.MediaFileID),
			ThumbnailURL: derefString(row.MediaThumbnailURL),
			FileSize:     row.MediaFileSize,
			MimeType:     row.MediaMimeType,
			FileType:     row.MediaFileType,
			FolderID:     row.MediaFolderID,
			Deleted:      row.MediaDeleted,
		},
		CreatedAt: row.CreatedAt,
		UpdatedAt: row.UpdatedAt,
	}
}

func (s *MusicService) playlistRowToVO(row repository.MusicPlaylistRow) dto.MusicPlaylistVO {
	return dto.MusicPlaylistVO{
		ID:               row.ID,
		Name:             row.Name,
		Slug:             row.Slug,
		Description:      row.Description,
		CoverMediaFileID: row.CoverMediaFileID,
		CoverURL:         publicMediaURLForID(row.CoverMediaFileID),
		Visibility:       row.Visibility,
		Status:           row.Status,
		DisplayOnHome:    row.DisplayOnHome,
		DisplayOnProfile: row.DisplayOnProfile,
		CarouselEnabled:  row.CarouselEnabled,
		RandomEnabled:    row.RandomEnabled,
		IsFavorite:       row.IsFavorite,
		SortOrder:        row.SortOrder,
		TrackCount:       row.TrackCount,
		CreatedAt:        row.CreatedAt,
		UpdatedAt:        row.UpdatedAt,
	}
}

func (s *MusicService) audioCandidateToVO(row repository.MusicAudioCandidateRow) dto.MusicAudioCandidateVO {
	return dto.MusicAudioCandidateVO{
		MusicMediaVO: dto.MusicMediaVO{
			ID:           row.ID,
			OriginalName: row.OriginalName,
			FileURL:      row.FileURL,
			PublicURL:    fmt.Sprintf("/api/v1/public/media/%d", row.ID),
			ThumbnailURL: derefString(row.ThumbnailURL),
			FileSize:     row.FileSize,
			MimeType:     row.MimeType,
			FileType:     row.FileType,
			FolderID:     row.FolderID,
			Deleted:      row.Deleted,
		},
		MappedTrackID: row.MappedTrackID,
		MappedTitle:   row.MappedTitle,
	}
}

func (s *MusicService) assertCoverMedia(ctx context.Context, mediaID int64) error {
	if s.mediaSvc == nil {
		return nil
	}
	media, err := s.mediaSvc.GetByID(ctx, mediaID)
	if err != nil {
		return err
	}
	if media == nil || media.Deleted || media.FileType != "IMAGE" {
		return errors.New("封面必须选择媒体库中的图片")
	}
	return nil
}

func normalizeOptionalText(v *string) *string {
	if v == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*v)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

const (
	musicTrackTitleMaxRunes  = 160
	musicTrackArtistMaxRunes = 120
	musicTrackAlbumMaxRunes  = 120
)

func normalizeMusicImportField(value string, maxRunes int) string {
	value = strings.TrimSpace(strings.ToValidUTF8(value, ""))
	if maxRunes <= 0 {
		return ""
	}
	runes := []rune(value)
	if len(runes) > maxRunes {
		return string(runes[:maxRunes])
	}
	return value
}

func titleFromFilename(name string) string {
	base := strings.TrimSuffix(name, filepath.Ext(name))
	base = strings.TrimSpace(strings.ReplaceAll(base, "_", " "))
	if base == "" {
		return "未命名音频"
	}
	return normalizeMusicImportField(base, musicTrackTitleMaxRunes)
}

var musicSlugNonAlnum = regexp.MustCompile(`[^a-z0-9]+`)

func uniqueMusicSlug(name string) string {
	base := strings.ToLower(strings.TrimSpace(name))
	base = musicSlugNonAlnum.ReplaceAllString(base, "-")
	base = strings.Trim(base, "-")
	if base == "" {
		base = "playlist"
	}
	return fmt.Sprintf("%s-%d", base, time.Now().UnixMilli())
}

func publicMediaURLForID(id *int64) string {
	if id == nil || *id <= 0 {
		return ""
	}
	return fmt.Sprintf("/api/v1/public/media/%d", *id)
}

func normalizeMusicServicePage(pageNum, pageSize int) (int, int) {
	if pageNum < 1 {
		pageNum = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	return pageNum, pageSize
}
