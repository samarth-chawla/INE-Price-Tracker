import { useState } from 'react';
import SearchBar from './components/SearchBar.jsx';
import ProductList from './components/ProductList.jsx';
import SelectedProduct from './components/SelectedProduct.jsx';
import TrackedSection from './components/TrackedSection.jsx';
import Modal from './components/Modal.jsx';
import { api } from './utils/api.js';

export default function App() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);   // null = no search yet
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null); // product shown in the modal
  const [trackedRefresh, setTrackedRefresh] = useState(0); // bump to reload tracked list

  async function handleSearch(term) {
    const trimmed = term.trim();
    if (!trimmed) {
      setError('Please enter a search term.');
      return;
    }
    if (trimmed.length < 2) {
      setError('Search term must be at least 2 characters.');
      return;
    }

    setLoading(true);
    setError(null);
    setResults(null);
    setSelected(null); // close any open modal when a new search starts

    try {
      const res = await fetch(api(`/api/products/search?q=${encodeURIComponent(trimmed)}`));
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Something went wrong. Please try again.');
        return;
      }

      setResults(data.results);
    } catch {
      setError('Could not reach the server. Make sure the backend is running.');
    } finally {
      setLoading(false);
    }
  }

  // Opens the modal — search results stay visible underneath
  function handleSelect(product) {
    setSelected(product);
  }

  // Closes the modal — search results are still there, no re-search needed
  function handleClose() {
    setSelected(null);
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>INE Product Price Tracker</h1>
        <p className="subtitle">
          Search for a product, track an option, then check its live price history.
        </p>
      </header>

      <main className="app-main">
        <SearchBar
          query={query}
          onChange={setQuery}
          onSearch={() => handleSearch(query)}
          loading={loading}
        />

        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}

        {loading && (
          <div className="loading" role="status">
            <span className="spinner" aria-hidden="true" />
            Searching the INE store…
          </div>
        )}

        {/* Search results remain visible even when a product is selected */}
        {!loading && results !== null && (
          <ProductList results={results} query={query} onSelect={handleSelect} />
        )}

        {/* Tracked products dashboard — always visible, refreshes on track */}
        <TrackedSection refreshKey={trackedRefresh} />
      </main>

      {/* Modal opens on top of everything — backdrop click or Escape closes it */}
      {selected && (
        <Modal onClose={handleClose}>
          <SelectedProduct
            product={selected}
            onClose={handleClose}
            onTracked={() => setTrackedRefresh((k) => k + 1)}
          />
        </Modal>
      )}
    </div>
  );
}
