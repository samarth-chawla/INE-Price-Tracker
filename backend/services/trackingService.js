'use strict';

// Service layer for Phase 3 persistence: tracked products + scrape logs.
//
// DATA RULE (enforced here AND by the DB CHECK constraint):
//   success → price + stock stored,  outcome='success'
//   retried → price=NULL, stock=NULL, outcome='retried', error_message set
//   failed  → price=NULL, stock=NULL, outcome='failed',  error_message set
// A failed/retried attempt never overwrites or reuses a previous success —
// history is append-only; each attempt is its own row. run_id groups the
// rows of one logical scrape; attempt_number orders them within the run.

const db = require('../db/client');

function toTrackedProduct(row) {
  return {
    id: row.id,
    storeProductId: row.store_product_id,
    productName: row.product_name,
    productUrl: row.product_url,
    selectedOption: row.selected_option,
    active: row.active,
    createdAt: row.created_at,
  };
}

function toScrapeLog(row) {
  return {
    id: row.id,
    trackedProductId: row.tracked_product_id,
    timestamp: row.timestamp,
    price: row.price === null ? null : Number(row.price), // NUMERIC → number
    stock: row.stock,
    outcome: row.outcome,
    errorMessage: row.error_message,
    attempts: row.attempts,
    attemptNumber: row.attempt_number,
    runId: row.run_id,
  };
}

/** Insert a tracked product. Throws code 23505 on duplicate (store id + option). */
async function createTrackedProduct({ storeProductId, productName, productUrl, selectedOption }) {
  const res = await db.query(
    `insert into tracked_products (store_product_id, product_name, product_url, selected_option)
     values ($1, $2, $3, $4)
     returning *`,
    [storeProductId, productName, productUrl, selectedOption]
  );
  return toTrackedProduct(res.rows[0]);
}

async function getTrackedProducts() {
  const res = await db.query(`select * from tracked_products order by created_at desc`);
  return res.rows.map(toTrackedProduct);
}

async function getTrackedProductById(id) {
  const res = await db.query(`select * from tracked_products where id = $1`, [id]);
  return res.rows.length ? toTrackedProduct(res.rows[0]) : null;
}

/** Only active products, oldest first — the scheduled run's work list. */
async function getActiveTrackedProducts() {
  const res = await db.query(`select * from tracked_products where active = true order by created_at asc`);
  return res.rows.map(toTrackedProduct);
}

/**
 * Append one scrape-log row (one attempt).
 * @param {string} trackedProductId
 * @param {object} r  { outcome:'success'|'retried'|'failed', price?, stock?,
 *                      errorMessage?, attempts?, attemptNumber?, runId? }
 */
async function saveScrapeResult(trackedProductId, r) {
  if (r.outcome !== 'success' && r.outcome !== 'retried' && r.outcome !== 'failed') {
    throw Object.assign(new Error(`outcome must be 'success', 'retried' or 'failed'`), { code: 'BAD_OUTCOME' });
  }
  let price = null;
  let stock = null;
  let errorMessage = null;

  if (r.outcome === 'success') {
    if (typeof r.price !== 'number' || !Number.isFinite(r.price)) {
      throw Object.assign(new Error('successful scrape requires a numeric price'), { code: 'BAD_PRICE' });
    }
    if (typeof r.stock !== 'string' || r.stock.trim() === '') {
      throw Object.assign(new Error('successful scrape requires a stock string'), { code: 'BAD_STOCK' });
    }
    price = r.price;
    stock = r.stock;
  } else {
    // Retried/failed: force NULLs no matter what the caller passed — stale
    // data must never leak into a non-success row.
    if (typeof r.errorMessage !== 'string' || r.errorMessage.trim() === '') {
      throw Object.assign(new Error(`outcome '${r.outcome}' requires an error message`), { code: 'BAD_ERROR' });
    }
    errorMessage = r.errorMessage;
  }

  const attempts =
    typeof r.attempts === 'number' && Number.isInteger(r.attempts) ? r.attempts : null;
  const attemptNumber =
    typeof r.attemptNumber === 'number' && Number.isInteger(r.attemptNumber) && r.attemptNumber >= 1
      ? r.attemptNumber
      : 1;
  const runId =
    typeof r.runId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(r.runId)
      ? r.runId
      : null;

  const res = await db.query(
    `insert into scrape_logs (tracked_product_id, price, stock, outcome, error_message, attempts, attempt_number, run_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning *`,
    [trackedProductId, price, stock, r.outcome, errorMessage, attempts, attemptNumber, runId]
  );
  return toScrapeLog(res.rows[0]);
}

/** Newest-first history for one tracked product. */
async function getScrapeHistory(trackedProductId, limit = 50) {
  const n = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const res = await db.query(
    `select * from scrape_logs
     where tracked_product_id = $1
     order by timestamp desc
     limit $2`,
    [trackedProductId, n]
  );
  return res.rows.map(toScrapeLog);
}

module.exports = {
  createTrackedProduct,
  getTrackedProducts,
  getTrackedProductById,
  getActiveTrackedProducts,
  saveScrapeResult,
  getScrapeHistory,
};
