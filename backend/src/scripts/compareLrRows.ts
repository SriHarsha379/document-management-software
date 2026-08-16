/**
 * Read-only side-by-side comparison of two Lr rows and everything linked to
 * them — for deciding whether two rows are genuinely the same trip (safe to
 * merge with findDuplicateLrRows.ts) or two different trips that happen to
 * share a misread field (do NOT merge; fix the bad field on one row instead).
 *
 * Prints every column on both Lr rows, then every linked document for each
 * (via lrId AND documentLinks, same dual-path scoping used elsewhere) with
 * its full ExtractedData. Makes NO changes to the database.
 *
 *   npx tsx src/scripts/compareLrRows.ts <lrId1> <lrId2>
 */

import { db } from '../lib/db.js';

function printRow(label: string, value: unknown): void {
  if (value === null || value === undefined || value === '') return;
  console.log(`    ${label.padEnd(22)} ${String(value)}`);
}

async function dumpLr(id: string): Promise<void> {
  const lr = await db.lr.findUnique({ where: { id } });
  if (!lr) {
    console.log(`  (no Lr row with id ${id})`);
    return;
  }

  console.log(`\n  Lr ${lr.id}`);
  for (const [key, value] of Object.entries(lr)) {
    if (key === 'id') continue;
    printRow(key, value instanceof Date ? value.toISOString() : value);
  }

  const direct = await db.document.findMany({
    where: { lrId: id },
    include: { extractedData: true },
    orderBy: { uploadedAt: 'asc' },
  });
  const linked = await db.documentLinkRecord.findMany({
    where: { lrId: id },
    include: { document: { include: { extractedData: true } } },
    orderBy: { linkedAt: 'asc' },
  });

  const merged = new Map<string, (typeof direct)[number]>();
  for (const d of direct) merged.set(d.id, d);
  for (const l of linked) if (!merged.has(l.document.id)) merged.set(l.document.id, l.document);

  console.log(`\n  Linked documents (${merged.size}):`);
  for (const doc of merged.values()) {
    console.log(`\n    ── ${doc.type} / ${doc.lrDocumentCategory ?? '(no category)'} ──`);
    console.log(`       file: "${doc.originalFilename}"  uploaded: ${doc.uploadedAt.toISOString()}`);
    if (!doc.extractedData) {
      console.log(`       (no ExtractedData)`);
      continue;
    }
    for (const [key, value] of Object.entries(doc.extractedData)) {
      if (['id', 'documentId', 'rawOcrResponse', 'userEdits'].includes(key)) continue;
      printRow(key, value instanceof Date ? value.toISOString() : value);
    }
  }
}

async function main(): Promise<void> {
  const [idA, idB] = process.argv.slice(2);
  if (!idA || !idB) {
    console.error('Usage: npx tsx src/scripts/compareLrRows.ts <lrId1> <lrId2>');
    process.exitCode = 1;
    return;
  }

  console.log('════════════════════════════════════════════════════════════');
  console.log('ROW A');
  console.log('════════════════════════════════════════════════════════════');
  await dumpLr(idA);

  console.log('\n════════════════════════════════════════════════════════════');
  console.log('ROW B');
  console.log('════════════════════════════════════════════════════════════');
  await dumpLr(idB);

  console.log('\n(read-only — nothing was changed)');
}

main()
  .catch((err) => {
    console.error('compareLrRows failed:', err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
