-- AddColumn: sourceDocumentId – links a page-Document back to the parent PDF Document
ALTER TABLE "documents" ADD COLUMN "sourceDocumentId" TEXT;

-- AddColumn: pageNumber – 1-based page index within the source PDF (null for non-page documents)
ALTER TABLE "documents" ADD COLUMN "pageNumber" INTEGER;

-- Foreign-key index for fast lookups of all pages of a source document
CREATE INDEX "documents_sourceDocumentId_idx" ON "documents"("sourceDocumentId");
