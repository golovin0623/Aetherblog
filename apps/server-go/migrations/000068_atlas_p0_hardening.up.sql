-- 000068: Atlas P0 hardening
--
-- Covers:
--   * source_uri uniqueness aligned with per-owner carrier semantics
--   * AI suggestion fingerprint for ignored/pending de-duplication
--   * proposed_kp_type integrity at write time
--   * carrier_version lookup index for re-anchor/version migration

ALTER TABLE atlas_carriers
    DROP CONSTRAINT IF EXISTS uq_atlas_carriers_source_uri;

CREATE UNIQUE INDEX IF NOT EXISTS uq_atlas_carriers_owner_source_uri_live
    ON atlas_carriers ((COALESCE(owner_id, 0)), source_uri)
    WHERE deleted = false;

ALTER TABLE atlas_ai_suggestions
    ADD COLUMN IF NOT EXISTS fingerprint VARCHAR(128);

CREATE UNIQUE INDEX IF NOT EXISTS uq_atlas_ai_suggestions_pending_fingerprint
    ON atlas_ai_suggestions ((COALESCE(author_id, 0)), fingerprint)
    WHERE status = 'pending' AND fingerprint IS NOT NULL;

ALTER TABLE atlas_ai_suggestions
    ADD CONSTRAINT chk_atlas_sug_proposed_kp_type
    CHECK (
        proposed_kp_type IS NULL OR
        proposed_kp_type IN ('claim', 'concept', 'question', 'definition', 'method', 'example', 'person', 'source')
    ) NOT VALID;

CREATE INDEX IF NOT EXISTS idx_atlas_anno_carrier_version
    ON atlas_annotations(carrier_version_id)
    WHERE deleted = false AND carrier_version_id IS NOT NULL;
