"use server";

import { revalidatePath } from "next/cache";

import { getSession } from "@/lib/crm/auth";
import { isLocale } from "@/lib/crm/i18n";
import { BUSINESS_TZ, now } from "@/lib/crm/clock";
import { readWorkHours } from "@/lib/crm/constants";
import { ownerRecipients, sendSmsResult, toE164 } from "@/lib/crm/notify";
import { setPrimaryContractorId, updateOwnProfile } from "@/lib/crm/queries";
import { rateLimit } from "@/lib/rate-limit";
import type { SaveState, TestSmsState } from "./types";

// Returns the E.164 form, null to clear, or "invalid".
function normalizePhone(raw: string): string | null | "invalid" {
  const t = raw.trim();
  if (t === "") return null;
  if (t.startsWith("+")) {
    const cleaned = "+" + t.slice(1).replace(/\D/g, "");
    return cleaned.length >= 11 && cleaned.length <= 16 ? cleaned : "invalid";
  }
  const d = t.replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return "invalid";
}

export async function saveSettings(_prev: SaveState, formData: FormData): Promise<SaveState> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Your session expired. Please sign in again." };

  const fullName = String(formData.get("full_name") ?? "").trim().slice(0, 120);
  const phone = normalizePhone(String(formData.get("phone") ?? ""));
  if (phone === "invalid") {
    return { ok: false, error: "Enter a valid US phone number, e.g. (919) 555-1234." };
  }

  // Ignore anything that isn't a language we ship, so a tampered form can't
  // write a value the locale check constraint would reject.
  const rawLocale = String(formData.get("locale") ?? "");
  const locale = isLocale(rawLocale) ? rawLocale : undefined;

  const ok = await updateOwnProfile(session, { full_name: fullName || null, phone, locale });
  if (!ok) return { ok: false, error: "Could not save your settings. Please try again." };

  revalidatePath("/crm/settings");
  revalidatePath("/crm");
  return { ok: true, saved: true };
}

/**
 * When this person takes on-site quote visits.
 *
 * Separate from saveSettings deliberately: the two forms are saved
 * independently, and a contractor narrowing their hours shouldn't be able to
 * blank their own alert number as a side effect of a stale name field.
 *
 * Everything is re-derived through readWorkHours rather than trusted, so a
 * hand-posted form can't write a window the check constraint would reject or a
 * day list that leaves them unbookable.
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
  // An empty list would be read as "no restriction" by readWorkHours, which is
  // the right default for a row nobody has touched and the wrong answer to
  // somebody deliberately unticking every box - so it's refused here instead.
  if (days.length === 0) {
    return { ok: false, error: "Pick at least one day, otherwise nobody can book you." };
  }

  const hours = readWorkHours({ work_start_hour: startHour, work_end_hour: endHour, work_days: days });
  const ok = await updateOwnProfile(session, {
    work_start_hour: hours.startHour,
    work_end_hour: hours.endHour,
    work_days: hours.days,
  });
  if (!ok) {
    return {
      ok: false,
      error: "Could not save your hours. If this keeps happening, run supabase/appointments.sql.",
    };
  }

  revalidatePath("/crm/settings");
  return { ok: true, saved: true };
}

// Owner-only: fire one real text through the configured provider so you can see
// whether notifications actually work, and read the provider's own error when
// they don't. Sends to the number you type, or to everyone who'd receive a real
// owner alert if you leave it blank.
export async function sendTestSms(_prev: TestSmsState, formData: FormData): Promise<TestSmsState> {
  const session = await getSession();
  if (!session || session.staff.role !== "owner") return { ok: false, error: "Owners only." };

  // Texts cost money and the provider rate-limits us anyway; keep an accidental
  // double-click or a stuck tab from burning through the allowance.
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
    // Exactly the list a real owner alert would go to - no exclusions, since the
    // point is to prove your own number receives them.
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
      // Sends at any hour, like every other staff-facing text: quiet hours only
      // hold messages to customers. An owner tapping "send a test" at 9pm needs
      // the answer at 9pm.
      const r = await sendSmsResult(to, `Raleigh Concrete Group CRM test message (${stamp}). Notifications are working.`);
      return {
        to,
        from: r.from ?? null,
        ok: r.ok,
        status: r.status ?? null,
        // The provider's raw response is the whole point of this feature - it's
        // what tells you "A2P Registration Not Approved" vs a bad key. Trimmed
        // so a huge HTML error page can't blow up the panel.
        detail: r.detail ? r.detail.slice(0, 600) : null,
      };
    }),
  );

  return { ok: results.some((r) => r.ok), results };
}

// Owner-only: choose the contractor every new quote auto-assigns to.
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
