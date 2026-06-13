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
	PageNum    int
	PageSize   int
	PublicOnly bool
}

type MusicPlaylistFilter struct {
	Status     string
	Visibility string
	PageNum    int
	PageSize   int
	PublicOnly bool
}

type MusicScanFilter struct {
	FolderID      *int64
	Keyword       string
	IncludeMapped bool
	PageNum       int
	PageSize      int
}

type MusicTrackRow struct {
	ID                int64      `db:"id"`
	MediaFileID       int64      `db:"media_file_id"`
	Title             string     `db:"title"`
	Artist            string     `db:"artist"`
	Album             string     `db:"album"`
	DurationSeconds   *int       `db:"duration_seconds"`
	CoverMediaFileID  *int64     `db:"cover_media_file_id"`
	Lyric             *string    `db:"lyric"`
	Source            string     `db:"source"`
	Status            string     `db:"status"`
	SortOrder         int        `db:"sort_order"`
	IsFeatured        bool       `db:"is_featured"`
	PlayCount         int64      `db:"play_count"`
	CreatedAt         *time.Time `db:"created_at"`
	UpdatedAt         *time.Time `db:"updated_at"`
	MediaOriginalName string     `db:"media_original_name"`
	MediaFileURL      string     `db:"media_file_url"`
	MediaFileSize     int64      `db:"media_file_size"`
	MediaMimeType     *string    `db:"media_mime_type"`
	MediaFileType     string     `db:"media_file_type"`
	MediaFolderID     *int64     `db:"media_folder_id"`
	MediaDeleted      bool       `db:"media_deleted"`
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
	MappedTrackID *int64  `db:"mapped_track_id"`
	MappedTitle   *string `db:"mapped_title"`
}

type MusicSummaryCounts struct {
	TrackCount          int64 `db:"track_count"`
	ActiveTrackCount    int64 `db:"active_track_count"`
	PlaylistCount       int64 `db:"playlist_count"`
	MappedMediaCount    int64 `db:"mapped_media_count"`
	AvailableAudioCount int64 `db:"available_audio_count"`
}

const musicTrackSelect = `
	t.id, t.media_file_id, t.title, t.artist, t.album, t.duration_seconds,
	t.cover_media_file_id, t.lyric, t.source, t.status, t.sort_order, t.is_featured,
	t.play_count, t.created_at, t.updated_at,
	mf.original_name AS media_original_name,
	mf.file_url AS media_file_url,
	mf.file_size AS media_file_size,
	mf.mime_type AS media_mime_type,
	mf.file_type AS media_file_type,
	mf.folder_id AS media_folder_id,
	mf.deleted AS media_deleted`

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
			media_folder_id, playback_mode, carousel_enabled, carousel_interval_seconds, random_enabled, updated_at
		)
		VALUES (1,$1,$2,$3,$4,$5,$6,$7,$8,$9,CURRENT_TIMESTAMP)
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
			updated_at=CURRENT_TIMESTAMP`,
		s.Enabled, s.ShowOnHomePage, s.ShowOnProfileCard, s.FeaturedPlaylistID, s.MediaFolderID,
		s.PlaybackMode, s.CarouselEnabled, s.CarouselIntervalSeconds, s.RandomEnabled,
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
			mf.folder_id, mf.deleted, mt.id AS mapped_track_id, mt.title AS mapped_title
		FROM media_files mf
		LEFT JOIN music_tracks mt ON mt.media_file_id = mf.id
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
			mf.folder_id, mf.deleted, mt.id AS mapped_track_id, mt.title AS mapped_title
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
		    lyric=$6, status=$7, sort_order=$8, is_featured=$9, updated_at=CURRENT_TIMESTAMP
		WHERE id=$10`,
		t.Title, t.Artist, t.Album, t.DurationSeconds, t.CoverMediaFileID,
		t.Lyric, t.Status, t.SortOrder, t.IsFeatured, id)
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
		JOIN media_files mf ON mf.id=t.media_file_id`)
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
	base := sb.String()

	var total int64
	if err := r.db.QueryRowContext(ctx, "SELECT COUNT(DISTINCT p.id) "+base, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	query := fmt.Sprintf(`
		SELECT p.id, p.name, p.slug, p.description, p.cover_media_file_id, p.visibility, p.status,
		       p.display_on_home, p.display_on_profile, p.carousel_enabled, p.random_enabled,
		       p.sort_order, p.created_at, p.updated_at, COUNT(pt.track_id) AS track_count
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
		       p.sort_order, p.created_at, p.updated_at, COUNT(pt.track_id) AS track_count
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
	rows, _, err := r.ListPlaylists(ctx, MusicPlaylistFilter{PublicOnly: true, PageNum: 1, PageSize: 1})
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return &rows[0], nil
}

func (r *MusicRepo) CreatePlaylist(ctx context.Context, p model.MusicPlaylist) (int64, error) {
	var id int64
	err := r.db.QueryRowContext(ctx, `
		INSERT INTO music_playlists (
			name, slug, description, cover_media_file_id, visibility, status,
			display_on_home, display_on_profile, carousel_enabled, random_enabled, sort_order
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		RETURNING id`,
		p.Name, p.Slug, p.Description, p.CoverMediaFileID, p.Visibility, p.Status,
		p.DisplayOnHome, p.DisplayOnProfile, p.CarouselEnabled, p.RandomEnabled, p.SortOrder,
	).Scan(&id)
	return id, err
}

func (r *MusicRepo) UpdatePlaylist(ctx context.Context, id int64, p model.MusicPlaylist) error {
	res, err := r.db.ExecContext(ctx, `
		UPDATE music_playlists
		SET name=$1, description=$2, cover_media_file_id=$3, visibility=$4, status=$5,
		    display_on_home=$6, display_on_profile=$7, carousel_enabled=$8,
		    random_enabled=$9, sort_order=$10, updated_at=CURRENT_TIMESTAMP
		WHERE id=$11`,
		p.Name, p.Description, p.CoverMediaFileID, p.Visibility, p.Status,
		p.DisplayOnHome, p.DisplayOnProfile, p.CarouselEnabled, p.RandomEnabled, p.SortOrder, id)
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
			(SELECT COUNT(*) FROM media_files WHERE deleted=false AND file_type='AUDIO') AS available_audio_count`)
	return &counts, err
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
