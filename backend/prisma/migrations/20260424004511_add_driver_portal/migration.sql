-- CreateTable
CREATE TABLE "temporary_driver_accesses" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "phone" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "lastLoginAt" DATETIME,
    "isRevoked" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "driver_upload_documents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "docType" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'PENDING_OCR',
    "ocrText" TEXT,
    "ocrData" TEXT,
    "vehicleNumber" TEXT,
    "documentDate" TEXT,
    "linkedGroupId" TEXT,
    "tempDriverAccessId" TEXT NOT NULL,
    CONSTRAINT "driver_upload_documents_linkedGroupId_fkey" FOREIGN KEY ("linkedGroupId") REFERENCES "document_groups" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "driver_upload_documents_tempDriverAccessId_fkey" FOREIGN KEY ("tempDriverAccessId") REFERENCES "temporary_driver_accesses" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "temporary_driver_accesses_phone_key" ON "temporary_driver_accesses"("phone");
