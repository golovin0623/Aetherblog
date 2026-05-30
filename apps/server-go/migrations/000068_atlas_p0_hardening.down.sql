-- rollback 000068: restore the previous global source_uri uniqueness and remove
-- the P0 hardening additions.

DROP INDEX IF EXISTS idx_atlas_anno_carrier_version;

ALTER TABLE atlas_ai_suggestions
    DROP CONSTRAINT IF EXISTS chk_atlas_sug_proposed_kp_type;

DROP INDEX IF EXISTS uq_atlas_ai_suggestions_pending_fingerprint;

ALTER TABLE atlas_ai_suggestions
    DROP COLUMN IF EXISTS fingerprint;

DROP INDEX IF EXISTS uq_atlas_carriers_owner_source_uri_live;

ALTER TABLE atlas_carriers
    ADD CONSTRAINT uq_atlas_carriers_source_uri UNIQUE (source_uri);
