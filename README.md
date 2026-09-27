# Product Price Tracker

> 🎥 **Submission video:** [![Submission demo — price tracker run](https://drive.google.com/thumbnail?id=1dC4df7XayEkB3nP-dg2Q7s55XQ8hT7QH&sz=w1000)](https://drive.google.com/file/d/1dC4df7XayEkB3nP-dg2Q7s55XQ8hT7QH/view?usp=sharing)

### 🟢 **Live app:** [https://ine-price-tracker-rose.vercel.app/](https://ine-price-tracker-rose.vercel.app/)

### 🟢 API: [http://ine-price-tracker-jez4.onrender.com/health](http://ine-price-tracker-jez4.onrender.com/health)

#### Track mock-store products ([https://demo.inelabteamdev.com](https://demo.inelabteamdev.com)):

`search → pick product + option → scrape price/stock every 2h → history, per-product scrape log, CSV export.`

## Setup

```bash
# backend
cd backend && npm install
# frontend
cd frontend && npm install
```

Playwright browsers (one time, for local scraping):

```bash
cd backend && npx playwright install chromium
```

## Environment variables

Backend reads `.env` (repo root; `backend/.env` also works as a fallback). Required:

| Var | Purpose |
|---|---|
| `SUPABASE_CONNECTION_STRING` | Supabase pooler URI — runtime queries and migrations (direct `:5432` is IPv6-only; unreachable from most networks) |
| `SCRAPE_RUN_TOKEN` | Shared secret for `POST /api/scrape/run` (`x-scrape-token` header) |
| `FRONTEND_URL` | Public frontend origin for CORS allowlist (exact match; unset = open local dev) |
| `PORT` | Backend listen port (default 3001; Render injects its own) |

Optional: `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` (local browser override only —
never set it to a Windows path on Render; production uses the Docker-bundled
Chromium), `PLAYWRIGHT_HEADED=1` (visible demo window, see below).

Frontend: `VITE_API_BASE_URL` (production API base; dev uses the Vite `/api` proxy, so it stays unset locally).

## Run

```bash
cd backend
npm run dev      # node --watch (:3001)
```

```bash
cd frontend
npm run dev      # Vite (:5173, proxies /api to the backend)
```

## Scraping schedule (cron-job.org, q2h)

| Job | When | Target |
|---|---|---|
| Scrape | every 2 hours (`0 */2 * * *`) | `POST /api/scrape/run` + `x-scrape-token` header |

The run scrapes all active `tracked_products` sequentially under one shared
`run_id` — one `scrape_logs` row per attempt (`success` / `retried` /
`failed`). A product's failure never stops the rest; a second call while a
run is busy gets 409. Manual per-product checks: `POST /api/tracked/:id/check`.

## Export

Each tracked card has **Export CSV**, built from stored history: one row per
attempt with product, option, UTC timestamp, attempt number, price, stock,
outcome, and error. `retried`/`failed` rows keep price/stock empty — the file
always matches the database exactly.

## Headed (= observable) mode

Watch one scrape live in a visible browser window (same retries, timeouts,
and consent handling as production — headless stays the default everywhere
else):

```bash
cd backend
node demo-headed.js 2562 "Creator kit"
```

## Design

See [DESIGN-NOTE.md](./DESIGN-NOTE.md) for store analysis, scraper/retry
design, persistence model, scheduling, and deployment shape.
