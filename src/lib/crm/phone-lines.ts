// Server-only: which Quo number a text goes out from.
//
// Every customer text on a job assigned to a contractor with their own Quo line goes out from that line, so
// the contractor sees the whole conversation in their Quo inbox and the customer's replies reach them
// directly. Decided when the text is actually sent (held texts included), so a reassigned job switches to
// the new contractor's line from its next text. Everything else goes out from the business line: new-lead
// receipts, unassigned jobs, owner and crew alerts.
//
// The assignments live in app_integrations (provider "settings"), set by the owner in Settings. No line set
// for the business means the QUO_FROM env var, as before.
import { readAppSettings, writeAppSettings } from "./queries";
import { pgAdmin } from "./rest";

export type PhoneLines = {
  /** The business line, E.164; null means QUO_FROM. */
  business: string | null;
  /** Staff id -> that contractor's own line, E.164. */
  contractors: Record<string, string>;
};

// New-lead receipts answer the website form before anyone owns the job.
const ALWAYS_BUSINESS = new Set(["received"]);

// A send can need this several times a minute (a cron run); a stale minute is harmless.
let cached: { at: number; lines: PhoneLines } | null = null;
const TTL_MS = 60_000;

export async function getPhoneLines(): Promise<PhoneLines> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.lines;
  const data = await readAppSettings();
  const raw = (data.phone_lines ?? {}) as Partial<PhoneLines>;
  const lines: PhoneLines = {
    business: typeof raw.business === "string" && raw.business ? raw.business : null,
    contractors:
      raw.contractors && typeof raw.contractors === "object"
        ? Object.fromEntries(
            Object.entries(raw.contractors).filter(([, v]) => typeof v === "string" && v !== ""),
          )
        : {},
  };
  cached = { at: Date.now(), lines };
  return lines;
}

export async function savePhoneLines(lines: PhoneLines): Promise<boolean> {
  const ok = await writeAppSettings({ phone_lines: lines });
  if (ok) cached = null;
  return ok;
}

/**
 * The line a text goes out from, or null for the provider's default (QUO_FROM). A contractor's line is only
 * for a customer text on a job assigned to them.
 */
export async function sendingLine(log?: { quoteId?: string | null; kind?: string; role?: string }): Promise<string | null> {
  const lines = await getPhoneLines().catch(() => null);
  if (!lines) return null;
  if (log?.role === "customer" && log.quoteId && !ALWAYS_BUSINESS.has(log.kind ?? "")) {
    const own = await assignedLine(log.quoteId, lines).catch(() => null);
    if (own) return own;
  }
  return lines.business;
}

async function assignedLine(quoteId: string, lines: PhoneLines): Promise<string | null> {
  if (Object.keys(lines.contractors).length === 0) return null;
  const res = await pgAdmin(`quote_requests?id=eq.${encodeURIComponent(quoteId)}&select=assigned_to&limit=1`);
  if (!res.ok) return null;
  const rows = (await res.json()) as { assigned_to: string | null }[];
  const staffId = rows[0]?.assigned_to;
  return staffId ? (lines.contractors[staffId] ?? null) : null;
}

// ── The numbers in the Quo workspace, for the Settings picker ──────────────────

export type QuoNumber = { id: string; number: string; label: string };
export type QuoNumbersResult = { ok: true; numbers: QuoNumber[] } | { ok: false; error: string };

export async function listQuoNumbers(): Promise<QuoNumbersResult> {
  const key = process.env.QUO_API_KEY || "";
  if (!key) return { ok: false, error: "QUO_API_KEY is not set, so the Quo numbers can't be listed." };
  try {
    const res = await fetch("https://api.openphone.com/v1/phone-numbers", {
      headers: { Authorization: key },
      cache: "no-store",
      // Settings must never wait long on Quo.
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { ok: false, error: `Quo answered ${res.status} when listing numbers.` };
    const body = (await res.json()) as {
      data?: { id?: string; number?: string; formattedNumber?: string; name?: string; users?: { firstName?: string; lastName?: string }[] }[];
    };
    const numbers = (body.data ?? [])
      .filter((n) => n.id && n.number)
      .map((n) => {
        const people = (n.users ?? [])
          .map((u) => [u.firstName, u.lastName].filter(Boolean).join(" "))
          .filter(Boolean)
          .join(", ");
        const shown = n.formattedNumber || n.number!;
        return {
          id: n.id!,
          number: n.number!,
          label: [n.name, shown, people && `(${people})`].filter(Boolean).join(" · "),
        };
      });
    return { ok: true, numbers };
  } catch (e) {
    const timedOut = e instanceof Error && e.name === "TimeoutError";
    return { ok: false, error: timedOut ? "Quo took too long to list its numbers." : "Could not reach Quo to list its numbers." };
  }
}
