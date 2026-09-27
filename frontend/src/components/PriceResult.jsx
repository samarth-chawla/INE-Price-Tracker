export default function PriceResult({ result }) {
  const formatted = result.price.toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  });

  const scrapedAt = new Date(result.scrapedAt).toLocaleString();

  return (
    <div className="price-result">
      <h4>Live Price</h4>
      <p className="price-value-display">{formatted}</p>
      <dl className="price-meta">
        <dt>Stock</dt>
        <dd>{result.stock}</dd>
        <dt>Option</dt>
        <dd>{result.selectedOption}</dd>
        <dt>Checked at</dt>
        <dd>{scrapedAt}</dd>
      </dl>
      {result.attempts > 1 && (
        <p className="price-attempts">Loaded in {result.attempts} attempts</p>
      )}
      <p className="price-disclaimer">
        Price sourced from the INE mock store. Not saved — tracking not yet implemented.
      </p>
    </div>
  );
}
