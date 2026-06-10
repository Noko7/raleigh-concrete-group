"use server";

import { revalidatePath } from "next/cache";

import { getSession } from "@/lib/crm/auth";
import { updateOwnProfile } from "@/lib/crm/queries";
import type { SaveState } from "./types";

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
