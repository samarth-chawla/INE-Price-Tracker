'use strict';

// Minimal Phase 3 API: tracked products + scrape history.
// No cron, no dashboard, no auto-scraping — each scrape is triggered
// explicitly (POST /:id/check runs one Phase 2 scrape and stores every
// attempt as its own row, grouped by run_id).

const express = require('express');
const { randomUUID } = require('crypto');
const router = express.Router();
const service = require('../services/trackingService');
const { runProductCheck } = require('../services/scrapeRunner');

const STORE_BASE = 'https://demo.inelabteamdev.com';

/** Map DB/service errors to HTTP responses. Returns true when handled. */
function handleDbError(err, res) {
  if (err.code === 'DB_NOT_CONFIGURED' || err.code === 'DB_UNREACHABLE') {
    res.status(503).json({ error: 'Database unavailable', detail: err.message });
    return true;
  }
  if (err.code === '23505') {
    res.status(409).json({ error: 'This product + option is already tracked.' });
    return true;
  }
  if (err.code === '23503') {
    res.status(404).json({ error: 'Tracked product not found.' });
    return true;
  }
  if (['BAD_OUTCOME', 'BAD_PRICE', 'BAD_STOCK', 'BAD_ERROR'].includes(err.code)) {
    res.status(400).json({ error: err.message });
    return true;
  }
  return false;
}

/** Validate product + option against the live store; returns { name, url }. */
async function validateAgainstStore(storeProductId, selectedOption) {
  let r;
  try {
    r = await fetch(`${STORE_BASE}/api/v2/items/${storeProductId}`);
  } catch {
    const err = new Error('Store request failed');
    err.code = 'STORE_DOWN';
    throw err;
  }
  if (r.status === 404) {
    const err = new Error(`Product ${storeProductId} not found in the store`);
    err.code = 'STORE_404';
    throw err;
  }
  if (!r.ok) {
    const err = new Error(`Store returned HTTP ${r.status}`);
    err.code = 'STORE_DOWN';
    throw err;
  }
  const data = await r.json();
  const options = data.options || [];
  const ok =
    options.length === 0 ||
    options.some((o) => (o.label || o.name || o).toLowerCase() === selectedOption.toLowerCase());
  if (!ok) {
    const err = new Error(
      `Option "${selectedOption}" not found. Available: ${options.map((o) => o.label || o.name || o).join(', ')}`
    );
    err.code = 'BAD_OPTION';
    throw err;
  }
  return { name: data.name, url: `${STORE_BASE}/item/${data.id}` };
}

// POST /api/tracked — track a product + option.
router.post('/', async (req, res) => {
  const { storeProductId, selectedOption } = req.body || {};
  if (!storeProductId || !/^\d+$/.test(String(storeProductId))) {
    return res.status(400).json({ error: 'Field "storeProductId" is required and must be numeric.' });
  }
  if (!selectedOption || typeof selectedOption !== 'string' || selectedOption.trim() === '') {
    return res.status(400).json({ error: 'Field "selectedOption" is required and must be a non-empty string.' });
  }
  try {
    const { name, url } = await validateAgainstStore(String(storeProductId).trim(), selectedOption.trim());
    const created = await service.createTrackedProduct({
      storeProductId: String(storeProductId).trim(),
      productName: name,
      productUrl: url,
      selectedOption: selectedOption.trim(),
    });
    return res.status(201).json(created);
  } catch (err) {
    if (err.code === 'STORE_404' || err.code === 'BAD_OPTION') {
      return res.status(err.code === 'STORE_404' ? 404 : 400).json({ error: err.message });
    }
    if (err.code === 'STORE_DOWN') {
      return res.status(502).json({ error: err.message });
    }
    if (handleDbError(err, res)) return;
    console.error('[tracked] create failed:', err.message);
    return res.status(500).json({ error: 'Failed to create tracked product.' });
  }
});

// GET /api/tracked — list all tracked products.
router.get('/', async (_req, res) => {
  try {
    return res.json({ results: await service.getTrackedProducts() });
  } catch (err) {
    if (handleDbError(err, res)) return;
    console.error('[tracked] list failed:', err.message);
    return res.status(500).json({ error: 'Failed to list tracked products.' });
  }
});

// GET /api/tracked/:id — one tracked product.
router.get('/:id', async (req, res) => {
  try {
    const item = await service.getTrackedProductById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Tracked product not found.' });
    return res.json(item);
  } catch (err) {
    if (handleDbError(err, res)) return;
    console.error('[tracked] get failed:', err.message);
    return res.status(500).json({ error: 'Failed to get tracked product.' });
  }
});

// POST /api/tracked/:id/scrapes — store one scrape-attempt row.
// Body: { outcome:'success'|'retried'|'failed', price?, stock?,
//         errorMessage?, attempts?, attemptNumber?, runId? }
// Non-success rows are forced to price=NULL, stock=NULL by the service.
router.post('/:id/scrapes', async (req, res) => {
  try {
    const item = await service.getTrackedProductById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Tracked product not found.' });
    const saved = await service.saveScrapeResult(req.params.id, req.body || {});
    return res.status(201).json(saved);
  } catch (err) {
    if (handleDbError(err, res)) return;
    console.error('[tracked] save scrape failed:', err.message);
    return res.status(500).json({ error: 'Failed to save scrape result.' });
  }
});

// GET /api/tracked/:id/scrapes?limit=N — newest-first history.
router.get('/:id/scrapes', async (req, res) => {
  try {
    const item = await service.getTrackedProductById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Tracked product not found.' });
    const history = await service.getScrapeHistory(req.params.id, req.query.limit);
    return res.json({ results: history });
  } catch (err) {
    if (handleDbError(err, res)) return;
    console.error('[tracked] history failed:', err.message);
    return res.status(500).json({ error: 'Failed to get scrape history.' });
  }
});

// POST /api/tracked/:id/check — run ONE Phase 2 scrape now and store EVERY
// attempt as its own row under one run_id: intermediate attempts as
// outcome='retried' (NULL price/stock), the terminal attempt as 'success'
// (fresh price/stock) or 'failed' (NULLs + error). attempt_number counts
// 1..N within the run. Manual trigger only (no scheduling in Phase 3).
router.post('/:id/check', async (req, res) => {
  req.socket.setTimeout(120_000);
  try {
    const item = await service.getTrackedProductById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Tracked product not found.' });
    if (!item.active) return res.status(400).json({ error: 'Tracked product is not active.' });

    const runId = randomUUID();
    console.log(`[tracked] check now — id=${item.id} store=${item.storeProductId} option="${item.selectedOption}" run=${runId}`);
    const summary = await runProductCheck(item, runId);
    if (summary.outcome === 'success') {
      return res.json(summary.saved);
    }
    return res.status(502).json({ error: 'Scrape failed', saved: summary.saved });
  } catch (err) {
    if (handleDbError(err, res)) return;
    console.error('[tracked] check failed:', err.message);
    return res.status(500).json({ error: 'Check failed.' });
  }
});

module.exports = router;
