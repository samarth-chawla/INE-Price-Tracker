// Catalogue product card: brand/category eyebrow, name, SKU/ID,
// subtle tracked-options indicator, View Product action.
// No scraped price here — price belongs to a tracked option, not the card.
export default function ProductCard({ product, trackedCount, onSelect }) {
  return (
    <div className="catalog-card">
      <p className="catalog-eyebrow">
        {product.brand} · {product.category}
      </p>
      <p className="catalog-name">{product.name}</p>
      <p className="catalog-meta">
        <span className="label">SKU:</span> {product.sku}
      </p>
      <p className="catalog-meta">
        <span className="label">ID:</span> {product.id}
      </p>
      {trackedCount > 0 && (
        <p className="catalog-tracked" aria-label={`${trackedCount} tracked options`}>
          <span className="dot" aria-hidden="true" /> Tracked options: {trackedCount}
        </p>
      )}
      <div className="catalog-foot">
        <button
          className="btn-select"
          onClick={() => onSelect(product)}
          aria-label={`View ${product.name}`}
        >
          View Product →
        </button>
      </div>
    </div>
  );
}
