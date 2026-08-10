import { dict, type Dict, type Locale } from "@/lib/crm/i18n";
import type { Agreement, AgreementStatus } from "@/lib/crm/types";
import { removeAgreement, setAgreementStatus } from "./actions";

const statusLabel = (t: Dict, s: AgreementStatus): string =>
  ({
    pending: t.agreements.statusPending,
    sent: t.agreements.statusSent,
    signed: t.agreements.statusSigned,
    declined: t.agreements.statusDeclined,
    void: t.agreements.statusVoid,
  })[s];

const ORDER: AgreementStatus[] = ["pending", "sent", "signed", "declined", "void"];

function fmt(iso: string, locale: Locale) {
  return new Date(iso).toLocaleDateString(locale === "es" ? "es-US" : "en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function AgreementStatusBadge({ status, locale = "en" }: { status: AgreementStatus; locale?: Locale }) {
  return <span className={`crm-badge ag-badge-${status}`}>{statusLabel(dict(locale), status)}</span>;
}

// Read-only for contractors: they sign in DocuSeal, the owner keeps the record.
export function AgreementList({
  agreements,
  isOwner,
  locale = "en",
}: {
  agreements: Agreement[];
  isOwner: boolean;
  locale?: Locale;
}) {
  const t = dict(locale);
  if (agreements.length === 0) {
    return <p className="crm-muted crm-sm">{t.agreements.noneRecorded}</p>;
  }

  return (
    <ul className="ag-list">
      {agreements.map((a) => (
        <li key={a.id} className="ag-item">
          <div className="ag-item-head">
            <div>
              <strong>{a.title}</strong>
              <div className="crm-muted crm-sm">
                {t.agreements.added} {fmt(a.created_at, locale)}
                {a.signed_at
                  ? ` · ${t.agreements.signedOn} ${fmt(a.signed_at, locale)}`
                  : a.sent_at
                    ? ` · ${t.agreements.sent} ${fmt(a.sent_at, locale)}`
                    : ""}
              </div>
            </div>
            <AgreementStatusBadge status={a.status} locale={locale} />
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
                {t.agreements.viewFileFull}
              </a>
            )}
            {a.docuseal_url && (
              <a className="crm-btn crm-btn-ghost" href={a.docuseal_url} target="_blank" rel="noreferrer">
                {t.agreements.openDocusealFull}
              </a>
            )}

            {isOwner && (
              <>
                <form action={setAgreementStatus} className="ag-status-form">
                  <input type="hidden" name="id" value={a.id} />
                  <select name="status" defaultValue={a.status} className="crm-input ag-status-select">
                    {ORDER.map((s) => (
                      <option key={s} value={s}>
                        {statusLabel(t, s)}
                      </option>
                    ))}
                  </select>
                  <button type="submit" className="crm-btn crm-btn-ghost">
                    {t.agreements.update}
                  </button>
                </form>
                <form action={removeAgreement}>
                  <input type="hidden" name="id" value={a.id} />
                  <button type="submit" className="crm-btn crm-btn-ghost ag-delete">
                    {t.agreements.remove}
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
