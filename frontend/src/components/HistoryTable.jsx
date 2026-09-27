// Scrape-history table: newest first, every attempt its own row.
// retried/failed rows show — for price/stock plus the recorded reason.

function formatPrice(value) {
  return Number(value).toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  });
}

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function HistoryTable({ rows }) {
  if (!rows || rows.length === 0) {
    return <p className="hist-empty">No scrape history yet. Use “Check Now” to run the first scrape.</p>;
  }

  return (
    <div className="hist-wrap">
      <table className="hist-table">
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>Attempt</th>
            <th>Price</th>
            <th>Stock</th>
            <th>Outcome</th>
            <th>Error / message</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={`hist-row--${r.outcome}`}>
              <td className="hist-time">{formatTime(r.timestamp)}</td>
              <td>{r.attemptNumber ?? '—'}</td>
              <td>{r.outcome === 'success' && r.price !== null ? formatPrice(r.price) : '—'}</td>
              <td>{r.outcome === 'success' ? (r.stock ?? '—') : '—'}</td>
              <td>
                <span className={`pill pill--${r.outcome}`}>{r.outcome}</span>
              </td>
              <td className="hist-err">{r.errorMessage || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
