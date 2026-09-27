'use strict';

const express = require('express');
const { randomUUID } = require('crypto');
const router = express.Router();
const { scrapePrice } = require('../scraper/priceScraper');
const trackingService = require('../services/trackingService');
const { runProductCheck } = require('../services/scrapeRunner');

// Overlap guard: one scheduled run at a time (no internal scheduler —
// cron-job.org calls this endpoint; a second call while busy gets 409).
let runInProgress = false;

/**
 * Simple shared-secret protection so arbitrary public users cannot trigger
 * scraping once deployed. Set SCRAPE_RUN_TOKEN in the backend environment
 * and send it as the `x-scrape-token` header. When the variable is unset
 * (local dev), the endpoint stays open but logs a warning.
 */
function checkRunAuth(req, res) {
  const token = process.env.SCRAPE_RUN_TOKEN;
  if (!token) {
    console.warn('[run] SCRAPE_RUN_TOKEN not set — /api/scrape/run is unauthenticated.');
    return true;
  }
  if (req.headers['x-scrape-token'] === token) return true;
  res.status(401).json({ error: 'Unauthorized: valid x-scrape-token header required.' });
  return false;
}

function dbUnavailable(res, err) {
  if (err.code === 'DB_NOT_CONFIGURED' || err.code === 'DB_UNREACHABLE') {
    res.status(503).json({ error: 'Database unavailable', detail: err.message });
    return true;
  }
  return false;
}

/**
 * POST /api/scrape
 *
 * Body: { productId: string, option: string }
 *
 * Triggers a Playwright scrape of the INE mock store for the given product
 * and option, returning the current price and stock status.
 *
 * The socket timeout is extended to 120s to accommodate the browser scrape
 * (gesture guard + up to 5 click retries can take ~60-90s).
 */
router.post('/', async (req, res) => {
  // Extend socket timeout to 120 seconds for the scrape duration
  req.socket.setTimeout(120_000);

  const { productId, option } = req.body;

  if (!productId || typeof productId !== 'string' || productId.trim() === '') {
    return res.status(400).json({ error: 'Field "productId" is required and must be a non-empty string.' });
  }

  if (!option || typeof option !== 'string' || option.trim() === '') {
    return res.status(400).json({ error: 'Field "option" is required and must be a non-empty string.' });
  }

  const cleanProductId = productId.trim();
  const cleanOption = option.trim();

  console.log(`[scrape] POST /api/scrape — productId=${cleanProductId} option="${cleanOption}"`);

  try {
    const result = await scrapePrice(cleanProductId, cleanOption);
    return res.json(result);
  } catch (err) {
    console.error(`[scrape] Failed for product ${cleanProductId}:`, err.message);
    return res.status(502).json({
      error: 'Scrape failed',
      detail: err.message,
    });
  }
});

/**
 * POST /api/scrape/run
 *
 * Complete scheduled scrape run for ALL active tracked products.
 * One run_id is minted for the whole run and stamped on every attempt row.
 * Products are processed SEQUENTIALLY (safe for rate limits / resources).
 * A product's failure is captured per product and never stops the run.
 *
 * Response: { runId, startedAt, finishedAt, total, successful, failed, results[] }
 */
router.post('/run', async (req, res) => {
  // A full run over several products can take minutes — generous socket cap.
  req.socket.setTimeout(15 * 60_000);

  if (!checkRunAuth(req, res)) return;
  if (runInProgress) {
    return res.status(409).json({ error: 'A scrape run is already in progress.' });
  }

  let products;
  try {
    products = await trackingService.getActiveTrackedProducts();
  } catch (err) {
    if (dbUnavailable(res, err)) return;
    console.error('[run] could not load tracked products:', err.message);
    return res.status(500).json({ error: 'Failed to load tracked products.' });
  }

  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  runInProgress = true;
  console.log(`[run] starting run=${runId} products=${products.length}`);
  const results = [];
  try {
    for (const item of products) {
      try {
        const summary = await runProductCheck(item, runId);
        const { saved, ...publicSummary } = summary;
        results.push(publicSummary);
      } catch (err) {
        // Database failure for this product — record and continue with the rest.
        console.error(`[run] product ${item.id} errored:`, err.message);
        results.push({
          trackedProductId: item.id,
          storeProductId: item.storeProductId,
          selectedOption: item.selectedOption,
          outcome: 'failed',
          price: null,
          stock: null,
          attempts: null,
          attemptNumber: null,
          runId,
          errorMessage: `Run error (not a scrape result): ${err.message}`,
        });
      }
    }
  } finally {
    runInProgress = false;
  }

  const successful = results.filter((r) => r.outcome === 'success').length;
  const finishedAt = new Date().toISOString();
  console.log(`[run] finished run=${runId} successful=${successful} failed=${results.length - successful}`);
  return res.json({
    runId,
    startedAt,
    finishedAt,
    total: results.length,
    successful,
    failed: results.length - successful,
    results,
  });
});

module.exports = router;
