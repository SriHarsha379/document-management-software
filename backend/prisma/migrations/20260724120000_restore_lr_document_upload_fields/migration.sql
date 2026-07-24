-- Restore the direct LR-document association that the LR upload workflow uses.
CREATE TYPE "LrDocumentCategory" AS ENUM (
  'LR_GENERATED',
  'ACKNOWLEDGED_INVOICE',
  'ACKNOWLEDGED_LR_COPY',
  'DEPOT_PLANT_WEIGHMENT_SLIP',
  'SITE_WEIGHMENT_SLIP',
  'TOLL_RECEIPT',
  'ADDITIONAL_ATTACHMENT_1',
  'ADDITIONAL_ATTACHMENT_2'
);

ALTER TABLE "documents"
  ADD COLUMN "lrId" TEXT,
  ADD COLUMN "lrDocumentCategory" "LrDocumentCategory",
  ADD COLUMN "uploadedById" TEXT;

ALTER TABLE "parties"
  ADD COLUMN "isBillToParty" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "isShipToParty" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX "documents_lrId_idx" ON "documents"("lrId");
CREATE INDEX "documents_lrDocumentCategory_idx" ON "documents"("lrDocumentCategory");
CREATE INDEX "documents_uploadedById_idx" ON "documents"("uploadedById");

ALTER TABLE "documents"
  ADD CONSTRAINT "documents_lrId_fkey"
  FOREIGN KEY ("lrId") REFERENCES "lrs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "documents"
  ADD CONSTRAINT "documents_uploadedById_fkey"
  FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
