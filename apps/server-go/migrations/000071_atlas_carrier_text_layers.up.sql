-- 000071: Persist extracted Atlas carrier text layers.
--
-- PDF carriers need a stable rootText backing storage_uri instead of keeping
-- extracted text in atlas_carriers.metadata. The text layer is keyed by
-- carrier + content_hash so carrier_versions.storage_uri can point to an
-- immutable extraction artifact.

CREATE TABLE IF NOT EXISTS atlas_carrier_text_layers (
    id BIGSERIAL PRIMARY KEY,
    carrier_id BIGINT NOT NULL REFERENCES atlas_carriers(id) ON DELETE CASCADE,
    content_hash CHAR(64) NOT NULL,
    storage_uri TEXT NOT NULL,
    page_count INT NOT NULL DEFAULT 0,
    char_count INT NOT NULL DEFAULT 0,
    text_content TEXT NOT NULL DEFAULT '',
    pages JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_atlas_carrier_text_layer_hash UNIQUE (carrier_id, content_hash),
    CONSTRAINT uq_atlas_carrier_text_layer_uri UNIQUE (storage_uri),
    CONSTRAINT chk_atlas_carrier_text_layer_hash_len CHECK (length(content_hash) = 64),
    CONSTRAINT chk_atlas_carrier_text_layer_counts CHECK (page_count >= 0 AND char_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_atlas_carrier_text_layers_carrier
    ON atlas_carrier_text_layers(carrier_id, created_at DESC);

COMMENT ON TABLE atlas_carrier_text_layers IS
    'Atlas extracted rootText artifacts for PDF and future non-markdown carriers. carrier_versions.storage_uri points to storage_uri.';
