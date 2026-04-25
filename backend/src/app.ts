import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import * as path from 'path';
import * as fs from 'fs';
import documentRoutes from './routes/documents.js';
import bundleRoutes from './routes/bundles.js';
import searchRoutes from './routes/search.js';
import dispatchRoutes from './routes/dispatch.js';
import adminDriverRoutes from './routes/adminDriver.js';
import driverPortalRoutes from './routes/driverPortal.js';
import authRoutes from './modules/auth/auth.routes.js';
import lrRoutes from './modules/lr/lr.routes.js';

const app = express();

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.FRONTEND_URL ?? 'http://localhost:5173',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve uploaded files (images) statically so frontend can display them
const uploadDir = process.env.UPLOAD_DIR ?? './uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
app.use('/uploads', express.static(path.resolve(uploadDir)));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/documents', documentRoutes);
app.use('/api/bundles', bundleRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/dispatch', dispatchRoutes);
app.use('/api/admin/driver-access', adminDriverRoutes);
app.use('/api/driver', driverPortalRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/lrs', lrRoutes);

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message ?? 'Internal server error' });
});

export default app;
