-- AlterTable
ALTER TABLE "extracted_data" ADD COLUMN "branchName"    TEXT;
ALTER TABLE "extracted_data" ADD COLUMN "orderType"     TEXT;
ALTER TABLE "extracted_data" ADD COLUMN "tptCode"       TEXT;
ALTER TABLE "extracted_data" ADD COLUMN "quantityInMt"  REAL;
ALTER TABLE "extracted_data" ADD COLUMN "quantityInBags" REAL;
