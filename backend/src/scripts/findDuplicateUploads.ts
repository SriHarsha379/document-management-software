/**
 * Find (and optionally remove) duplicate document uploads.
 *
 * The trigger case: the SAME physical scan gets uploaded to the DMS twice
 * (e.g. once as a whole multi-page PDF, once again later as a re-scan or a
 * re-export). Because pdfSplitService derives fresh JPEGs per page on each
 * upload, the two uploads never share a fileHash — the byte-identical-file
 * guard on POST /documents/upload cannot catch this. The result: an LR ends
 * up with "2 uploaded" on several slots, and the "View" combined PDF shows
 * every page from both uploads merged together.
 *
 * This script detects that pattern differently: for each LR, it groups the
 * documents linked to it (via Document.lrId OR the DocumentLinkRecord join
 * table — see the note in lr.repo.ts's summary() about why both must be
 * checked) by lrDocumentCategory, then within a category looks for two or
 * more documents whose ExtractedData shares the same content fingerprint
 * (the exact fields that matter for that document type). Only an exact
 * fingerprint match is flagged — a near-miss is left alone rather than
 * risking a false positive.
 *
 *   npx tsx src/scripts/findDuplicateUploads.ts                     # dry run, every LR
 *   npx tsx src/scripts/findDuplicateUploads.ts --lr "MH/DR/LR/25-26/2499"   # one LR only
 *   npx tsx src/scripts/findDuplicateUploads.ts --apply              # actually delete
 *
 * In apply mode, within each duplicate cluster the EARLIEST-uploaded document
 * is always kept; every later duplicate is deleted (same safe-deletion order
 * as the existing DELETE /documents/:id route: bundle membership removed
 * first, then the document itself — which cascades to ExtractedData and
 * DocumentLinkRecord). Affected LRs are re-reconciled afterward so rollups
 * (toll totals, weight variance) reflect the cleanup.
 */

import { db } from '../lib/db.js';
import { reconcileLr } from '../services/reconciliationService.js';

interface CandidateDoc {
  id: string;
  originalFilename: string;
  uploadedAt: Date;
  lrDocumentCategory: string | null;
  type: string;
  extractedData: {
    invoiceNo: string | null;
    lrNo: string | null;
    vehicleNo: string | null;
    date: string | null;
    weightInfo: string | null;
    tollAmount: string | null;
    documentTime: string | null;
    quantity: string | null;
  } | null;
}

/**
 * Content fingerprint for de-duplication, tuned per document type — using
 * the wrong fields for a type would either miss real duplicates or, worse,
 * flag two genuinely different documents as the same. Returns null when
 * there isn't enough data to fingerprint confidently (never guess).
 */
function fingerprint(doc: CandidateDoc): string | null {
  const ed = doc.extractedData;
  if (!ed) return null;
  const norm = (s: string | null | undefined) => s?.trim().toUpperCase() || null;

  switch (doc.type) {
    case 'LR':
    case 'INVOICE':
    case 'RECEIVING':
      // Invoice No + LR No together — same standard the duplicate-warning
      // feature on the review screen uses.
      if (!norm(ed.invoiceNo) || !norm(ed.lrNo)) return null;
      return `${norm(ed.invoiceNo)}|${norm(ed.lrNo)}`;
    case 'WEIGHMENT':
    case 'WEIGHMENT_PARTY':
    case 'WEIGHMENT_SITE':
      // No document/invoice number on a weighbridge ticket — vehicle + date
      // + the actual weight reading is what identifies it uniquely.
      if (!norm(ed.vehicleNo) || !norm(ed.date) || !norm(ed.weightInfo)) return null;
      return `${norm(ed.vehicleNo)}|${norm(ed.date)}|${norm(ed.weightInfo)}`;
    case 'TOLL':
      if (!norm(ed.vehicleNo) || !norm(ed.tollAmount) || !norm(ed.documentTime)) return null;
      return `${norm(ed.vehicleNo)}|${norm(ed.tollAmount)}|${norm(ed.documentTime)}`;
    default:
      return null;
  }
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const lrArgIndex = process.argv.indexOf('--lr');
  const onlyLrNo = lrArgIndex !== -1 ? process.argv[lrArgIndex + 1] : undefined;

  const lrs = await db.lr.findMany({
    where: onlyLrNo ? { lrNo: onlyLrNo } : {},
    select: {
      id: true,
      lrNo: true,
      uploadedDocuments: {
        select: {
          id: true,
          originalFilename: true,
          uploadedAt: true,
          lrDocumentCategory: true,
          type: true,
          extractedData: {
            select: {
              invoiceNo: true, lrNo: true, vehicleNo: true, date: true,
              weightInfo: true, tollAmount: true, documentTime: true, quantity: true,
            },
          },
        },
      },
      documentLinks: {
        select: {
          document: {
            select: {
              id: true,
              originalFilename: true,
              uploadedAt: true,
              lrDocumentCategory: true,
              type: true,
              extractedData: {
                select: {
                  invoiceNo: true, lrNo: true, vehicleNo: true, date: true,
                  weightInfo: true, tollAmount: true, documentTime: true, quantity: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (onlyLrNo && lrs.length === 0) {
    console.log(`No LR found with lrNo "${onlyLrNo}".`);
    return;
  }

  let totalClusters = 0;
  let totalDeletable = 0;
  const toDelete: string[] = [];
  const affectedLrIds = new Set<string>();

  for (const lr of lrs) {
    // De-dupe the same physical document appearing via both lrId and the
    // link table (same pattern as listLrRelatedDocuments in lr.routes.ts).
    const merged = new Map<string, CandidateDoc>();
    for (const d of lr.uploadedDocuments) merged.set(d.id, d);
    for (const link of lr.documentLinks) {
      if (!merged.has(link.document.id)) merged.set(link.document.id, link.document);
    }
    const docs = Array.from(merged.values());

    // Group by (category, fingerprint).
    const groups = new Map<string, CandidateDoc[]>();
    for (const doc of docs) {
      const fp = fingerprint(doc);
      if (!fp) continue;
      const key = `${doc.lrDocumentCategory ?? doc.type}::${fp}`;
      const list = groups.get(key) ?? [];
      list.push(doc);
      groups.set(key, list);
    }

    for (const [key, group] of groups) {
      if (group.length < 2) continue;
      totalClusters++;
      const sorted = group.slice().sort((a, b) => a.uploadedAt.getTime() - b.uploadedAt.getTime());
      const keep = sorted[0]!;
      const remove = sorted.slice(1);

      console.log(`\nLR ${lr.lrNo}  —  ${key.split('::')[0]}`);
      console.log(`  KEEP   ${keep.id}  "${keep.originalFilename}"  uploaded ${keep.uploadedAt.toISOString()}`);
      for (const r of remove) {
        console.log(`  DELETE ${r.id}  "${r.originalFilename}"  uploaded ${r.uploadedAt.toISOString()}`);
        toDelete.push(r.id);
        totalDeletable++;
      }
      affectedLrIds.add(lr.id);
    }
  }

  console.log(`\n── Summary ──`);
  console.log(`${totalClusters} duplicate cluster(s) found across ${lrs.length} LR(s) checked.`);
  console.log(`${totalDeletable} document(s) would be deleted (the earliest upload in each cluster is always kept).`);

  if (!apply) {
    console.log(`\nDry run only — nothing was changed. Re-run with --apply to actually delete the above.`);
    return;
  }

  if (toDelete.length === 0) {
    console.log(`\nNothing to delete.`);
    return;
  }

  console.log(`\nApplying: deleting ${toDelete.length} duplicate document(s)...`);
  // Same order as DELETE /api/documents/:id: bundle membership first (no
  // cascade on BundleItem), then the document itself (cascades to
  // ExtractedData and DocumentLinkRecord).
  await db.bundleItem.deleteMany({ where: { documentId: { in: toDelete } } });
  await db.document.deleteMany({ where: { id: { in: toDelete } } });

  console.log(`Re-reconciling ${affectedLrIds.size} affected LR(s)...`);
  for (const lrId of affectedLrIds) {
    try {
      await reconcileLr(lrId);
    } catch (err) {
      console.error(`  reconcileLr failed for ${lrId}:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`\nDone.`);
}

main()
  .catch((err) => {
    console.error('findDuplicateUploads failed:', err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
