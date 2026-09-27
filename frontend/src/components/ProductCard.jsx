export default function ProductCard({ product, onSelect }) {
  return (
    <div className="product-card">
      <div className="product-info">
        <p className="product-name">{product.name}</p>
        <p className="product-meta">
          <span className="label">ID:</span> {product.id}
        </p>
        <p className="product-meta">
          <span className="label">Brand:</span> {product.brand}
        </p>
        <p className="product-meta">
          <span className="label">Category:</span> {product.category}
        </p>
      </div>
      <button
        className="btn-select"
        onClick={() => onSelect(product)}
        aria-label={`Select ${product.name}`}
      >
        Select
      </button>
    </div>
  );
}
