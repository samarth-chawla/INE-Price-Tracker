import ProductCard from './ProductCard.jsx';

export default function ProductList({ results, query, onSelect }) {
  if (results.length === 0) {
    return (
      <section className="results-section">
        <p className="no-results">
          No products found for <strong>"{query}"</strong>. Try a different name, brand, or category.
        </p>
      </section>
    );
  }

  return (
    <section className="results-section">
      <h2 className="results-heading">
        {results.length} result{results.length !== 1 ? 's' : ''} for &ldquo;{query}&rdquo;
      </h2>
      <ul className="product-list">
        {results.map((product) => (
          <li key={product.id}>
            <ProductCard product={product} onSelect={onSelect} />
          </li>
        ))}
      </ul>
    </section>
  );
}
