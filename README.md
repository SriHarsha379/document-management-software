# document-management-software

A minimal web OCR module with camera capture/upload and OpenAI Vision extraction.

## Features

- Camera capture (`getUserMedia`) and file upload
- Supported file types: JPG, PNG, PDF
- Max upload size: 5MB (client + server validation)
- OCR endpoint: `POST /api/ocr/extract`
- PDF first-page conversion to image before OCR
- OpenAI Responses API integration (server-side key only)
- Extracted text + metadata (`timestamp`, `fileName`, `contentType`, `page` for PDFs)

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create env file:

```bash
cp .env.example .env
```

3. Set your OpenAI key in `.env`:

```env
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_OCR_MODEL=gpt-4o-mini
PORT=3000
```

## Run

```bash
npm start
```

Open: `http://localhost:3000`

## Test

```bash
npm test
```

## API

### `POST /api/ocr/extract`

- Content-Type: `multipart/form-data`
- Field name: `file`
- Accepted MIME types:
  - `image/jpeg`
  - `image/png`
  - `application/pdf`
- Max size: `5MB`

Response:

```json
{
  "text": "...",
  "metadata": {
    "timestamp": "2026-04-23T00:00:00.000Z",
    "fileName": "scan.png",
    "contentType": "image/png",
    "page": 1
  }
}
```

## Notes

- `OPENAI_API_KEY` is only used on the backend and is never exposed to frontend code.
- PDF OCR uses `pdfjs-dist` with `@napi-rs/canvas` to render the first page to PNG before sending to OpenAI Vision.
