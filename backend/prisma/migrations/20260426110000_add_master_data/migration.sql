-- ── Master Data Tables ───────────────────────────────────────────────────────

CREATE TABLE "transporters" (
    "id"          TEXT     NOT NULL PRIMARY KEY,
    "code"        TEXT     NOT NULL,
    "name"        TEXT     NOT NULL,
    "contactName" TEXT,
    "phone"       TEXT,
    "email"       TEXT,
    "address"     TEXT,
    "isActive"    INTEGER  NOT NULL DEFAULT 1,
    "companyId"   TEXT     NOT NULL,
    "createdAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   DATETIME NOT NULL,
    CONSTRAINT "transporters_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "transporters_companyId_code_key" ON "transporters"("companyId", "code");
CREATE INDEX "transporters_companyId_idx"   ON "transporters"("companyId");
CREATE INDEX "transporters_isActive_idx"    ON "transporters"("isActive");

CREATE TABLE "officers" (
    "id"        TEXT     NOT NULL PRIMARY KEY,
    "name"      TEXT     NOT NULL,
    "phone"     TEXT,
    "email"     TEXT,
    "role"      TEXT,
    "isActive"  INTEGER  NOT NULL DEFAULT 1,
    "companyId" TEXT     NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "officers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "officers_companyId_idx" ON "officers"("companyId");
CREATE INDEX "officers_isActive_idx"  ON "officers"("isActive");

CREATE TABLE "parties" (
    "id"            TEXT     NOT NULL PRIMARY KEY,
    "code"          TEXT     NOT NULL,
    "name"          TEXT     NOT NULL,
    "contactPerson" TEXT,
    "phone"         TEXT,
    "email"         TEXT,
    "gstNo"         TEXT,
    "address"       TEXT,
    "isActive"      INTEGER  NOT NULL DEFAULT 1,
    "companyId"     TEXT     NOT NULL,
    "createdAt"     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     DATETIME NOT NULL,
    CONSTRAINT "parties_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "parties_companyId_code_key" ON "parties"("companyId", "code");
CREATE INDEX "parties_companyId_idx" ON "parties"("companyId");
CREATE INDEX "parties_isActive_idx"  ON "parties"("isActive");

CREATE TABLE "products" (
    "id"        TEXT     NOT NULL PRIMARY KEY,
    "name"      TEXT     NOT NULL,
    "brand"     TEXT,
    "category"  TEXT,
    "unit"      TEXT,
    "isActive"  INTEGER  NOT NULL DEFAULT 1,
    "companyId" TEXT     NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "products_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "products_companyId_name_brand_key" ON "products"("companyId", "name", "brand");
CREATE INDEX "products_companyId_idx" ON "products"("companyId");
CREATE INDEX "products_category_idx"  ON "products"("category");
CREATE INDEX "products_isActive_idx"  ON "products"("isActive");

CREATE TABLE "working_centres" (
    "id"        TEXT     NOT NULL PRIMARY KEY,
    "code"      TEXT     NOT NULL,
    "name"      TEXT     NOT NULL,
    "address"   TEXT,
    "isActive"  INTEGER  NOT NULL DEFAULT 1,
    "branchId"  TEXT,
    "companyId" TEXT     NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "working_centres_branchId_fkey"  FOREIGN KEY ("branchId")  REFERENCES "branches"  ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "working_centres_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "working_centres_companyId_code_key" ON "working_centres"("companyId", "code");
CREATE INDEX "working_centres_companyId_idx" ON "working_centres"("companyId");
CREATE INDEX "working_centres_branchId_idx"  ON "working_centres"("branchId");
CREATE INDEX "working_centres_isActive_idx"  ON "working_centres"("isActive");
