import Link from "next/link";

import { requireSession } from "@/lib/crm/auth";
import { STATUS_LABELS, type Status } from "@/lib/crm/constants";
import { dict } from "@/lib/crm/i18n";
import { crmBase } from "@/lib/crm/nav";
import { listQuotes } from "@/lib/crm/queries";

export const dynamic = "force-dynamic";

type SP = { search?: string };

type Customer = {
  key: string;
  name: string;
  phone: string;
  email: string | null;
  count: number;
  lastDate: string;
  lastStatus: Status;
  wonValue: number;
};

export default async function CustomersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const session = await requireSession();
  const base = await crmBase();
  const sp = await searchParams;
  const t = dict(session.staff.locale);

  const quotes = await listQuotes(session, { search: sp.search });

  // A deal counts toward won value once the customer has accepted it.
  const wonValueOf = (q: (typeof quotes)[number]) =>
    q.customer_response === "accepted" ? Number(q.quote_amount ?? 0) : 0;

  const map = new Map<string, Customer>();
  for (const q of quotes) {
    const key = q.phone.replace(/\D/g, "") || q.email?.toLowerCase() || q.id;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        key,
        name: q.name,
        phone: q.phone,
        email: q.email,
        count: 1,
        lastDate: q.created_at,
        lastStatus: q.status,
        wonValue: wonValueOf(q),
      });
    } else {
      existing.count += 1;
      if (q.created_at > existing.lastDate) {
        existing.lastDate = q.created_at;
        existing.lastStatus = q.status;
        existing.name = q.name;
      }
      existing.wonValue += wonValueOf(q);
    }
  }
  const customers = [...map.values()].sort((a, b) => (a.lastDate < b.lastDate ? 1 : -1));

  return (
    <main className="crm-page">
      <div className="crm-page-head">
        <h1>{t.customers.title}</h1>
        <p className="crm-muted">{t.customers.subtitle}</p>
      </div>

      <form className="crm-filters" method="get" action={`${base}/customers`}>
        <input
          className="crm-input"
          type="search"
          name="search"
          placeholder={t.customers.searchPlaceholder}
          defaultValue={sp.search ?? ""}
        />
        <button type="submit" className="crm-btn crm-btn-primary">
          {t.customers.search}
        </button>
        <Link href={`${base}/customers`} className="crm-btn crm-btn-ghost">
          {t.customers.reset}
        </Link>
      </form>

      {customers.length === 0 ? (
        <div className="crm-empty">{t.customers.empty}</div>
      ) : (
        <div className="crm-table-wrap">
          <table className="crm-table">
            <thead>
              <tr>
                <th>{t.customers.colCustomer}</th>
                <th>{t.customers.colContact}</th>
                <th>{t.customers.colQuotes}</th>
                <th>{t.customers.colLatest}</th>
                <th>{t.customers.wonValue}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.key}>
                  <td className="crm-link-strong">{c.name}</td>
                  <td className="crm-sm">
                    {c.phone}
                    {c.email && <div className="crm-muted">{c.email}</div>}
                  </td>
                  <td>{c.count}</td>
                  <td>
                    <span className={`crm-badge crm-badge-${c.lastStatus}`}>
                      {t.status[c.lastStatus] ?? STATUS_LABELS[c.lastStatus]}
                    </span>
                  </td>
                  <td>{c.wonValue > 0 ? `$${c.wonValue.toLocaleString()}` : t.common.na}</td>
                  <td className="crm-row-actions">
                    <Link href={`${base}/?search=${encodeURIComponent(c.phone)}`} className="crm-btn crm-btn-ghost">
                      {t.customers.viewQuotes}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
