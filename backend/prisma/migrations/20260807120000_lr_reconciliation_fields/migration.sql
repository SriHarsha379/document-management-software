-- Auto-reconciliation fields on lrs: computed by services/reconciliationService.ts
-- whenever a TOLL or WEIGHMENT document is linked/unlinked from an Lr.
-- These are never edited directly by users.
ALTER TABLE "lrs"
  ADD COLUMN "autoTollAmount" DOUBLE PRECISION,
  ADD COLUMN "originNetWeightKg" DOUBLE PRECISION,
  ADD COLUMN "destinationNetWeightKg" DOUBLE PRECISION,
  ADD COLUMN "weightVariancePct" DOUBLE PRECISION,
  ADD COLUMN "reconciliationIssues" TEXT,
  ADD COLUMN "reconciledAt" TIMESTAMP(3);
