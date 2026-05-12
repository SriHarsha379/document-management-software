import { PrismaClient } from '@prisma/client';
import type { DocumentType, ExtractedFields } from '../types/index.js';

const prisma = new PrismaClient();
// Indian registration examples: MH12AB1234, GJ05CD5678, KA01AB1234.
export const VEHICLE_NO_PATTERN = /^[A-Z]{2}\d{1,2}[A-Z]{1,3}\d{1,4}$/;
export const ISSUE_PENALTY_WEIGHT = 0.08;
const RETRY_CONFIDENCE_THRESHOLD = 0.75;
const MAX_CONTEXT_HINTS = 15;
const METRICS_SAMPLE_LIMIT = 2000;

type ProfileData = {
  stableFields: Record<string, string>;
  correctedFieldCounts: Record<string, number>;
};

type OcrQualityMetrics = {
  totalReviewed: number;
  totalAutoAccepted: number;
  editedDocuments: number;
  editRate: number;
  topEditedFields: Array<{ field: string; count: number }>;
};

const EDIT_TRACKED_FIELDS: (keyof ExtractedFields | 'documentType')[] = [
  'lrNo', 'invoiceNo', 'vehicleNo', 'quantity', 'date', 'partyNames', 'tollAmount', 'weightInfo',
  'billToParty', 'shipToParty', 'principalCompany', 'branchName', 'loadingSlipNo', 'companyInvoiceNo',
  'companyInvoiceDate', 'companyEwayBillNo', 'deliveryDestination', 'productName', 'transporterName',
  'orderType', 'tptCode', 'quantityInMt', 'quantityInBags', 'documentType',
];

function cleanText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  return v.length > 0 ? v : undefined;
}

function normalizeVehicleNo(value?: string): string | undefined {
  if (!value) return undefined;
  const cleaned = value.toUpperCase().replace(/[\s-]+/g, '');
  return cleaned.length > 0 ? cleaned : undefined;
}

function normalizeDate(value?: string): string | undefined {
  if (!value) return undefined;
  const src = value.trim();
  if (!src) return undefined;

  const iso = src.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (iso) {
    const y = iso[1];
    const m = iso[2].padStart(2, '0');
    const d = iso[3].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  const dmy = src.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dmy) {
    const d = dmy[1].padStart(2, '0');
    const m = dmy[2].padStart(2, '0');
    const y = dmy[3];
    return `${y}-${m}-${d}`;
  }
  return undefined;
}

export function normalizeExtractedFields(fields: ExtractedFields): ExtractedFields {
  return {
    ...fields,
    lrNo: cleanText(fields.lrNo)?.toUpperCase(),
    invoiceNo: cleanText(fields.invoiceNo)?.toUpperCase(),
    vehicleNo: normalizeVehicleNo(fields.vehicleNo),
    date: normalizeDate(fields.date),
    quantity: cleanText(fields.quantity),
    tollAmount: cleanText(fields.tollAmount),
    weightInfo: cleanText(fields.weightInfo),
    billToParty: cleanText(fields.billToParty),
    shipToParty: cleanText(fields.shipToParty),
    principalCompany: cleanText(fields.principalCompany)?.toUpperCase(),
    branchName: cleanText(fields.branchName)?.toUpperCase(),
    loadingSlipNo: cleanText(fields.loadingSlipNo)?.toUpperCase(),
    companyInvoiceNo: cleanText(fields.companyInvoiceNo)?.toUpperCase(),
    companyInvoiceDate: normalizeDate(fields.companyInvoiceDate),
    companyEwayBillNo: cleanText(fields.companyEwayBillNo)?.toUpperCase(),
    deliveryDestination: cleanText(fields.deliveryDestination),
    productName: cleanText(fields.productName),
    transporterName: cleanText(fields.transporterName),
    orderType: cleanText(fields.orderType)?.toUpperCase(),
    tptCode: cleanText(fields.tptCode)?.toUpperCase(),
    partyNames: Array.isArray(fields.partyNames)
      ? fields.partyNames.map((p) => p.trim()).filter(Boolean)
      : undefined,
  };
}

function needsVehicleAndDate(documentType: DocumentType): boolean {
  return ['LR', 'INVOICE', 'TOLL', 'WEIGHMENT', 'WEIGHMENT_PARTY', 'WEIGHMENT_SITE'].includes(documentType);
}

export function getValidationIssues(fields: ExtractedFields, documentType: DocumentType): string[] {
  const issues: string[] = [];

  if (needsVehicleAndDate(documentType)) {
    if (!fields.vehicleNo) issues.push('vehicleNo missing');
    if (!fields.date) issues.push('date missing');
  }

  if (fields.vehicleNo && !VEHICLE_NO_PATTERN.test(fields.vehicleNo)) {
    issues.push('vehicleNo format invalid');
  }
  if (fields.date && !/^\d{4}-\d{2}-\d{2}$/.test(fields.date)) {
    issues.push('date format invalid');
  }
  return issues;
}

export function computeFieldConfidence(fields: ExtractedFields, baseConfidence: number, issues: string[]): Record<string, number> {
  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  const penalty = issues.length * ISSUE_PENALTY_WEIGHT;
  const base = clamp(baseConfidence - penalty);
  const perField: Record<string, number> = {};

  const keys: (keyof ExtractedFields)[] = [
    'vehicleNo', 'date', 'lrNo', 'invoiceNo', 'quantity', 'tollAmount', 'weightInfo',
    'billToParty', 'shipToParty', 'principalCompany', 'branchName', 'loadingSlipNo',
    'companyInvoiceNo', 'companyInvoiceDate', 'companyEwayBillNo', 'deliveryDestination',
    'productName', 'transporterName', 'orderType', 'tptCode',
  ];

  for (const key of keys) {
    const raw = fields[key];
    const present = Array.isArray(raw) ? raw.length > 0 : raw !== undefined && raw !== null && String(raw).trim() !== '';
    perField[key] = present ? base : clamp(base - 0.2);
  }
  return perField;
}

export function shouldRetryOcr(issues: string[], currentConfidence: number): boolean {
  // Retry when confidence is under threshold or required fields are invalid/missing.
  return issues.length > 0 || currentConfidence < RETRY_CONFIDENCE_THRESHOLD;
}

export function shouldAutoAccept(fields: ExtractedFields, documentType: DocumentType): boolean {
  const confidence = fields.confidence ?? 0;
  const issues = getValidationIssues(fields, documentType);
  const criticalPresent = needsVehicleAndDate(documentType) ? Boolean(fields.vehicleNo && fields.date) : true;
  return confidence >= 0.92 && issues.length === 0 && criticalPresent;
}

function profileKeyFromParts(documentType: DocumentType, principalCompany?: string, branchName?: string, transporterName?: string): string {
  const p = principalCompany?.trim().toUpperCase() || '*';
  const b = branchName?.trim().toUpperCase() || '*';
  const t = transporterName?.trim().toUpperCase() || '*';
  return `${documentType}|${p}|${b}|${t}`;
}

export async function getContextualOcrHints(documentType: DocumentType, fields: ExtractedFields): Promise<string[]> {
  const principalCompany = fields.principalCompany?.trim().toUpperCase();
  const branchName = fields.branchName?.trim().toUpperCase();
  const transporterName = fields.transporterName?.trim().toUpperCase();
  const orFilters: Array<{ principalCompany?: string; branchName?: string; transporterName?: string }> = [];
  if (principalCompany) orFilters.push({ principalCompany });
  if (branchName) orFilters.push({ branchName });
  if (transporterName) orFilters.push({ transporterName });

  if (orFilters.length === 0) return [];

  const profiles = await prisma.extractionProfile.findMany({
    where: {
      documentType,
      OR: orFilters,
    },
    orderBy: [{ successfulSaves: 'desc' }, { samplesCount: 'desc' }, { updatedAt: 'desc' }],
    take: 3,
  });

  const hints: string[] = [];
  for (const profile of profiles) {
    try {
      const data = JSON.parse(profile.profileData) as ProfileData;
      for (const [field, value] of Object.entries(data.stableFields)) {
        if (value) hints.push(`${field}: ${value}`);
      }
    } catch {
      // ignore malformed profile
    }
  }
  // Keep hints bounded to avoid unnecessary token usage in retry prompts.
  return [...new Set(hints)].slice(0, MAX_CONTEXT_HINTS);
}

export async function learnFromDocumentReview(_documentId: string, documentType: DocumentType, stableFields: ExtractedFields, editedFields: string[]): Promise<void> {
  const principalCompany = stableFields.principalCompany?.trim().toUpperCase();
  const branchName = stableFields.branchName?.trim().toUpperCase();
  const transporterName = stableFields.transporterName?.trim().toUpperCase();
  const profileKey = profileKeyFromParts(documentType, principalCompany, branchName, transporterName);

  const compactStable: Record<string, string> = {};
  for (const field of EDIT_TRACKED_FIELDS) {
    if (field === 'documentType') continue;
    const value = stableFields[field];
    if (Array.isArray(value)) {
      if (value.length > 0) compactStable[field] = value.join(' | ');
    } else if (value !== undefined && value !== null && String(value).trim() !== '') {
      compactStable[field] = String(value).trim();
    }
  }

  const existing = await prisma.extractionProfile.findUnique({ where: { profileKey } });
  const mergedData: ProfileData = existing
    ? (() => {
        try {
          const current = JSON.parse(existing.profileData) as ProfileData;
          return {
            stableFields: { ...current.stableFields, ...compactStable },
            correctedFieldCounts: { ...current.correctedFieldCounts },
          };
        } catch {
          return { stableFields: compactStable, correctedFieldCounts: {} };
        }
      })()
    : { stableFields: compactStable, correctedFieldCounts: {} };

  for (const field of editedFields) {
    mergedData.correctedFieldCounts[field] = (mergedData.correctedFieldCounts[field] ?? 0) + 1;
  }

  await prisma.extractionProfile.upsert({
    where: { profileKey },
    create: {
      profileKey,
      documentType,
      principalCompany: principalCompany ?? null,
      branchName: branchName ?? null,
      transporterName: transporterName ?? null,
      profileData: JSON.stringify(mergedData),
      samplesCount: 1,
      successfulSaves: 1,
      lastUsedAt: new Date(),
    },
    update: {
      profileData: JSON.stringify(mergedData),
      samplesCount: { increment: 1 },
      successfulSaves: { increment: 1 },
      lastUsedAt: new Date(),
    },
  });
}

export function getTrackedReviewFields(): string[] {
  return EDIT_TRACKED_FIELDS.map((f) => String(f));
}

export async function getOcrQualityMetrics(): Promise<OcrQualityMetrics> {
  const [reviewed, autoAccepted, allWithEdits] = await Promise.all([
    prisma.extractedData.count({ where: { userReviewed: true } }),
    prisma.document.count({ where: { status: 'SAVED', extractedData: { is: { userReviewed: false } } } }),
    prisma.extractedData.findMany({
      where: { userEdits: { not: null } },
      select: { userEdits: true },
      // Large enough for trend visibility while keeping endpoint fast on SQLite.
      take: METRICS_SAMPLE_LIMIT,
      orderBy: { reviewedAt: 'desc' },
    }),
  ]);

  const fieldCounts: Record<string, number> = {};
  for (const row of allWithEdits) {
    if (!row.userEdits) continue;
    try {
      const parsed = JSON.parse(row.userEdits) as Record<string, unknown>;
      for (const field of Object.keys(parsed)) {
        fieldCounts[field] = (fieldCounts[field] ?? 0) + 1;
      }
    } catch {
      // ignore malformed JSON
    }
  }

  const editedDocuments = allWithEdits.length;
  const editRate = reviewed > 0 ? editedDocuments / reviewed : 0;
  const topEditedFields = Object.entries(fieldCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([field, count]) => ({ field, count }));

  return {
    totalReviewed: reviewed,
    totalAutoAccepted: autoAccepted,
    editedDocuments,
    editRate,
    topEditedFields,
  };
}
