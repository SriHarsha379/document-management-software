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
- **Temporary Driver Portal** — time-limited access for drivers to upload documents from mobile

## Architecture

```
document-management-software/
├── backend/          # Node.js + Express + TypeScript
│   ├── prisma/       # Database schema (SQLite) + migrations
│   └── src/
│       ├── routes/   # REST API endpoints
│       ├── services/ # OCR service + document service
│       └── middleware/ # Multer file upload, driver auth
└── frontend/         # React + Vite + TypeScript
    └── src/
        ├── components/  # DocumentUpload, OCRReview, DocumentList, DriverPortal, AdminDriverAccess
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
# Edit .env and set OPENAI_API_KEY and JWT_SECRET
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

## Driver Portal

The driver portal is a separate mobile-friendly UI at `/driver`:

```
http://localhost:5173/driver
```

### Admin Flow

1. Navigate to the **🚛 Drivers** tab in the main dashboard.
2. Enter the driver's phone number and click **Create Access**.
3. Copy the generated password (shown once) and share it with the driver along with the portal URL.
4. The access automatically expires after **7 days**. You can also manually revoke it.

### Driver Flow

1. Driver opens `http://<your-domain>/driver` on their phone.
2. Driver logs in with their phone number and the password provided by admin.
3. Driver selects a document type (**LR**, **Toll**, **Weighment Slip**).
4. Driver takes a photo or uploads a file.
5. The document is OCR'd, linked to the matching transaction (by vehicle number + date), and stored.

After 7 days:
- Login is blocked with an "Access Expired" message.
- Upload API rejects requests even if the UI is bypassed.

## API Reference

### Documents

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/documents/upload` | Upload a document file |
| `POST` | `/api/documents/:id/ocr` | Run OCR on uploaded document |
| `PUT` | `/api/documents/:id/review` | Save reviewed/edited data |
| `GET` | `/api/documents` | List documents (with filters) |
| `GET` | `/api/documents/:id` | Get document with extracted data |
| `GET` | `/api/documents/groups/:groupId` | Get linked document group |
| `GET` | `/api/health` | Health check |

### Driver Portal (Admin)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/admin/driver-access` | Create / renew driver access |
| `GET` | `/api/admin/driver-access` | List all driver accesses |
| `PUT` | `/api/admin/driver-access/:id/revoke` | Revoke driver access |
| `GET` | `/api/admin/driver-access/:id/uploads` | List uploads for a driver |

### Driver Portal (Driver)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/driver/login` | Login with phone + password |
| `GET` | `/api/driver/status` | Check session / expiry status |
| `POST` | `/api/driver/upload` | Upload document (requires Bearer token) |
| `GET` | `/api/driver/uploads` | List own uploads (requires Bearer token) |

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
    │       └── ExtractedData  ← OCR fields + user edits
    └── DriverUploadDocument ← driver-uploaded docs (linked to group)

TemporaryDriverAccess ← phone + hashed password + expiry
    └── DriverUploadDocument ← upload ownership
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
| `JWT_SECRET` | `change-me-in-production` | **Required in production** — secret for driver JWT tokens |
