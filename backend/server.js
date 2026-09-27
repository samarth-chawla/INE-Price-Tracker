// Env loading: repo-root `.env` first (deployment format), then
// `backend/.env` as a fallback so existing local setups keep working.
// Neither file overrides variables already present in the environment.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const productsRouterModule = require('./routes/products');
const scrapeRouter = require('./routes/scrape');
const trackingRouter = require('./routes/tracking');
const { isDbConfigured, checkDb } = require('./db/client');

const PORT = process.env.PORT || 3001;

const app = express();

// CORS: locked to the deployed frontend origin when FRONTEND_URL is set
// (production); open during local dev when it is unset.
const FRONTEND_URL = process.env.FRONTEND_URL;
if (FRONTEND_URL) {
  console.log(`CORS restricted to ${FRONTEND_URL}`);
} else {
  console.log('CORS open (FRONTEND_URL not set — local dev mode).');
}
app.use(cors({ origin: FRONTEND_URL || true }));
app.use(express.json());

app.use('/api/products', productsRouterModule);
app.use('/api/scrape', scrapeRouter);
app.use('/api/tracked', trackingRouter);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// DB health (Phase 3) — reports configured/unconfigured without crashing.
app.get('/api/db-health', async (_req, res) => {
  if (!isDbConfigured()) {
    return res.status(503).json({ status: 'unconfigured', detail: 'SUPABASE_CONNECTION_STRING is not set.' });
  }
  try {
    await checkDb();
    return res.json({ status: 'ok' });
  } catch (err) {
    return res.status(503).json({ status: 'unreachable', detail: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`INE Tracker backend running on http://localhost:${PORT}`);
  // Pre-warm the product cache in the background so the first search is fast.
  productsRouterModule.prewarm();
});
