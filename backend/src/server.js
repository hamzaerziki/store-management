import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { pool, query } from './db.js';

import authRoutes from './routes/auth.js';
import storeRoutes from './routes/stores.js';
import catalogRoutes from './routes/catalog.js';
import itemRoutes from './routes/items.js';
import quoteRoutes from './routes/quotes.js';
import comparisonRoutes from './routes/comparisons.js';
import dashboardRoutes from './routes/dashboard.js';
import adminRoutes from './routes/admin.js';
import documentRoutes from './routes/documents.js';
import operationRoutes from './routes/operations.js';
import demandRoutes from './routes/demands.js';
import transitionRoutes from './routes/transitions.js';
import governanceRoutes from './routes/governance.js';
import reportingRoutes from './routes/reporting.js';
import categoryBudgetRoutes from './routes/category-budgets.js';
import v1Routes from './routes/v1/index.js';
import { deliverPendingEmails } from './services/notification-service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: false, frameguard: false, contentSecurityPolicy: false }));
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || config.security.allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origine non autorisée'));
  },
  credentials: false,
}));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
  req.id = crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  req.setTimeout(config.security.requestTimeoutMs);
  res.setTimeout(config.security.requestTimeoutMs);
  next();
});

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: req => req.path === '/auth/login' || req.path === '/health',
  message: { error: 'Trop de requêtes. Veuillez réessayer dans quelques instants.' },
});
app.use('/api', limiter);

fs.mkdirSync(path.resolve(config.uploadDir), { recursive: true });
app.use('/uploads', express.static(path.resolve(config.uploadDir), {
  fallthrough: true,
  etag: true,
  maxAge: '1h',
  setHeaders: (res, filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('Content-Disposition', /^\.(png|jpe?g|gif|webp|bmp)$/.test(ext) ? 'inline' : 'attachment');
  },
}));

app.get('/api/health', async (req, res) => {
  try {
    await query('SELECT 1');
    res.json({ status: 'ok', service: 'safari-backend', time: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ status: 'error', error: e.message });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/stores', storeRoutes);
app.use('/api', catalogRoutes);
app.use('/api/items', itemRoutes);
app.use('/api/quotes', quoteRoutes);
app.use('/api/comparisons', comparisonRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/operations', operationRoutes);
app.use('/api/demands', demandRoutes);
app.use('/api/transitions', transitionRoutes);
app.use('/api/governance', governanceRoutes);
app.use('/api/reporting', reportingRoutes);
app.use('/api/category-budgets', categoryBudgetRoutes);
app.use('/api', adminRoutes);
app.use('/api/v1', v1Routes);

app.use((req, res) => res.status(404).json({ error: 'Route introuvable' }));

app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || (err.name === 'MulterError' ? 400 : err.message === 'Origine non autorisée' ? 403 : 500);
  if (status >= 500) {
    console.error(`[${req.id}]`, err);
    return res.status(500).json({ error: 'Erreur interne du serveur', request_id: req.id });
  }
  return res.status(status).json({ error: err.message || 'Requête invalide', request_id: req.id });
});

await query("ALTER TABLE quotes ADD COLUMN IF NOT EXISTS extracted_data JSONB DEFAULT '{}'::jsonb");
await query('ALTER TABLE items ADD COLUMN IF NOT EXISTS is_service BOOLEAN NOT NULL DEFAULT false');
await query(fs.readFileSync(path.join(__dirname, '..', 'db', 'init', '05-project-spaces.sql'), 'utf8'));
await query(fs.readFileSync(path.join(__dirname, '..', 'db', 'init', '06-approval-chain.sql'), 'utf8'));
await query(fs.readFileSync(path.join(__dirname, '..', 'db', 'init', '07-dossier-complete.sql'), 'utf8'));
await query(fs.readFileSync(path.join(__dirname, '..', 'db', 'init', '08-demands.sql'), 'utf8'));
await query(fs.readFileSync(path.join(__dirname, '..', 'db', 'init', '09-demands-detail.sql'), 'utf8'));
await query(fs.readFileSync(path.join(__dirname, '..', 'db', 'init', '10-store-brands.sql'), 'utf8'));
await query(fs.readFileSync(path.join(__dirname, '..', 'db', 'init', '11-workflow-planning.sql'), 'utf8'));
await query(fs.readFileSync(path.join(__dirname, '..', 'db', 'init', '12-dosi-role.sql'), 'utf8'));
await query(fs.readFileSync(path.join(__dirname, '..', 'db', 'init', '13-quote-demand-link.sql'), 'utf8'));
await query(fs.readFileSync(path.join(__dirname, '..', 'db', 'init', '14-governance.sql'), 'utf8'));
await query(fs.readFileSync(path.join(__dirname, '..', 'db', 'init', '15-dossier-complete.sql'), 'utf8'));
await query(fs.readFileSync(path.join(__dirname, '..', 'db', 'init', '16-dossier-backfill.sql'), 'utf8'));
await query(fs.readFileSync(path.join(__dirname, '..', 'db', 'init', '17-document-lines-fiscal.sql'), 'utf8'));
await query(fs.readFileSync(path.join(__dirname, '..', 'db', 'init', '24-security-hardening.sql'), 'utf8'));
await query(fs.readFileSync(path.join(__dirname, '..', 'db', 'init', '25-category-budgets.sql'), 'utf8'));
await query(fs.readFileSync(path.join(__dirname, '..', 'db', 'init', '26-single-store-drafts.sql'), 'utf8'));
await query(fs.readFileSync(path.join(__dirname, '..', 'db', 'init', '27-backfill-workbook-quotes.sql'), 'utf8'));
await query(fs.readFileSync(path.join(__dirname, '..', 'db', 'init', '28-it-category-taxonomy.sql'), 'utf8'));
await query(fs.readFileSync(path.join(__dirname, '..', 'db', 'init', '29-demand-execution.sql'), 'utf8'));
await query(fs.readFileSync(path.join(__dirname, '..', 'db', 'init', '30-notification-templates.sql'), 'utf8'));
await query(fs.readFileSync(path.join(__dirname, '..', 'db', 'init', '31-gantt-traceability.sql'), 'utf8'));
await query(fs.readFileSync(path.join(__dirname, '..', 'db', 'init', '32-execution-progress-logic.sql'), 'utf8'));
await query(fs.readFileSync(path.join(__dirname, '..', 'db', 'init', '33-audit-journal.sql'), 'utf8'));

const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`Safari backend listening on port ${config.port}`);
});

deliverPendingEmails({ limit: 50 }).catch(error => console.error('[mail] startup flush failed:', error.message));
const mailFlush = setInterval(() => {
  deliverPendingEmails({ limit: 50 }).catch(error => console.error('[mail] retry failed:', error.message));
}, 60_000);
mailFlush.unref();

server.requestTimeout = config.security.requestTimeoutMs;
server.headersTimeout = config.security.requestTimeoutMs + 5000;
server.keepAliveTimeout = 65000;

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; closing HTTP server and database pool`);
  server.close(async err => {
    if (err) console.error('HTTP close error:', err.message);
    try {
      await pool.end();
      process.exit(0);
    } catch (e) {
      console.error('Pool close error:', e.message);
      process.exit(1);
    }
  });
  setTimeout(() => process.exit(1), config.security.requestTimeoutMs).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', reason => {
  console.error('Unhandled rejection:', reason);
});
