DROP INDEX IF EXISTS idx_posts_fulltext;
DROP INDEX IF EXISTS idx_notes_fulltext;

-- Do not recreate the pre-000055 full-body tsvector indexes here. Rebuilding
-- them can fail on the same oversized posts or notes this migration protects
-- and would leave rollback stuck on index creation. Re-applying the up
-- migration restores the safe GIN indexes.
