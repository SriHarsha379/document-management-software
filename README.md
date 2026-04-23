# Logistics DMS – OCR Ingestion Module

A full-stack Document Management System for logistics operations with AI-powered OCR to extract structured data from LR, Invoice, Toll, and Weighment documents.

## Features

- **Upload** documents (JPG, PNG, WEBP, PDF) via drag-and-drop or file picker
- **OCR** via OpenAI Vision API (GPT-4o) — auto-extracts:
  - LR No, Invoice No, Vehicle No, Quantity, Date, Party Names, Toll Amount, Weight Info
- **Auto-tagging** — classifies document as LR / Invoice / Toll / Weighment
- **Auto-linking** — groups documents sharing the same Vehicle Number + Date
- **Review & Edit** — user can correct any extracted field before saving
- **REST API** with pagination and filtering

## Architecture

```
document-management-software/
├── backend/          # Node.js + Express + TypeScript
│   ├── prisma/       # Database schema (SQLite) + migrations
│   └── src/
│       ├── routes/   # REST API endpoints
│       ├── services/ # OCR service + document service
│       └── middleware/ # Multer file upload
└── frontend/         # React + Vite + TypeScript
    └── src/
        ├── components/  # DocumentUpload, OCRReview, DocumentList
        └── services/    # API client (axios)
```

## Quick Start

### Prerequisites
- Node.js 18+
- OpenAI API key with access to `gpt-4o`

### Backend

```bash
cd backend
cp .env.example .env
# Edit .env and set OPENAI_API_KEY
npm install
npm run db:migrate     # Creates SQLite database
npm run dev            # Starts on http://localhost:3001
```

### Frontend

```bash
cd frontend
npm install
npm run dev            # Starts on http://localhost:5173
```

Open **http://localhost:5173** in your browser.

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/documents/upload` | Upload a document file |
| `POST` | `/api/documents/:id/ocr` | Run OCR on uploaded document |
| `PUT` | `/api/documents/:id/review` | Save reviewed/edited data |
| `GET` | `/api/documents` | List documents (with filters) |
| `GET` | `/api/documents/:id` | Get document with extracted data |
| `GET` | `/api/documents/groups/:groupId` | Get linked document group |
| `GET` | `/api/health` | Health check |

### Query params for `GET /api/documents`
- `type` — `LR | INVOICE | TOLL | WEIGHMENT | UNKNOWN`
- `status` — `PENDING_OCR | PENDING_REVIEW | SAVED`
- `vehicleNo` — filter by vehicle number (partial match)
- `page`, `limit` — pagination

### Review payload (`PUT /api/documents/:id/review`)
```json
{
  "documentType": "LR",
  "lrNo": "LR-2024-001",
  "invoiceNo": null,
  "vehicleNo": "MH12AB1234",
  "quantity": "10 MT",
  "date": "2024-01-15",
  "partyNames": ["ABC Traders", "XYZ Logistics"],
  "tollAmount": null,
  "weightInfo": null
}
```

## Database Schema

```
DocumentGroup  ← groups documents by vehicleNo + date
    └── Document  ← stores raw file info and type/status
            └── ExtractedData  ← OCR fields + user edits
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Backend server port |
| `DATABASE_URL` | `file:./dev.db` | SQLite database path |
| `OPENAI_API_KEY` | — | **Required** — OpenAI API key |
| `UPLOAD_DIR` | `./uploads` | Directory for uploaded files |
| `MAX_FILE_SIZE_MB` | `10` | Max upload size in MB |
| `FRONTEND_URL` | `http://localhost:5173` | CORS allowed origin |
