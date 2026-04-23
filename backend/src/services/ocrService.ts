import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import type { DocumentType, ExtractedFields, OcrResult } from '../types/index.js';

const DOCUMENT_TYPE_KEYWORDS: Record<DocumentType, string[]> = {
  LR: ['lorry receipt', 'lr no', 'lr number', 'consignment note', 'bilty', 'goods receipt'],
  INVOICE: ['invoice', 'bill', 'gst invoice', 'tax invoice', 'proforma', 'invoice no', 'invoice number'],
  TOLL: ['toll', 'toll tax', 'toll receipt', 'national highway', 'fastag', 'toll plaza'],
  WEIGHMENT: ['weighment', 'weight slip', 'gross weight', 'tare weight', 'net weight', 'weighbridge'],
  EWAYBILL: ['e-way bill', 'eway bill', 'e way bill', 'ewb no', 'ewb number', 'eway'],
  RECEIVING: ['receiving', 'delivery receipt', 'pod', 'proof of delivery', 'receiving copy', 'unloading report'],
  UNKNOWN: [],
};

const OCR_SYSTEM_PROMPT = `You are an expert OCR assistant for a logistics document management system in India.
Analyze the provided document image and extract structured data.

Always respond with a valid JSON object with these exact fields:
{
  "documentType": "<LR|INVOICE|TOLL|WEIGHMENT|EWAYBILL|RECEIVING|UNKNOWN>",
  "confidence": <0.0-1.0>,
  "lrNo": "<LR number or null>",
  "invoiceNo": "<invoice number or null>",
  "vehicleNo": "<vehicle registration number in format like MH12AB1234 or null>",
  "quantity": "<quantity with unit, e.g. '10 MT', '500 bags' or null>",
  "date": "<date in YYYY-MM-DD format or null>",
  "partyNames": ["<consignor name>", "<consignee name>"],
  "tollAmount": "<toll amount with currency, e.g. '₹120' or null>",
  "weightInfo": "<weight details, e.g. 'Gross: 15000 kg, Tare: 5000 kg, Net: 10000 kg' or null>",
  "rawText": "<full text extracted from document>"
}

Document type detection rules:
- LR (Lorry Receipt): Has LR number, consignor, consignee, vehicle number, goods description
- INVOICE: Has invoice number, buyer/seller details, item list, GST number, amounts
- TOLL: Has toll plaza name, vehicle number, amount, date/time
- WEIGHMENT: Has weighbridge details, vehicle number, gross/tare/net weight
- EWAYBILL: Has E-way Bill number, GSTIN, HSN code, transporter details
- RECEIVING: Has receiving/delivery acknowledgement, POD, signature, unloading details

Extract vehicle numbers carefully - they follow Indian format like MH12AB1234, GJ05CD5678.
For dates, normalize to YYYY-MM-DD format.
If a field is not found or unclear, return null for that field.`;

function detectDocumentTypeFromText(text: string): DocumentType {
  const lower = text.toLowerCase();
  const scores: Record<DocumentType, number> = {
    LR: 0,
    INVOICE: 0,
    TOLL: 0,
    WEIGHMENT: 0,
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
            text: 'Extract all structured fields from this logistics document. Return only the JSON object.',
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

  const rawText = typeof parsed.rawText === 'string' ? parsed.rawText : rawContent;
  let documentType = (parsed.documentType as DocumentType) ?? 'UNKNOWN';

  const validTypes: DocumentType[] = ['LR', 'INVOICE', 'TOLL', 'WEIGHMENT', 'EWAYBILL', 'RECEIVING', 'UNKNOWN'];
  if (!validTypes.includes(documentType)) {
    documentType = detectDocumentTypeFromText(rawText);
  }

  const partyNamesRaw = parsed.partyNames;
  const partyNames: string[] = Array.isArray(partyNamesRaw)
    ? partyNamesRaw.filter((p): p is string => typeof p === 'string')
    : [];

  const fields: ExtractedFields = {
    lrNo: typeof parsed.lrNo === 'string' ? parsed.lrNo : undefined,
    invoiceNo: typeof parsed.invoiceNo === 'string' ? parsed.invoiceNo : undefined,
    vehicleNo: typeof parsed.vehicleNo === 'string' ? parsed.vehicleNo : undefined,
    quantity: typeof parsed.quantity === 'string' ? parsed.quantity : undefined,
    date: typeof parsed.date === 'string' ? parsed.date : undefined,
    partyNames: partyNames.length > 0 ? partyNames : undefined,
    tollAmount: typeof parsed.tollAmount === 'string' ? parsed.tollAmount : undefined,
    weightInfo: typeof parsed.weightInfo === 'string' ? parsed.weightInfo : undefined,
    documentType,
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
  };

  return {
    fields,
    rawResponse,
    documentType,
    confidence: fields.confidence ?? 0.5,
  };
}
