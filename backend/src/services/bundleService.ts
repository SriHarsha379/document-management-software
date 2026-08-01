import { prisma } from './documentService.js';
import type { DocumentType, RecipientType, BundleStatus } from '../types/index.js';

// ── Recipient rules ────────────────────────────────────────────────────────────
// Defines which document types are required for each recipient.
// Counts per the spec: ACCOUNTS=9 (multiples allowed), PARTY=4, TRANSPORTER=5.
export const RECIPIENT_RULES: Record<RecipientType, DocumentType[]> = {
  ACCOUNTS: ['INVOICE', 'EWAYBILL', 'LR', 'WEIGHMENT', 'TOLL', 'RECEIVING'],
  PARTY: ['INVOICE', 'LR', 'RECEIVING', 'WEIGHMENT'],
  TRANSPORTER: ['LR', 'INVOICE', 'WEIGHMENT', 'TOLL'],
};

export interface BundlePreview {
  groupId: string;
  recipientType: RecipientType;
  requiredTypes: DocumentType[];
  autoSelectedDocuments: BundleDocumentItem[];
  missingTypes: DocumentType[];
  /**
   * True when this DocumentGroup's confirmed links span more than one
   * distinct LR (e.g. the same vehicle making two separate trips close
   * together). DocumentGroup has no concept of "which LR" — it's purely a
   * vehicle+date bucket — so when this is true, documents belonging to the
   * ambiguous types are deliberately left out of autoSelectedDocuments
   * (they show up in missingTypes instead) rather than guessing which LR's
   * paperwork to include. Resolving this properly requires the caller to
   * specify which LR the bundle is for; until the API/UI support that, this
   * flag lets the frontend warn the user instead of silently sending a
   * bundle with someone else's documents in it.
   */
  ambiguousMultiLr: boolean;
}

export interface BundleDocumentItem {
  documentId: string;
  type: DocumentType;
  originalFilename: string;
  status: string;
  isOverride: boolean;
}

/**
 * Compute a preview of which documents would be auto-selected for a given
 * group + recipient type, and which required types are missing.
 *
 * Only documents CONFIRMED as belonging to a specific LR (via
 * document_link_records — the same auto-link pipeline that scopes the
 * Documents table) are eligible. Raw DocumentGroup membership is not
 * sufficient on its own: a group can legitimately contain documents from
 * more than one LR (e.g. the same truck making two trips a day apart), and
 * silently including all of them would attach one LR's paperwork to
 * another's bundle. When a group's confirmed links span more than one LR,
 * the affected types are excluded from auto-selection (see
 * `ambiguousMultiLr` on the result) rather than guessed.
 */
export async function previewBundle(groupId: string, recipientType: RecipientType): Promise<BundlePreview> {
  const required = RECIPIENT_RULES[recipientType];

  const groupDocs = await prisma.document.findMany({
    where: { groupId },
    select: {
      id: true,
      type: true,
      originalFilename: true,
      status: true,
      documentLinks: { select: { lrId: true } },
    },
    orderBy: { uploadedAt: 'asc' },
  });

  // Only documents with at least one confirmed LR link are eligible.
  const linkedDocs = groupDocs.filter((doc) => doc.documentLinks.length > 0);

  // Does this group's confirmed links span more than one distinct LR?
  const distinctLrIds = new Set(linkedDocs.flatMap((doc) => doc.documentLinks.map((l) => l.lrId)));
  const ambiguousMultiLr = distinctLrIds.size > 1;

  // If ambiguous, only trust documents linked EXCLUSIVELY to the single
  // most-represented LR (majority) for auto-selection; everything else in
  // the group is left out rather than guessed.
  let eligibleDocs = linkedDocs;
  if (ambiguousMultiLr) {
    const counts = new Map<string, number>();
    for (const doc of linkedDocs) {
      for (const link of doc.documentLinks) {
        counts.set(link.lrId, (counts.get(link.lrId) ?? 0) + 1);
      }
    }
    const majorityLrId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    eligibleDocs = linkedDocs.filter(
      (doc) => doc.documentLinks.length === 1 && doc.documentLinks[0].lrId === majorityLrId,
    );
  }

  const autoSelected: BundleDocumentItem[] = [];
  const coveredTypes = new Set<DocumentType>();

  for (const doc of eligibleDocs) {
    const docType = doc.type as DocumentType;
    if (required.includes(docType)) {
      autoSelected.push({
        documentId: doc.id,
        type: docType,
        originalFilename: doc.originalFilename,
        status: doc.status,
        isOverride: false,
      });
      coveredTypes.add(docType);
    }
  }

  const missingTypes = required.filter((t) => !coveredTypes.has(t));

  return {
    groupId,
    recipientType,
    requiredTypes: required,
    autoSelectedDocuments: autoSelected,
    ambiguousMultiLr,
    missingTypes,
  };
}

/**
 * Create and persist a DocumentBundle with the provided document selection.
 * Each item is marked as override=true when the set differs from the auto-selection.
 */
export async function createBundle(
  groupId: string,
  recipientType: RecipientType,
  documentIds: string[],
  notes?: string
) {
  // Compute auto-selection to determine overrides
  const preview = await previewBundle(groupId, recipientType);
  const autoIds = new Set(preview.autoSelectedDocuments.map((d) => d.documentId));

  // Validate all provided documentIds exist
  const docs = await prisma.document.findMany({
    where: { id: { in: documentIds } },
    select: { id: true },
  });
  const foundIds = new Set(docs.map((d) => d.id));
  const invalidIds = documentIds.filter((id) => !foundIds.has(id));
  if (invalidIds.length > 0) {
    throw new Error(`Invalid document IDs: ${invalidIds.join(', ')}`);
  }

  const bundle = await prisma.documentBundle.create({
    data: {
      groupId,
      recipientType,
      notes: notes ?? null,
      items: {
        create: documentIds.map((docId) => ({
          documentId: docId,
          isOverride: !autoIds.has(docId),
        })),
      },
    },
    include: { items: { include: { document: true } }, group: true },
  });

  return bundle;
}

/**
 * Update a bundle's document list and/or status.
 */
export async function updateBundle(
  bundleId: string,
  patch: { documentIds?: string[]; status?: BundleStatus; notes?: string }
) {
  const existing = await prisma.documentBundle.findUnique({
    where: { id: bundleId },
    include: { items: true },
  });
  if (!existing) throw new Error('Bundle not found');

  return prisma.$transaction(async (tx) => {
    if (patch.documentIds !== undefined) {
      // Recompute overrides
      const preview = await previewBundle(existing.groupId, existing.recipientType as RecipientType);
      const autoIds = new Set(preview.autoSelectedDocuments.map((d) => d.documentId));

      // Validate IDs
      const docs = await tx.document.findMany({
        where: { id: { in: patch.documentIds } },
        select: { id: true },
      });
      const foundIds = new Set(docs.map((d) => d.id));
      const invalidIds = patch.documentIds.filter((id) => !foundIds.has(id));
      if (invalidIds.length > 0) {
        throw new Error(`Invalid document IDs: ${invalidIds.join(', ')}`);
      }

      // Delete old items and recreate
      await tx.bundleItem.deleteMany({ where: { bundleId } });
      await tx.bundleItem.createMany({
        data: patch.documentIds.map((docId) => ({
          bundleId,
          documentId: docId,
          isOverride: !autoIds.has(docId),
        })),
      });
    }

    return tx.documentBundle.update({
      where: { id: bundleId },
      data: {
        ...(patch.status ? { status: patch.status } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      },
      include: { items: { include: { document: true } }, group: true },
    });
  });
}

/**
 * Delete a bundle.
 */
export async function deleteBundle(bundleId: string): Promise<void> {
  await prisma.documentBundle.delete({ where: { id: bundleId } });
}
