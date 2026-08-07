import type { Agreement, AgreementStatus } from "@/lib/crm/types";
import { removeAgreement, setAgreementStatus } from "./actions";

const STATUS_LABELS: Record<AgreementStatus, string> = {
  pending: "Not sent",
  sent: "Awaiting signature",
  signed: "Signed",
  declined: "Declined",
  void: "Void",
};

const ORDER: AgreementStatus[] = ["pending", "sent", "signed", "declined", "void"];

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function AgreementStatusBadge({ status }: { status: AgreementStatus }) {
  return <span className={`crm-badge ag-badge-${status}`}>{STATUS_LABELS[status]}</span>;
}

// Read-only for contractors: they sign in DocuSeal, the owner keeps the record.
export function AgreementList({ agreements, isOwner }: { agreements: Agreement[]; isOwner: boolean }) {
  if (agreements.length === 0) {
    return <p className="crm-muted crm-sm">No agreements recorded yet.</p>;
  }

  return (
    <ul className="ag-list">
      {agreements.map((a) => (
        <li key={a.id} className="ag-item">
          <div className="ag-item-head">
            <div>
              <strong>{a.title}</strong>
              <div className="crm-muted crm-sm">
                Added {fmt(a.created_at)}
                {a.signed_at ? ` · signed ${fmt(a.signed_at)}` : a.sent_at ? ` · sent ${fmt(a.sent_at)}` : ""}
              </div>
            </div>
            <AgreementStatusBadge status={a.status} />
          </div>

          {a.notes && <p className="crm-muted crm-sm ag-notes">{a.notes}</p>}

          <div className="ag-item-actions">
            {a.file_path && (
              <a
                className="crm-btn crm-btn-ghost"
                href={`/crm/api/agreement?id=${encodeURIComponent(a.id)}`}
                target="_blank"
                rel="noreferrer"
              >
                View file
              </a>
            )}
            {a.docuseal_url && (
              <a className="crm-btn crm-btn-ghost" href={a.docuseal_url} target="_blank" rel="noreferrer">
                Open in DocuSeal
              </a>
            )}

            {isOwner && (
              <>
                <form action={setAgreementStatus} className="ag-status-form">
                  <input type="hidden" name="id" value={a.id} />
                  <select name="status" defaultValue={a.status} className="crm-input ag-status-select">
                    {ORDER.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
                  <button type="submit" className="crm-btn crm-btn-ghost">
                    Update
                  </button>
                </form>
                <form action={removeAgreement}>
                  <input type="hidden" name="id" value={a.id} />
                  <button type="submit" className="crm-btn crm-btn-ghost ag-delete">
                    Delete
                  </button>
                </form>
              </>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
