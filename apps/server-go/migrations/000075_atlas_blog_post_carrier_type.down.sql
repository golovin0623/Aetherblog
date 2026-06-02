-- 000075 rollback: restore the pre-blog-post Atlas carrier type set.

ALTER TABLE atlas_carriers
    DROP CONSTRAINT IF EXISTS chk_atlas_carriers_type;

ALTER TABLE atlas_carriers
    DROP CONSTRAINT IF EXISTS atlas_carriers_type_check;

ALTER TABLE atlas_carriers
    ADD CONSTRAINT atlas_carriers_type_check
        CHECK (type IN ('pdf', 'epub', 'markdown', 'web', 'video', 'audio', 'image'));
