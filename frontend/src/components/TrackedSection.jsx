import { useCallback, useEffect, useState } from 'react';
import TrackedCard from './TrackedCard.jsx';
import { api } from '../utils/api.js';

// Tracked-products dashboard section.
// Loads GET /api/tracked, then per-product history (for latest-success
// price/stock + the history table). Check Now uses POST /:id/check.
const HISTORY_PREVIEW_LIMIT = 50;

export default function TrackedSection({ refreshKey }) {
  const [products, setProducts] = useState(null); // null = not loaded yet
  const [loadError, setLoadError] = useState(null);
  const [histories, setHistories] = useState({}); // id -> { loading, error, rows }
  const [checkingId, setCheckingId] = useState(null);
  const [checkError, setCheckError] = useState(null);

  const loadHistory = useCallback(async (id) => {
    setHistories((h) => ({ ...h, [id]: { loading: true, error: null, rows: h[id]?.rows || [] } }));
    try {
      const res = await fetch(api(`/api/tracked/${id}/scrapes?limit=${HISTORY_PREVIEW_LIMIT}`));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Server returned ${res.status}`);
      setHistories((h) => ({ ...h, [id]: { loading: false, error: null, rows: data.results || [] } }));
    } catch (err) {
      setHistories((h) => ({
        ...h,
        [id]: { loading: false, error: err.message || 'Could not load history.', rows: h[id]?.rows || [] },
      }));
    }
  }, []);

  const loadAll = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch(api('/api/tracked'));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Server returned ${res.status}`);
      const list = data.results || [];
      setProducts(list);
      list.forEach((p) => loadHistory(p.id));
    } catch (err) {
      setProducts([]);
      setLoadError(err.message || 'Could not load tracked products.');
    }
  }, [loadHistory]);

  useEffect(() => {
    loadAll();
  }, [loadAll, refreshKey]);

  async function handleCheckNow(product) {
    if (checkingId) return;
    setCheckingId(product.id);
    setCheckError(null);
    try {
      // 502 here still means "a failed row was saved" — refresh either way.
      await fetch(api(`/api/tracked/${product.id}/check`), { method: 'POST' });
      await loadHistory(product.id);
    } catch {
      setCheckError('Check request failed. Is the backend running?');
    } finally {
      setCheckingId(null);
    }
  }

  return (
    <section className="results-section" aria-label="Tracked products">
      <h2 className="results-heading">Tracked Products</h2>

      {loadError && (
        <div className="alert alert-error" role="alert">{loadError}</div>
      )}

      {checkError && (
        <div className="alert alert-error" role="alert">{checkError}</div>
      )}

      {products === null && !loadError && (
        <div className="loading" role="status">
          <span className="spinner" aria-hidden="true" />
          Loading tracked products…
        </div>
      )}

      {products !== null && products.length === 0 && !loadError && (
        <p className="no-results">
          Nothing tracked yet. Search above, pick an option, and add it to tracking.
        </p>
      )}

      {products !== null && products.length > 0 && (
        <ul className="product-list">
          {products.map((p) => (
            <TrackedCard
              key={p.id}
              product={p}
              history={histories[p.id]?.rows || []}
              historyLoading={histories[p.id]?.loading ?? true}
              historyError={histories[p.id]?.error || null}
              checking={checkingId === p.id}
              onCheckNow={handleCheckNow}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
