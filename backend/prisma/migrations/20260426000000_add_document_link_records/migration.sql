-- Add invoiceNo to lrs table
ALTER TABLE "lrs" ADD COLUMN "invoiceNo" TEXT;

-- CreateTable for document_link_records
CREATE TABLE "document_link_records" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "lrId" TEXT NOT NULL,
    "matchedFields" TEXT NOT NULL,
    "confidence" REAL NOT NULL DEFAULT 0.5,
    "isManual" BOOLEAN NOT NULL DEFAULT false,
    "linkedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_link_records_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "document_link_records_lrId_fkey" FOREIGN KEY ("lrId") REFERENCES "lrs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "document_link_records_documentId_lrId_key" ON "document_link_records"("documentId", "lrId");
