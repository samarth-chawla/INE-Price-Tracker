export default function SearchBar({ query, onChange, onSearch, onClear, loading }) {
  function handleKeyDown(e) {
    if (e.key === 'Enter') onSearch();
  }

  return (
    <div className="search-bar">
      <label htmlFor="product-search" className="sr-only">
        Search products
      </label>
      <input
        id="product-search"
        type="search"
        placeholder="Search by product name or SKU..."
        value={query}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={loading}
        autoFocus
      />
      {onClear && (
        <button
          className="btn-clear"
          onClick={onClear}
          disabled={loading}
          aria-label="Clear search"
          title="Clear search"
        >
          ✕
        </button>
      )}
      <button onClick={onSearch} disabled={loading || !query.trim()}>
        {loading ? 'Searching…' : 'Search'}
      </button>
    </div>
  );
}
