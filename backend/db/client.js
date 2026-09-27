'use strict';

// Minimal PostgreSQL client for Supabase (via `pg`).
// Reads SUPABASE_CONNECTION_STRING from the environment (.env supported).
// The pool is created lazily so the backend still boots (and Phase 1/2 keep
// working) when the database is not configured or unreachable — tracking
// routes then answer 503 with a clear message instead of crashing.

const { Pool } = require('pg');

let pool = null;

function isDbConfigured() {
  return !!process.env.SUPABASE_CONNECTION_STRING;
}

function getPool() {
  if (!isDbConfigured()) {
    const err = new Error(
      'Database not configured. Set SUPABASE_CONNECTION_STRING in backend/.env (see .env.example).'
    );
    err.code = 'DB_NOT_CONFIGURED';
    throw err;
  }
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.SUPABASE_CONNECTION_STRING,
      ssl: { rejectUnauthorized: false }, // Supabase requires SSL
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    pool.on('error', (err) => {
      console.error('[db] pool error:', err.message);
    });
  }
  return pool;
}

/** Run a parameterized query. Throws DB_NOT_CONFIGURED when no connection string. */
async function query(text, params) {
  const client = getPool();
  try {
    return await client.query(text, params);
  } catch (err) {
    // Unreachable host / refused connection → mark clearly for 503 mapping.
    if (['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'ENETUNREACH'].includes(err.code)) {
      err.code = 'DB_UNREACHABLE';
    }
    throw err;
  }
}

/** True when a live query round-trips. Used by the health endpoint. */
async function checkDb() {
  await query('select 1 as ok');
  return true;
}

module.exports = { isDbConfigured, query, checkDb };
