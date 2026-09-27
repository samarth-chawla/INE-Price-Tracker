import TrackedSection from './TrackedSection.jsx';

// Dedicated tracked-products view. Reuses the existing dashboard section;
// only the page frame (back button, count line, empty state) is new here.
export default function TrackedPage({ refreshKey, count, onBack, onBrowse }) {
  return (
    <div className="tracked-page">
      <button className="btn-ghost" onClick={onBack}>
        ← Back to Products
      </button>
      <h2 className="section-title">Tracked Products</h2>
      <p className="page-meta" role="status">
        {count} product{count !== 1 ? 's' : ''} currently being monitored.
      </p>
      <TrackedSection refreshKey={refreshKey} showHeading={false} onBrowse={onBrowse} />
    </div>
  );
}
