/*
  Warnings:

  - You are about to drop the column `firstWeightAtMs` on the `extracted_data` table. All the data in the column will be lost.
  - You are about to drop the column `secondWeightAtMs` on the `extracted_data` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "extracted_data" DROP COLUMN "firstWeightAtMs",
DROP COLUMN "secondWeightAtMs";
