-- Add transporter field to extracted_data
ALTER TABLE "extracted_data" ADD COLUMN "transporter" TEXT;

-- Performance indexes on extracted_data
CREATE INDEX IF NOT EXISTS "extracted_data_vehicleNo_idx"   ON "extracted_data"("vehicleNo");
CREATE INDEX IF NOT EXISTS "extracted_data_lrNo_idx"        ON "extracted_data"("lrNo");
CREATE INDEX IF NOT EXISTS "extracted_data_invoiceNo_idx"   ON "extracted_data"("invoiceNo");
CREATE INDEX IF NOT EXISTS "extracted_data_date_idx"        ON "extracted_data"("date");
CREATE INDEX IF NOT EXISTS "extracted_data_transporter_idx" ON "extracted_data"("transporter");

-- Performance indexes on documents
CREATE INDEX IF NOT EXISTS "documents_type_idx"       ON "documents"("type");
CREATE INDEX IF NOT EXISTS "documents_status_idx"     ON "documents"("status");
CREATE INDEX IF NOT EXISTS "documents_uploadedAt_idx" ON "documents"("uploadedAt");

-- Performance indexes on lrs
CREATE INDEX IF NOT EXISTS "lrs_companyId_idx" ON "lrs"("companyId");
CREATE INDEX IF NOT EXISTS "lrs_lrNo_idx"      ON "lrs"("lrNo");
CREATE INDEX IF NOT EXISTS "lrs_vehicleNo_idx" ON "lrs"("vehicleNo");
CREATE INDEX IF NOT EXISTS "lrs_date_idx"      ON "lrs"("date");

-- SavedFilter table
CREATE TABLE "saved_filters" (
    "id"        TEXT     NOT NULL PRIMARY KEY,
    "userId"    TEXT     NOT NULL,
    "name"      TEXT     NOT NULL,
    "filters"   TEXT     NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE INDEX IF NOT EXISTS "saved_filters_userId_idx" ON "saved_filters"("userId");
