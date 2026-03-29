ALTER TABLE posts
    ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS source_key VARCHAR(128),
    ADD COLUMN IF NOT EXISTS legacy_author_name VARCHAR(100),
    ADD COLUMN IF NOT EXISTS legacy_visited_count BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS legacy_copyright VARCHAR(255);

CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_source_key
    ON posts(source_key)
    WHERE source_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_posts_hidden_status
    ON posts(is_hidden, status, published_at DESC);
