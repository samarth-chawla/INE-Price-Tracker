'use strict';

// Shared single-product scrape + persist logic (Phase 4).
// Used by POST /api/tracked/:id/check (own run_id) and POST /api/scrape/run
// (one run_id shared across the whole scheduled run).
//
// Behavior per product (unchanged Phase 3 rules):
//   intermediate attempts → outcome='retried', price/stock NULL
//   terminal success      → outcome='success', fresh price/stock
//   terminal failure      → outcome='failed',  price/stock NULL + error
// Scrape failures are CAPTURED (returned, never thrown) so one product can
// never stop a batch run. Only database errors are thrown.

const { scrapePrice } = require('../scraper/priceScraper');
const service = require('./trackingService');

/**
 * @param {object} item  tracked product row (camelCase service shape)
 * @param {string} runId run identifier to stamp on every row
 * @returns {Promise<object>} per-product summary for run responses
 */
async function runProductCheck(item, runId) {
  let retries = 0;
  console.log(`[run] check — tracked=${item.id} store=${item.storeProductId} option="${item.selectedOption}" run=${runId}`);
  try {
    const result = await scrapePrice(item.storeProductId, item.selectedOption, {
      // The scraper awaits this hook, so retried rows land before the
      // terminal row. A logging failure is caught here and must never
      // fail the scrape itself.
      onAttempt: (a) => {
        retries += 1;
        return service.saveScrapeResult(item.id, {
          outcome: 'retried',
          errorMessage: a.errorMessage,
          attemptNumber: a.attemptNumber,
          runId,
        }).catch((logErr) => console.error('[run] retried-row save failed:', logErr.message));
      },
    });
    const saved = await service.saveScrapeResult(item.id, {
      outcome: 'success',
      price: result.price,
      stock: result.stock,
      attempts: result.attempts,
      attemptNumber: retries + 1,
      runId,
    });
    return {
      trackedProductId: item.id,
      storeProductId: item.storeProductId,
      selectedOption: item.selectedOption,
      outcome: 'success',
      price: saved.price,
      stock: saved.stock,
      attempts: saved.attempts,
      attemptNumber: saved.attemptNumber,
      runId,
      errorMessage: null,
      saved,
    };
  } catch (scrapeErr) {
    const saved = await service.saveScrapeResult(item.id, {
      outcome: 'failed',
      errorMessage: scrapeErr.message || 'Scrape failed',
      attemptNumber: retries + 1,
      runId,
    });
    return {
      trackedProductId: item.id,
      storeProductId: item.storeProductId,
      selectedOption: item.selectedOption,
      outcome: 'failed',
      price: null,
      stock: null,
      attempts: null,
      attemptNumber: saved.attemptNumber,
      runId,
      errorMessage: saved.errorMessage,
      saved,
    };
  }
}

module.exports = { runProductCheck };
