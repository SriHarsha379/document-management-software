/**
 * One-off repair for DocumentGroups that the old grouping logic split.
 *
 * Run AFTER applying migration 20260811090000_vehicle_canonical_and_group_merge.
 *
 *   npx tsx src/scripts/repairSplitGroups.ts            # dry run, reports only
 *   npx tsx src/scripts/repairSplitGroups.ts --apply    # actually merges
 *
 * Order of operations matters:
 *   1. relinkPendingDocuments() — documents that never linked to an Lr (because
 *      the plate was misread) now can, thanks to the canonical key and the new
 *      weight tier. They must be linked before merging, since the merge is
 *      driven entirely by LR links.
 *   2. mergeAllSplitGroups() — collapse every LR whose documents span more than
 *      one group.
 *
 * The dry run reports what step 2 would do without touching anything.
 */

import { db } from '../lib/db.js';
import { relinkPendingDocuments } from '../services/autoLinkService.js';
import { mergeAllSplitGroups } from '../services/groupMergeService.js';

interface SplitRow {
  lr_id: string;
  lr_no: string;
  vehicle_no: string | null;
  group_count: bigint;
}

async function reportSplits(): Promise<SplitRow[]> {
  return db.$queryRaw<SplitRow[]>`
    SELECT l."id"                      AS lr_id,
           l."lrNo"                    AS lr_no,
           l."vehicleNo"               AS vehicle_no,
           count(DISTINCT d."groupId") AS group_count
      FROM "lrs" l
      JOIN "document_link_records" dlr ON dlr."lrId" = l."id"
      JOIN "documents" d              ON d."id"     = dlr."documentId"
     WHERE d."groupId" IS NOT NULL
     GROUP BY l."id", l."lrNo", l."vehicleNo"
    HAVING count(DISTINCT d."groupId") > 1
     ORDER BY count(DISTINCT d."groupId") DESC
  `;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');

  console.log('── Step 1: relinking documents that never found an LR ──');
  if (apply) {
    const relink = await relinkPendingDocuments();
    console.log(`   processed ${relink.processed}, newly linked ${relink.linked}`);
  } else {
    const pending = await db.document.count({
      where: { extractedData: { isNot: null }, documentLinks: { none: {} } },
    });
    console.log(`   ${pending} unlinked document(s) would be retried`);
  }

  console.log('\n── Step 2: LRs whose documents span multiple groups ──');
  const splits = await reportSplits();
  if (splits.length === 0) {
    console.log('   none — nothing to merge');
  } else {
    for (const row of splits) {
      console.log(
        `   ${row.lr_no.padEnd(24)} vehicle=${(row.vehicle_no ?? '—').padEnd(12)} ` +
          `groups=${row.group_count}`,
      );
    }
    console.log(`   ${splits.length} LR(s) affected`);
  }

  if (!apply) {
    console.log('\nDry run. Re-run with --apply to perform the merge.');
    return;
  }

  console.log('\n── Step 3: merging ──');
  const result = await mergeAllSplitGroups();
  console.log(
    `   scanned ${result.lrsScanned} LR(s), merged ${result.lrsMerged}, ` +
      `removed ${result.groupsRemoved} duplicate group(s)`,
  );

  const remaining = await reportSplits();
  console.log(`   ${remaining.length} split LR(s) remaining`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
