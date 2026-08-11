-- Weighment classification: separate custody point from bridge ownership
--
-- `DocumentType` conflated two independent facts:
--   POINT — weighed at ORIGIN (loading) or DESTINATION (unloading)?
--   OWNER — our bridge, the party's bridge, or a commercial one?
--
-- They coincide often enough to look like one thing, but a party can weigh at
-- the loading depot and a commercial bridge can be used at either end. POINT
-- drives the shortage arithmetic; OWNER only matters in a dispute. Conflating
-- them meant a misclassified slip silently INVERTED the variance.

-- ── 1. Columns ───────────────────────────────────────────────────────────────

ALTER TABLE "extracted_data"
  ADD COLUMN IF NOT EXISTS "challanNo"                TEXT,
  ADD COLUMN IF NOT EXISTS "bridgeName"               TEXT,
  ADD COLUMN IF NOT EXISTS "weighmentPoint"           TEXT,
  ADD COLUMN IF NOT EXISTS "weighmentOwner"           TEXT,
  ADD COLUMN IF NOT EXISTS "weighmentPointConfidence" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "grossWeightAtMs"          BIGINT,
  ADD COLUMN IF NOT EXISTS "tareWeightAtMs"           BIGINT,
  ADD COLUMN IF NOT EXISTS "grossWeightKg"            DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "tareWeightKg"             DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "netWeightKg"              DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "statedWeightDiffKg"       DOUBLE PRECISION;

-- ── 2. Seed weighmentPoint from the existing DocumentType ────────────────────
--
-- A starting point only, at the confidence the old signal deserves (0.5).
-- Re-running OCR extraction will overwrite these with timestamp-derived values
-- at 0.95. Deliberately does NOT set weighmentOwner: DocumentType never carried
-- ownership information, and inventing it would be worse than leaving it null.

UPDATE "extracted_data" e
   SET "weighmentPoint"           = 'DESTINATION',
       "weighmentPointConfidence" = 0.5
  FROM "documents" d
 WHERE d."id" = e."documentId"
   AND d."type" = 'WEIGHMENT_SITE'
   AND e."weighmentPoint" IS NULL;

UPDATE "extracted_data" e
   SET "weighmentPoint"           = 'ORIGIN',
       "weighmentPointConfidence" = 0.5
  FROM "documents" d
 WHERE d."id" = e."documentId"
   AND d."type" IN ('WEIGHMENT', 'WEIGHMENT_PARTY')
   AND e."weighmentPoint" IS NULL;

-- ── 3. Indexes ───────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS "extracted_data_challanNo_idx"
    ON "extracted_data" ("challanNo");

CREATE INDEX IF NOT EXISTS "extracted_data_weighmentPoint_idx"
    ON "extracted_data" ("weighmentPoint");

-- ── 4. Review queue for low-confidence classifications ───────────────────────
--
-- Everything seeded above sits at 0.5 and should be re-extracted. Anything
-- still below 0.7 after re-extraction needs a human to say which end of the
-- trip it was weighed at, because the alternative is an inverted shortage.

CREATE OR REPLACE VIEW v_weighment_needs_review AS
SELECT
    d."id"                          AS document_id,
    d."originalFilename",
    d."type"                        AS document_type,
    e."vehicleNo",
    e."date",
    e."bridgeName",
    e."weighmentPoint",
    e."weighmentOwner",
    e."weighmentPointConfidence",
    e."netWeightKg",
    e."statedWeightDiffKg"
FROM "documents" d
JOIN "extracted_data" e ON e."documentId" = d."id"
WHERE d."type" IN ('WEIGHMENT', 'WEIGHMENT_PARTY', 'WEIGHMENT_SITE')
  AND (e."weighmentPoint" IS NULL OR COALESCE(e."weighmentPointConfidence", 0) < 0.7);

-- ── 5. Shortage report ───────────────────────────────────────────────────────
--
-- The number that actually goes on a claim. Prefers the figure the party
-- printed on their own slip over one we derive.

CREATE OR REPLACE VIEW v_lr_shortages AS
SELECT
    l."id"                    AS lr_id,
    l."lrNo",
    l."vehicleNo",
    l."date",
    l."quantityInMt",
    l."originNetWeightKg",
    l."destinationNetWeightKg",
    l."originNetWeightKg" - l."destinationNetWeightKg" AS shortage_kg,
    l."weightVariancePct"
FROM "lrs" l
WHERE l."originNetWeightKg" IS NOT NULL
  AND l."destinationNetWeightKg" IS NOT NULL
  AND l."originNetWeightKg" > l."destinationNetWeightKg";
