"use server";

import { revalidatePath } from "next/cache";

import { getSession } from "@/lib/crm/auth";
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

  const ok = await updateOwnProfile(session, { full_name: fullName || null, phone });
  if (!ok) return { ok: false, error: "Could not save your settings. Please try again." };

  revalidatePath("/crm/settings");
  revalidatePath("/crm");
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

  const stamp = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const results = await Promise.all(
    targets.map(async (to) => {
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
