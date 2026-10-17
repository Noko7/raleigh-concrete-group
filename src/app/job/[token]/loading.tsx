// Opened from a text, often on a slow connection: a right-shaped card shows the tap worked.
export default function JobLoading() {
  return (
    <main className="job-wrap" aria-busy="true" aria-live="polite">
      <div className="job-card">
        <span className="crm-sr">Loading</span>
        <div className="sk sk-light sk-logo" />
        <div className="sk sk-light sk-title" />

        <div className="sk-key">
          <div className="sk sk-light sk-pill" />
          <div className="sk sk-light sk-line sk-w-30" />
          <div className="sk sk-light sk-big" />
        </div>

        <div className="sk-stack">
          {[0, 1, 2].map((i) => (
            <div key={i} className="sk-card sk-card-light">
              <div className="sk sk-light sk-line sk-w-60" />
              <div className="sk sk-light sk-line sk-w-40" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
