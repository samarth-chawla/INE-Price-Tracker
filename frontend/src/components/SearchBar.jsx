export default function SearchBar({ query, onChange, onSearch, loading }) {
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
        placeholder="e.g. camera, Solvane, action…"
        value={query}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={loading}
        autoFocus
      />
      <button onClick={onSearch} disabled={loading || !query.trim()}>
        {loading ? 'Searching…' : 'Search'}
      </button>
    </div>
  );
}
