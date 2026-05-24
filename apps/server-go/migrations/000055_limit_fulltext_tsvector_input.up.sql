-- PostgreSQL refuses to build tsvector values from very large strings
-- (SQLSTATE 54000). Keep complete Markdown content in the source tables, but
-- cap only the derived full-text-search documents used by GIN indexes.

DROP INDEX IF EXISTS idx_posts_fulltext;
DROP INDEX IF EXISTS idx_notes_fulltext;

CREATE INDEX IF NOT EXISTS idx_posts_fulltext
ON posts USING gin (to_tsvector('simple', left(title || ' ' || COALESCE(summary, '') || ' ' || COALESCE(content_markdown, ''), 200000)));

CREATE INDEX IF NOT EXISTS idx_notes_fulltext
ON notes USING gin (to_tsvector('simple', left(title || ' ' || COALESCE(summary, '') || ' ' || COALESCE(content_markdown, ''), 200000)));
