const express = require('express');
const router = express.Router();

const STORE_BASE = 'https://demo.inelabteamdev.com';
const LISTINGS_URL = `${STORE_BASE}/api/v2/listings`;

// Discovered by inspecting the store's JS bundle:
//   - /api/v2/listings?page=N&limit=M returns paginated JSON
//   - Max enforced page size is 60 items; 960 total products
//   - The store's pagination order is FULLY RANDOMISED per request — each
//     call returns a different random 60 products. Simple "16-page" fetch
//     only yields ~63% of the catalogue due to the birthday problem.
//   - The store rate-limits aggressive parallel fetches with HTTP 503.
//   - No server-side search endpoint exists on the store.
//
// Strategy: fetch in gentle batches of 2, retrying on 503, until all 960
// unique IDs are seen (or after MAX_PAGES for safety). Cache the result
// in memory for CACHE_TTL_MS.

const TOTAL_PRODUCTS = 960;
const PAGE_LIMIT = 60;
const BATCH_SIZE = 2;       // gentle: 2 parallel requests per round
const BATCH_DELAY_MS = 300; // pause between rounds to avoid rate limits
const MAX_PAGES = 70;       // safety cap; at 60/page, 70 pages → ~98.5% coverage
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let productCache = null;
let cachePopulatedAt = null;
let fetchInProgress = null; // shared Promise while fetch is running

/** Wait for `ms` milliseconds. */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch one page with up to `retries` attempts on transient failures.
 * Handles both 503 (service unavailable) and 429 (rate limited).
 */
async function fetchPage(page, retries = 4) {
  const url = `${LISTINGS_URL}?page=${page}&limit=${PAGE_LIMIT}`;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url);
    if (res.ok) return res.json();
    const isTransient = res.status === 503 || res.status === 429;
    if (isTransient && attempt < retries) {
      // 429/503: back off progressively — 500ms, 1s, 2s, 4s
      const delay = res.status === 429
        ? 1000 * Math.pow(2, attempt)   // 429 needs a longer pause
        : 500 * Math.pow(2, attempt);   // 503 is usually brief
      await sleep(delay);
      continue;
    }
    throw new Error(`Store listings: HTTP ${res.status} for page ${page}`);
  }
}

/**
 * Fetch products until all 960 unique IDs are collected.
 *
 * The store randomises order per request so we keep fetching until we
 * hit TOTAL_PRODUCTS unique items or MAX_PAGES (whichever comes first).
 */
async function fetchAllProducts() {
  const seen = new Map(); // id -> raw product object
  let pageNum = 1;

  console.log(`Fetching products from INE store (target: ${TOTAL_PRODUCTS})…`);

  while (seen.size < TOTAL_PRODUCTS && pageNum <= MAX_PAGES) {
    const batch = [];
    for (let i = 0; i < BATCH_SIZE && pageNum <= MAX_PAGES; i++, pageNum++) {
      batch.push(pageNum);
    }

    const pages = await Promise.all(batch.map((p) => fetchPage(p)));

    for (const data of pages) {
      for (const product of data.results) {
        if (!seen.has(product.id)) {
          seen.set(product.id, product);
        }
      }
    }

    if (pageNum % 10 === 1) {
      console.log(`  page ${pageNum - 1}: ${seen.size} unique products so far`);
    }

    if (seen.size < TOTAL_PRODUCTS) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  const total = seen.size;
  if (total < TOTAL_PRODUCTS) {
    console.warn(`Warning: collected ${total}/${TOTAL_PRODUCTS} unique products after ${pageNum - 1} pages.`);
  }

  return Array.from(seen.values()).map(normalise);
}

/**
 * Normalise a raw store product into the shape our API returns.
 */
function normalise(raw) {
  return {
    id: String(raw.id),
    name: raw.name,
    brand: raw.brand,
    category: raw.category,
    sku: raw.sku,
    url: `${STORE_BASE}/item/${raw.id}`,
  };
}

/**
 * Return the cached product list, refreshing if stale or absent.
 * Multiple callers during the initial fetch share a single in-flight Promise.
 */
async function getProducts() {
  const now = Date.now();
  if (productCache && cachePopulatedAt && now - cachePopulatedAt < CACHE_TTL_MS) {
    return productCache;
  }
  // If a fetch is already in progress, wait for it instead of starting another
  if (fetchInProgress) {
    return fetchInProgress;
  }
  fetchInProgress = fetchAllProducts()
    .then((products) => {
      productCache = products;
      cachePopulatedAt = Date.now();
      console.log(`Cache ready: ${productCache.length} unique products.`);
      return productCache;
    })
    .finally(() => {
      fetchInProgress = null;
    });
  return fetchInProgress;
}



/**
 * GET /api/products?page=N&limit=M
 *
 * Paginated catalogue slice for the browse view. Served from the same
 * in-memory cache as search (no extra store scraping). Search endpoint
 * below is unchanged.
 *
 * Example: GET /api/products?page=1&limit=30
 */
router.get('/', async (req, res) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 60);

  try {
    const products = await getProducts();
    const total = products.length;
    const totalPages = Math.max(Math.ceil(total / limit), 1);
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * limit;

    return res.json({
      results: products.slice(start, start + limit),
      pagination: { page: safePage, limit, total, totalPages },
    });
  } catch (err) {
    console.error('Catalogue error:', err.message);
    return res.status(502).json({
      error: 'Failed to retrieve products from the store. Please try again shortly.',
      detail: err.message,
    });
  }
});

/**
 * GET /api/products/search?q=<term>
 *
 * Accepts a partial or full product name (also matches brand, category, SKU).
 * Returns matching products from the INE mock store.
 *
 * Example: GET /api/products/search?q=camera
 */
router.get('/search', async (req, res) => {
  const q = (req.query.q || '').trim();

  if (!q) {
    return res.status(400).json({
      error: 'Query parameter "q" is required and must not be empty.',
    });
  }

  if (q.length < 2) {
    return res.status(400).json({
      error: 'Search term must be at least 2 characters.',
    });
  }

  try {
    const products = await getProducts();
    const term = q.toLowerCase();

    const results = products.filter(
      (p) =>
        p.name.toLowerCase().includes(term) ||
        p.brand.toLowerCase().includes(term) ||
        p.category.toLowerCase().includes(term) ||
        p.sku.toLowerCase().includes(term),
    );

    if (results.length === 0) {
      return res.json({
        results: [],
        message: `No products found matching "${q}".`,
      });
    }

    return res.json({ results });
  } catch (err) {
    console.error('Search error:', err.message);
    return res.status(502).json({
      error: 'Failed to retrieve products from the store. Please try again shortly.',
      detail: err.message,
    });
  }
});

// GET /api/products/:id — product detail including options (for Phase 2 option picker)
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  if (!/^\d+$/.test(id)) {
    return res.status(400).json({ error: 'Product ID must be numeric' });
  }
  try {
    const r = await fetch(`${STORE_BASE}/api/v2/items/${id}`);
    if (r.status === 404) return res.status(404).json({ error: 'Product not found' });
    if (!r.ok) return res.status(502).json({ error: `Store returned ${r.status}` });
    const data = await r.json();
    return res.json({
      id: String(data.id),
      name: data.name,
      brand: data.brand,
      category: data.category,
      sku: data.sku,
      optionAxis: data.optionAxis || null,
      options: data.options || [],
      url: `${STORE_BASE}/item/${data.id}`,
    });
  } catch (err) {
    return res.status(502).json({ error: 'Store request failed', detail: err.message });
  }
});

function prewarm() {
  getProducts().catch((err) => {
    console.error('Cache prewarm failed:', err.message);
  });
}

module.exports = router;
module.exports.prewarm = prewarm;
