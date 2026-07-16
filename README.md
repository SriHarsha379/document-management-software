# Logistics DMS – OCR Ingestion Module

A full-stack Document Management System for logistics operations with AI-powered OCR to extract structured data from LR, Invoice, Toll, and Weighment documents.

## Features

- **Upload** documents (JPG, PNG, WEBP, PDF) via drag-and-drop or file picker
- **OCR** via OpenAI Vision API (GPT-4o) — auto-extracts:
  - LR No, Invoice No, Vehicle No, Quantity, Date, Party Names, Toll Amount, Weight Info
- **Auto-tagging** — classifies document as LR / Invoice / Toll / Weighment
- **Auto-linking** — groups documents sharing the same Vehicle Number with document dates within ±3 days
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

## Customer Portal

The customer portal is a secure, read-only interface at `/customer-portal` that lets external customers (parties/consignees) view and download shipment documents that have been dispatched to them.

```
http://localhost:5173/customer-portal
```

### How It Works

1. **Admin creates access** — an admin generates a time-limited access token for a party (customer).
2. **Admin shares credentials** — the admin copies the one-time-shown token and emails or sends it to the customer along with the portal URL.
3. **Customer logs in** — the customer visits `/customer-portal`, enters their email address and the access token.
4. **Customer views shipments** — after login, the customer sees a list of all document bundles (shipments) that have been dispatched to their email or phone number. Only `READY` or `SENT` bundles are visible (never drafts).
5. **Customer views documents** — the customer can open any shipment to see individual documents (LR, Invoice, Toll, Weighment Slip) with extracted metadata.
6. **Customer downloads files** — each document can be downloaded directly from the portal.

Access is automatically blocked (with an "Access Expired" message) once the token expires or is revoked — even if the customer tries to bypass the UI via direct API calls.

### Admin Flow

1. Navigate to the **🏢 Customer Portal** tab in the main dashboard.
2. Search for and select the party (customer) from the dropdown.
3. Optionally enter a login email (defaults to the email stored on the party record).
4. Set the validity period (default: **30 days**, max: 365 days).
5. Click **Create Access**.
6. Copy the full credential block shown (email + token + expiry + portal URL) — **the token is shown only once**.
7. Share the credentials with the customer.
8. To revoke access early, click **Revoke** next to the entry in the Active Accesses list.

### Customer Flow

1. Customer opens `http://<your-domain>/customer-portal` in their browser (mobile-friendly).
2. Customer enters their **email address** and the **access token** provided by the logistics team.
3. Customer lands on their shipment list — each card shows vehicle number, date, number of documents, and dispatch status.
4. Customer clicks a shipment to view the full document list with extracted fields (LR No, Invoice No, etc.).
5. Customer clicks **Download** on any document to save it locally.

After expiry or revocation:
- Login is blocked with an "Access Expired — contact your logistics partner" message.
- All authenticated API endpoints reject requests even if a valid JWT is somehow reused.

### How It Should Work (Design Intent)

- **Party-scoped visibility** — a customer only sees shipments dispatched to their email or registered phone number. They cannot see other customers' documents.
- **Token is a one-time secret** — the raw token is shown to the admin only once and stored as a bcrypt hash. A new token must be generated to regain access.
- **Short-lived by default** — 30-day default validity keeps exposure windows small. Admins should prefer shorter windows for one-off document sharing.
- **Rate limiting** — login endpoint is limited to 10 attempts per 15 minutes per IP to prevent brute-force attacks.
- **Path traversal protection** — document download endpoint validates that the resolved file path stays within the configured `UPLOAD_DIR`.
- **CUSTOMER_JWT_SECRET** — set this environment variable separately from `JWT_SECRET` so customer sessions and driver/admin sessions use independent signing keys.

---

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

### Customer Portal (Admin)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/admin/customer-portal-access` | Create / renew customer portal access |
| `GET` | `/api/admin/customer-portal-access` | List all customer portal accesses |
| `PUT` | `/api/admin/customer-portal-access/:id/revoke` | Revoke customer portal access |
| `DELETE` | `/api/admin/customer-portal-access/:id` | Permanently delete customer portal access |

### Customer Portal (Customer)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/customer/login` | Login with email + access token |
| `GET` | `/api/customer/me` | Get current session / party info |
| `GET` | `/api/customer/shipments` | List dispatched shipment bundles |
| `GET` | `/api/customer/shipments/:bundleId` | Get shipment detail with documents |
| `GET` | `/api/customer/documents/:documentId/download` | Download a document file |

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

CustomerPortalAccess ← party + loginEmail + tokenHash + expiry
    (no child records — links to Party for visibility)
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
| `CUSTOMER_JWT_SECRET` | falls back to `JWT_SECRET` | Secret for customer portal JWT tokens — set independently in production |
