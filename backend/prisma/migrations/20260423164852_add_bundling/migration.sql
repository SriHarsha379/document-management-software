-- CreateTable
CREATE TABLE "document_bundles" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recipientType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "groupId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "document_bundles_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "document_groups" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "bundle_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bundleId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "isOverride" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "bundle_items_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "document_bundles" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "bundle_items_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "bundle_items_bundleId_documentId_key" ON "bundle_items"("bundleId", "documentId");
