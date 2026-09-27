-- INE Product Price Tracker — Phase 3 schema (Supabase PostgreSQL)
--
-- Run once against the database. Safe to re-run (IF NOT EXISTS).
-- All timestamps are TIMESTAMPTZ (UTC). Prices use NUMERIC (exact, for money).
--
--   psql "$SUPABASE_CONNECTION_STRING" -f schema.sql
-- or paste into the Supabase Dashboard → SQL Editor.

create extension if not exists pgcrypto;

-- Products (product + option pairs) the user chose to track.
create table if not exists tracked_products (
  id               uuid        primary key default gen_random_uuid(),
  store_product_id text        not null,               -- e.g. '2562'
  product_name     text        not null,               -- from the store API
  product_url      text        not null,               -- https://demo.inelabteamdev.com/item/2562
  selected_option  text        not null,               -- e.g. 'Creator kit'
  active           boolean     not null default true,
  created_at       timestamptz not null default now(),
  unique (store_product_id, selected_option)
);

-- One row per scrape attempt. A failed/retried attempt stores NULL
-- price/stock — it must NEVER overwrite or reuse a previous successful
-- result (enforced by the CHECK constraint below). run_id groups the rows
-- of one logical scrape; attempt_number orders them within the run.
create table if not exists scrape_logs (
  id                 uuid        primary key default gen_random_uuid(),
  tracked_product_id uuid        not null references tracked_products (id) on delete cascade,
  timestamp          timestamptz not null default now(),
  price              numeric,                            -- whole INR on success, NULL otherwise
  stock              text,                               -- exact store text on success, NULL otherwise
  outcome            text        not null check (outcome in ('success', 'retried', 'failed')),
  error_message      text,                               -- set on retried/failed, NULL on success
  attempts           integer,                            -- store's "Loaded in N attempts", when known
  attempt_number     integer     not null default 1,     -- 1-based position within the run
  run_id             uuid,                               -- groups one scrape's attempt rows
  check (
    (outcome = 'success' and price is not null)
    or
    (outcome in ('retried', 'failed') and price is null and stock is null)
  )
);

-- History lookups are always "one product, newest first".
create index if not exists idx_scrape_logs_product_time
  on scrape_logs (tracked_product_id, timestamp desc);
