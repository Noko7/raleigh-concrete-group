// Every CRM page is force-dynamic, so navigation waits on Supabase; this streams instantly so a tap reads
// as registered. Shaped like the page it stands in for.
export default function CrmLoading() {
  return (
    <main className="crm-page crm-page-wide" aria-busy="true" aria-live="polite">
      <span className="crm-sr">Loading</span>

      <div className="crm-page-head">
        <div>
          <div className="sk sk-title" />
          <div className="sk sk-line sk-w-40" />
        </div>
      </div>

      <div className="sk-row">
        <div className="sk sk-input" />
        <div className="sk sk-btn" />
      </div>

      <div className="sk-stack">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="sk-card">
            <div className="sk sk-line sk-w-60" />
            <div className="sk sk-line sk-w-30" />
            <div className="sk sk-pills">
              <span className="sk sk-pill" />
              <span className="sk sk-pill" />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
