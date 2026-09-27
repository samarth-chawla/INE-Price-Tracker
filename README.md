# INE Product Price Tracker

A full-stack product search and price tracking tool targeting the [INE mock store](https://demo.inelabteamdev.com/).

---

## Phase 2 — Live Price Scraping

Phase 2 adds option selection and live price checking for a selected product, using Playwright to interact with the store's price-loading flow.

### Additional setup (Phase 2)

> Playwright uses the system Chrome installation. No separate browser download is needed on Windows
> if Chrome is installed at `C:/Program Files/Google/Chrome/Application/chrome.exe`.
> To use a different browser, set the env var:
> ```
> PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=C:/path/to/chrome.exe
> ```

### Why Playwright is required

The INE store's price loading cannot be replicated with plain HTTP because:

1. **Gesture guard** — The price panel requires ≥8 mouse moves + ≥600ms hover before the button enables
2. **Click interference** — 35% of button clicks are silently dropped or delayed 900ms
3. **3-step challenge flow** — Challenge GET → fingerprint POST (canvas, WebGL, rAF, `isTrusted`) → bearer-auth GET with XOR-encrypted response
4. **Consent dialog** — A focus-trap modal blocks pointer events on 75% of sessions

Playwright's browser events are `isTrusted: true` and execute real JS (canvas/WebGL fingerprinting).

### Scrape endpoint

```
POST /api/scrape
Content-Type: application/json

{ "productId": "2562", "option": "Creator kit" }
```

Response:
```json
{
  "productId": "2562",
  "productName": "Solvane Action Camera Nano",
  "selectedOption": "Creator kit",
  "price": 64443,
  "currency": "INR",
  "stock": "Sold out",
  "scrapedAt": "2026-09-26T19:58:25.002Z",
  "attempts": 1,
  "success": true
}
```

`price` is the **shown/current selling price** in whole Indian Rupees (not MRP or member price).
`stock` is the exact text shown on the product page (e.g. `"Sold out"`, `"Ready to ship · 144 available"`).
`attempts` reflects the store's internal retry count shown in "Loaded in N attempt(s)".

### Product detail endpoint (for option picker)

```
GET /api/products/2562
```

Returns product detail including options:
```json
{
  "id": "2562",
  "name": "Solvane Action Camera Nano",
  "optionAxis": "Kit",
  "options": [
    { "id": "o1", "label": "Body only" },
    { "id": "o2", "label": "Standard kit" },
    { "id": "o3", "label": "Creator kit" },
    { "id": "o4", "label": "Pro kit" }
  ]
}
```

---

## Phase 1 — Product Search

This phase implements product discovery only: search by name → view results → select a product.

No database, no price extraction, no tracking.

---

## Project Structure

```
INE Project/
├── backend/          Express API server
│   ├── server.js
│   ├── package.json
│   └── routes/
│       └── products.js
└── frontend/         React + Vite UI
    ├── index.html
    ├── vite.config.js
    ├── package.json
    └── src/
        ├── main.jsx
        ├── App.jsx
        ├── index.css
        └── components/
            ├── SearchBar.jsx
            ├── ProductList.jsx
            ├── ProductCard.jsx
            └── SelectedProduct.jsx
```

---

## How to Run

### 1. Backend

```bash
cd backend
npm install
npm run dev        # uses node --watch (Node 18+)
# or: npm start   # plain node
```

The server starts on **http://localhost:3001**

> **Note:** On startup, the backend immediately begins building a local product cache
> by fetching all 960 products from the INE store. This takes **~30 seconds** due to
> rate-limiting on the store's API. The server is available immediately, but the first
> search will wait until the cache is ready. Subsequent searches are instant.
> The cache refreshes every 5 minutes.

### 2. Frontend

In a separate terminal:

```bash
cd frontend
npm install
npm run dev
```

The UI starts on **http://localhost:5173**

Vite proxies `/api/*` requests to the backend, so no CORS issues during development.

---

## Search Endpoint

```
GET /api/products/search?q=<search-term>
```

| Parameter | Type   | Required | Description                         |
|-----------|--------|----------|-------------------------------------|
| `q`       | string | Yes      | Partial or full product name, brand, category, or SKU |

### Success response

```json
{
  "results": [
    {
      "id": "2562",
      "name": "Solvane Action Camera Nano",
      "brand": "Solvane",
      "category": "Cameras",
      "sku": "SK-2562-SO",
      "url": "https://demo.inelabteamdev.com/item/2562"
    }
  ]
}
```

### No-results response

```json
{
  "results": [],
  "message": "No products found matching \"xyz\"."
}
```

### Error responses

| Status | Condition                         |
|--------|-----------------------------------|
| 400    | Missing or too-short query        |
| 502    | Store unreachable / bad response  |

---

## How Product IDs are Obtained

The INE mock store is a React SPA with a JSON API. By inspecting the compiled JS bundle, the following endpoints were discovered:

| Endpoint                              | Purpose                     |
|---------------------------------------|-----------------------------|
| `/api/v2/listings?page=N&limit=M`     | Paginated product catalogue |
| `/api/v2/items/{id}`                  | Single product detail       |
| `/api/v2/ui/manifest`                 | CSS class map for prices    |

Each product in `/api/v2/listings` contains a numeric `id` field (e.g. `2562`).  
The product's storefront URL is constructed as: `https://demo.inelabteamdev.com/item/{id}`.

The store has **no server-side search**. The backend fetches all 960 products across 16 pages
(60 per page max), caches them in memory for 5 minutes, and filters locally on each search request.
Search matches against name, brand, category, and SKU — all case-insensitive.

---

## Example Search Queries

| Query        | What you'll find                          |
|--------------|-------------------------------------------|
| `camera`     | Action cameras, dash cams, etc.           |
| `solvane`    | All products from the Solvane brand       |
| `gaming`     | All Gaming-category products              |
| `nano`       | Products with "Nano" in the name          |
| `SK-2562`    | Exact SKU lookup                          |
| `fitness`    | Fitness category products                 |

---

## Health Check

```
GET /api/health
→ { "status": "ok" }

GET /api/db-health
→ { "status": "ok" }   (or 503 when Supabase is unconfigured/unreachable)
```

---

## Deployment (Render + Vercel + cron-job.org)

No secrets are committed. Backend secrets live only in `backend/.env`
(local, gitignored) and in the Render dashboard (production).

### Backend → Render (Docker)

The repo includes `backend/Dockerfile` (Node 20 + Playwright Chromium with
system deps) and a `render.yaml` Blueprint (`runtime: docker`,
health check `/api/health`). Apply the Blueprint in the Render dashboard,
then set production environment variables there (names only):

| Variable | Value source |
|---|---|
| `SUPABASE_CONNECTION_STRING` | Supabase pooler URI (fresh/production value) |
| `SCRAPE_RUN_TOKEN` | Fresh long random string (NOT the local dev one) |
| `FRONTEND_URL` | The Vercel frontend origin, e.g. `https://…vercel.app` (locks CORS) |

`PORT` is injected by Render and already honored. The scraper uses
Playwright's bundled Chromium automatically when no
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` is set (Windows dev still prefers
the local system Chrome).

### Frontend → Vercel

Root Directory `frontend` (Vite auto-detected). Set in the Vercel project:

| Variable | Value |
|---|---|
| `VITE_API_BASE_URL` | The Render backend URL, e.g. `https://ine-tracker-backend.onrender.com` |

Local dev needs no variable (vite proxies `/api/*` to `localhost:3001`).
Never put Supabase or scrape tokens in frontend code.

### Scheduler → cron-job.org

| Field | Value |
|---|---|
| URL | `https://<render-service>.onrender.com/api/scrape/run` |
| Method | `POST` |
| Header | `x-scrape-token: <production SCRAPE_RUN_TOKEN>` |
| Schedule | Every 2 hours — cron `0 */2 * * *` |

---

## New files in Phase 2

| File | Purpose |
|------|---------|
| `backend/scraper/priceScraper.js` | Playwright scraper: gesture guard, consent dismiss, click retry, price extraction |
| `backend/routes/scrape.js` | `POST /api/scrape` endpoint |
| `frontend/src/components/PriceResult.jsx` | Displays scraped price + stock result |
| `frontend/src/components/SelectedProduct.jsx` | Extended with option picker + Check Price button |
