// The crew's job page while the server is still answering.
//
// Same reasoning as the CRM's skeleton, and more so: this is the page opened
// from a text message, one-handed, often on a slow connection at the kerb. A
// white card that is already the right shape tells you the tap worked.
export default function JobLoading() {
  return (
    <main className="job-wrap" aria-busy="true" aria-live="polite">
      <div className="job-card">
        <span className="crm-sr">Loading</span>
        <div className="sk sk-light sk-logo" />
        <div className="sk sk-light sk-title" />

        {/* The key block: the two facts the page exists to show. */}
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
