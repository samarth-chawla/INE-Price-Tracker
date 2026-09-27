import { useState } from 'react';
import HistoryTable from './HistoryTable.jsx';
import { buildHistoryCsv, downloadCsv, historyFilename } from '../utils/csv.js';
import { api } from '../utils/api.js';

function formatPrice(value) {
  return Number(value).toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  });
}

// One tracked product: latest SUCCESSFUL price/stock on the card
// (a later failure must never blank a known-good price), plus
// Check Now / History / Export CSV actions.
export default function TrackedCard({ product, history, historyLoading, historyError, onCheckNow, checking }) {
  const [showHistory, setShowHistory] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(null);

  const rows = history || [];
  const latestSuccess = rows.find((r) => r.outcome === 'success') || null;

  async function handleExport() {
    setExporting(true);
    setExportError(null);
    try {
      // Fetch the full history for export (card preview may be capped).
      const res = await fetch(api(`/api/tracked/${product.id}/scrapes?limit=200`));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Server returned ${res.status}`);
      downloadCsv(historyFilename(product), buildHistoryCsv(product, data.results || []));
    } catch (err) {
      setExportError(err.message || 'CSV export failed.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <li className="tracked-card">
      <div className="tracked-info">
        <p className="product-name">{product.productName}</p>
        <p className="product-meta">
          <span className="label">ID:</span> {product.storeProductId}
          {' · '}
          <span className="label">Option:</span> {product.selectedOption}
        </p>
        <p className="tracked-current">
          <span className="label">Current price:</span>{' '}
          {latestSuccess ? formatPrice(latestSuccess.price) : '-'}
          {' · '}
          <span className="label">Stock:</span>{' '}
          {latestSuccess ? (latestSuccess.stock ?? '-') : '-'}
        </p>
        {!historyLoading && !historyError && !latestSuccess && (
          <p className="sp-hint">No successful scrape yet - price/stock not available.</p>
        )}
        {historyError && (
          <p className="sp-hint">Could not load history: {historyError}</p>
        )}
      </div>

      <div className="tracked-actions">
        <button
          className="btn-select"
          onClick={() => onCheckNow(product)}
          disabled={checking || historyLoading}
        >
          {checking ? 'Checking…' : 'Check Now'}
        </button>
        <button
          className="btn-ghost"
          onClick={() => setShowHistory((v) => !v)}
          disabled={historyLoading}
        >
          {showHistory ? 'Hide history' : 'History'}
        </button>
        <button
          className="btn-ghost"
          onClick={handleExport}
          disabled={exporting}
        >
          {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
      </div>

      {exportError && (
        <div className="alert alert-error" role="alert">{exportError}</div>
      )}

      {showHistory && (
        historyLoading
          ? <div className="loading loading-sm"><span className="spinner" aria-hidden="true" /> Loading history…</div>
          : <HistoryTable rows={rows} />
      )}
    </li>
  );
}
