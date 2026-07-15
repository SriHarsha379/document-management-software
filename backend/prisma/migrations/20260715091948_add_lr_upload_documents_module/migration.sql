-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_documents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    "originalFilename" TEXT NOT NULL,
    "rawFilePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "groupId" TEXT,
    "lrId" TEXT,
    "lrDocumentCategory" TEXT,
    "uploadedById" TEXT,
    "sourceDocumentId" TEXT,
    "pageNumber" INTEGER,
    CONSTRAINT "documents_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "document_groups" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "documents_lrId_fkey" FOREIGN KEY ("lrId") REFERENCES "lrs" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "documents_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_documents" ("groupId", "id", "mimeType", "originalFilename", "pageNumber", "rawFilePath", "sourceDocumentId", "status", "type", "updatedAt", "uploadedAt") SELECT "groupId", "id", "mimeType", "originalFilename", "pageNumber", "rawFilePath", "sourceDocumentId", "status", "type", "updatedAt", "uploadedAt" FROM "documents";
DROP TABLE "documents";
ALTER TABLE "new_documents" RENAME TO "documents";
CREATE INDEX "documents_type_idx" ON "documents"("type");
CREATE INDEX "documents_status_idx" ON "documents"("status");
CREATE INDEX "documents_uploadedAt_idx" ON "documents"("uploadedAt");
CREATE INDEX "documents_sourceDocumentId_idx" ON "documents"("sourceDocumentId");
CREATE INDEX "documents_lrId_idx" ON "documents"("lrId");
CREATE INDEX "documents_lrDocumentCategory_idx" ON "documents"("lrDocumentCategory");
CREATE INDEX "documents_uploadedById_idx" ON "documents"("uploadedById");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
