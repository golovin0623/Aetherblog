-- Systematic music curation: independent lyric assets plus curator favorites.
-- Media tags remain the canonical tag system and continue to bind through
-- music_tracks.media_file_id -> media_file_tags.media_file_id.

CREATE TABLE IF NOT EXISTS music_lyrics (
    id BIGSERIAL PRIMARY KEY,
    track_id BIGINT UNIQUE REFERENCES music_tracks(id) ON DELETE SET NULL,
    name VARCHAR(180) NOT NULL,
    content TEXT NOT NULL,
    format VARCHAR(16) NOT NULL DEFAULT 'PLAIN',
    language VARCHAR(32) NOT NULL DEFAULT 'und',
    source_file_name VARCHAR(255),
    timing_offset_ms INT NOT NULL DEFAULT 0,
    status VARCHAR(24) NOT NULL DEFAULT 'DRAFT',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_music_lyrics_content CHECK (LENGTH(BTRIM(content)) > 0),
    CONSTRAINT chk_music_lyrics_format CHECK (format IN ('LRC', 'PLAIN')),
    CONSTRAINT chk_music_lyrics_status CHECK (status IN ('DRAFT', 'READY', 'NEEDS_REVIEW')),
    CONSTRAINT chk_music_lyrics_offset CHECK (timing_offset_ms BETWEEN -600000 AND 600000)
);

ALTER TABLE music_tracks
    ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE music_playlists
    ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_music_lyrics_status_updated
    ON music_lyrics(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_music_tracks_favorite
    ON music_tracks(is_favorite, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_music_playlists_favorite
    ON music_playlists(is_favorite, updated_at DESC);

-- Lift legacy inline lyrics into independently manageable assets. Keep the
-- denormalized music_tracks.lyric value during the compatibility window; all
-- new lyric writes synchronize both representations.
INSERT INTO music_lyrics (
    track_id,
    name,
    content,
    format,
    language,
    timing_offset_ms,
    status
)
SELECT
    id,
    title || ' 歌词',
    BTRIM(lyric),
    CASE
        WHEN lyric ~ '\[[0-9]{1,3}:[0-9]{1,2}([.:][0-9]{1,3})?\]' THEN 'LRC'
        ELSE 'PLAIN'
    END,
    'und',
    0,
    'READY'
FROM music_tracks
WHERE lyric IS NOT NULL
  AND LENGTH(BTRIM(lyric)) > 0
ON CONFLICT (track_id) DO NOTHING;
