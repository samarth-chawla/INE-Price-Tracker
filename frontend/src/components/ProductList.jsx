import ProductCard from './ProductCard.jsx';

// Responsive grid of catalogue/search cards. trackedCounts maps
// store product id → number of tracked options (for the card indicator).
export default function ProductList({ products, trackedCounts, onSelect, emptyMessage }) {
  if (!products || products.length === 0) {
    return (
      <p className="no-results">
        {emptyMessage || 'No products to show.'}
      </p>
    );
  }

  return (
    <div className="catalog-grid">
      {products.map((product) => (
        <ProductCard
          key={product.id}
          product={product}
          trackedCount={trackedCounts?.[product.id] || 0}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
