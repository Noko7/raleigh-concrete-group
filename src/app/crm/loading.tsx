// Shown the instant a CRM link is tapped, for as long as the server takes.
//
// Every page in here is force-dynamic, so a navigation cannot be served from a
// cache: the browser sits on the page you are leaving until Supabase has
// answered, which reads as the app freezing when you move between pages
// quickly. This is what Next streams in that gap instead, and it turns "did
// that tap register?" into "it is coming".
//
// Shaped like the page it stands in for - a head, a filter row, a stack of
// cards - because a skeleton that matches nothing is just a different kind of
// blank screen.
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
