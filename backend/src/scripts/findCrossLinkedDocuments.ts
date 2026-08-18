/**
 * Find documents that are linked to MORE THAN ONE Lr at the same time — via
 * Document.lrId directly, the DocumentLinkRecord join table, or both. A
 * document belongs to exactly one physical trip, so this is always a bug,
 * not a legitimate state — but the fix is to remove the WRONG link, not to
 * merge or delete either Lr row (the two LRs a cross-linked document points
 * at are very often two entirely different, both-legitimate trips — see
 * compareLrRows.ts's write-up for a concrete example of this).
 *
 *   npx tsx src/scripts/findCrossLinkedDocuments.ts                          # report only
 *   npx tsx src/scripts/findCrossLinkedDocuments.ts --unlink <docId> --from <lrId>
 *
 * --unlink removes ONLY the connection between that one document and that
 * one Lr (clearing Document.lrId if that was the direct link, and/or
 * deleting the matching DocumentLinkRecord row), then re-reconciles every
 * Lr that document remains connected to, and the one it was removed from.
 * It refuses if that would leave the document connected to zero LRs — use
 * the normal document-delete flow instead if that's genuinely what you want.
 */

import { db } from '../lib/db.js';
import { reconcileLr } from '../services/reconciliationService.js';

async function report(): Promise<void> {
  const links = await db.documentLinkRecord.findMany({
    select: { documentId: true, lrId: true, lr: { select: { lrNo: true } } },
  });
  const byDoc = new Map<string, Array<{ lrId: string; lrNo: string; via: 'link' | 'direct' }>>();
  for (const l of links) {
    const list = byDoc.get(l.documentId) ?? [];
    list.push({ lrId: l.lrId, lrNo: l.lr.lrNo, via: 'link' });
    byDoc.set(l.documentId, list);
  }

  const docsWithDirectLr = await db.document.findMany({
    where: { lrId: { not: null } },
    select: { id: true, lrId: true, lr: { select: { lrNo: true } } },
  });
  for (const d of docsWithDirectLr) {
    if (!d.lrId || !d.lr) continue;
    const list = byDoc.get(d.id) ?? [];
    if (!list.some((e) => e.lrId === d.lrId)) {
      list.push({ lrId: d.lrId, lrNo: d.lr.lrNo, via: 'direct' });
    }
    byDoc.set(d.id, list);
  }

  const crossLinked = Array.from(byDoc.entries()).filter(([, list]) => list.length > 1);

  if (crossLinked.length === 0) {
    console.log('No cross-linked documents found.');
    return;
  }

  for (const [documentId, lrList] of crossLinked) {
    const doc = await db.document.findUnique({
      where: { id: documentId },
      select: { type: true, lrDocumentCategory: true, originalFilename: true, uploadedAt: true },
    });
    console.log(`\nDocument ${documentId}  (${doc?.type} / ${doc?.lrDocumentCategory ?? 'no category'})`);
    console.log(`  file: "${doc?.originalFilename}"  uploaded: ${doc?.uploadedAt.toISOString()}`);
    console.log(`  linked to ${lrList.length} LR(s):`);
    for (const l of lrList) {
      console.log(`    lrId=${l.lrId}  lrNo="${l.lrNo}"  via=${l.via}`);
    }
  }

  console.log(`\n── Summary ──`);
  console.log(`${crossLinked.length} document(s) linked to more than one LR at once.`);
  console.log(
    `\nFor each one, read its own extracted lrNo/invoiceNo (see compareLrRows.ts) to decide\n` +
    `which LR it actually belongs to, then remove the WRONG link with:\n\n` +
    `  npx tsx src/scripts/findCrossLinkedDocuments.ts --unlink <documentId> --from <lrId-to-remove>`,
  );
}

async function unlink(documentId: string, lrId: string): Promise<void> {
  const doc = await db.document.findUnique({ where: { id: documentId } });
  if (!doc) {
    console.error(`Document ${documentId} does not exist.`);
    process.exitCode = 1;
    return;
  }

  const link = await db.documentLinkRecord.findUnique({
    where: { documentId_lrId: { documentId, lrId } },
  });
  const isDirect = doc.lrId === lrId;

  if (!link && !isDirect) {
    console.error(`Document ${documentId} is not linked to LR ${lrId} (neither directly nor via DocumentLinkRecord).`);
    process.exitCode = 1;
    return;
  }

  // Count how many OTHER connections this document would still have after
  // removing this one — refuse to leave it orphaned.
  const otherLinks = await db.documentLinkRecord.count({
    where: { documentId, lrId: { not: lrId } },
  });
  const wouldHaveDirect = doc.lrId !== null && doc.lrId !== lrId;
  if (otherLinks === 0 && !wouldHaveDirect) {
    console.error(
      `Refusing: removing this link would leave document ${documentId} connected to ZERO LRs.\n` +
      `If that's genuinely what you want, delete the document itself through the normal UI/API instead.`,
    );
    process.exitCode = 1;
    return;
  }

  if (isDirect) {
    await db.document.update({ where: { id: documentId }, data: { lrId: null } });
    console.log(`Cleared direct lrId (was ${lrId}) on document ${documentId}.`);
  }
  if (link) {
    await db.documentLinkRecord.delete({ where: { documentId_lrId: { documentId, lrId } } });
    console.log(`Deleted DocumentLinkRecord(document=${documentId}, lr=${lrId}).`);
  }

  console.log(`Re-reconciling LR ${lrId} (the one removed from)...`);
  await reconcileLr(lrId).catch((err) => console.error('  reconcileLr failed:', err instanceof Error ? err.message : err));

  const remaining = await db.documentLinkRecord.findMany({ where: { documentId }, select: { lrId: true } });
  const remainingLrIds = new Set<string>(remaining.map((r: { lrId: string }) => r.lrId));
  const stillDirect = await db.document.findUnique({ where: { id: documentId }, select: { lrId: true } });
  if (stillDirect?.lrId) remainingLrIds.add(stillDirect.lrId);
  for (const otherId of remainingLrIds) {
    console.log(`Re-reconciling LR ${otherId} (still connected)...`);
    await reconcileLr(otherId).catch((err) => console.error('  reconcileLr failed:', err instanceof Error ? err.message : err));
  }

  console.log(`\nDone.`);
}

async function main(): Promise<void> {
  const unlinkIndex = process.argv.indexOf('--unlink');
  const fromIndex = process.argv.indexOf('--from');

  if (unlinkIndex === -1 && fromIndex === -1) {
    await report();
    return;
  }
  if (unlinkIndex === -1 || fromIndex === -1) {
    console.error('Both --unlink <documentId> and --from <lrId> are required together.');
    process.exitCode = 1;
    return;
  }
  const documentId = process.argv[unlinkIndex + 1];
  const lrId = process.argv[fromIndex + 1];
  if (!documentId || !lrId) {
    console.error('Both --unlink <documentId> and --from <lrId> are required together.');
    process.exitCode = 1;
    return;
  }

  await unlink(documentId, lrId);
}

main()
  .catch((err) => {
    console.error('findCrossLinkedDocuments failed:', err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
