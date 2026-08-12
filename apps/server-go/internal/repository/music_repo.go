package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"

	"github.com/golovin0623/aetherblog-server/internal/model"
	"github.com/golovin0623/aetherblog-server/internal/pkg/dbutil"
)

type MusicRepo struct {
	db *sqlx.DB
}

func NewMusicRepo(db *sqlx.DB) *MusicRepo {
	return &MusicRepo{db: db}
}

type MusicTrackFilter struct {
	Keyword    string
	Status     string
	PlaylistID *int64
	TagID      *int64
	TagState   string
	Favorite   *bool
	LyricState string
	CoverState string
	PageNum    int
	PageSize   int
	PublicOnly bool
}

type MusicPlaylistFilter struct {
	Status     string
	Visibility string
	Favorite   *bool
	PageNum    int
	PageSize   int
	PublicOnly bool
}

type MusicLyricFilter struct {
	Keyword  string
	Status   string
	Bound    *bool
	TrackID  *int64
	PageNum  int
	PageSize int
}

type MusicScanFilter struct {
	FolderID      *int64
	Keyword       string
	IncludeMapped bool
	PageNum       int
	PageSize      int
}

type MusicTrackRow struct {
	ID                  int64      `db:"id"`
	MediaFileID         int64      `db:"media_file_id"`
	Title               string     `db:"title"`
	Artist              string     `db:"artist"`
	Album               string     `db:"album"`
	DurationSeconds     *int       `db:"duration_seconds"`
	CoverMediaFileID    *int64     `db:"cover_media_file_id"`
	Lyric               *string    `db:"lyric"`
	Source              string     `db:"source"`
	Status              string     `db:"status"`
	SortOrder           int        `db:"sort_order"`
	IsFeatured          bool       `db:"is_featured"`
	IsFavorite          bool       `db:"is_favorite"`
	PlayCount           int64      `db:"play_count"`
	PlaylistCount       int64      `db:"playlist_count"`
	TagsJSON            []byte     `db:"tags_json"`
	LyricAssetID        *int64     `db:"lyric_asset_id"`
	LyricAssetName      *string    `db:"lyric_asset_name"`
	LyricFormat         *string    `db:"lyric_format"`
	LyricLanguage       *string    `db:"lyric_language"`
	LyricSourceFileName *string    `db:"lyric_source_file_name"`
	LyricTimingOffsetMs *int       `db:"lyric_timing_offset_ms"`
	LyricStatus         *string    `db:"lyric_status"`
	CreatedAt           *time.Time `db:"created_at"`
	UpdatedAt           *time.Time `db:"updated_at"`
	MediaOriginalName   string     `db:"media_original_name"`
	MediaFileURL        string     `db:"media_file_url"`
	MediaFileSize       int64      `db:"media_file_size"`
	MediaMimeType       *string    `db:"media_mime_type"`
	MediaFileType       string     `db:"media_file_type"`
	MediaFolderID       *int64     `db:"media_folder_id"`
	MediaDeleted        bool       `db:"media_deleted"`
	MediaThumbnailURL   *string    `db:"media_thumbnail_url"`
}

type MusicPlaylistRow struct {
	ID               int64      `db:"id"`
	Name             string     `db:"name"`
	Slug             string     `db:"slug"`
	Description      *string    `db:"description"`
	CoverMediaFileID *int64     `db:"cover_media_file_id"`
	Visibility       string     `db:"visibility"`
	Status           string     `db:"status"`
	DisplayOnHome    bool       `db:"display_on_home"`
	DisplayOnProfile bool       `db:"display_on_profile"`
	CarouselEnabled  bool       `db:"carousel_enabled"`
	RandomEnabled    bool       `db:"random_enabled"`
	IsFavorite       bool       `db:"is_favorite"`
	SortOrder        int        `db:"sort_order"`
	TrackCount       int64      `db:"track_count"`
	CreatedAt        *time.Time `db:"created_at"`
	UpdatedAt        *time.Time `db:"updated_at"`
}

type MusicAudioCandidateRow struct {
	ID            int64   `db:"id"`
	OriginalName  string  `db:"original_name"`
	FileURL       string  `db:"file_url"`
	FileSize      int64   `db:"file_size"`
	MimeType      *string `db:"mime_type"`
	FileType      string  `db:"file_type"`
	FolderID      *int64  `db:"folder_id"`
	Deleted       bool    `db:"deleted"`
	ThumbnailURL  *string `db:"thumbnail_url"`
	MappedTrackID *int64  `db:"mapped_track_id"`
	MappedTitle   *string `db:"mapped_title"`
}

type MusicSummaryCounts struct {
	TrackCount            int64 `db:"track_count"`
	ActiveTrackCount      int64 `db:"active_track_count"`
	PlaylistCount         int64 `db:"playlist_count"`
	MappedMediaCount      int64 `db:"mapped_media_count"`
	AvailableAudioCount   int64 `db:"available_audio_count"`
	FavoriteTrackCount    int64 `db:"favorite_track_count"`
	FavoritePlaylistCount int64 `db:"favorite_playlist_count"`
	LyricCount            int64 `db:"lyric_count"`
	ReadyLyricCount       int64 `db:"ready_lyric_count"`
	MissingLyricCount     int64 `db:"missing_lyric_count"`
	MissingCoverCount     int64 `db:"missing_cover_count"`
	TaggedTrackCount      int64 `db:"tagged_track_count"`
}

type MusicLyricRow struct {
	ID               int64      `db:"id"`
	Name             string     `db:"name"`
	Content          string     `db:"content"`
	Format           string     `db:"format"`
	Language         string     `db:"language"`
	SourceFileName   *string    `db:"source_file_name"`
	TimingOffsetMs   int        `db:"timing_offset_ms"`
	Status           string     `db:"status"`
	TrackID          *int64     `db:"track_id"`
	BoundTrackTitle  *string    `db:"bound_track_title"`
	BoundTrackArtist *string    `db:"bound_track_artist"`
	CreatedAt        *time.Time `db:"created_at"`
	UpdatedAt        *time.Time `db:"updated_at"`
}

const musicTrackSelect = `
	t.id, t.media_file_id, t.title, t.artist, t.album, t.duration_seconds,
	t.cover_media_file_id, COALESCE(ml.content, t.lyric) AS lyric,
	t.source, t.status, t.sort_order, t.is_featured, t.is_favorite,
	t.play_count,
	(SELECT COUNT(*) FROM music_playlist_tracks playlist_membership WHERE playlist_membership.track_id=t.id) AS playlist_count,
	COALESCE((
		SELECT jsonb_agg(
			jsonb_build_object(
				'id', tag.id,
				'name', tag.name,
				'slug', tag.slug,
				'color', tag.color,
				'category', tag.category,
				'usageCount', tag.usage_count
			)
			ORDER BY tag.name ASC
		)
		FROM media_file_tags file_tag
		JOIN media_tags tag ON tag.id=file_tag.tag_id
		WHERE file_tag.media_file_id=t.media_file_id
	), '[]'::jsonb) AS tags_json,
	ml.id AS lyric_asset_id,
	ml.name AS lyric_asset_name,
	ml.format AS lyric_format,
	ml.language AS lyric_language,
	ml.source_file_name AS lyric_source_file_name,
	ml.timing_offset_ms AS lyric_timing_offset_ms,
	ml.status AS lyric_status,
	t.created_at, t.updated_at,
	mf.original_name AS media_original_name,
	mf.file_url AS media_file_url,
	mf.file_size AS media_file_size,
	mf.mime_type AS media_mime_type,
	mf.file_type AS media_file_type,
	mf.folder_id AS media_folder_id,
	mf.deleted AS media_deleted,
	mv.file_url AS media_thumbnail_url`

const musicLyricSelect = `
	l.id, l.name, l.content, l.format, l.language, l.source_file_name,
	l.timing_offset_ms, l.status, l.track_id,
	t.title AS bound_track_title,
	t.artist AS bound_track_artist,
	l.created_at, l.updated_at`

func (r *MusicRepo) GetSettings(ctx context.Context) (*model.MusicSettings, error) {
	if _, err := r.db.ExecContext(ctx, `INSERT INTO music_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`); err != nil {
		return nil, err
	}
	var s model.MusicSettings
	if err := r.db.GetContext(ctx, &s, `SELECT * FROM music_settings WHERE id=1`); err != nil {
		return nil, err
	}
	return &s, nil
}

func (r *MusicRepo) UpdateSettings(ctx context.Context, s model.MusicSettings) (*model.MusicSettings, error) {
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO music_settings (
			id, enabled, show_on_home_page, show_on_profile_card, featured_playlist_id,
			media_folder_id, playback_mode, carousel_enabled, carousel_interval_seconds, random_enabled,
			skin_mode, skin_preset, skin_color_light, skin_color_dark, updated_at
		)
		VALUES (1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,CURRENT_TIMESTAMP)
		ON CONFLICT (id) DO UPDATE SET
			enabled=EXCLUDED.enabled,
			show_on_home_page=EXCLUDED.show_on_home_page,
			show_on_profile_card=EXCLUDED.show_on_profile_card,
			featured_playlist_id=EXCLUDED.featured_playlist_id,
			media_folder_id=EXCLUDED.media_folder_id,
			playback_mode=EXCLUDED.playback_mode,
			carousel_enabled=EXCLUDED.carousel_enabled,
			carousel_interval_seconds=EXCLUDED.carousel_interval_seconds,
			random_enabled=EXCLUDED.random_enabled,
			skin_mode=EXCLUDED.skin_mode,
			skin_preset=EXCLUDED.skin_preset,
			skin_color_light=EXCLUDED.skin_color_light,
			skin_color_dark=EXCLUDED.skin_color_dark,
			updated_at=CURRENT_TIMESTAMP`,
		s.Enabled, s.ShowOnHomePage, s.ShowOnProfileCard, s.FeaturedPlaylistID, s.MediaFolderID,
		s.PlaybackMode, s.CarouselEnabled, s.CarouselIntervalSeconds, s.RandomEnabled,
		s.SkinMode, s.SkinPreset, s.SkinColorLight, s.SkinColorDark,
	)
	if err != nil {
		return nil, err
	}
	return r.GetSettings(ctx)
}

func (r *MusicRepo) FindAudioMediaByID(ctx context.Context, mediaID int64) (*MusicAudioCandidateRow, error) {
	var row MusicAudioCandidateRow
	err := r.db.GetContext(ctx, &row, `
		SELECT
			mf.id, mf.original_name, mf.file_url, mf.file_size, mf.mime_type, mf.file_type,
			mf.folder_id, mf.deleted, mv.file_url AS thumbnail_url, mt.id AS mapped_track_id, mt.title AS mapped_title
		FROM media_files mf
		LEFT JOIN music_tracks mt ON mt.media_file_id = mf.id
		LEFT JOIN media_variants mv ON mv.media_file_id = mf.id AND mv.variant_type='THUMBNAIL'
		WHERE mf.id=$1 AND mf.file_type='AUDIO'`, mediaID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &row, nil
}

func (r *MusicRepo) ScanAudioMedia(ctx context.Context, f MusicScanFilter) ([]MusicAudioCandidateRow, int64, error) {
	pageNum, pageSize := normalizeMusicPage(f.PageNum, f.PageSize)
	var sb strings.Builder
	args := []any{}
	idx := 1

	sb.WriteString(`
		FROM media_files mf
		LEFT JOIN music_tracks mt ON mt.media_file_id = mf.id
		LEFT JOIN media_variants mv ON mv.media_file_id = mf.id AND mv.variant_type='THUMBNAIL'
		WHERE mf.deleted=false
		  AND mf.file_type='AUDIO'
		  AND (mf.folder_id IS NULL OR mf.folder_id NOT IN (SELECT id FROM media_folders WHERE is_system = TRUE))`)

	if f.FolderID != nil {
		sb.WriteString(fmt.Sprintf(" AND mf.folder_id=$%d", idx))
		args = append(args, *f.FolderID)
		idx++
	}
	if strings.TrimSpace(f.Keyword) != "" {
		sb.WriteString(fmt.Sprintf(" AND (mf.filename ILIKE $%d OR mf.original_name ILIKE $%d)", idx, idx))
		args = append(args, "%"+dbutil.EscapeLike(strings.TrimSpace(f.Keyword))+"%")
		idx++
	}
	if !f.IncludeMapped {
		sb.WriteString(" AND mt.id IS NULL")
	}

	base := sb.String()
	var total int64
	if err := r.db.QueryRowContext(ctx, "SELECT COUNT(*) "+base, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	query := fmt.Sprintf(`
		SELECT
			mf.id, mf.original_name, mf.file_url, mf.file_size, mf.mime_type, mf.file_type,
			mf.folder_id, mf.deleted, mv.file_url AS thumbnail_url, mt.id AS mapped_track_id, mt.title AS mapped_title
		%s
		ORDER BY mf.created_at DESC
		LIMIT $%d OFFSET $%d`, base, idx, idx+1)
	args = append(args, pageSize, (pageNum-1)*pageSize)

	var rows []MusicAudioCandidateRow
	if err := r.db.SelectContext(ctx, &rows, query, args...); err != nil {
		return nil, 0, err
	}
	return rows, total, nil
}

func (r *MusicRepo) CreateTrack(ctx context.Context, t model.MusicTrack) (int64, error) {
	var id int64
	err := r.db.QueryRowContext(ctx, `
		INSERT INTO music_tracks (
			media_file_id, title, artist, album, duration_seconds, cover_media_file_id,
			lyric, source, status, sort_order, is_featured
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		ON CONFLICT (media_file_id) DO UPDATE SET updated_at = music_tracks.updated_at
		RETURNING id`,
		t.MediaFileID, t.Title, t.Artist, t.Album, t.DurationSeconds, t.CoverMediaFileID,
		t.Lyric, t.Source, t.Status, t.SortOrder, t.IsFeatured,
	).Scan(&id)
	return id, err
}

func (r *MusicRepo) UpdateTrack(ctx context.Context, id int64, t model.MusicTrack) error {
	res, err := r.db.ExecContext(ctx, `
		UPDATE music_tracks
		SET title=$1, artist=$2, album=$3, duration_seconds=$4, cover_media_file_id=$5,
		    lyric=$6, status=$7, sort_order=$8, is_featured=$9, is_favorite=$10,
		    updated_at=CURRENT_TIMESTAMP
		WHERE id=$11`,
		t.Title, t.Artist, t.Album, t.DurationSeconds, t.CoverMediaFileID,
		t.Lyric, t.Status, t.SortOrder, t.IsFeatured, t.IsFavorite, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (r *MusicRepo) DeleteTrack(ctx context.Context, id int64) error {
	res, err := r.db.ExecContext(ctx, `DELETE FROM music_tracks WHERE id=$1`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (r *MusicRepo) FindTrackByID(ctx context.Context, id int64) (*MusicTrackRow, error) {
	var row MusicTrackRow
	err := r.db.GetContext(ctx, &row, `
		SELECT `+musicTrackSelect+`
		FROM music_tracks t
		JOIN media_files mf ON mf.id=t.media_file_id
		LEFT JOIN media_variants mv ON mv.media_file_id = mf.id AND mv.variant_type='THUMBNAIL'
		LEFT JOIN music_lyrics ml ON ml.track_id=t.id
		WHERE t.id=$1`, id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &row, nil
}

func (r *MusicRepo) ListTracks(ctx context.Context, f MusicTrackFilter) ([]MusicTrackRow, int64, error) {
	pageNum, pageSize := normalizeMusicPage(f.PageNum, f.PageSize)
	var sb strings.Builder
	args := []any{}
	idx := 1
	orderBy := "t.sort_order ASC, t.created_at DESC"

	sb.WriteString(`
		FROM music_tracks t
		JOIN media_files mf ON mf.id=t.media_file_id
		LEFT JOIN media_variants mv ON mv.media_file_id = mf.id AND mv.variant_type='THUMBNAIL'
		LEFT JOIN music_lyrics ml ON ml.track_id=t.id`)
	if f.PlaylistID != nil {
		sb.WriteString(" JOIN music_playlist_tracks mpt ON mpt.track_id=t.id")
		orderBy = "mpt.sort_order ASC, t.sort_order ASC, t.created_at DESC"
	}
	sb.WriteString(" WHERE mf.deleted=false")
	if f.PlaylistID != nil {
		sb.WriteString(fmt.Sprintf(" AND mpt.playlist_id=$%d", idx))
		args = append(args, *f.PlaylistID)
		idx++
	}
	if f.PublicOnly {
		sb.WriteString(" AND t.status='ACTIVE'")
	} else if strings.TrimSpace(f.Status) != "" {
		sb.WriteString(fmt.Sprintf(" AND t.status=$%d", idx))
		args = append(args, strings.TrimSpace(f.Status))
		idx++
	}
	if strings.TrimSpace(f.Keyword) != "" {
		like := "%" + dbutil.EscapeLike(strings.TrimSpace(f.Keyword)) + "%"
		sb.WriteString(fmt.Sprintf(" AND (t.title ILIKE $%d OR t.artist ILIKE $%d OR t.album ILIKE $%d OR mf.original_name ILIKE $%d)", idx, idx, idx, idx))
		args = append(args, like)
		idx++
	}
	if f.TagID != nil {
		sb.WriteString(fmt.Sprintf(`
			AND EXISTS (
				SELECT 1
				FROM media_file_tags filter_file_tag
				WHERE filter_file_tag.media_file_id=t.media_file_id
				  AND filter_file_tag.tag_id=$%d
			)`, idx))
		args = append(args, *f.TagID)
		idx++
	}
	switch strings.ToUpper(strings.TrimSpace(f.TagState)) {
	case "WITH_TAGS":
		sb.WriteString(`
			AND EXISTS (
				SELECT 1
				FROM media_file_tags filter_file_tag
				WHERE filter_file_tag.media_file_id=t.media_file_id
			)`)
	case "WITHOUT_TAGS":
		sb.WriteString(`
			AND NOT EXISTS (
				SELECT 1
				FROM media_file_tags filter_file_tag
				WHERE filter_file_tag.media_file_id=t.media_file_id
			)`)
	}
	if f.Favorite != nil {
		sb.WriteString(fmt.Sprintf(" AND t.is_favorite=$%d", idx))
		args = append(args, *f.Favorite)
		idx++
	}
	switch strings.ToUpper(strings.TrimSpace(f.LyricState)) {
	case "WITH_LYRIC":
		sb.WriteString(" AND (ml.id IS NOT NULL OR NULLIF(BTRIM(t.lyric), '') IS NOT NULL)")
	case "WITHOUT_LYRIC":
		sb.WriteString(" AND ml.id IS NULL AND NULLIF(BTRIM(t.lyric), '') IS NULL")
	case "NEEDS_REVIEW":
		sb.WriteString(" AND ml.status='NEEDS_REVIEW'")
	}
	switch strings.ToUpper(strings.TrimSpace(f.CoverState)) {
	case "WITH_COVER":
		sb.WriteString(" AND (t.cover_media_file_id IS NOT NULL OR mv.file_url IS NOT NULL)")
	case "WITHOUT_COVER":
		sb.WriteString(" AND t.cover_media_file_id IS NULL AND mv.file_url IS NULL")
	}

	base := sb.String()
	var total int64
	if err := r.db.QueryRowContext(ctx, "SELECT COUNT(*) "+base, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	query := fmt.Sprintf(`
		SELECT `+musicTrackSelect+`
		%s
		ORDER BY %s
		LIMIT $%d OFFSET $%d`, base, orderBy, idx, idx+1)
	args = append(args, pageSize, (pageNum-1)*pageSize)

	var rows []MusicTrackRow
	if err := r.db.SelectContext(ctx, &rows, query, args...); err != nil {
		return nil, 0, err
	}
	return rows, total, nil
}

func (r *MusicRepo) ListPlaylists(ctx context.Context, f MusicPlaylistFilter) ([]MusicPlaylistRow, int64, error) {
	pageNum, pageSize := normalizeMusicPage(f.PageNum, f.PageSize)
	var sb strings.Builder
	args := []any{}
	idx := 1
	sb.WriteString(`
		FROM music_playlists p
		LEFT JOIN music_playlist_tracks pt ON pt.playlist_id=p.id
		WHERE 1=1`)
	if f.PublicOnly {
		sb.WriteString(" AND p.status='ACTIVE' AND p.visibility='PUBLIC'")
	} else {
		if strings.TrimSpace(f.Status) != "" {
			sb.WriteString(fmt.Sprintf(" AND p.status=$%d", idx))
			args = append(args, strings.TrimSpace(f.Status))
			idx++
		}
		if strings.TrimSpace(f.Visibility) != "" {
			sb.WriteString(fmt.Sprintf(" AND p.visibility=$%d", idx))
			args = append(args, strings.TrimSpace(f.Visibility))
			idx++
		}
	}
	if f.Favorite != nil {
		sb.WriteString(fmt.Sprintf(" AND p.is_favorite=$%d", idx))
		args = append(args, *f.Favorite)
		idx++
	}
	base := sb.String()

	var total int64
	if err := r.db.QueryRowContext(ctx, "SELECT COUNT(DISTINCT p.id) "+base, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	query := fmt.Sprintf(`
		SELECT p.id, p.name, p.slug, p.description, p.cover_media_file_id, p.visibility, p.status,
		       p.display_on_home, p.display_on_profile, p.carousel_enabled, p.random_enabled,
		       p.is_favorite, p.sort_order, p.created_at, p.updated_at, COUNT(pt.track_id) AS track_count
		%s
		GROUP BY p.id
		ORDER BY p.sort_order ASC, p.created_at DESC
		LIMIT $%d OFFSET $%d`, base, idx, idx+1)
	args = append(args, pageSize, (pageNum-1)*pageSize)

	var rows []MusicPlaylistRow
	if err := r.db.SelectContext(ctx, &rows, query, args...); err != nil {
		return nil, 0, err
	}
	return rows, total, nil
}

func (r *MusicRepo) FindPlaylistByID(ctx context.Context, id int64) (*MusicPlaylistRow, error) {
	var row MusicPlaylistRow
	err := r.db.GetContext(ctx, &row, `
		SELECT p.id, p.name, p.slug, p.description, p.cover_media_file_id, p.visibility, p.status,
		       p.display_on_home, p.display_on_profile, p.carousel_enabled, p.random_enabled,
		       p.is_favorite, p.sort_order, p.created_at, p.updated_at, COUNT(pt.track_id) AS track_count
		FROM music_playlists p
		LEFT JOIN music_playlist_tracks pt ON pt.playlist_id=p.id
		WHERE p.id=$1
		GROUP BY p.id`, id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &row, nil
}

func (r *MusicRepo) FirstPublicPlaylist(ctx context.Context) (*MusicPlaylistRow, error) {
	var row MusicPlaylistRow
	err := r.db.GetContext(ctx, &row, `
		SELECT p.id, p.name, p.slug, p.description, p.cover_media_file_id, p.visibility, p.status,
		       p.display_on_home, p.display_on_profile, p.carousel_enabled, p.random_enabled,
		       p.is_favorite, p.sort_order, p.created_at, p.updated_at, COUNT(DISTINCT t.id) AS track_count
		FROM music_playlists p
		JOIN music_playlist_tracks pt ON pt.playlist_id=p.id
		JOIN music_tracks t ON t.id=pt.track_id AND t.status='ACTIVE'
		JOIN media_files mf ON mf.id=t.media_file_id AND mf.deleted=false
		WHERE p.status='ACTIVE' AND p.visibility='PUBLIC'
		GROUP BY p.id
		ORDER BY p.sort_order ASC, p.created_at DESC
		LIMIT 1`)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &row, nil
}

func (r *MusicRepo) CreatePlaylist(ctx context.Context, p model.MusicPlaylist) (int64, error) {
	var id int64
	err := r.db.QueryRowContext(ctx, `
		INSERT INTO music_playlists (
			name, slug, description, cover_media_file_id, visibility, status,
			display_on_home, display_on_profile, carousel_enabled, random_enabled, is_favorite, sort_order
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
		RETURNING id`,
		p.Name, p.Slug, p.Description, p.CoverMediaFileID, p.Visibility, p.Status,
		p.DisplayOnHome, p.DisplayOnProfile, p.CarouselEnabled, p.RandomEnabled, p.IsFavorite, p.SortOrder,
	).Scan(&id)
	return id, err
}

func (r *MusicRepo) UpdatePlaylist(ctx context.Context, id int64, p model.MusicPlaylist) error {
	res, err := r.db.ExecContext(ctx, `
		UPDATE music_playlists
		SET name=$1, description=$2, cover_media_file_id=$3, visibility=$4, status=$5,
		    display_on_home=$6, display_on_profile=$7, carousel_enabled=$8,
		    random_enabled=$9, is_favorite=$10, sort_order=$11, updated_at=CURRENT_TIMESTAMP
		WHERE id=$12`,
		p.Name, p.Description, p.CoverMediaFileID, p.Visibility, p.Status,
		p.DisplayOnHome, p.DisplayOnProfile, p.CarouselEnabled, p.RandomEnabled, p.IsFavorite, p.SortOrder, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (r *MusicRepo) DeletePlaylist(ctx context.Context, id int64) error {
	res, err := r.db.ExecContext(ctx, `DELETE FROM music_playlists WHERE id=$1`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (r *MusicRepo) AddTrackToPlaylist(ctx context.Context, playlistID, trackID int64) error {
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO music_playlist_tracks (playlist_id, track_id, sort_order)
		VALUES ($1,$2,COALESCE((SELECT MAX(sort_order)+1 FROM music_playlist_tracks WHERE playlist_id=$1),0))
		ON CONFLICT (playlist_id, track_id) DO NOTHING`, playlistID, trackID)
	return err
}

func (r *MusicRepo) RemoveTrackFromPlaylist(ctx context.Context, playlistID, trackID int64) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM music_playlist_tracks WHERE playlist_id=$1 AND track_id=$2`, playlistID, trackID)
	return err
}

func (r *MusicRepo) UpdatePlaylistTrackOrders(ctx context.Context, playlistID int64, tracks []model.MusicPlaylistTrack) error {
	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for _, track := range tracks {
		res, execErr := tx.ExecContext(ctx, `
			UPDATE music_playlist_tracks
			SET sort_order=$3
			WHERE playlist_id=$1 AND track_id=$2`, playlistID, track.TrackID, track.SortOrder)
		if execErr != nil {
			return execErr
		}
		n, _ := res.RowsAffected()
		if n == 0 {
			return sql.ErrNoRows
		}
	}
	return tx.Commit()
}

func (r *MusicRepo) SummaryCounts(ctx context.Context) (*MusicSummaryCounts, error) {
	var counts MusicSummaryCounts
	err := r.db.GetContext(ctx, &counts, `
		SELECT
			(SELECT COUNT(*) FROM music_tracks) AS track_count,
			(SELECT COUNT(*) FROM music_tracks WHERE status='ACTIVE') AS active_track_count,
			(SELECT COUNT(*) FROM music_playlists) AS playlist_count,
			(SELECT COUNT(DISTINCT media_file_id) FROM music_tracks) AS mapped_media_count,
			(SELECT COUNT(*) FROM media_files WHERE deleted=false AND file_type='AUDIO') AS available_audio_count,
			(SELECT COUNT(*) FROM music_tracks WHERE is_favorite=true) AS favorite_track_count,
			(SELECT COUNT(*) FROM music_playlists WHERE is_favorite=true) AS favorite_playlist_count,
			(SELECT COUNT(*) FROM music_lyrics) AS lyric_count,
			(SELECT COUNT(*) FROM music_lyrics WHERE status='READY') AS ready_lyric_count,
			(
				SELECT COUNT(*)
				FROM music_tracks track
				LEFT JOIN music_lyrics lyric ON lyric.track_id=track.id
				WHERE lyric.id IS NULL
				  AND NULLIF(BTRIM(track.lyric), '') IS NULL
			) AS missing_lyric_count,
			(
				SELECT COUNT(*)
				FROM music_tracks track
				LEFT JOIN media_variants variant
				  ON variant.media_file_id=track.media_file_id
				 AND variant.variant_type='THUMBNAIL'
				WHERE track.cover_media_file_id IS NULL
				  AND variant.file_url IS NULL
			) AS missing_cover_count,
			(
				SELECT COUNT(DISTINCT track.id)
				FROM music_tracks track
				JOIN media_file_tags file_tag ON file_tag.media_file_id=track.media_file_id
			) AS tagged_track_count`)
	return &counts, err
}

func (r *MusicRepo) CreateLyric(ctx context.Context, lyric model.MusicLyric) (int64, error) {
	var id int64
	err := r.db.QueryRowContext(ctx, `
		INSERT INTO music_lyrics (
			name, content, format, language, source_file_name,
			timing_offset_ms, status
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		RETURNING id`,
		lyric.Name,
		lyric.Content,
		lyric.Format,
		lyric.Language,
		lyric.SourceFileName,
		lyric.TimingOffsetMs,
		lyric.Status,
	).Scan(&id)
	return id, err
}

func (r *MusicRepo) FindLyricByID(ctx context.Context, id int64) (*MusicLyricRow, error) {
	var row MusicLyricRow
	err := r.db.GetContext(ctx, &row, `
		SELECT `+musicLyricSelect+`
		FROM music_lyrics l
		LEFT JOIN music_tracks t ON t.id=l.track_id
		WHERE l.id=$1`, id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &row, nil
}

func (r *MusicRepo) ListLyrics(ctx context.Context, filter MusicLyricFilter) ([]MusicLyricRow, int64, error) {
	pageNum, pageSize := normalizeMusicPage(filter.PageNum, filter.PageSize)
	var sb strings.Builder
	args := []any{}
	idx := 1

	sb.WriteString(`
		FROM music_lyrics l
		LEFT JOIN music_tracks t ON t.id=l.track_id
		WHERE 1=1`)
	if strings.TrimSpace(filter.Keyword) != "" {
		like := "%" + dbutil.EscapeLike(strings.TrimSpace(filter.Keyword)) + "%"
		sb.WriteString(fmt.Sprintf(`
			AND (
				l.name ILIKE $%d
				OR l.content ILIKE $%d
				OR COALESCE(l.source_file_name, '') ILIKE $%d
				OR COALESCE(t.title, '') ILIKE $%d
				OR COALESCE(t.artist, '') ILIKE $%d
			)`, idx, idx, idx, idx, idx))
		args = append(args, like)
		idx++
	}
	if strings.TrimSpace(filter.Status) != "" {
		sb.WriteString(fmt.Sprintf(" AND l.status=$%d", idx))
		args = append(args, strings.ToUpper(strings.TrimSpace(filter.Status)))
		idx++
	}
	if filter.Bound != nil {
		if *filter.Bound {
			sb.WriteString(" AND l.track_id IS NOT NULL")
		} else {
			sb.WriteString(" AND l.track_id IS NULL")
		}
	}
	if filter.TrackID != nil {
		sb.WriteString(fmt.Sprintf(" AND l.track_id=$%d", idx))
		args = append(args, *filter.TrackID)
		idx++
	}

	base := sb.String()
	var total int64
	if err := r.db.QueryRowContext(ctx, "SELECT COUNT(*) "+base, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	query := fmt.Sprintf(`
		SELECT `+musicLyricSelect+`
		%s
		ORDER BY
			CASE l.status WHEN 'NEEDS_REVIEW' THEN 0 WHEN 'DRAFT' THEN 1 ELSE 2 END,
			l.updated_at DESC,
			l.id DESC
		LIMIT $%d OFFSET $%d`, base, idx, idx+1)
	args = append(args, pageSize, (pageNum-1)*pageSize)

	var rows []MusicLyricRow
	if err := r.db.SelectContext(ctx, &rows, query, args...); err != nil {
		return nil, 0, err
	}
	return rows, total, nil
}

func (r *MusicRepo) UpdateLyric(ctx context.Context, id int64, lyric model.MusicLyric) error {
	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	result, err := tx.ExecContext(ctx, `
		UPDATE music_lyrics
		SET name=$1,
		    content=$2,
		    format=$3,
		    language=$4,
		    source_file_name=$5,
		    timing_offset_ms=$6,
		    status=$7,
		    updated_at=CURRENT_TIMESTAMP
		WHERE id=$8`,
		lyric.Name,
		lyric.Content,
		lyric.Format,
		lyric.Language,
		lyric.SourceFileName,
		lyric.TimingOffsetMs,
		lyric.Status,
		id,
	)
	if err != nil {
		return err
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return sql.ErrNoRows
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE music_tracks
		SET lyric=$1, updated_at=CURRENT_TIMESTAMP
		WHERE id=(SELECT track_id FROM music_lyrics WHERE id=$2)`,
		lyric.Content,
		id,
	); err != nil {
		return err
	}
	return tx.Commit()
}

func (r *MusicRepo) BindLyric(ctx context.Context, lyricID, trackID int64) error {
	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var previousTrackID sql.NullInt64
	if err := tx.QueryRowContext(ctx, `
		SELECT track_id
		FROM music_lyrics
		WHERE id=$1
		FOR UPDATE`,
		lyricID,
	).Scan(&previousTrackID); err != nil {
		return err
	}

	// Release the target track before assigning it to the requested lyric.
	// Doing both row changes in one UPDATE can violate PostgreSQL's immediate
	// unique constraint on music_lyrics.track_id, even though the final state is
	// unique. Sequential updates keep the move valid and transactional.
	if _, err := tx.ExecContext(ctx, `
		UPDATE music_lyrics
		SET track_id=NULL, updated_at=CURRENT_TIMESTAMP
		WHERE track_id=$1 AND id<>$2`,
		trackID,
		lyricID,
	); err != nil {
		return err
	}

	result, err := tx.ExecContext(ctx, `
		UPDATE music_lyrics
		SET track_id=$1, updated_at=CURRENT_TIMESTAMP
		WHERE id=$2`,
		trackID,
		lyricID,
	)
	if err != nil {
		return err
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return sql.ErrNoRows
	}

	var previousTrack any
	if previousTrackID.Valid {
		previousTrack = previousTrackID.Int64
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE music_tracks
		SET lyric=NULL, updated_at=CURRENT_TIMESTAMP
		WHERE id=$1 OR id=$2`,
		trackID,
		previousTrack,
	); err != nil {
		return err
	}

	result, err = tx.ExecContext(ctx, `
		UPDATE music_tracks
		SET lyric=(SELECT content FROM music_lyrics WHERE id=$1),
		    updated_at=CURRENT_TIMESTAMP
		WHERE id=$2`,
		lyricID,
		trackID,
	)
	if err != nil {
		return err
	}
	affected, _ = result.RowsAffected()
	if affected == 0 {
		return sql.ErrNoRows
	}
	return tx.Commit()
}

func (r *MusicRepo) UnbindLyric(ctx context.Context, lyricID int64) error {
	result, err := r.db.ExecContext(ctx, `
		WITH bound_track AS (
			SELECT track_id
			FROM music_lyrics
			WHERE id=$1
		),
		unbound AS (
			UPDATE music_lyrics
			SET track_id=NULL, updated_at=CURRENT_TIMESTAMP
			WHERE id=$1
			RETURNING id
		)
		UPDATE music_tracks
		SET lyric=NULL, updated_at=CURRENT_TIMESTAMP
		WHERE id=(SELECT track_id FROM bound_track)
		  AND EXISTS (SELECT 1 FROM unbound)`,
		lyricID,
	)
	if err != nil {
		return err
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		// An already-unbound lyric is still a successful idempotent operation.
		existing, findErr := r.FindLyricByID(ctx, lyricID)
		if findErr != nil {
			return findErr
		}
		if existing == nil {
			return sql.ErrNoRows
		}
	}
	return nil
}

func (r *MusicRepo) DeleteLyric(ctx context.Context, lyricID int64) error {
	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `
		UPDATE music_tracks
		SET lyric=NULL, updated_at=CURRENT_TIMESTAMP
		WHERE id=(SELECT track_id FROM music_lyrics WHERE id=$1)`,
		lyricID,
	); err != nil {
		return err
	}
	result, err := tx.ExecContext(ctx, `DELETE FROM music_lyrics WHERE id=$1`, lyricID)
	if err != nil {
		return err
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return sql.ErrNoRows
	}
	return tx.Commit()
}

func normalizeMusicPage(pageNum, pageSize int) (int, int) {
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
