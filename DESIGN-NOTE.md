# DESIGN NOTE — INE Product Price Tracker

How the app works and why it is built this way. Everything below describes
the code as implemented.

## Store analysis

The mock store (`https://demo.inelabteamdev.com`) is a React SPA with its own
JSON API (found by inspecting the compiled bundle):

| Endpoint | Purpose |
|---|---|
| `/api/v2/listings?page=N&limit=M` | Product catalogue (max 60/page) |
| `/api/v2/items/{id}` | Product detail + options |
| `/api/v2/ui/manifest` | Rotating CSS class map for prices |

Product search needs no HTML scraping: the backend pages the listings API,
dedupes, caches in memory (5 min TTL), and filters locally on name, brand,
category, SKU. Pagination order is randomized per request, so the cache
builder over-fetches until ~960 unique IDs are seen.

## Why Playwright is required

Price loading cannot be done over plain HTTP:

1. **Gesture guard** — the price panel needs ≥8 mouse moves + ≥600ms hover.
2. **Click interference** — ~35% of check-button clicks are dropped or delayed.
3. **Challenge flow** — challenge GET → canvas/WebGL/`isTrusted` fingerprint
   POST → bearer-auth GET with XOR-encrypted price payload.
4. **Consent dialog** — a focus-trap `.consent-scrim` modal on ~75% of sessions
   that needs **1–3** Allow/Reject clicks to dismiss (verified in the bundle).

Playwright gives trusted input events and real JS execution. HTTP/HTML
parsing was deliberately rejected for the price path.

## Scraper design (`backend/scraper/priceScraper.js`)

- Satisfies the gesture guard (10 moves × 70ms), dismisses consent
  proactively, per click attempt, and via a Playwright locator handler
  (`noWaitAfter` so a stubborn overlay can never wedge a click).
- The click loop is **state-aware**: the check button only exists in the idle
  phase, so each attempt reads the panel first — click check, click the
  store's own Retry control in error phase, or wait without clicking while
  loading. One stuck click fails fast (10s cap) into the next retry.
- Price parsing is format-aware (default/spaced/euro/lakh/trailing/unicode
  full-width digits, zero-width split carriers). A naive digit-strip turns
  euro `₹35.286,00` into 3528600 (100×) — the parser normalizes and drops
  decimal tails instead. Unparseable/empty data throws; it is never stored.
- A failed scrape throws honestly. Each scrape runs in a fresh browser that
  is always closed; no state leaks between runs.

## Persistence model (Supabase PostgreSQL)

- `tracked_products` — the (product, option) pairs being tracked.
- `scrape_logs` — **one row per attempt**, append-only. Intermediate attempts
  are `retried`, the terminal attempt is `success` (fresh price/stock) or
  `failed`. `retried`/`failed` rows store `price = NULL, stock = NULL`
  (service validation + DB CHECK constraint). Rows of one scrape share a
  `run_id` with a 1-based `attempt_number`. History never overwrites history.
- Money uses `NUMERIC`; timestamps are UTC `timestamptz`.

## Scheduling

No in-process scheduler. `POST /api/scrape/run` scrapes all active tracked
products **sequentially** (rate-limit safe) under one shared `run_id`, with
per-product failure isolation and an overlap guard (409 while busy).
cron-job.org calls it every 2 hours with an `x-scrape-token` shared secret
(`SCRAPE_RUN_TOKEN`). The manual `POST /api/tracked/:id/check` reuses the
same runner for one product.

## Deployment shape

- Backend → Render, Docker runtime. The image installs Playwright's bundled
  Chromium (`--with-deps`); the scraper omits `executablePath` there.
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` is an optional local override only.
- Frontend → Vercel, pointed at the backend via `VITE_API_BASE_URL`.
- CSV export is client-side from stored history (one row per attempt).
