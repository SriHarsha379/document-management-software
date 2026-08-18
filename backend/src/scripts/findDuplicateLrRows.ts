/**
 * Find (and optionally merge) duplicate Lr rows caused by an OCR-misread
 * lrNo prefix — e.g. "MIH/DR/LR/26-27/1419" vs the real "MH/DR/LR/26-27/1419".
 *
 * autoCreateLrRecord's idempotency check now also matches on companyInvoiceNo
 * (see the fix in documentService.ts), which stops this from happening for
 * NEW uploads. It does nothing for Lr rows that were already created with a
 * bad prefix before that fix shipped — this script is for cleaning those up.
 *
 * Deleting an Lr row is NOT safe on its own: Document.lrId and
 * DocumentLinkRecord.lrId both cascade-delete on Lr deletion, so naively
 * deleting the bad row would silently destroy every document attached to it.
 * This script repoints those documents/links onto the correct Lr FIRST, and
 * only deletes the bad row once nothing points at it anymore.
 *
 * Because deciding WHICH row in a cluster has the correct lrNo needs a human
 * to actually read the two strings and the source documents (OCR confidence
 * being higher on one page than another proves nothing), this script never
 * guesses. It only ever:
 *
 *   1. REPORTS clusters of Lr rows that share a company + companyInvoiceNo
 *      (the same reliable signal the create-time fix uses).
 *   2. MERGES a cluster only when you explicitly say which id to keep:
 *
 *   npx tsx src/scripts/findDuplicateLrRows.ts                        # report only
 *   npx tsx src/scripts/findDuplicateLrRows.ts --keep <lrId> --merge <lrId>[,<lrId>...]
 *
 * --merge accepts a comma-separated list if more than two rows exist in one
 * cluster. Every id in --merge must belong to the SAME cluster as --keep
 * (same companyInvoiceNo) — the script refuses otherwise, as a guard against
 * a typo'd id merging two unrelated LRs together.
 */

import { db } from '../lib/db.js';
import { reconcileLr } from '../services/reconciliationService.js';

async function report(): Promise<void> {
  const rows = await db.lr.findMany({
    where: { companyInvoiceNo: { not: null } },
    select: {
      id: true,
      lrNo: true,
      companyId: true,
      companyInvoiceNo: true,
      vehicleNo: true,
      lrDate: true,
      date: true,
      createdAt: true,
      _count: { select: { uploadedDocuments: true, documentLinks: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!r.companyInvoiceNo?.trim()) continue;
    const key = `${r.companyId}::${r.companyInvoiceNo.trim().toUpperCase()}`;
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }

  let clusterCount = 0;
  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    clusterCount++;
    const invoiceNo = key.split('::')[1];
    console.log(`\nCluster — companyInvoiceNo ${invoiceNo}`);
    for (const r of group) {
      const docCount = r._count.uploadedDocuments + r._count.documentLinks;
      console.log(
        `  ${r.id}  lrNo="${r.lrNo}"  vehicle=${r.vehicleNo ?? '—'}  date=${r.lrDate ?? r.date ?? '—'}  ` +
        `${docCount} linked doc(s)  created ${r.createdAt.toISOString()}`,
      );
    }
  }

  console.log(`\n── Summary ──`);
  console.log(`${clusterCount} cluster(s) of Lr rows sharing the same company + Invoice No found.`);
  if (clusterCount === 0) return;

  console.log(
    `\nNothing was changed — this script never picks a winner automatically.\n` +
    `Read the lrNo values above, decide which one is actually correct (check the\n` +
    `source document if unsure), then re-run with:\n\n` +
    `  npx tsx src/scripts/findDuplicateLrRows.ts --keep <id-to-keep> --merge <id-to-remove>[,<id>...]`,
  );
}

async function merge(keepId: string, mergeIds: string[]): Promise<void> {
  const keep = await db.lr.findUnique({ where: { id: keepId } });
  if (!keep) {
    console.error(`--keep id ${keepId} does not exist.`);
    process.exitCode = 1;
    return;
  }
  if (!keep.companyInvoiceNo?.trim()) {
    console.error(`--keep row ${keepId} has no companyInvoiceNo — refusing (nothing to verify the merge against).`);
    process.exitCode = 1;
    return;
  }
  const keepInvoiceNo = keep.companyInvoiceNo.trim().toUpperCase();

  const mergeRows = await db.lr.findMany({ where: { id: { in: mergeIds } } });
  if (mergeRows.length !== mergeIds.length) {
    const found = new Set(mergeRows.map((r: { id: string }) => r.id));
    const missing = mergeIds.filter((id) => !found.has(id));
    console.error(`--merge id(s) not found: ${missing.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  // Guard: every row being merged away must share the SAME companyInvoiceNo
  // as the row being kept — this is what stops a typo'd id from silently
  // merging two unrelated LRs together.
  const mismatched = mergeRows.filter(
    (r: { companyInvoiceNo: string | null }) => r.companyInvoiceNo?.trim().toUpperCase() !== keepInvoiceNo,
  );
  if (mismatched.length > 0) {
    console.error(
      `Refusing: the following --merge row(s) do NOT share companyInvoiceNo ` +
      `"${keep.companyInvoiceNo}" with the --keep row:`,
    );
    for (const r of mismatched as Array<{ id: string; lrNo: string; companyInvoiceNo: string | null }>) {
      console.error(`  ${r.id}  lrNo="${r.lrNo}"  companyInvoiceNo="${r.companyInvoiceNo ?? '(none)'}"`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`Keeping ${keepId}  (lrNo="${keep.lrNo}")`);
  for (const r of mergeRows) {
    console.log(`Merging away ${r.id}  (lrNo="${r.lrNo}")`);

    // 1. Repoint documents whose lrId points directly at the bad row.
    const direct = await db.document.updateMany({
      where: { lrId: r.id },
      data: { lrId: keepId },
    });
    console.log(`  repointed ${direct.count} document(s) with a direct lrId`);

    // 2. Repoint DocumentLinkRecord rows. Can't blind-UPDATE lrId because of
    //    the (documentId, lrId) unique constraint — a document already
    //    linked to BOTH rows would collide. Upsert onto the kept row, then
    //    delete the old link explicitly.
    const links = await db.documentLinkRecord.findMany({ where: { lrId: r.id } });
    for (const link of links) {
      await db.documentLinkRecord.upsert({
        where: { documentId_lrId: { documentId: link.documentId, lrId: keepId } },
        create: {
          documentId: link.documentId,
          lrId: keepId,
          matchedFields: link.matchedFields,
          confidence: link.confidence,
          isManual: link.isManual,
        },
        update: {}, // Already linked to the kept row — leave the existing link as-is.
      });
    }
    await db.documentLinkRecord.deleteMany({ where: { lrId: r.id } });
    console.log(`  repointed ${links.length} document-link record(s)`);

    // 3. Now safe to delete — nothing references this row anymore.
    await db.lr.delete({ where: { id: r.id } });
    console.log(`  deleted Lr ${r.id}`);
  }

  console.log(`Re-reconciling ${keepId}...`);
  await reconcileLr(keepId);
  console.log(`\nDone.`);
}

async function main(): Promise<void> {
  const keepIndex = process.argv.indexOf('--keep');
  const mergeIndex = process.argv.indexOf('--merge');

  if (keepIndex === -1 && mergeIndex === -1) {
    await report();
    return;
  }

  if (keepIndex === -1 || mergeIndex === -1) {
    console.error('Both --keep <id> and --merge <id>[,<id>...] are required together.');
    process.exitCode = 1;
    return;
  }

  const keepId = process.argv[keepIndex + 1];
  const mergeArg = process.argv[mergeIndex + 1];
  if (!keepId || !mergeArg) {
    console.error('Both --keep <id> and --merge <id>[,<id>...] are required together.');
    process.exitCode = 1;
    return;
  }
  const mergeIds = mergeArg.split(',').map((s) => s.trim()).filter(Boolean);
  if (mergeIds.includes(keepId)) {
    console.error('--keep id cannot also appear in --merge.');
    process.exitCode = 1;
    return;
  }

  await merge(keepId, mergeIds);
}

main()
  .catch((err) => {
    console.error('findDuplicateLrRows failed:', err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
