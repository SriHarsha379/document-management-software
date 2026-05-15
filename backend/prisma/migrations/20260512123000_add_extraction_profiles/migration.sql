CREATE TABLE "extraction_profiles" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileKey" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "principalCompany" TEXT,
    "branchName" TEXT,
    "transporterName" TEXT,
    "profileData" TEXT NOT NULL,
    "samplesCount" INTEGER NOT NULL DEFAULT 1,
    "successfulSaves" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "lastUsedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "extraction_profiles_documentType_idx" ON "extraction_profiles"("documentType");
CREATE INDEX "extraction_profiles_principalCompany_idx" ON "extraction_profiles"("principalCompany");
CREATE INDEX "extraction_profiles_branchName_idx" ON "extraction_profiles"("branchName");
CREATE INDEX "extraction_profiles_transporterName_idx" ON "extraction_profiles"("transporterName");
CREATE UNIQUE INDEX "extraction_profiles_profileKey_key" ON "extraction_profiles"("profileKey");
