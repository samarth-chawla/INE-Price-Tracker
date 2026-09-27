-- Phase 3 follow-up migration: represent EVERY scrape attempt as its own row.
--
-- Before: one row per scrape call (inner click-retries lived only in logs).
-- After:  intermediate attempts → outcome='retried', price/stock NULL;
--         terminal attempt     → 'success' (fresh price+stock) or 'failed' (NULLs).
-- run_id groups the rows of one logical scrape; attempt_number orders them.
--
-- Safe to re-run. Existing rows stay valid (attempt_number defaults to 1,
-- run_id stays NULL, success/failed satisfy the new CHECK).
--
--   psql "$SUPABASE_CONNECTION_STRING" -f migrate-002-attempts.sql

alter table scrape_logs
  add column if not exists attempt_number integer not null default 1;

alter table scrape_logs
  add column if not exists run_id uuid;

alter table scrape_logs
  drop constraint if exists scrape_logs_outcome_check;

alter table scrape_logs
  drop constraint if exists scrape_logs_check;

alter table scrape_logs
  add constraint scrape_logs_outcome_check
  check (outcome in ('success', 'retried', 'failed'));

alter table scrape_logs
  add constraint scrape_logs_check
  check (
    (outcome = 'success' and price is not null)
    or
    (outcome in ('retried', 'failed') and price is null and stock is null)
  );
