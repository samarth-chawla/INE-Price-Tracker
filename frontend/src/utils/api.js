// API base URL for production deployments.
// - Local dev (vite proxy):  VITE_API_BASE_URL is unset → relative "/api/…" paths.
// - Vercel production:        set VITE_API_BASE_URL to the Render backend URL,
//   e.g. https://ine-tracker-backend.onrender.com
const BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

/** Build an API URL honoring the configured backend base. */
export function api(path) {
  return `${BASE}${path}`;
}
