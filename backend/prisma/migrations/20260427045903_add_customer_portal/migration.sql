/*
  Warnings:

  - You are about to alter the column `isActive` on the `officers` table. The data in that column could be lost. The data in that column will be cast from `Int` to `Boolean`.
  - You are about to alter the column `isActive` on the `parties` table. The data in that column could be lost. The data in that column will be cast from `Int` to `Boolean`.
  - You are about to alter the column `isActive` on the `products` table. The data in that column could be lost. The data in that column will be cast from `Int` to `Boolean`.
  - You are about to alter the column `isActive` on the `transporters` table. The data in that column could be lost. The data in that column will be cast from `Int` to `Boolean`.
  - You are about to alter the column `isActive` on the `working_centres` table. The data in that column could be lost. The data in that column will be cast from `Int` to `Boolean`.

*/
-- CreateTable
CREATE TABLE "customer_portal_accesses" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "partyId" TEXT NOT NULL,
    "loginEmail" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "lastLoginAt" DATETIME,
    "isRevoked" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "customer_portal_accesses_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "parties" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_officers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "role" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "companyId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "officers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_officers" ("companyId", "createdAt", "email", "id", "isActive", "name", "phone", "role", "updatedAt") SELECT "companyId", "createdAt", "email", "id", "isActive", "name", "phone", "role", "updatedAt" FROM "officers";
DROP TABLE "officers";
ALTER TABLE "new_officers" RENAME TO "officers";
CREATE INDEX "officers_companyId_idx" ON "officers"("companyId");
CREATE INDEX "officers_isActive_idx" ON "officers"("isActive");
CREATE TABLE "new_parties" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactPerson" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "gstNo" TEXT,
    "address" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "companyId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "parties_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_parties" ("address", "code", "companyId", "contactPerson", "createdAt", "email", "gstNo", "id", "isActive", "name", "phone", "updatedAt") SELECT "address", "code", "companyId", "contactPerson", "createdAt", "email", "gstNo", "id", "isActive", "name", "phone", "updatedAt" FROM "parties";
DROP TABLE "parties";
ALTER TABLE "new_parties" RENAME TO "parties";
CREATE INDEX "parties_companyId_idx" ON "parties"("companyId");
CREATE INDEX "parties_isActive_idx" ON "parties"("isActive");
CREATE UNIQUE INDEX "parties_companyId_code_key" ON "parties"("companyId", "code");
CREATE TABLE "new_products" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "category" TEXT,
    "unit" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "companyId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "products_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_products" ("brand", "category", "companyId", "createdAt", "id", "isActive", "name", "unit", "updatedAt") SELECT "brand", "category", "companyId", "createdAt", "id", "isActive", "name", "unit", "updatedAt" FROM "products";
DROP TABLE "products";
ALTER TABLE "new_products" RENAME TO "products";
CREATE INDEX "products_companyId_idx" ON "products"("companyId");
CREATE INDEX "products_category_idx" ON "products"("category");
CREATE INDEX "products_isActive_idx" ON "products"("isActive");
CREATE UNIQUE INDEX "products_companyId_name_brand_key" ON "products"("companyId", "name", "brand");
CREATE TABLE "new_transporters" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "companyId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "transporters_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_transporters" ("address", "code", "companyId", "contactName", "createdAt", "email", "id", "isActive", "name", "phone", "updatedAt") SELECT "address", "code", "companyId", "contactName", "createdAt", "email", "id", "isActive", "name", "phone", "updatedAt" FROM "transporters";
DROP TABLE "transporters";
ALTER TABLE "new_transporters" RENAME TO "transporters";
CREATE INDEX "transporters_companyId_idx" ON "transporters"("companyId");
CREATE INDEX "transporters_isActive_idx" ON "transporters"("isActive");
CREATE UNIQUE INDEX "transporters_companyId_code_key" ON "transporters"("companyId", "code");
CREATE TABLE "new_working_centres" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "branchId" TEXT,
    "companyId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "working_centres_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "working_centres_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_working_centres" ("address", "branchId", "code", "companyId", "createdAt", "id", "isActive", "name", "updatedAt") SELECT "address", "branchId", "code", "companyId", "createdAt", "id", "isActive", "name", "updatedAt" FROM "working_centres";
DROP TABLE "working_centres";
ALTER TABLE "new_working_centres" RENAME TO "working_centres";
CREATE INDEX "working_centres_companyId_idx" ON "working_centres"("companyId");
CREATE INDEX "working_centres_branchId_idx" ON "working_centres"("branchId");
CREATE INDEX "working_centres_isActive_idx" ON "working_centres"("isActive");
CREATE UNIQUE INDEX "working_centres_companyId_code_key" ON "working_centres"("companyId", "code");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "customer_portal_accesses_loginEmail_key" ON "customer_portal_accesses"("loginEmail");
