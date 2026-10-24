"use server";

import { revalidatePath } from "next/cache";

import { getSession } from "@/lib/crm/auth";
import { isLocale } from "@/lib/crm/i18n";
import { BUSINESS_TZ, now } from "@/lib/crm/clock";
import { readWorkHours } from "@/lib/crm/constants";
import { ownerRecipients, sendSmsResult, toE164 } from "@/lib/crm/notify";
import { listContractors, setPrimaryContractorId, updateOwnProfile } from "@/lib/crm/queries";
import { getPhoneLines, listQuoNumbers, savePhoneLines } from "@/lib/crm/phone-lines";
import { rateLimit } from "@/lib/rate-limit";
import type { SaveState, TestSmsState } from "./types";

// E.164, null to clear, or "invalid". Uses toE164 from notify.ts (what the senders use), so an accepted
// number is one a text can reach. The wrapper treats an empty box as "clear my number".
function normalizePhone(raw: string): string | null | "invalid" {
  if (raw.trim() === "") return null;
  return toE164(raw) ?? "invalid";
}

export async function saveSettings(_prev: SaveState, formData: FormData): Promise<SaveState> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Your session expired. Please sign in again." };

  const fullName = String(formData.get("full_name") ?? "").trim().slice(0, 120);
  const phone = normalizePhone(String(formData.get("phone") ?? ""));
  if (phone === "invalid") {
    return { ok: false, error: "Enter a valid US phone number, e.g. (919) 555-1234." };
  }

  // Only locales we ship, so a tampered form can't violate the locale check constraint.
  const rawLocale = String(formData.get("locale") ?? "");
  const locale = isLocale(rawLocale) ? rawLocale : undefined;

  const ok = await updateOwnProfile(session, { full_name: fullName || null, phone, locale });
  if (!ok) return { ok: false, error: "Could not save your settings. Please try again." };

  revalidatePath("/crm/settings");
  revalidatePath("/crm");
  return { ok: true, saved: true };
}

/**
 * Separate from saveSettings so narrowing hours can't blank the alert number via a stale field.
 * Re-derived through readWorkHours so a hand-posted form can't break the check constraint or leave them
 * unbookable.
 */
export async function saveWorkHours(_prev: SaveState, formData: FormData): Promise<SaveState> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Your session expired. Please sign in again." };

  const startHour = Number(formData.get("work_start_hour"));
  const endHour = Number(formData.get("work_end_hour"));
  const days = formData.getAll("work_days").map(Number);

  if (!Number.isFinite(startHour) || !Number.isFinite(endHour)) {
    return { ok: false, error: "Pick a first and last visit time." };
  }
  if (endHour < startHour) {
    return { ok: false, error: "The last visit can't be earlier than the first." };
  }
  // Empty would read as "no restriction" in readWorkHours; unticking every box deliberately is refused instead.
  if (days.length === 0) {
    return { ok: false, error: "Pick at least one day, otherwise nobody can book you." };
  }

  const hours = readWorkHours({ work_start_hour: startHour, work_end_hour: endHour, work_days: days });
  const ok = await updateOwnProfile(session, {
    work_start_hour: hours.startHour,
    work_end_hour: hours.endHour,
    work_days: hours.days,
  });
  if (!ok) return { ok: false, error: "Could not save your hours. Please try again." };

  revalidatePath("/crm/settings");
  return { ok: true, saved: true };
}

// Owner-only: send one real text to check notifications and see the provider's own error. Blank sends to
// every owner-alert recipient.
export async function sendTestSms(_prev: TestSmsState, formData: FormData): Promise<TestSmsState> {
  const session = await getSession();
  if (!session || session.staff.role !== "owner") return { ok: false, error: "Owners only." };

  // Texts cost money and the provider rate-limits us; guard against double clicks and stuck tabs.
  if (await rateLimit(`smstest:${session.staff.id}`, 10, 10 * 60 * 1000)) {
    return { ok: false, error: "Too many test messages. Wait a few minutes and try again." };
  }

  const typed = String(formData.get("to") ?? "").trim();
  let targets: string[];
  if (typed) {
    const e164 = toE164(typed);
    if (!e164) return { ok: false, error: `"${typed}" isn't a valid US number.` };
    targets = [e164];
  } else {
    // Exactly the real owner-alert list, no exclusions: the point is to prove your own number receives them.
    targets = await ownerRecipients();
    if (targets.length === 0) {
      return {
        ok: false,
        error: "No owner number to text. Save your phone above, or set OWNER_PHONE in Vercel.",
      };
    }
  }

  const stamp = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TZ,
    hour: "numeric",
    minute: "2-digit",
  }).format(now());
  const results = await Promise.all(
    targets.map(async (to) => {
      // Ignores quiet hours, like every staff-facing text (only customer texts are held).
      const r = await sendSmsResult(to, `Raleigh Concrete Group CRM test message (${stamp}). Notifications are working.`);
      return {
        to,
        from: r.from ?? null,
        ok: r.ok,
        status: r.status ?? null,
        // The raw response is the point (e.g. "A2P Registration Not Approved" vs a bad key). Trimmed so an HTML
        // error page can't blow up the panel.
        detail: r.detail ? r.detail.slice(0, 600) : null,
      };
    }),
  );

  return { ok: results.some((r) => r.ok), results };
}

// Owner-only: the contractor every new quote auto-assigns to.
export async function savePrimaryContractor(_prev: SaveState, formData: FormData): Promise<SaveState> {
  const session = await getSession();
  if (!session || session.staff.role !== "owner") return { ok: false, error: "Owners only." };

  const raw = String(formData.get("primary_contractor_id") ?? "").trim();
  const id = raw === "" ? null : raw;
  if (id && !/^[0-9a-fA-F-]{36}$/.test(id)) return { ok: false, error: "Pick a valid contractor." };

  const ok = await setPrimaryContractorId(id);
  if (!ok) return { ok: false, error: "Could not save. Please try again." };

  revalidatePath("/crm/settings");
  return { ok: true, saved: true };
}

// Owner-only: which Quo line each contractor's customers hear from, and the business line. Only numbers in
// the Quo workspace are accepted, so texts can't be pointed at a line Quo won't send from.
export async function savePhoneLinesAction(_prev: SaveState, formData: FormData): Promise<SaveState> {
  const session = await getSession();
  if (!session || session.staff.role !== "owner") return { ok: false, error: "Owners only." };

  const quo = await listQuoNumbers();
  if (!quo.ok) return { ok: false, error: `${quo.error} Nothing was changed.` };
  const known = new Set(quo.numbers.map((n) => n.number));

  const business = String(formData.get("business") ?? "").trim() || null;
  if (business && !known.has(business)) return { ok: false, error: "That business number isn't in your Quo workspace." };

  const contractors: Record<string, string> = {};
  const [staff, saved] = await Promise.all([listContractors(session), getPhoneLines()]);
  for (const c of staff) {
    // Only active contractors are on the form; an inactive one keeps their line for when they're back.
    if (!formData.has(`line_${c.id}`)) {
      if (saved.contractors[c.id]) contractors[c.id] = saved.contractors[c.id];
      continue;
    }
    const v = String(formData.get(`line_${c.id}`) ?? "").trim();
    if (!v) continue;
    if (!known.has(v)) return { ok: false, error: `The number for ${c.full_name || c.email} isn't in your Quo workspace.` };
    contractors[c.id] = v;
  }
  // One line per contractor: two sharing one would read each other's customers.
  const used = Object.values(contractors);
  if (new Set(used).size !== used.length) return { ok: false, error: "Two contractors can't share one number." };
  if (business && used.includes(business)) {
    return { ok: false, error: "A contractor's number can't also be the business number." };
  }

  const ok = await savePhoneLines({ business, contractors });
  if (!ok) return { ok: false, error: "Could not save the phone lines. Please try again." };
  revalidatePath("/crm/settings");
  return { ok: true, saved: true };
}
