import { useCallback, useEffect, useState } from 'react';
import CataloguePage from './components/CataloguePage.jsx';
import TrackedPage from './components/TrackedPage.jsx';
import SelectedProduct from './components/SelectedProduct.jsx';
import Modal from './components/Modal.jsx';
import { api } from './utils/api.js';

function routeFromHash() {
  return window.location.hash === '#/tracked' ? 'tracked' : 'catalogue';
}

export default function App() {
  const [view, setView] = useState(routeFromHash());
  const [selected, setSelected] = useState(null); // product shown in the modal
  const [tracked, setTracked] = useState([]);     // tracked list (header count + card indicators)
  const [trackedRefresh, setTrackedRefresh] = useState(0);

  // Tiny hash routing: #/ catalogue, #/tracked tracked page.
  useEffect(() => {
    function onHash() {
      setView(routeFromHash());
    }
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const loadTracked = useCallback(async () => {
    try {
      const res = await fetch(api('/api/tracked'));
      const data = await res.json();
      if (res.ok) setTracked(data.results || []);
    } catch {
      // Header count stays stale rather than breaking the page.
    }
  }, []);

  useEffect(() => {
    loadTracked();
  }, [loadTracked, trackedRefresh]);

  // store product id → number of tracked options (catalogue indicators).
  const trackedCounts = {};
  for (const t of tracked) {
    trackedCounts[t.storeProductId] = (trackedCounts[t.storeProductId] || 0) + 1;
  }

  function handleSelect(product) {
    setSelected(product);
  }

  function handleClose() {
    setSelected(null);
  }

  function handleTracked() {
    setTrackedRefresh((k) => k + 1); // refresh header count + card indicators
  }

  function goTracked() {
    window.location.hash = '#/tracked';
  }

  function goCatalogue() {
    window.location.hash = '#/';
  }

  const trackedOptions = selected
    ? tracked.filter((t) => t.storeProductId === selected.id).map((t) => t.selectedOption)
    : [];

  return (
    <div className="app">
      <header className="app-header app-header--row">
        <div>
          <h1>INE Product Price Tracker</h1>
          <p className="subtitle">
            Search for a product, track an option, then check its live price history.
          </p>
        </div>
        <button className="btn-header-tracked" onClick={goTracked}>
          View Tracked ({tracked.length})
        </button>
      </header>

      <main className="app-main">
        {view === 'tracked' ? (
          <TrackedPage
            refreshKey={trackedRefresh}
            count={tracked.length}
            onBack={goCatalogue}
            onBrowse={goCatalogue}
          />
        ) : (
          <CataloguePage
            trackedCounts={trackedCounts}
            onSelect={handleSelect}
          />
        )}
      </main>

      {/* Modal opens on top of everything — backdrop click or Escape closes it */}
      {selected && (
        <Modal onClose={handleClose}>
          <SelectedProduct
            product={selected}
            onClose={handleClose}
            onTracked={handleTracked}
            trackedOptions={trackedOptions}
          />
        </Modal>
      )}
    </div>
  );
}
