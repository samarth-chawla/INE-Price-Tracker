# INE Product Price Tracker

A full-stack product price tracker targeting the [INE mock store](https://demo.inelabteamdev.com/).
Search products, track a product + option, scrape its live price/stock on a
2-hour schedule, and review per-attempt history or export it as CSV.

---

## Architecture

```
React/Vite (Vercel)
   → Express/Node (Render, Docker)
       → Supabase PostgreSQL (tracked products + per-attempt scrape logs)
       → Playwright/Chromium (dynamic price scraping)
cron-job.org → POST /api/scrape/run (every 2 hours)
```

---

## Project Structure

```
INE Project/
├── backend/               Express API server
│   ├── server.js
│   ├── package.json
│   ├── Dockerfile
│   ├── .dockerignore
│   ├── .env.example
│   ├── db/
│   │   ├── schema.sql              # tracked_products + scrape_logs
│   │   ├── migrate-002-attempts.sql# per-attempt outcome/attempt_number/run_id
│   │   └── client.js               # pg pool (Supabase)
│   ├── routes/
│   │   ├── products.js             # search + product detail
│   │   ├── scrape.js               # POST /api/scrape + POST /api/scrape/run
│   │   └── tracking.js             # tracked products + history + check-now
│   ├── services/
│   │   ├── trackingService.js      # persistence (append-only history)
│   │   └── scrapeRunner.js         # single-product scrape + persist
│   └── scraper/
│       └── priceScraper.js         # Playwright scraper
└── frontend/              React + Vite UI
    ├── index.html
    ├── vite.config.js
    ├── package.json
    ├── .env.example
    └── src/
        ├── main.jsx
        ├── App.jsx
        ├── index.css
        ├── components/
        │   ├── SearchBar.jsx
        │   ├── ProductList.jsx
        │   ├── ProductCard.jsx
        │   ├── SelectedProduct.jsx  # option picker + Check Price + Track
        │   ├── PriceResult.jsx
        │   ├── Modal.jsx
        │   ├── TrackedSection.jsx   # tracked-products dashboard
        │   ├── TrackedCard.jsx      # latest-success price + Check Now/History/CSV
        │   └── HistoryTable.jsx     # per-attempt history table
        └── utils/
            ├── api.js               # VITE_API_BASE_URL backend prefix
            └── csv.js               # history CSV builder + download
```

---

## Workflow

Search → Select product → Select option → Track → Check Now/history →
scheduled scrape (every 2 hours) → CSV export.

---

## Product Search

The store exposes a JSON catalogue (`/api/v2/listings?page=N&limit=M`) with
numeric product IDs; product pages live at `/item/{id}`. The store has no
server-side search, so the backend builds an in-memory cache and filters
locally on name, brand, category, and SKU (case-insensitive).

```
GET /api/products/search?q=<partial or full product name>
GET /api/products/:id        # detail incl. options for the option picker
```

| Status | Condition |
|--------|-----------|
| 400 | Missing or too-short query |
| 502 | Store unreachable / bad response |

---

## Product + Option Tracking

```
POST /api/tracked            # { storeProductId, selectedOption } → 201 (409 if already tracked)
GET  /api/tracked            # all tracked products
GET  /api/tracked/:id        # one tracked product
```

The UI reuses product search: pick an option in the product modal and add it
to tracking. Duplicates are rejected with 409 and shown gracefully.

---

## Supabase Persistence

`backend/db/schema.sql` creates two tables (UTC `timestamptz`, `NUMERIC`
prices, FK with cascade delete, history index):

- `tracked_products` — store product id, name, URL, selected option, active flag
- `scrape_logs` — one row per attempt: timestamp, price, stock, outcome,
  error message, store attempt count, attempt number, run id

History is append-only. A failed/retried attempt stores `price = NULL` and
`stock = NULL` (enforced by service validation and a DB CHECK constraint) —
it never overwrites a previous success, and no stale values are ever stored.

---

## Scraping, Retries, and Per-Attempt History

The store's price loading needs a real browser: a gesture guard (≥8 mouse
moves + ≥600ms hover), silently dropped/delayed clicks, a challenge →
fingerprint → bearer-auth flow, and a consent dialog on ~75% of sessions.
Playwright supplies `isTrusted` input and real JS execution.

Each click-loop attempt is stored as its own row (`success` / `retried` /
`failed`), grouped by `run_id` with a 1-based `attempt_number`:

```
GET /api/tracked/:id/scrapes?limit=N   # newest-first history
```

The dashboard history table shows timestamp, attempt, price, stock, outcome,
and error. `retried`/`failed` rows display `—` for price/stock with the
recorded reason — failures are never hidden. Each tracked card derives its
current price/stock from the latest **successful** scrape, so a later failure
never blanks a known-good price.

---

## API Endpoints

| Method + path | Purpose |
|---|---|
| `GET /api/health` | Liveness (`{ status: "ok" }`) |
| `GET /api/db-health` | Supabase reachability (503 when unconfigured/unreachable) |
| `GET /api/products/search?q=` | Product search |
| `GET /api/products/:id` | Product detail + options |
| `POST /api/scrape` | Single-product/manual scrape (`{ productId, option }` → price/stock, not stored) |
| `POST /api/tracked` | Track a product + option |
| `GET /api/tracked` | List tracked products |
| `GET /api/tracked/:id` | One tracked product |
| `GET /api/tracked/:id/scrapes` | Per-attempt history, newest first |
| `POST /api/tracked/:id/scrapes` | Store one attempt row (used by tests/tools) |
| `POST /api/tracked/:id/check` | Manual Check Now: one scrape, every attempt persisted |
| `POST /api/scrape/run` | Scheduled batch run over ALL active tracked products (sequential, per-product failure isolation, one shared `run_id`) → `{ runId, total, successful, failed, results }` |

`POST /api/scrape/run` requires header `x-scrape-token: <SCRAPE_RUN_TOKEN>`
when the variable is set (production) and returns 401/409 otherwise; a
second call while a run is in progress gets 409.

---

## Dashboard, Check Now, CSV Export

The Tracked Products dashboard lists every tracked product with its latest
successful price/stock (or an explicit not-available note), plus per-card
**Check Now** (manual scrape with loading/success/failure states),
**History** (per-attempt table), and **Export CSV**.

CSV is generated client-side from the full history: one row per attempt with
product id, name, option, timestamp, attempt, price, stock, outcome, error.
`retried`/`failed` rows keep price/stock empty — data is never invented.

---

## Browser Setup (Playwright)

The scraper (`backend/scraper/priceScraper.js`) resolves its browser binary
in this order — no scraping logic depends on which entry wins:

1. `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` — **optional** override; when set,
   its value is passed straight to Playwright's `launch({ executablePath })`.
   The code does not validate it; an invalid path fails at launch.
2. Windows local dev — when the variable is unset and Chrome exists at the
   standard install location, the installed system Chrome is used.
3. Everywhere else — `executablePath` is omitted and Playwright uses its own
   bundled Chromium (requires a one-time `npx playwright install chromium`).

Production (Render, Docker): `backend/Dockerfile` runs
`npx playwright install --with-deps chromium` during the image build, which
provides both the bundled Chromium and its OS libraries. That is sufficient
— do NOT set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` on Render and do NOT
configure any Windows `C:\Program Files\…` path there.

---

## Environment Variables

Backend (`backend/.env`, gitignored; production values in the Render dashboard):

| Variable | Required | Purpose |
|---|---|---|
| `SUPABASE_CONNECTION_STRING` | Yes (production) | Supabase pooler URI (`postgresql://…`) |
| `SCRAPE_RUN_TOKEN` | Yes (production) | Shared secret for `POST /api/scrape/run` via `x-scrape-token` |
| `FRONTEND_URL` | Yes (production) | Deployed frontend origin — locks CORS (open when unset, local dev) |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` | No (optional) | Local browser override only |
| `PORT` | No | Injected by Render; defaults to 3001 locally |

Frontend (Vercel project settings):

| Variable | Required | Purpose |
|---|---|---|
| `VITE_API_BASE_URL` | Yes (production) | Render backend URL; unset locally (vite proxies `/api/*` to `localhost:3001`) |

Never put Supabase or scrape tokens in frontend code. Never commit `.env`.

---

## Deployment (Render + Vercel + cron-job.org)

### Backend → Render (Docker)

`render.yaml` defines the Blueprint (`runtime: docker`, health check
`/api/health`). Apply it in the Render dashboard, then set
`SUPABASE_CONNECTION_STRING`, `SCRAPE_RUN_TOKEN` (fresh value, not the dev
one), and `FRONTEND_URL`.

### Frontend → Vercel

Root Directory `frontend` (Vite auto-detected). Set `VITE_API_BASE_URL` to
the Render backend URL.

### Scheduler → cron-job.org

| Field | Value |
|---|---|
| URL | `https://<render-service>.onrender.com/api/scrape/run` |
| Method | `POST` |
| Header | `x-scrape-token: <production SCRAPE_RUN_TOKEN>` |
| Schedule | Every 2 hours — cron `0 */2 * * *` |

---

## How to Run Locally

```bash
cd backend
npm install
npm run dev        # node --watch (Node 18+); http://localhost:3001
```

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173 (proxies /api/* to the backend)
```

On startup the backend builds its product cache (~30s, refreshes every
5 minutes); the first search waits for it, later searches are instant.
