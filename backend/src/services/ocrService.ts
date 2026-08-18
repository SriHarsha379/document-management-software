import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import sharp from 'sharp';
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
import { splitPdfToPageImages, getPdfPageCount, MAX_PDF_PAGES } from './pdfSplitService.js';

/** One page's OCR outcome. `result` is null when that page failed to read. */
export interface PageOcrResult {
  pageNumber: number;
  result: OcrResult | null;
  error?: string;
}

const WEIGHMENT_TYPES: DocumentType[] = ['WEIGHMENT', 'WEIGHMENT_PARTY', 'WEIGHMENT_SITE'];
const VALID_TYPES: DocumentType[] = ['LR', 'INVOICE', 'TOLL', 'WEIGHMENT', 'WEIGHMENT_PARTY', 'WEIGHMENT_SITE', 'EWAYBILL', 'RECEIVING', 'UNKNOWN'];
type ImageQuality = 'HIGH' | 'MEDIUM' | 'LOW';
const CLASSIFICATION_WEIGHT = 0.4;
const OCR_WEIGHT = 0.6;

/**
 * Coerce a model-supplied numeric field.
 *
 * Vision models return weights as numbers, as quoted strings ("34690"), and
 * occasionally with units or separators ("34,690.00 Kgs"). Accepting only
 * `typeof === 'number'` silently drops most real readings, so parse loosely
 * and reject only what genuinely isn't a number.
 */
function numOrUndef(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** For weighment slips only vehicleNo, date, weightInfo, sealNo, and documentTime should be retained; strip everything else. */
function restrictToWeighmentFields(fields: ExtractedFields): ExtractedFields {
  return {
    vehicleNo: fields.vehicleNo,
    date: fields.date,
    weightInfo: fields.weightInfo,
    sealNo: fields.sealNo,
    documentTime: fields.documentTime,
    // Weighbridge specifics: these are the whole point of a weighment slip, so
    // stripping them here would defeat the challanNo / netWeight tiers and the
    // origin-vs-destination classifier.
    challanNo: fields.challanNo,
    bridgeName: fields.bridgeName,
    grossWeightKg: fields.grossWeightKg,
    tareWeightKg: fields.tareWeightKg,
    firstWeightKg: fields.firstWeightKg,
    secondWeightKg: fields.secondWeightKg,
    netWeightKg: fields.netWeightKg,
    grossWeightAt: fields.grossWeightAt,
    tareWeightAt: fields.tareWeightAt,
    firstWeightAt: fields.firstWeightAt,
    secondWeightAt: fields.secondWeightAt,
    statedWeightDiffKg: fields.statedWeightDiffKg,
    documentType: fields.documentType,
    confidence: fields.confidence,
    classificationConfidence: fields.classificationConfidence,
    ocrConfidence: fields.ocrConfidence,
    appliedRotation: fields.appliedRotation,
    imageQuality: fields.imageQuality,
    processingNotes: fields.processingNotes,
    fieldConfidence: fields.fieldConfidence,
    validationIssues: fields.validationIssues,
    additionalWeighments: fields.additionalWeighments,
  };
}

function parseAdditionalTollEntries(raw: unknown): ExtractedFields['additionalTollEntries'] {
  if (!Array.isArray(raw)) return undefined;
  const entries = raw
    .filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null)
    .map((e) => ({
      tollAmount: typeof e.tollAmount === 'string' ? e.tollAmount : undefined,
      documentTime: typeof e.documentTime === 'string' ? e.documentTime : undefined,
      vehicleNo: typeof e.vehicleNo === 'string' ? e.vehicleNo : undefined,
      date: typeof e.date === 'string' ? e.date : undefined,
    }))
    .filter((e) => e.tollAmount || e.documentTime);
  return entries.length > 0 ? entries : undefined;
}

function parseAdditionalWeighments(raw: unknown): ExtractedFields['additionalWeighments'] {
  if (!Array.isArray(raw)) return undefined;
  const entries = raw
    .filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null)
    .map((e) => ({
      vehicleNo: typeof e.vehicleNo === 'string' ? e.vehicleNo : undefined,
      date: typeof e.date === 'string' ? e.date : undefined,
      weightInfo: typeof e.weightInfo === 'string' ? e.weightInfo : undefined,
      sealNo: typeof e.sealNo === 'string' ? e.sealNo : undefined,
      documentTime: typeof e.documentTime === 'string' ? e.documentTime : undefined,
      documentType: (WEIGHMENT_TYPES.includes(e.documentType as DocumentType)
        ? (e.documentType as DocumentType)
        : undefined),
    }))
    .filter((e) => e.weightInfo);
  return entries.length > 0 ? entries : undefined;
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
    ewayBillDate: typeof parsed.ewayBillDate === 'string' ? parsed.ewayBillDate : undefined,
    approvedDestination: typeof parsed.approvedDestination === 'string' ? parsed.approvedDestination : undefined,
    deliveryDestination: typeof parsed.deliveryDestination === 'string' ? parsed.deliveryDestination : undefined,
    orderNo: typeof parsed.orderNo === 'string' ? parsed.orderNo : undefined,
    productName: typeof parsed.productName === 'string' ? parsed.productName : undefined,
    transporterName: typeof parsed.transporterName === 'string' ? parsed.transporterName : undefined,
    orderType: typeof parsed.orderType === 'string' ? parsed.orderType : undefined,
    tptCode: typeof parsed.tptCode === 'string' ? parsed.tptCode : undefined,
    quantityInMt: typeof parsed.quantityInMt === 'number' ? parsed.quantityInMt : undefined,
    quantityInBags: typeof parsed.quantityInBags === 'number' ? parsed.quantityInBags : undefined,
    driverName: typeof parsed.driverName === 'string' ? parsed.driverName : undefined,
    driverCellNo: typeof parsed.driverCellNo === 'string' ? parsed.driverCellNo : undefined,
    workingCenter: typeof parsed.workingCenter === 'string' ? parsed.workingCenter : undefined,
    depotPlantCode: typeof parsed.depotPlantCode === 'string' ? parsed.depotPlantCode : undefined,
    source: typeof parsed.source === 'string' ? parsed.source : undefined,
    sealNo: typeof parsed.sealNo === 'string' ? parsed.sealNo : undefined,
    documentTime: typeof parsed.documentTime === 'string' ? parsed.documentTime : undefined,
    hasStamp: parsed.hasStamp === true,
    hasSignature: parsed.hasSignature === true,

    // Weighbridge fields. The prompt asks for these; without parsing them here
    // they never reach extracted_data and the challanNo / netWeight link tiers
    // can never fire.
    challanNo: typeof parsed.challanNo === 'string' ? parsed.challanNo : undefined,
    bridgeName: typeof parsed.bridgeName === 'string' ? parsed.bridgeName : undefined,
    grossWeightKg: numOrUndef(parsed.grossWeightKg),
    tareWeightKg: numOrUndef(parsed.tareWeightKg),
    firstWeightKg: numOrUndef(parsed.firstWeightKg),
    secondWeightKg: numOrUndef(parsed.secondWeightKg),
    netWeightKg: numOrUndef(parsed.netWeightKg),
    grossWeightAt: typeof parsed.grossWeightAt === 'string' ? parsed.grossWeightAt : undefined,
    tareWeightAt: typeof parsed.tareWeightAt === 'string' ? parsed.tareWeightAt : undefined,
    firstWeightAt: typeof parsed.firstWeightAt === 'string' ? parsed.firstWeightAt : undefined,
    secondWeightAt: typeof parsed.secondWeightAt === 'string' ? parsed.secondWeightAt : undefined,
    statedWeightDiffKg: numOrUndef(parsed.statedWeightDiffKg),

    documentType,
    confidence: typeof parsed.ocrConfidence === 'number'
      ? parsed.ocrConfidence
      : typeof parsed.confidence === 'number'
        ? parsed.confidence
        : defaultConfidence,
    classificationConfidence: typeof parsed.classificationConfidence === 'number'
      ? parsed.classificationConfidence
      : typeof parsed.confidence === 'number'
        ? parsed.confidence
        : defaultConfidence,
    ocrConfidence: typeof parsed.ocrConfidence === 'number'
      ? parsed.ocrConfidence
      : typeof parsed.confidence === 'number'
        ? parsed.confidence
        : defaultConfidence,
    additionalTollEntries: parseAdditionalTollEntries(parsed.additionalTollEntries),
    additionalWeighments: parseAdditionalWeighments(parsed.additionalWeighments),
  };
  const normalized = normalizeExtractedFields(fields);
  if (WEIGHMENT_TYPES.includes(documentType)) {
    return restrictToWeighmentFields(normalized);
  }
  return normalized;
}

const DOCUMENT_TYPE_KEYWORDS: Record<DocumentType, string[]> = {
  LR: ['lorry receipt', 'lr no', 'lr number', 'consignment note', 'bilty', 'goods receipt'],
  INVOICE: ['invoice', 'bill', 'gst invoice', 'tax invoice', 'proforma', 'invoice no', 'invoice number'],
  TOLL: ['toll', 'toll tax', 'toll receipt', 'toll gate slip', 'national highway', 'fastag', 'toll plaza'],
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
- TOLL: Toll gate slip / toll receipt from a highway or expressway toll plaza. Contains toll plaza name, vehicle number, and amount collected.
- WEIGHMENT_PARTY: Party weighment slip. Usually taken at loading/origin/plant/party location before the trip starts.
- WEIGHMENT_SITE: Site weighment slip. Usually taken at delivery/site/destination or unloading location after the trip ends.
- WEIGHMENT: Generic weighbridge or weighment slip when it is clearly a weighment document but origin (party) vs destination (site) cannot be determined.
- EWAYBILL: E-Way Bill document with EWB/EWay Bill number, GSTIN, and transporter details.
- RECEIVING: Delivery or receiving acknowledgement, proof of delivery (POD), unloading report.

STEP 2 — Extract fields according to the identified document type using the rules below.

=== ACKNOWLEDGEMENT VISUAL CHECKS ===
These checks must be based on what is VISIBLY PRESENT in the document image.

- hasStamp: true ONLY when the RECIPIENT/CUSTOMER acknowledgement area has a physical/ink stamp, seal, rubber stamp, company stamp, or clearly stamped "received" mark.
- hasSignature: true ONLY when that same recipient/customer acknowledgement area has a handwritten/ink signature or clearly handwritten sign-off. A round recipient stamp with an ink signature across or next to it counts.
- Do NOT count the issuer's pre-printed/digital "Signature valid", "Authorised Signatory", QR-code, or a blank "Receiver's Signature with Seal" box.
- Do NOT count printed company logos, printed names, typed names, printed words such as "STAMP" or "SIGNATURE", watermarks, or ordinary document text.
- Do NOT infer a stamp or signature merely because the document type normally requires one.
- If you cannot clearly see the stamp or signature, return false.
- These are visual checks and must not depend only on OCR text.


=== FOR LR (Lorry Receipt) ===
- lrNo: LR / consignment number — look for labels "LR No", "LR No.", "L.R. No.", "LR Number", "Consignment No."
- loadingSlipNo: Loading slip number — look for labels "LS No", "L.S. No.", "Loading Slip No.", "LS No."
- sealNo: Seal number — look for labels "Seal No.", "Seal No", "SEAL NO."
- documentTime: The LR's "Out Time" (time the vehicle left), e.g. "11:38:17" or "17:56". Look for a label "Out Time" near the LR date. Return in HH:MM or HH:MM:SS 24-hour format exactly as printed. Return null if not present.
- invoiceNo: Supplier invoice number on the LR — look for "Invoice No", "Invoice No."
- companyInvoiceDate: Invoice date / "Inv Date" / "In Date" in YYYY-MM-DD (convert DD/MM/YYYY, DD-MM-YYYY, or DD.MM.YYYY)
- companyEwayBillNo: E-Way Bill number — look for "E-Way Bill No", "E-Way Bill No.", "EWB No."
- ewayBillDate: E-Way Bill date in YYYY-MM-DD (convert DD/MM/YYYY, DD-MM-YYYY, or DD.MM.YYYY)
- vehicleNo: Truck/vehicle registration number — look for "Truck No.", "Vehicle No.", "Lorry No.", "Truck No"
- date: LR date or document date in YYYY-MM-DD (convert DD/MM/YYYY, DD-MM-YYYY, or DD.MM.YYYY)
- billToParty: The "BILL TO PARTY" company name
- shipToParty: The "SHIP TO PARTY" company name (delivery address party)
- approvedDestination: Approved destination / sanctioned destination — look for labels like "Approved Destination"
- deliveryDestination: Delivered destination / destination city / "To Destination" city or location
- principalCompany: The principal/client company name on the LR — the company whose goods are being transported. Look first for an explicit label such as "Principal Company:", "Principal:", or "Company:". If no label is present, extract the most prominent company name from the document header (the consignor/sender company at the top of the document). This is the client company, NOT the transport/carrier company. Return the full name exactly as printed (e.g. "MY HOME INDUSTRIES PRIVATE LIMITED"). Return null if no company name can be identified.
- branchName: The branch of the principal/issuing company on the LR. Look first for an explicit "Branch:" label anywhere in the document header area; use the value that follows the label, normalized to UPPERCASE, and strip the word "BRANCH" from the end if present (e.g. "Dronagiri Branch" → "DRONAGIRI"). If no explicit "Branch:" label exists, extract the most specific locality or area name from the company/consignor header address block, normalized to UPPERCASE (e.g. "DRONAGIRI" from an address like "Dronagiri, Navi Mumbai"). Do not use a generic city or district name when a more specific locality is present. Always return a bare locality name without the word "BRANCH". Return null if no branch or locality can be identified.
- source: The source city/location from the sender's header address block, normalized to UPPERCASE (e.g. "NAVI MUMBAI"). Prefer the city token immediately following locality in the same address line.
- workingCenter: Working center / working centre name
- depotPlantCode: Depot code / plant code / depot-plant code
- productName: Product or commodity being transported — look for "PRODUCT", "Goods Description", "Item"
- quantity: Quantity with unit — look for "QUANTITY IN MT", "Qty", e.g. "35.38 MT" or "500 Bags"
- quantityInMt: Numeric quantity in metric tonnes — extract only the number from quantity, e.g. 35.38 (float). Return null if unit is not MT/MTS/tonnes.
- quantityInBags: Numeric quantity in bags — extract only the number, e.g. 500 (float). Return null if not in bags.
- orderNo: Order number — look for "Order No", "Order Number", "SO No"
- orderType: Order type — look for "ORDER TYPE", "Order Type", e.g. "BULK ORDER", "BAG ORDER"
- tptCode: Transport/TPT code — look for "T.P.T Code", "TPT Code", "TPT"
- driverName: Driver's name — look for "Driver Name", "Driver Name :", "Drfver Name" (OCR variant)
- driverCellNo: Driver's mobile/cell number — look for "Driver Cell No", "Driver Cell No.", "Driver Mobile", "Cell No"
- partyNames: Array [consignor/sender name, consignee/receiver name] — look for "From", "Consignor", "Sender" for index 0; "To", "Consignee", "Receiver" for index 1
- transporterName: The transport company name (usually printed as the issuing company on the document header)

=== FOR WEIGHMENT (Weighbridge Slip) ===
Extract ONLY the five fields below. Set every other field to null.
- vehicleNo: Vehicle registration number — look for "VEHICLE NO", "Vehicle No.", "Veh. No.", "Truck No."
- date: Date from the slip in YYYY-MM-DD. The date may appear as "DT:DD-MM-YYYY TM:HH:MM" (e.g. "DT:16-09-2025 TM:12:05") or "DD/MM/YYYY" — extract only the date part and convert to YYYY-MM-DD.
- weightInfo: Weight details from the slip — look for gross weight, tare weight, and net weight labels (e.g. "Gross Wt", "Tare Wt", "Net Wt", "GWT", "TWt", "NWT"). Combine all weight readings into a single string, e.g. "Gross: 49670 kg, Tare: 14290 kg, Net: 35380 kg".
- sealNo: A seal number written or stamped on the slip — this is often a HANDWRITTEN annotation (pen, marker, or a circled number) rather than a printed field, sometimes next to a label like "Seal No", "seal no.", or just written near the vehicle number. Only return it if it is explicitly labelled or clearly identifiable as a seal number — do not guess from an unlabelled circled number, since slips are sometimes annotated with other reference numbers (e.g. an invoice number) instead. Return null if uncertain.
- documentTime: The weighment time-of-day — prefer the "out" / second weighing time if the slip shows separate in/out or first/second weighing times (e.g. "Date time Out", "TM:", "Second Weight Date Time"); otherwise use whatever single time is printed. Return in HH:MM or HH:MM:SS 24-hour format. Return null if not present.
- If the slip explicitly indicates PARTY / LOADING / PLANT / ORIGIN weighment, classify as WEIGHMENT_PARTY.
- If the slip explicitly indicates SITE / DESTINATION / DELIVERY / UNLOADING weighment, classify as WEIGHMENT_SITE.
- Otherwise classify as WEIGHMENT.
- WEIGHBRIDGE READING LABELS: bridges use two different conventions and you must capture whichever is present, without converting between them. (a) Some label "Gross weight" and "Tare weight" — put these in grossWeightKg / tareWeightKg. (b) Others (e.g. PROCON RMC) label "First Weight" and "Second Weight" and never print the words gross or tare — put these in firstWeightKg / secondWeightKg IN THE ORDER PRINTED. The order matters: it records whether the truck arrived loaded or empty, which is how origin is told from destination. Never relabel a "First Weight" as gross.
- WEIGHBRIDGE TIMESTAMPS: capture the timestamp of EACH reading separately when the slip prints them ("Gross Weight Date Time" / "Tare Weight Date Time", or "First Weight Date Time" / "Second Weight Date Time") into grossWeightAtMs / tareWeightAtMs / firstWeightAtMs / secondWeightAtMs as ISO 8601 strings. These readings routinely straddle midnight (e.g. first at 13 May 23:23, second at 14 May 00:50) so ALWAYS include the date with the time, never the time alone. A gate slip's "Date time In / Out" is the visit as a whole, not a per-reading timestamp — do not put it in these fields.
- CHALLAN / GRN NUMBER: weighbridge slips print a "Challan No" or "GRN No". Extract it verbatim into challanNo. It is sometimes exactly the tax invoice number and sometimes a completely different series — report what is printed and never adjust it to match another document.
- WEIGHBRIDGE NAME: extract the weighbridge or company name from the slip's letterhead into bridgeName.
- IMPORTANT — MULTIPLE SLIPS ON ONE IMAGE: source documents are frequently a single sheet with TWO weighbridge slips stacked on it (e.g. an origin/party slip printed above a destination/site slip, or two separate weighbridge dockets pasted one under the other). Extract the FIRST (topmost) slip into the main vehicleNo/date/weightInfo/sealNo/documentTime/documentType fields as usual. If a SECOND, clearly distinct weighment slip is visible lower on the same image, extract it into "additionalWeighments" as an array with one object per extra slip using the same field names (vehicleNo, date, weightInfo, sealNo, documentTime, documentType). Do not merge the two slips' weight readings into one string. If there is only one slip on the image, omit "additionalWeighments" or return an empty array.

=== FOR INVOICE (Tax Invoice / GST Invoice) ===
- invoiceNo: Invoice number — look for "Invoice No", "Invoice No."
- date: Invoice date in YYYY-MM-DD (convert DD/MM/YYYY or DD.MM.YYYY)
- companyInvoiceDate: Invoice date / "Inv Date" / "In Date" in YYYY-MM-DD (convert DD/MM/YYYY, DD-MM-YYYY, or DD.MM.YYYY)
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
- ewayBillDate: E-Way Bill date in YYYY-MM-DD (convert DD/MM/YYYY, DD-MM-YYYY, or DD.MM.YYYY)

=== FOR TOLL ===
- vehicleNo: Vehicle registration number
- date: Date in YYYY-MM-DD
- tollAmount: Amount collected with currency symbol, e.g. "₹120" or "Rs.150"
- documentTime: The time the toll was debited — look for "Debited at", e.g. "03:05 PM". Convert to 24-hour HH:MM. Return null if not present.
- IMPORTANT — MULTIPLE TOLL ENTRIES ON ONE IMAGE: toll documents are very often phone screenshots of a FASTag/toll app showing a LIST of swipes (e.g. two or more "FASTag Swipe" entries for the same trip, sometimes at different plazas or times, occasionally for different vehicles if the driver's phone is shared across a fleet). Extract the FIRST (topmost) entry into the main tollAmount/documentTime/vehicleNo/date fields as usual. For every ADDITIONAL entry visible in the same screenshot, add one object to "additionalTollEntries" with tollAmount, documentTime, and — only if it differs from the first entry's vehicle — vehicleNo and date. Never sum multiple entries into a single tollAmount string; report each one separately. If there is only one entry, omit "additionalTollEntries" or return an empty array.

Always respond with a valid JSON object with EXACTLY these fields:
{
  "documentType": "<LR|INVOICE|TOLL|WEIGHMENT|EWAYBILL|RECEIVING|UNKNOWN>",
  "classificationConfidence": <0.0-1.0>,
  "ocrConfidence": <0.0-1.0>,
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
  "ewayBillDate": "<E-way Bill date in YYYY-MM-DD format or null>",
  "approvedDestination": "<approved destination or null>",
  "deliveryDestination": "<delivery destination city/location or null>",
  "orderNo": "<order number or null>",
  "productName": "<name of the product/commodity being transported or null>",
  "transporterName": "<name of the transport company/transporter or null>",
  "orderType": "<order type e.g. 'BULK ORDER', 'BAG ORDER' or null>",
  "tptCode": "<T.P.T code / TPT code or null>",
  "driverName": "<driver's name from 'Driver Name' label or null>",
  "driverCellNo": "<driver's cell/mobile number from 'Driver Cell No' label or null>",
  "workingCenter": "<working center / working centre name or null>",
  "depotPlantCode": "<depot or plant code or null>",
  "source": "<source location from sender/company header for LR and INVOICE (use explicit 'Source:' label when present, otherwise infer city/location from address block) or null>",
  "sealNo": "<seal number — printed 'Seal No.' on an LR, or a labelled handwritten seal number on a weighment slip — or null>",
  "documentTime": "<time-of-day this document records (LR Out Time, weighment in/out time, or toll debited time) in HH:MM or HH:MM:SS 24-hour format, or null>",
  "hasStamp": <true if a physical/ink stamp is visibly present, otherwise false>,
  "hasSignature": <true if a handwritten/ink signature is visibly present, otherwise false>,
  "additionalTollEntries": [{"tollAmount": "<amount or null>", "documentTime": "<HH:MM or null>", "vehicleNo": "<only if different from main vehicleNo, else null>", "date": "<only if different from main date, else null>"}],
  "grossWeightKg": <number or null>,
  "tareWeightKg": <number or null>,
  "firstWeightKg": <number or null>,
  "secondWeightKg": <number or null>,
  "grossWeightAt": "<ISO 8601 datetime or null>",
  "tareWeightAt": "<ISO 8601 datetime or null>",
  "firstWeightAt": "<ISO 8601 datetime or null>",
  "secondWeightAt": "<ISO 8601 datetime or null>",
  "challanNo": "<or null>",
  "bridgeName": "<or null>",
  "statedWeightDiffKg": <number or null>,
  "additionalWeighments": [{"vehicleNo": "<or null>", "date": "<or null>", "weightInfo": "<or null>", "sealNo": "<or null>", "documentTime": "<or null>", "documentType": "<WEIGHMENT|WEIGHMENT_PARTY|WEIGHMENT_SITE>"}],
  "rawText": "<full text extracted from document>"
}

"additionalTollEntries" and "additionalWeighments" should be omitted or empty arrays when the image contains only a single toll entry / single weighment slip — most documents. Only populate them when you can clearly see a second, distinct entry on the same image.

Important rules:
- Indian vehicle registration format: MH46CL9571, GJ05CD5678, MH12AB1234 — always uppercase, no spaces.
- LR numbers may contain slashes, e.g. "SP/DR/LR/25-26/1433" — capture the full value exactly.
- For dates: convert DD/MM/YYYY → YYYY-MM-DD, DD-MM-YYYY → YYYY-MM-DD, and DD.MM.YYYY → YYYY-MM-DD (dot-separated dates are common on printed invoices, e.g. "12.05.2026" means 12 May 2026 — do not mistake the dots for a decimal number or guess an unrelated year). Read the year digit by digit carefully (e.g. 2-0-2-5 = 2025, not 2020; 2-0-2-6 = 2026, not 2020 or 2023).
- For weighment slips the date often appears alongside a time stamp like "DT:16-09-2025 TM:12:05" — extract only the date portion.
- quantityInMt and quantityInBags must be plain numbers (no units), e.g. 35.38 not "35.38 MT".
- If a field is not present or cannot be read clearly, return null for that field.
- Use lower confidence values when the page is blurry, noisy, incomplete, skewed, or rotated.
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

/**
 * Converts a PDF file to a PNG image using pdftoppm (poppler-utils).
 * Returns the path to the generated PNG and the temp directory to clean up.
 *
 * Install poppler:
 *   macOS:  brew install poppler
 *   Ubuntu: apt install poppler-utils
 */
function convertPdfToImage(pdfPath: string): { imagePath: string; tempDir: string } {
  // FIRST PAGE ONLY. Correct for single-page PDFs, which is what the upload
  // route sends here — routes/documents.ts already splits multi-page PDFs into
  // one Document per page via pdfSplitService before OCR runs.
  //
  // Callers that may receive a multi-page PDF (e.g. the driver portal) must use
  // processDocumentOcrAllPages instead, or they will silently lose every page
  // after the first.
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-pdf-'));
  const outPrefix = path.join(tempDir, 'page');

  try {
    execSync(`pdftoppm -r 200 -png -f 1 -l 1 "${pdfPath}" "${outPrefix}"`, { stdio: 'pipe' });
  } catch (err) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `PDF conversion failed. Make sure poppler is installed.\n` +
        `  macOS:  brew install poppler\n` +
        `  Ubuntu: apt install poppler-utils\n\nOriginal error: ${msg}`,
    );
  }

  const pages = fs.readdirSync(tempDir).filter((f) => f.endsWith('.png')).sort();
  if (pages.length === 0) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw new Error('PDF to image conversion produced no output pages.');
  }
  return { imagePath: path.join(tempDir, pages[0]!), tempDir };
}

async function prepareImageVariants(sourcePath: string): Promise<{
  variants: Array<{ path: string; rotation: number }>;
  tempDir: string;
  imageQuality: ImageQuality;
  processingNotes: string[];
}> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-preprocessed-'));
  const metadata = await sharp(sourcePath, { failOn: 'none' }).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const processingNotes = ['Applied auto-orientation, grayscale normalization, and sharpening before OCR'];

  let imageQuality: ImageQuality = 'HIGH';
  if (width < 900 || height < 900) {
    imageQuality = 'LOW';
    processingNotes.push('Upscaled a low-resolution scan before OCR');
  } else if (width < 1400 || height < 1400) {
    imageQuality = 'MEDIUM';
  }

  const baseImagePath = path.join(tempDir, 'base.png');
  let basePipeline = sharp(sourcePath, { failOn: 'none' })
    .rotate()
    .flatten({ background: '#ffffff' })
    .grayscale()
    .normalize()
    .sharpen();

  if (width > 0 && width < 1600) {
    basePipeline = basePipeline.resize({ width: 1600, fit: 'inside', withoutEnlargement: false });
  } else {
    basePipeline = basePipeline.resize({ width: 2200, fit: 'inside', withoutEnlargement: true });
  }

  await basePipeline.png({ compressionLevel: 9 }).toFile(baseImagePath);

  const rotations = [0, 90, 180, 270];
  const variants: Array<{ path: string; rotation: number }> = [];

  for (const rotation of rotations) {
    const outputPath = rotation === 0 ? baseImagePath : path.join(tempDir, `rot-${rotation}.png`);
    if (rotation !== 0) {
      await sharp(baseImagePath, { failOn: 'none' })
        .rotate(rotation)
        .png({ compressionLevel: 9 })
        .toFile(outputPath);
    }
    variants.push({ path: outputPath, rotation });
  }

  return { variants, tempDir, imageQuality, processingNotes };
}

function scoreOcrCandidate(
  fields: ExtractedFields,
  issues: string[],
  classificationConfidence: number,
  ocrConfidence: number,
): number {
  return classificationConfidence * CLASSIFICATION_WEIGHT + ocrConfidence * OCR_WEIGHT - issues.length * ISSUE_PENALTY_WEIGHT;
}

/**
 * OCR every page of a document.
 *
 * For a PDF this rasterises ALL pages and runs a full OCR pass per page,
 * returning one OcrResult each. For a single image it returns one result, so
 * callers can use this uniformly.
 *
 * This is the entry point uploads should use. `processDocumentOcr` reads only
 * the first page and is kept for callers that specifically want that.
 */
export async function processDocumentOcrAllPages(
  filePath: string,
  mimeType: string,
): Promise<PageOcrResult[]> {
  if (mimeType !== 'application/pdf') {
    const single = await processDocumentOcr(filePath, mimeType);
    return [{ pageNumber: 1, result: single }];
  }

  const pageCount = await getPdfPageCount(filePath);
  if (pageCount <= 1) {
    const single = await processDocumentOcr(filePath, mimeType);
    return [{ pageNumber: 1, result: single }];
  }
  if (pageCount > MAX_PDF_PAGES) {
    throw new Error(
      `PDF has ${pageCount} pages which exceeds the maximum of ${MAX_PDF_PAGES}.`,
    );
  }

  // Reuses the same splitter the upload route uses, so both ingestion paths
  // produce identical page images.
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-allpages-'));
  const results: PageOcrResult[] = [];

  try {
    const pages = await splitPdfToPageImages(filePath, tempDir);
    for (const page of pages) {
      try {
        const result = await processDocumentOcr(page.filePath, page.mimeType);
        results.push({ pageNumber: page.pageNumber, result });
      } catch (err) {
        // One unreadable page must never cost the rest of the bundle.
        console.error(`OCR failed for page ${page.pageNumber} of ${filePath}:`, err);
        results.push({
          pageNumber: page.pageNumber,
          result: null,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  return results;
}

export async function processDocumentOcr(filePath: string, mimeType: string): Promise<OcrResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is not set');
  }

  const client = new OpenAI({ apiKey });

  // ── PDF → PNG conversion ──────────────────────────────────────────────────
  // GPT-4o vision only accepts image types (jpeg/png/gif/webp).
  // PDFs must be rasterised to an image before being sent to the API.
  let actualFilePath = filePath;
  const tempDirs: string[] = [];

  if (mimeType === 'application/pdf') {
    const converted = convertPdfToImage(filePath);
    actualFilePath = converted.imagePath;
    tempDirs.push(converted.tempDir);
  }
  // ─────────────────────────────────────────────────────────────────────────

  try {
    const prepared = await prepareImageVariants(actualFilePath);
    tempDirs.push(prepared.tempDir);

    const runOcrPass = async (
      imagePath: string,
      extraGuidance?: string,
    ): Promise<{ parsed: Record<string, unknown>; rawResponse: string; rawContent: string }> => {
      const fileBuffer = fs.readFileSync(imagePath);
      const base64Image = fileBuffer.toString('base64');
      const ext = path.extname(imagePath).toLowerCase();
      let imageMediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' = 'image/jpeg';
      if (ext === '.png') imageMediaType = 'image/png';
      else if (ext === '.gif') imageMediaType = 'image/gif';
      else if (ext === '.webp') imageMediaType = 'image/webp';

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

    const evaluateCandidate = async (imagePath: string, rotation: number, extraGuidance?: string) => {
      const pass = await runOcrPass(imagePath, extraGuidance);
      const rawText = typeof pass.parsed.rawText === 'string' ? pass.parsed.rawText : pass.rawContent;
      let documentType = (pass.parsed.documentType as DocumentType) ?? 'UNKNOWN';
      if (!VALID_TYPES.includes(documentType)) {
        documentType = detectDocumentTypeFromText(rawText);
      }

      const fields = parseExtractedFields(pass.parsed, documentType, 0.5);
      if (fields.vehicleNo && !VEHICLE_NO_PATTERN.test(fields.vehicleNo)) {
        fields.vehicleNo = undefined;
      }

      const issues = getValidationIssues(fields, documentType);
      const classificationConfidence = fields.classificationConfidence ?? fields.confidence ?? 0.5;
      const ocrConfidence = fields.ocrConfidence ?? fields.confidence ?? 0.5;

      return {
        pass,
        documentType,
        fields,
        issues,
        rotation,
        classificationConfidence,
        ocrConfidence,
        score: scoreOcrCandidate(fields, issues, classificationConfidence, ocrConfidence),
      };
    };

    const firstVariant = prepared.variants[0];
    if (!firstVariant) {
      throw new Error('No image variants were prepared for OCR');
    }
    let bestCandidate = await evaluateCandidate(firstVariant.path, 0);

    if (shouldRetryOcr(bestCandidate.issues, bestCandidate.ocrConfidence) || bestCandidate.classificationConfidence < 0.75) {
      for (const variant of prepared.variants.slice(1)) {
        const candidate = await evaluateCandidate(variant.path, variant.rotation);
        if (candidate.score > bestCandidate.score) {
          bestCandidate = candidate;
        }
      }
    }

    if (shouldRetryOcr(bestCandidate.issues, bestCandidate.ocrConfidence)) {
      const hints = await getContextualOcrHints(bestCandidate.documentType, bestCandidate.fields);
      if (hints.length > 0) {
        const retryCandidate = await evaluateCandidate(
          prepared.variants.find((variant) => variant.rotation === bestCandidate.rotation)?.path ?? prepared.variants[0]!.path,
          bestCandidate.rotation,
          hints.map((hint) => `- ${hint}`).join('\n'),
        );
        if (retryCandidate.score >= bestCandidate.score) {
          bestCandidate = retryCandidate;
        }
      }
    }

    const fields = bestCandidate.fields;
    const issues = bestCandidate.issues;
    fields.confidence = bestCandidate.ocrConfidence;
    fields.classificationConfidence = bestCandidate.classificationConfidence;
    fields.ocrConfidence = bestCandidate.ocrConfidence;
    fields.appliedRotation = bestCandidate.rotation;
    fields.imageQuality = prepared.imageQuality;
    fields.processingNotes = [
      ...prepared.processingNotes,
      ...(bestCandidate.rotation !== 0 ? [`Selected a ${bestCandidate.rotation}° rotated variant after OCR scoring`] : []),
    ];
    fields.validationIssues = issues;
    fields.fieldConfidence = computeFieldConfidence(fields, bestCandidate.ocrConfidence, issues);

    return {
      fields,
      rawResponse: bestCandidate.pass.rawResponse,
      documentType: bestCandidate.documentType,
      confidence: bestCandidate.ocrConfidence,
      metadata: {
        classificationConfidence: bestCandidate.classificationConfidence,
        ocrConfidence: bestCandidate.ocrConfidence,
        appliedRotation: bestCandidate.rotation,
        imageQuality: prepared.imageQuality,
        processingNotes: fields.processingNotes,
        fieldConfidence: fields.fieldConfidence ?? {},
        validationIssues: issues,
      },
    };

  } finally {
    // Always clean up the temp directory created for PDF conversion
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}
