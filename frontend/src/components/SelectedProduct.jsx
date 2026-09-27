import { useEffect, useState } from 'react';
import PriceResult from './PriceResult.jsx';
import { api } from '../utils/api.js';

export default function SelectedProduct({ product, onClose, onTracked }) {
  // ── Options state ────────────────────────────────────────────────────────
  const [options, setOptions] = useState(null);      // null = not yet fetched
  const [optionAxis, setOptionAxis] = useState('');  // e.g. "Kit"
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [optionsError, setOptionsError] = useState(null);

  // ── Price check state ────────────────────────────────────────────────────
  const [selectedOption, setSelectedOption] = useState(null);
  const [checking, setChecking] = useState(false);
  const [priceResult, setPriceResult] = useState(null);
  const [priceError, setPriceError] = useState(null);

  // ── Track state ──────────────────────────────────────────────────────────
  const [tracking, setTracking] = useState(false);
  const [trackMsg, setTrackMsg] = useState(null);   // { kind: 'ok'|'info'|'error', text }

  // Fetch product options whenever the product changes
  useEffect(() => {
    setOptions(null);
    setOptionAxis('');
    setLoadingOptions(false);
    setOptionsError(null);
    setSelectedOption(null);
    setChecking(false);
    setPriceResult(null);
    setPriceError(null);

    const controller = new AbortController();

    async function fetchOptions() {
      setLoadingOptions(true);
      try {
        const res = await fetch(api(`/api/products/${product.id}`), {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        const data = await res.json();
        setOptions(data.options ?? []);
        setOptionAxis(data.optionAxis ?? '');
      } catch (err) {
        if (err.name !== 'AbortError') {
          setOptionsError('Could not load options. Is the backend running?');
        }
      } finally {
        if (!controller.signal.aborted) setLoadingOptions(false);
      }
    }

    fetchOptions();
    return () => controller.abort();
  }, [product.id]);

  function handleOptionSelect(opt) {
    if (checking || tracking) return;
    setSelectedOption(opt);
    setPriceResult(null);
    setPriceError(null);
    setTrackMsg(null);
  }

  async function handleCheckPrice() {
    if (!selectedOption || checking) return;
    setChecking(true);
    setPriceResult(null);
    setPriceError(null);

    try {
      const res = await fetch(api('/api/scrape'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: product.id,
          option: selectedOption.label,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || data.detail || `Server returned ${res.status}`);
      }
      setPriceResult(data);
    } catch (err) {
      setPriceError(err.message || 'Price check failed. Please try again.');
    } finally {
      setChecking(false);
    }
  }

  async function handleTrack() {
    if (!selectedOption || tracking || checking) return;
    setTracking(true);
    setTrackMsg(null);
    try {
      const res = await fetch(api('/api/tracked'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeProductId: product.id,
          selectedOption: selectedOption.label,
        }),
      });
      const data = await res.json();
      if (res.status === 409) {
        setTrackMsg({ kind: 'info', text: 'Already tracked — this product + option is on your list.' });
        return;
      }
      if (!res.ok) throw new Error(data.error || `Server returned ${res.status}`);
      setTrackMsg({ kind: 'ok', text: `Tracking ${product.name} — ${selectedOption.label}.` });
      if (onTracked) onTracked();
    } catch (err) {
      setTrackMsg({ kind: 'error', text: err.message || 'Could not add to tracking.' });
    } finally {
      setTracking(false);
    }
  }

  return (
    <div className="sp-modal">

      {/* ── Modal header ─────────────────────────────────────────────── */}
      <div className="sp-header">
        <div className="sp-title-block">
          <span className="sp-category">{product.category}</span>
          <h2 className="sp-name">{product.name}</h2>
        </div>
        <button
          className="sp-close"
          onClick={onClose}
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      {/* ── Product meta ─────────────────────────────────────────────── */}
      <dl className="sp-meta">
        <dt>ID</dt>      <dd>{product.id}</dd>
        <dt>Brand</dt>   <dd>{product.brand}</dd>
        <dt>SKU</dt>     <dd>{product.sku}</dd>
        <dt>URL</dt>
        <dd>
          <a href={product.url} target="_blank" rel="noopener noreferrer">
            {product.url}
          </a>
        </dd>
      </dl>

      {/* ── Price check section ──────────────────────────────────────── */}
      <div className="sp-price-section">
        <h3 className="sp-section-title">Check Today's Price</h3>

        {/* Loading options */}
        {loadingOptions && (
          <div className="loading loading-sm">
            <span className="spinner" aria-hidden="true" />
            Loading options…
          </div>
        )}

        {/* Options error */}
        {optionsError && (
          <div className="alert alert-error">{optionsError}</div>
        )}

        {/* Options loaded */}
        {!loadingOptions && !optionsError && options !== null && (
          <>
            {options.length > 0 && (
              <div className="sp-options">
                <p className="sp-options-label">
                  Choose a <strong>{optionAxis}</strong>:
                </p>
                <div className="sp-chips" role="group" aria-label={`${optionAxis} options`}>
                  {options.map((opt) => (
                    <button
                      key={opt.id}
                      className={`sp-chip${selectedOption?.id === opt.id ? ' sp-chip--active' : ''}`}
                      onClick={() => handleOptionSelect(opt)}
                      disabled={checking || tracking}
                      aria-pressed={selectedOption?.id === opt.id}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {!selectedOption && (
                  <p className="sp-hint">Select an option above to check its price.</p>
                )}
              </div>
            )}

            {/* Check Price button */}
            {(selectedOption || options.length === 0) && (
              <div className="sp-check-block">
                <button
                  className="sp-btn-check"
                  onClick={handleCheckPrice}
                  disabled={checking || tracking}
                >
                  {checking
                    ? '⏳ Checking price…'
                    : `Check price${selectedOption ? ` — ${selectedOption.label}` : ''}`}
                </button>
                {selectedOption && (
                  <button
                    className="sp-btn-track"
                    onClick={handleTrack}
                    disabled={checking || tracking}
                  >
                    {tracking ? 'Adding…' : `Track this option — ${selectedOption.label}`}
                  </button>
                )}
                {trackMsg && (
                  <p className={`sp-track-msg sp-track-msg--${trackMsg.kind}`} role="status">
                    {trackMsg.text}
                  </p>
                )}
                {checking && (
                  <p className="sp-checking-note">
                    Opening the store page and reading the live price.
                    This takes up to 30 seconds…
                  </p>
                )}
              </div>
            )}
          </>
        )}

        {/* Price error */}
        {priceError && (
          <div className="alert alert-error sp-price-error">{priceError}</div>
        )}

        {/* Price result */}
        {priceResult && <PriceResult result={priceResult} />}
      </div>
    </div>
  );
}
