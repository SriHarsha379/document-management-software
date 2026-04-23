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
 */
export async function previewBundle(groupId: string, recipientType: RecipientType): Promise<BundlePreview> {
  const required = RECIPIENT_RULES[recipientType];

  const groupDocs = await prisma.document.findMany({
    where: { groupId },
    select: { id: true, type: true, originalFilename: true, status: true },
    orderBy: { uploadedAt: 'asc' },
  });

  const autoSelected: BundleDocumentItem[] = [];
  const coveredTypes = new Set<DocumentType>();

  for (const doc of groupDocs) {
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
