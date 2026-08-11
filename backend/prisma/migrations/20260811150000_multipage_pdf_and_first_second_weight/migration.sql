-- Multi-page PDF ingestion + First/Second weighbridge reading labels
--
-- Two additions, both driven by real bundles that the pipeline silently
-- mishandled.
--
-- 1. `documents.pageNumber` and `documents.sourceDocumentId` already existed
--    but were never populated from a PDF, because the rasteriser only ever
--    converted page 1 (`pdftoppm -f 1 -l 1`). A 4-page trip bundle ingested
--    the tax invoice and discarded the lorry receipt, both weighbridge tickets
--    and both toll swipes, with no error. No schema change is needed for the
--    fix — only an index, so the pages of one upload can be fetched together.
--
-- 2. Weighbridges use two incompatible labelling conventions. Some print
--    "Gross weight" / "Tare weight"; others (PROCON RMC) print "First Weight" /
--    "Second Weight" and never say gross or tare at all. The ORDER of the
--    first/second pair is what identifies origin vs destination, so the two
--    conventions must be stored separately rather than mapped onto each other.

-- ── 1. First/Second reading columns ──────────────────────────────────────────

ALTER TABLE "extracted_data"
  ADD COLUMN IF NOT EXISTS "firstWeightKg"   DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "secondWeightKg"  DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "firstWeightAtMs"  BIGINT,
  ADD COLUMN IF NOT EXISTS "secondWeightAtMs" BIGINT;

-- ── 2. Index for retrieving all pages of one upload ──────────────────────────

CREATE INDEX IF NOT EXISTS "documents_sourceDocumentId_idx"
    ON "documents" ("sourceDocumentId");

-- ── 3. Report: uploads that lost pages under the old rasteriser ──────────────
--
-- Any PDF ingested before this fix produced exactly one Document, regardless of
-- how many pages it had. The page count isn't recorded, so this can't identify
-- them with certainty — but a PDF upload whose Document has no siblings and no
-- pageNumber is the signature, and re-running OCR on those files is cheap
-- relative to the paperwork they may be missing.
--
--   SELECT * FROM v_pdf_uploads_needing_reocr ORDER BY "uploadedAt" DESC;

CREATE OR REPLACE VIEW v_pdf_uploads_needing_reocr AS
SELECT
    d."id"               AS document_id,
    d."originalFilename",
    d."rawFilePath",
    d."type"             AS document_type,
    d."uploadedAt",
    d."groupId"
FROM "documents" d
WHERE d."mimeType" = 'application/pdf'
  AND d."pageNumber" IS NULL
  AND d."sourceDocumentId" IS NULL
  AND NOT EXISTS (
        SELECT 1 FROM "documents" s WHERE s."sourceDocumentId" = d."id"
      );
