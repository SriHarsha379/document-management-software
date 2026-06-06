import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import type { DocumentType, ExtractedFields, OcrResult } from '../types/index.js';
import {
  computeFieldConfidence,
  getContextualOcrHints,
  getValidationIssues,
  ISSUE_PENALTY_WEIGHT,
  normalizeExtractedFields,
  shouldRetryOcr,
  VEHICLE_NO_PATTERN,
} from './ocrLearningService.js';

const WEIGHMENT_TYPES: DocumentType[] = ['WEIGHMENT', 'WEIGHMENT_PARTY', 'WEIGHMENT_SITE'];

/** For weighment slips only vehicleNo and date should be retained; strip everything else. */
function restrictToWeighmentFields(fields: ExtractedFields): ExtractedFields {
  return {
    vehicleNo: fields.vehicleNo,
    date: fields.date,
    documentType: fields.documentType,
    confidence: fields.confidence,
  };
}

function parseExtractedFields(parsed: Record<string, unknown>, documentType: DocumentType, defaultConfidence = 0.5): ExtractedFields {
  const partyNames = Array.isArray(parsed.partyNames)
    ? parsed.partyNames.filter((p): p is string => typeof p === 'string')
    : undefined;

  const fields: ExtractedFields = {
    lrNo: typeof parsed.lrNo === 'string' ? parsed.lrNo : undefined,
    invoiceNo: typeof parsed.invoiceNo === 'string' ? parsed.invoiceNo : undefined,
    vehicleNo: typeof parsed.vehicleNo === 'string' ? parsed.vehicleNo : undefined,
    quantity: typeof parsed.quantity === 'string' ? parsed.quantity : undefined,
    date: typeof parsed.date === 'string' ? parsed.date : undefined,
    partyNames,
    tollAmount: typeof parsed.tollAmount === 'string' ? parsed.tollAmount : undefined,
    weightInfo: typeof parsed.weightInfo === 'string' ? parsed.weightInfo : undefined,
    billToParty: typeof parsed.billToParty === 'string' ? parsed.billToParty : undefined,
    shipToParty: typeof parsed.shipToParty === 'string' ? parsed.shipToParty : undefined,
    principalCompany: typeof parsed.principalCompany === 'string' ? parsed.principalCompany : undefined,
    branchName: typeof parsed.branchName === 'string' ? parsed.branchName : undefined,
    loadingSlipNo: typeof parsed.loadingSlipNo === 'string' ? parsed.loadingSlipNo : undefined,
    companyInvoiceNo: typeof parsed.companyInvoiceNo === 'string' ? parsed.companyInvoiceNo : undefined,
    companyInvoiceDate: typeof parsed.companyInvoiceDate === 'string' ? parsed.companyInvoiceDate : undefined,
    companyEwayBillNo: typeof parsed.companyEwayBillNo === 'string' ? parsed.companyEwayBillNo : undefined,
    deliveryDestination: typeof parsed.deliveryDestination === 'string' ? parsed.deliveryDestination : undefined,
    productName: typeof parsed.productName === 'string' ? parsed.productName : undefined,
    transporterName: typeof parsed.transporterName === 'string' ? parsed.transporterName : undefined,
    orderType: typeof parsed.orderType === 'string' ? parsed.orderType : undefined,
    tptCode: typeof parsed.tptCode === 'string' ? parsed.tptCode : undefined,
    quantityInMt: typeof parsed.quantityInMt === 'number' ? parsed.quantityInMt : undefined,
    quantityInBags: typeof parsed.quantityInBags === 'number' ? parsed.quantityInBags : undefined,
    driverName: typeof parsed.driverName === 'string' ? parsed.driverName : undefined,
    driverCellNo: typeof parsed.driverCellNo === 'string' ? parsed.driverCellNo : undefined,
    source: typeof parsed.source === 'string' ? parsed.source : undefined,
    documentType,
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : defaultConfidence,
  };
  const normalized = normalizeExtractedFields(fields);
  if (WEIGHMENT_TYPES.includes(documentType)) {
    return restrictToWeighmentFields(normalized);
  }
  // principalCompany is only meaningful on invoices; strip it from LR documents
  // to prevent the transporter header from being misidentified as the principal company.
  if (documentType === 'LR') {
    normalized.principalCompany = undefined;
  }
  return normalized;
}

const DOCUMENT_TYPE_KEYWORDS: Record<DocumentType, string[]> = {
  LR: ['lorry receipt', 'lr no', 'lr number', 'consignment note', 'bilty', 'goods receipt'],
  INVOICE: ['invoice', 'bill', 'gst invoice', 'tax invoice', 'proforma', 'invoice no', 'invoice number'],
  TOLL: ['toll', 'toll tax', 'toll receipt', 'national highway', 'fastag', 'toll plaza'],
  WEIGHMENT: ['weighment', 'weight slip', 'gross weight', 'tare weight', 'net weight', 'weighbridge', 'weigh bridge'],
  WEIGHMENT_PARTY: ['weighment party', 'party weighment', 'party weight slip'],
  WEIGHMENT_SITE: ['weighment site', 'site weighment', 'site weight slip'],
  EWAYBILL: ['e-way bill', 'eway bill', 'e way bill', 'ewb no', 'ewb number', 'eway'],
  RECEIVING: ['receiving', 'delivery receipt', 'pod', 'proof of delivery', 'receiving copy', 'unloading report'],
  UNKNOWN: [],
};

const OCR_SYSTEM_PROMPT = `You are an expert OCR assistant for a logistics document management system in India.
Analyze the provided document image and perform TWO steps:

STEP 1 — Identify the document type from the visual layout, printed title, and content:
- LR: Document titled "LORRY RECEIPT", "LORRY RECEIPT CUM CONSIGNMENT NOTE", "BILTY", "GOODS RECEIPT", or similar. Contains an LR number, consignor/consignee or Bill-To/Ship-To parties, vehicle/truck number, and goods description.
- INVOICE: Document titled "TAX INVOICE", "GST INVOICE", "INVOICE", "PROFORMA INVOICE". Contains invoice number, HSN/SAC codes, GSTIN, line-item rates and totals.
- TOLL: Toll receipt from a highway/expressway toll plaza. Contains toll plaza name, vehicle number, and amount collected.
- WEIGHMENT: Weighbridge or Weigh Bridge slip. Contains vehicle number, gross weight, tare weight, and net weight in KGS.
- EWAYBILL: E-Way Bill document with EWB/EWay Bill number, GSTIN, and transporter details.
- RECEIVING: Delivery or receiving acknowledgement, proof of delivery (POD), unloading report.

STEP 2 — Extract fields according to the identified document type using the rules below.

=== FOR LR (Lorry Receipt) ===
- lrNo: LR / consignment number — look for labels "LR No", "LR No.", "L.R. No.", "LR Number", "Consignment No."
- loadingSlipNo: Loading slip number — look for labels "LS No", "L.S. No.", "Loading Slip No.", "LS No."
- invoiceNo: Supplier invoice number on the LR — look for "Invoice No", "Invoice No."
- companyEwayBillNo: E-Way Bill number — look for "E-Way Bill No", "E-Way Bill No.", "EWB No."
- vehicleNo: Truck/vehicle registration number — look for "Truck No.", "Vehicle No.", "Lorry No.", "Truck No"
- date: LR date or document date in YYYY-MM-DD (convert DD/MM/YYYY or DD-MM-YYYY)
- billToParty: The "BILL TO PARTY" company name
- shipToParty: The "SHIP TO PARTY" company name (delivery address party)
- branchName: The locality/area from the sender's header address block, normalized to UPPERCASE (e.g. "DRONAGIRI"). Look for the locality token before the city/district in the "From" address. Also check "From Destination" label.
- source: The source city/location from the sender's header address block, normalized to UPPERCASE (e.g. "NAVI MUMBAI"). Prefer the city token immediately following locality in the same address line.
- productName: Product or commodity being transported — look for "PRODUCT", "Goods Description", "Item"
- quantity: Quantity with unit — look for "QUANTITY IN MT", "Qty", e.g. "35.38 MT" or "500 Bags"
- quantityInMt: Numeric quantity in metric tonnes — extract only the number from quantity, e.g. 35.38 (float). Return null if unit is not MT/MTS/tonnes.
- quantityInBags: Numeric quantity in bags — extract only the number, e.g. 500 (float). Return null if not in bags.
- orderType: Order type — look for "ORDER TYPE", "Order Type", e.g. "BULK ORDER", "BAG ORDER"
- tptCode: Transport/TPT code — look for "T.P.T Code", "TPT Code", "TPT"
- driverName: Driver's name — look for "Driver Name", "Driver Name :", "Drfver Name" (OCR variant)
- driverCellNo: Driver's mobile/cell number — look for "Driver Cell No", "Driver Cell No.", "Driver Mobile", "Cell No"
- partyNames: Array [consignor/sender name, consignee/receiver name] — look for "From", "Consignor", "Sender" for index 0; "To", "Consignee", "Receiver" for index 1
- transporterName: The transport company name (usually printed as the issuing company on the document header)
- deliveryDestination: "To Destination" city or location

=== FOR WEIGHMENT (Weighbridge Slip) ===
Extract ONLY the two fields below. Set every other field to null.
- vehicleNo: Vehicle registration number — look for "VEHICLE NO", "Vehicle No.", "Veh. No.", "Truck No."
- date: Date from the slip in YYYY-MM-DD. The date may appear as "DT:DD-MM-YYYY TM:HH:MM" (e.g. "DT:16-09-2025 TM:12:05") or "DD/MM/YYYY" — extract only the date part and convert to YYYY-MM-DD.

=== FOR INVOICE (Tax Invoice / GST Invoice) ===
- invoiceNo: Invoice number — look for "Invoice No", "Invoice No."
- date: Invoice date in YYYY-MM-DD (convert DD/MM/YYYY)
- vehicleNo: Vehicle number — look for "Vehicle No", "Veh No"
- lrNo: LR number referenced in the invoice — look for "LR No.", "LR No"
- billToParty: "BILL TO" party name
- shipToParty: "SHIP TO" party name
- principalCompany: The sender/issuer company name from the top header block (e.g. "MY HOME INDUSTRIES PRIVATE LIMITED"). This is the company that issued the invoice.
- branchName: The branch name — look for an explicit "Branch:" label in the company header area, normalized to UPPERCASE. If no "Branch:" label exists, extract the locality from the company address block (e.g. "DRONAGIRI").
- source: The source location — look for an explicit "Source:" label in the company header area. If no label exists, extract the city/location token from the same company address block (e.g. "NAVI MUMBAI"), normalized to UPPERCASE.
- productName: Item/product name from line items
- quantity: Quantity from line items with unit
- quantityInMt: Numeric quantity in metric tonnes from line items (float), e.g. 35.38
- companyEwayBillNo: E-Way Bill number — look for "E-Way Bill No", "E-Way bill No"

=== FOR TOLL ===
- vehicleNo: Vehicle registration number
- date: Date in YYYY-MM-DD
- tollAmount: Amount collected with currency symbol, e.g. "₹120" or "Rs.150"

Always respond with a valid JSON object with EXACTLY these fields:
{
  "documentType": "<LR|INVOICE|TOLL|WEIGHMENT|EWAYBILL|RECEIVING|UNKNOWN>",
  "confidence": <0.0-1.0>,
  "lrNo": "<LR number or null>",
  "invoiceNo": "<invoice/bill number or null>",
  "vehicleNo": "<vehicle registration number in Indian format like MH12AB1234 or null>",
  "quantity": "<quantity with unit, e.g. '35.38 MT', '500 Bags' or null>",
  "quantityInMt": <numeric MT value e.g. 35.38, or null>,
  "quantityInBags": <numeric bags count e.g. 500, or null>,
  "date": "<document date in YYYY-MM-DD format or null>",
  "partyNames": ["<consignor/sender name>", "<consignee/receiver name>"],
  "tollAmount": "<toll amount with currency, e.g. '₹120' or null>",
  "weightInfo": "<weight details, e.g. 'Gross: 49670 kg, Tare: 14290 kg, Net: 35380 kg' or null>",
  "billToParty": "<name of the Bill To party or null>",
  "shipToParty": "<name of the Ship To party or null>",
  "principalCompany": "<company name from the top-left header block (sender/issuer) — e.g. 'SP ASSOCIATES' or null>",
  "branchName": "<locality/area from the sender's header address block, normalized to UPPERCASE — e.g. 'DRONAGIRI' or null>",
  "loadingSlipNo": "<loading slip number or null>",
  "companyInvoiceNo": "<company's own invoice number or null>",
  "companyInvoiceDate": "<company invoice date in YYYY-MM-DD format or null>",
  "companyEwayBillNo": "<E-way Bill number or null>",
  "deliveryDestination": "<delivery destination city/location or null>",
  "productName": "<name of the product/commodity being transported or null>",
  "transporterName": "<name of the transport company/transporter or null>",
  "orderType": "<order type e.g. 'BULK ORDER', 'BAG ORDER' or null>",
  "tptCode": "<T.P.T code / TPT code or null>",
  "driverName": "<driver's name from 'Driver Name' label or null>",
  "driverCellNo": "<driver's cell/mobile number from 'Driver Cell No' label or null>",
  "source": "<source location from 'Source:' label in invoice header or null>",
  "rawText": "<full text extracted from document>"
}

Important rules:
- Indian vehicle registration format: MH46CL9571, GJ05CD5678, MH12AB1234 — always uppercase, no spaces.
- LR numbers may contain slashes, e.g. "SP/DR/LR/25-26/1433" — capture the full value exactly.
- For dates: convert DD/MM/YYYY → YYYY-MM-DD and DD-MM-YYYY → YYYY-MM-DD. Read the year digit by digit carefully (e.g. 2-0-2-5 = 2025, not 2020).
- For weighment slips the date often appears alongside a time stamp like "DT:16-09-2025 TM:12:05" — extract only the date portion.
- quantityInMt and quantityInBags must be plain numbers (no units), e.g. 35.38 not "35.38 MT".
- If a field is not present or cannot be read clearly, return null for that field.
- Always extract rawText with the complete readable text from the document.`;

function detectDocumentTypeFromText(text: string): DocumentType {
  const lower = text.toLowerCase();
  const scores: Record<DocumentType, number> = {
    LR: 0,
    INVOICE: 0,
    TOLL: 0,
    WEIGHMENT: 0,
    WEIGHMENT_PARTY: 0,
    WEIGHMENT_SITE: 0,
    EWAYBILL: 0,
    RECEIVING: 0,
    UNKNOWN: 0,
  };

  for (const [type, keywords] of Object.entries(DOCUMENT_TYPE_KEYWORDS) as [DocumentType, string[]][]) {
    for (const keyword of keywords) {
      if (lower.includes(keyword)) {
        scores[type] += 1;
      }
    }
  }

  const sorted = (Object.entries(scores) as [DocumentType, number][]).sort(([, a], [, b]) => b - a);

  if (sorted[0][1] === 0) return 'UNKNOWN';
  return sorted[0][0];
}

export async function processDocumentOcr(filePath: string, mimeType: string): Promise<OcrResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is not set');
  }

  const client = new OpenAI({ apiKey });

  const fileBuffer = fs.readFileSync(filePath);
  const base64Image = fileBuffer.toString('base64');

  const ext = path.extname(filePath).toLowerCase();
  let imageMediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' = 'image/jpeg';
  if (ext === '.png') imageMediaType = 'image/png';
  else if (ext === '.gif') imageMediaType = 'image/gif';
  else if (ext === '.webp') imageMediaType = 'image/webp';

  const runOcrPass = async (extraGuidance?: string): Promise<{ parsed: Record<string, unknown>; rawResponse: string; rawContent: string }> => {
    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: OCR_SYSTEM_PROMPT,
        },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:${imageMediaType};base64,${base64Image}`,
                detail: 'high',
              },
            },
            {
              type: 'text',
              text: extraGuidance
                ? `Extract all structured fields from this logistics document. Return only the JSON object.\n\nAdditional context from previously corrected similar documents:\n${extraGuidance}`
                : 'Extract all structured fields from this logistics document. Return only the JSON object.',
            },
          ],
        },
      ],
      max_tokens: 1500,
      temperature: 0,
    });

    const rawContent = response.choices[0]?.message?.content ?? '';
    const rawResponse = JSON.stringify(response);

    let parsed: Record<string, unknown> = {};
    try {
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      }
    } catch {
      parsed = { rawText: rawContent };
    }
    return { parsed, rawResponse, rawContent };
  };

  const firstPass = await runOcrPass();
  let parsed = firstPass.parsed;
  let rawResponse = firstPass.rawResponse;
  const rawContent = firstPass.rawContent;

  const rawText = typeof parsed.rawText === 'string' ? parsed.rawText : rawContent;
  let documentType = (parsed.documentType as DocumentType) ?? 'UNKNOWN';

  const validTypes: DocumentType[] = ['LR', 'INVOICE', 'TOLL', 'WEIGHMENT', 'WEIGHMENT_PARTY', 'WEIGHMENT_SITE', 'EWAYBILL', 'RECEIVING', 'UNKNOWN'];
  if (!validTypes.includes(documentType)) {
    documentType = detectDocumentTypeFromText(rawText);
  }

  let fields = parseExtractedFields(parsed, documentType, 0.5);
  if (fields.vehicleNo && !VEHICLE_NO_PATTERN.test(fields.vehicleNo)) {
    fields.vehicleNo = undefined;
  }
  let issues = getValidationIssues(fields, documentType);

  if (shouldRetryOcr(issues, fields.confidence ?? 0.5)) {
    const hints = await getContextualOcrHints(documentType, fields);
    if (hints.length > 0) {
      const secondPass = await runOcrPass(hints.map((h) => `- ${h}`).join('\n'));
      const retryParsed = secondPass.parsed;
      let retryDocumentType = (retryParsed.documentType as DocumentType) ?? documentType;
      if (!validTypes.includes(retryDocumentType)) retryDocumentType = documentType;

      const retryFields = parseExtractedFields(retryParsed, retryDocumentType, fields.confidence ?? 0.5);
      const retryIssues = getValidationIssues(retryFields, retryDocumentType);
      const retryScore = (retryFields.confidence ?? 0) - retryIssues.length * ISSUE_PENALTY_WEIGHT;
      const currentScore = (fields.confidence ?? 0) - issues.length * ISSUE_PENALTY_WEIGHT;
      if (retryScore >= currentScore) {
        fields = retryFields;
        documentType = retryDocumentType;
        rawResponse = secondPass.rawResponse;
        issues = retryIssues;
      }
    }
  }

  fields.validationIssues = issues;
  fields.fieldConfidence = computeFieldConfidence(fields, fields.confidence ?? 0.5, issues);

  return {
    fields,
    rawResponse,
    documentType,
    confidence: fields.confidence ?? 0.5,
  };
}
