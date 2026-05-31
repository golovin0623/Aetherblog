-- 000075: allow blog_post Atlas carriers created from posts://{id}.
--
-- PR #745 added the service/UI path for blog_post carriers. The base Atlas
-- migration predated that carrier type, so real inserts would still fail on
-- the atlas_carriers.type CHECK constraint without this schema patch.

ALTER TABLE atlas_carriers
    DROP CONSTRAINT IF EXISTS atlas_carriers_type_check;

ALTER TABLE atlas_carriers
    DROP CONSTRAINT IF EXISTS chk_atlas_carriers_type;

ALTER TABLE atlas_carriers
    ADD CONSTRAINT chk_atlas_carriers_type
        CHECK (type IN ('pdf', 'epub', 'markdown', 'blog_post', 'web', 'video', 'audio', 'image'));
