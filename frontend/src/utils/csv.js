// CSV helpers for scrape-history export.
// One row per attempt. retried/failed rows keep price/stock EMPTY —
// data is never invented.

const HEADERS = [
  'Product ID',
  'Product name',
  'Selected option',
  'Timestamp',
  'Attempt',
  'Price',
  'Stock',
  'Outcome',
  'Error',
];

/** Escape one CSV cell (quotes, commas, newlines). */
function cell(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Build CSV text for a tracked product's history rows (API shape).
 * Rows are emitted in the order given (API returns newest first).
 */
export function buildHistoryCsv(product, rows) {
  const lines = [HEADERS.join(',')];
  for (const r of rows) {
    lines.push(
      [
        product.storeProductId,
        product.productName,
        product.selectedOption,
        r.timestamp,
        r.attemptNumber ?? '',
        r.outcome === 'success' && r.price !== null ? r.price : '',
        r.outcome === 'success' ? (r.stock ?? '') : '',
        r.outcome,
        r.errorMessage ?? '',
      ]
        .map(cell)
        .join(',')
    );
  }
  return lines.join('\r\n') + '\r\n';
}

/** Trigger a browser download of CSV text. */
export function downloadCsv(filename, text) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Safe filename for a product's history export. */
export function historyFilename(product) {
  const opt = product.selectedOption.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const day = new Date().toISOString().slice(0, 10);
  return `scrape-history-${product.storeProductId}-${opt}-${day}.csv`;
}
