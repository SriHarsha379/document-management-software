const OpenAI = require('openai');
const { createCanvas } = require('@napi-rs/canvas');

const OCR_PROMPT = 'Extract all readable text from this image. Return clean structured text.';

async function convertPdfFirstPageToPng(pdfBuffer) {
  try {
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer), useSystemFonts: true });
    const pdf = await loadingTask.promise;

    if (pdf.numPages < 1) {
      throw new Error('PDF has no pages.');
    }

    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext('2d');

    await page.render({ canvasContext: context, viewport }).promise;

    return { imageBuffer: canvas.toBuffer('image/png'), page: 1, contentType: 'image/png' };
  } catch (error) {
    const conversionError = new Error('Unable to process the PDF file. Please upload a valid PDF.');
    conversionError.statusCode = 400;
    throw conversionError;
  }
}

function buildDataUrl(buffer, contentType) {
  return `data:${contentType};base64,${buffer.toString('base64')}`;
}

function extractOutputText(response) {
  if (typeof response.output_text === 'string' && response.output_text.trim()) {
    return response.output_text.trim();
  }

  const output = Array.isArray(response.output) ? response.output : [];
  const chunks = output
    .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
    .filter((item) => item && typeof item.text === 'string')
    .map((item) => item.text.trim())
    .filter(Boolean);

  return chunks.join('\n').trim();
}

async function extractTextFromFile(file) {
  let imageBuffer = file.buffer;
  let contentType = file.mimetype;
  let page;

  if (file.mimetype === 'application/pdf') {
    const converted = await convertPdfFirstPageToPng(file.buffer);
    imageBuffer = converted.imageBuffer;
    contentType = converted.contentType;
    page = converted.page;
  }

  const imageDataUrl = buildDataUrl(imageBuffer, contentType);

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  let response;
  try {
    response = await client.responses.create({
      model: process.env.OPENAI_OCR_MODEL || 'gpt-4o-mini',
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: OCR_PROMPT },
            { type: 'input_image', image_url: imageDataUrl }
          ]
        }
      ]
    });
  } catch (error) {
    const ocrError = new Error('OCR service is temporarily unavailable. Please try again.');
    ocrError.statusCode = 502;
    throw ocrError;
  }

  const text = extractOutputText(response);

  return {
    text,
    metadata: {
      timestamp: new Date().toISOString(),
      fileName: file.originalname,
      contentType: file.mimetype,
      ...(page ? { page } : {})
    }
  };
}

module.exports = { extractTextFromFile, buildDataUrl, extractOutputText, convertPdfFirstPageToPng };
