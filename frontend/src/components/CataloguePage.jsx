import { useCallback, useEffect, useState } from 'react';
import SearchBar from './SearchBar.jsx';
import ProductList from './ProductList.jsx';
import { api } from '../utils/api.js';

const PAGE_LIMIT = 30;

/** Compact page list: first · window around current · last, with ellipses. */
function pageList(totalPages, current) {
  const pages = new Set([1, totalPages]);
  for (let p = current - 2; p <= current + 2; p++) {
    if (p >= 1 && p <= totalPages) pages.add(p);
  }
  const sorted = [...pages].sort((a, b) => a - b);
  const out = [];
  let prev = 0;
  for (const p of sorted) {
    if (p - prev > 1) out.push('…');
    out.push(p);
    prev = p;
  }
  return out;
}

function Pagination({ page, totalPages, onChange, disabled }) {
  if (totalPages <= 1) return null;
  return (
    <nav className="pagination" aria-label="Catalogue pages">
      <button
        className="page-btn"
        onClick={() => onChange(page - 1)}
        disabled={disabled || page <= 1}
      >
        Previous
      </button>
      {pageList(totalPages, page).map((p, i) =>
        p === '…' ? (
          <span key={`gap-${i}`} className="page-gap" aria-hidden="true">…</span>
        ) : (
          <button
            key={p}
            className={`page-btn${p === page ? ' page-btn--active' : ''}`}
            onClick={() => onChange(p)}
            disabled={disabled}
            aria-current={p === page ? 'page' : undefined}
          >
            {p}
          </button>
        )
      )}
      <button
        className="page-btn"
        onClick={() => onChange(page + 1)}
        disabled={disabled || page >= totalPages}
      >
        Next
      </button>
    </nav>
  );
}

// Main catalogue view: browse-all paginated by default, search replaces
// the catalogue while a query is active, clearing returns to page 1.
export default function CataloguePage({ trackedCounts, onSelect }) {
  const [input, setInput] = useState('');
  const [mode, setMode] = useState('catalogue'); // 'catalogue' | 'search'
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [products, setProducts] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const loadPage = useCallback(async (p) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(api(`/api/products?page=${p}&limit=${PAGE_LIMIT}`));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Server returned ${res.status}`);
      setProducts(data.results || []);
      setPagination(data.pagination);
      setPage(data.pagination?.page || p);
      setMode('catalogue');
    } catch (err) {
      setError(err.message || 'Could not load the catalogue.');
    } finally {
      setLoading(false);
    }
  }, []);

  const runSearch = useCallback(async (term) => {
    const trimmed = term.trim();
    if (trimmed.length < 2) {
      // Clearing the search returns to the paginated catalogue.
      setQuery('');
      setInput('');
      loadPage(1);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(api(`/api/products/search?q=${encodeURIComponent(trimmed)}`));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Server returned ${res.status}`);
      setProducts(data.results || []);
      setPagination(null);
      setQuery(trimmed);
      setMode('search');
    } catch (err) {
      setError(err.message || 'Search failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [loadPage]);

  useEffect(() => {
    loadPage(1);
  }, [loadPage]);

  function handleClear() {
    setInput('');
    setQuery('');
    loadPage(1);
  }

  const start = pagination ? (pagination.page - 1) * pagination.limit + 1 : 0;
  const end = pagination ? Math.min(start + products.length - 1, pagination.total) : 0;

  return (
    <div className="catalog-page">
      <h2 className="section-title">Browse Products</h2>

      <SearchBar
        query={input}
        onChange={setInput}
        onSearch={() => runSearch(input)}
        onClear={input ? handleClear : null}
        loading={loading}
      />

      {error && (
        <div className="alert alert-error" role="alert">{error}</div>
      )}

      {loading && (
        <div className="loading" role="status">
          <span className="spinner" aria-hidden="true" />
          {mode === 'search' ? 'Searching the INE store…' : 'Loading catalogue…'}
        </div>
      )}

      {!loading && !error && pagination && mode === 'catalogue' && (
        <p className="page-meta" role="status">
          {pagination.total} products · Page {pagination.page} of {pagination.totalPages}
          {' · '}Showing {products.length ? `${start}–${end}` : '0'} of {pagination.total}
        </p>
      )}

      {!loading && !error && mode === 'search' && (
        <p className="page-meta" role="status">
          {products.length} result{products.length !== 1 ? 's' : ''} for “{query}”
        </p>
      )}

      {!loading && !error && (
        <ProductList
          products={products}
          trackedCounts={trackedCounts}
          onSelect={onSelect}
          emptyMessage={
            mode === 'search'
              ? `No products found for "${query}". Try a different name, brand, or SKU.`
              : 'No products to show.'
          }
        />
      )}

      {!loading && !error && pagination && mode === 'catalogue' && (
        <Pagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          onChange={loadPage}
          disabled={loading}
        />
      )}
    </div>
  );
}
