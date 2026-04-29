-- AlterTable
ALTER TABLE "lrs" ADD COLUMN "billAmount" REAL;
ALTER TABLE "lrs" ADD COLUMN "billDate" TEXT;
ALTER TABLE "lrs" ADD COLUMN "billNo" TEXT;
ALTER TABLE "lrs" ADD COLUMN "billToParty" TEXT;
ALTER TABLE "lrs" ADD COLUMN "companyEwayBillNo" TEXT;
ALTER TABLE "lrs" ADD COLUMN "companyInvoiceDate" TEXT;
ALTER TABLE "lrs" ADD COLUMN "companyInvoiceNo" TEXT;
ALTER TABLE "lrs" ADD COLUMN "dayClosingKm" REAL;
ALTER TABLE "lrs" ADD COLUMN "dayOpeningKm" REAL;
ALTER TABLE "lrs" ADD COLUMN "deliveryDestination" TEXT;
ALTER TABLE "lrs" ADD COLUMN "driverBhatta" REAL;
ALTER TABLE "lrs" ADD COLUMN "driverBillNo" TEXT;
ALTER TABLE "lrs" ADD COLUMN "driverName" TEXT;
ALTER TABLE "lrs" ADD COLUMN "fuelAmount" REAL;
ALTER TABLE "lrs" ADD COLUMN "fuelPerKm" REAL;
ALTER TABLE "lrs" ADD COLUMN "grandTotal" REAL;
ALTER TABLE "lrs" ADD COLUMN "loadingSlipNo" TEXT;
ALTER TABLE "lrs" ADD COLUMN "lrDate" TEXT;
ALTER TABLE "lrs" ADD COLUMN "orderType" TEXT;
ALTER TABLE "lrs" ADD COLUMN "principalCompany" TEXT;
ALTER TABLE "lrs" ADD COLUMN "productName" TEXT;
ALTER TABLE "lrs" ADD COLUMN "quantityInBags" REAL;
ALTER TABLE "lrs" ADD COLUMN "quantityInMt" REAL;
ALTER TABLE "lrs" ADD COLUMN "serialNo" INTEGER;
ALTER TABLE "lrs" ADD COLUMN "shipToParty" TEXT;
ALTER TABLE "lrs" ADD COLUMN "tollCharges" REAL;
ALTER TABLE "lrs" ADD COLUMN "totalRunningKm" REAL;
ALTER TABLE "lrs" ADD COLUMN "tpt" TEXT;
ALTER TABLE "lrs" ADD COLUMN "tptCode" TEXT;
ALTER TABLE "lrs" ADD COLUMN "transporterName" TEXT;
ALTER TABLE "lrs" ADD COLUMN "unloadingAtSite" REAL;
ALTER TABLE "lrs" ADD COLUMN "weighmentCharges" REAL;

-- CreateIndex
CREATE INDEX "lrs_serialNo_idx" ON "lrs"("serialNo");
