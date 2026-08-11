-- Vehicle canonicalisation + duplicate-group repair
--
-- Adds a lossy, OCR-confusion-tolerant matching key alongside the raw vehicle
-- number on both `lrs` and `document_groups`, backfills it for existing rows,
-- and reports (without destroying) the duplicate groups the old grouping logic
-- created.
--
-- The canonical form folds the character pairs that dot-matrix and thermal
-- printed plates actually confuse: O/0/Q, I/1/L, B/8, S/5, Z/2, G/6. It is a
-- MATCHING key only and must never be displayed or written back over the raw
-- value — "MH47AS3999" and "MH47A53999" both canonicalise to "MH47A53999" and
-- the original cannot be recovered.

-- ── 1. Columns ───────────────────────────────────────────────────────────────

ALTER TABLE "lrs"             ADD COLUMN IF NOT EXISTS "vehicleNoCanonical" TEXT;
ALTER TABLE "document_groups" ADD COLUMN IF NOT EXISTS "vehicleNoCanonical" TEXT;

-- ── 2. Canonicalisation function ─────────────────────────────────────────────
--
-- Kept as a SQL function so the backfill here and any future data-repair job
-- stay bit-identical with the TypeScript implementation in
-- src/services/vehicleNormalization.ts. If you change one, change both.

CREATE OR REPLACE FUNCTION canonical_vehicle_no(input TEXT)
RETURNS TEXT AS $$
BEGIN
  IF input IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN translate(
    regexp_replace(upper(trim(input)), '[^A-Z0-9]', '', 'g'),
    'OQILBSZG',
    '01185526'
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ── 3. Backfill ──────────────────────────────────────────────────────────────

UPDATE "lrs"
   SET "vehicleNoCanonical" = canonical_vehicle_no("vehicleNo")
 WHERE "vehicleNo" IS NOT NULL
   AND "vehicleNoCanonical" IS NULL;

UPDATE "document_groups"
   SET "vehicleNoCanonical" = canonical_vehicle_no("vehicleNo")
 WHERE "vehicleNoCanonical" IS NULL;

-- ── 4. Indexes ───────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS "lrs_vehicleNoCanonical_idx"
    ON "lrs" ("vehicleNoCanonical");

CREATE INDEX IF NOT EXISTS "document_groups_vehicleNoCanonical_idx"
    ON "document_groups" ("vehicleNoCanonical");

-- ── 5. Duplicate-group report ────────────────────────────────────────────────
--
-- A view, not a DELETE. Merging groups moves documents between buckets and can
-- invalidate an already-dispatched DocumentBundle, so it is done in application
-- code (groupMergeService.mergeAllSplitGroups) where it runs inside a
-- transaction and is logged — not silently inside a migration.
--
-- Query this after migrating to see the damage:
--   SELECT * FROM v_split_lr_groups ORDER BY group_count DESC;

CREATE OR REPLACE VIEW v_split_lr_groups AS
SELECT
    l."id"                              AS lr_id,
    l."lrNo"                            AS lr_no,
    l."vehicleNo"                       AS vehicle_no,
    count(DISTINCT d."groupId")         AS group_count,
    array_agg(DISTINCT d."groupId")     AS group_ids
FROM "lrs" l
JOIN "document_link_records" dlr ON dlr."lrId"  = l."id"
JOIN "documents"             d   ON d."id"      = dlr."documentId"
WHERE d."groupId" IS NOT NULL
GROUP BY l."id", l."lrNo", l."vehicleNo"
HAVING count(DISTINCT d."groupId") > 1;
