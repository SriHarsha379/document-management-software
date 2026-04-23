-- CreateTable
CREATE TABLE "dispatch_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bundleId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "ccRecipient" TEXT,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "errorMsg" TEXT,
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "dispatch_logs_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "document_bundles" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
