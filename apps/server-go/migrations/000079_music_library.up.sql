-- Music library and playlist management.
-- Media files remain the storage/catalog layer; music_* tables store only
-- playback, playlist, ordering, and presentation metadata.

CREATE TABLE IF NOT EXISTS music_tracks (
    id BIGSERIAL PRIMARY KEY,
    media_file_id BIGINT NOT NULL UNIQUE REFERENCES media_files(id) ON DELETE CASCADE,
    title VARCHAR(160) NOT NULL,
    artist VARCHAR(120) NOT NULL DEFAULT '',
    album VARCHAR(120) NOT NULL DEFAULT '',
    duration_seconds INT,
    cover_media_file_id BIGINT REFERENCES media_files(id) ON DELETE SET NULL,
    lyric TEXT,
    source VARCHAR(24) NOT NULL DEFAULT 'MEDIA_LIBRARY',
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    sort_order INT NOT NULL DEFAULT 0,
    is_featured BOOLEAN NOT NULL DEFAULT FALSE,
    play_count BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_music_tracks_duration CHECK (duration_seconds IS NULL OR duration_seconds > 0),
    CONSTRAINT chk_music_tracks_source CHECK (source IN ('MEDIA_LIBRARY', 'UPLOAD', 'MANUAL')),
    CONSTRAINT chk_music_tracks_status CHECK (status IN ('ACTIVE', 'HIDDEN'))
);

CREATE TABLE IF NOT EXISTS music_playlists (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    slug VARCHAR(140) NOT NULL UNIQUE,
    description TEXT,
    cover_media_file_id BIGINT REFERENCES media_files(id) ON DELETE SET NULL,
    visibility VARCHAR(20) NOT NULL DEFAULT 'PUBLIC',
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    display_on_home BOOLEAN NOT NULL DEFAULT TRUE,
    display_on_profile BOOLEAN NOT NULL DEFAULT TRUE,
    carousel_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    random_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_music_playlists_visibility CHECK (visibility IN ('PRIVATE', 'PUBLIC')),
    CONSTRAINT chk_music_playlists_status CHECK (status IN ('ACTIVE', 'HIDDEN'))
);

CREATE TABLE IF NOT EXISTS music_playlist_tracks (
    playlist_id BIGINT NOT NULL REFERENCES music_playlists(id) ON DELETE CASCADE,
    track_id BIGINT NOT NULL REFERENCES music_tracks(id) ON DELETE CASCADE,
    sort_order INT NOT NULL DEFAULT 0,
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (playlist_id, track_id)
);

CREATE TABLE IF NOT EXISTS music_settings (
    id SMALLINT PRIMARY KEY DEFAULT 1,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    show_on_home_page BOOLEAN NOT NULL DEFAULT TRUE,
    show_on_profile_card BOOLEAN NOT NULL DEFAULT TRUE,
    featured_playlist_id BIGINT REFERENCES music_playlists(id) ON DELETE SET NULL,
    media_folder_id BIGINT REFERENCES media_folders(id) ON DELETE SET NULL,
    playback_mode VARCHAR(20) NOT NULL DEFAULT 'SEQUENTIAL',
    carousel_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    carousel_interval_seconds INT NOT NULL DEFAULT 8,
    random_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_music_settings_singleton CHECK (id = 1),
    CONSTRAINT chk_music_settings_playback_mode CHECK (playback_mode IN ('SEQUENTIAL', 'SHUFFLE', 'LOOP', 'CAROUSEL')),
    CONSTRAINT chk_music_settings_carousel_interval CHECK (carousel_interval_seconds BETWEEN 3 AND 60)
);

CREATE INDEX IF NOT EXISTS idx_music_tracks_status_sort ON music_tracks(status, sort_order, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_music_tracks_media_file ON music_tracks(media_file_id);
CREATE INDEX IF NOT EXISTS idx_music_tracks_cover_media ON music_tracks(cover_media_file_id);
CREATE INDEX IF NOT EXISTS idx_music_playlists_status_sort ON music_playlists(status, sort_order, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_music_playlist_tracks_track ON music_playlist_tracks(track_id);
CREATE INDEX IF NOT EXISTS idx_music_playlist_tracks_order ON music_playlist_tracks(playlist_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_music_settings_featured_playlist ON music_settings(featured_playlist_id);
CREATE INDEX IF NOT EXISTS idx_music_settings_media_folder ON music_settings(media_folder_id);

INSERT INTO music_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;
