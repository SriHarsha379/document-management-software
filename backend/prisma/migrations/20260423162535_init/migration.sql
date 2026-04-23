-- CreateTable
CREATE TABLE "document_groups" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vehicleNo" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    "originalFilename" TEXT NOT NULL,
    "rawFilePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "groupId" TEXT,
    CONSTRAINT "documents_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "document_groups" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "extracted_data" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "lrNo" TEXT,
    "invoiceNo" TEXT,
    "vehicleNo" TEXT,
    "quantity" TEXT,
    "date" TEXT,
    "partyNames" TEXT,
    "tollAmount" TEXT,
    "weightInfo" TEXT,
    "rawOcrResponse" TEXT NOT NULL,
    "confidence" REAL,
    "ocrProcessedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userReviewed" BOOLEAN NOT NULL DEFAULT false,
    "reviewedAt" DATETIME,
    "userEdits" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "extracted_data_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "document_groups_vehicleNo_date_key" ON "document_groups"("vehicleNo", "date");

-- CreateIndex
CREATE UNIQUE INDEX "extracted_data_documentId_key" ON "extracted_data"("documentId");
