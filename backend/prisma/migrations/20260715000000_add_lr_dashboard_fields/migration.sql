-- AlterTable: add new LR fields for dashboard
ALTER TABLE "lrs" ADD COLUMN "driverCellNo" TEXT;
ALTER TABLE "lrs" ADD COLUMN "ewayBillDate" TEXT;
ALTER TABLE "lrs" ADD COLUMN "approvedDestination" TEXT;
ALTER TABLE "lrs" ADD COLUMN "orderNo" TEXT;
ALTER TABLE "lrs" ADD COLUMN "workingCenter" TEXT;
ALTER TABLE "lrs" ADD COLUMN "depotPlantCode" TEXT;
