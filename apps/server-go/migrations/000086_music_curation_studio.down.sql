UPDATE music_tracks AS track
SET lyric = lyric.content
FROM music_lyrics AS lyric
WHERE lyric.track_id = track.id;

DROP INDEX IF EXISTS idx_music_playlists_favorite;
DROP INDEX IF EXISTS idx_music_tracks_favorite;
DROP INDEX IF EXISTS idx_music_lyrics_status_updated;

ALTER TABLE music_playlists DROP COLUMN IF EXISTS is_favorite;
ALTER TABLE music_tracks DROP COLUMN IF EXISTS is_favorite;

DROP TABLE IF EXISTS music_lyrics;
