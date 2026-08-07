"use server";

import { revalidatePath } from "next/cache";

import { getSession } from "@/lib/crm/auth";
import { SITE_ORIGIN } from "@/lib/crm/env";
import { sendSmsResult } from "@/lib/crm/notify";
import { adminCreateUser, adminUpdatePassword, pgAdmin } from "@/lib/crm/rest";
import type { AddState, ResetState } from "./types";

function tempPassword(): string {
  return `Rcg-${crypto.randomUUID().slice(0, 8)}-${crypto.randomUUID().slice(0, 4)}`;
}

export async function createContractor(_prev: AddState, formData: FormData): Promise<AddState> {
  const session = await getSession();
  if (!session || session.staff.role !== "owner") return { ok: false, error: "Owners only." };

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const fullName = String(formData.get("full_name") ?? "").trim().slice(0, 120);
  const phone = String(formData.get("phone") ?? "").trim().slice(0, 32);
  const notify = String(formData.get("notify") ?? "") === "on";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "Enter a valid email." };
  if (fullName.length < 2) return { ok: false, error: "Enter the contractor's name." };

  const password = tempPassword();
  const created = await adminCreateUser(email, password, fullName);
  if ("error" in created) return { ok: false, error: created.error };

  // The on-signup trigger created the staff row as a contractor; fill in details
  // and flag them to set their own password on first login.
  await pgAdmin(`staff?id=eq.${created.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      full_name: fullName,
      phone: phone || null,
      role: "contractor",
      active: true,
      must_reset_password: true,
    }),
  });

  // Optionally text the contractor their login + temporary password.
  let smsSent = false;
  let smsNote: string | undefined;
  if (notify) {
    if (!phone) {
      smsNote = "Add a phone number to text their login.";
    } else {
      const loginUrl = `${SITE_ORIGIN}/crm/login`;
      const msg = `Raleigh Concrete Group CRM is ready for you.\nSign in: ${loginUrl}\nEmail: ${email}\nTemp password: ${password}\nYou'll set your own password on first login.`;
      const res = await sendSmsResult(phone, msg);
      smsSent = res.ok;
      if (!res.ok) smsNote = `Couldn't text them (${res.detail || res.status || "unknown error"}). Share the password manually.`;
    }
  }

  revalidatePath("/crm/contractors");
  return { ok: true, email, password, smsSent, smsNote };
}

export async function resetContractorPassword(_prev: ResetState, formData: FormData): Promise<ResetState> {
  const session = await getSession();
  if (!session || session.staff.role !== "owner") return { ok: false, error: "Owners only." };

  const id = String(formData.get("id") ?? "");
  const notify = String(formData.get("notify") ?? "") === "on";
  if (!id) return { ok: false, error: "Missing contractor." };

  // Look the contractor up by id AND role so an owner can't reset another
  // owner's password through this endpoint.
  const res = await pgAdmin(`staff?id=eq.${encodeURIComponent(id)}&role=eq.contractor&select=email,phone&limit=1`);
  if (!res.ok) return { ok: false, error: "Could not load that contractor." };
  const rows = (await res.json()) as { email: string | null; phone: string | null }[];
  const contractor = rows[0];
  if (!contractor) return { ok: false, error: "That contractor no longer exists." };

  const password = tempPassword();
  if (!(await adminUpdatePassword(id, password))) {
    return { ok: false, error: "Could not reset their password. Try again." };
  }

  await pgAdmin(`staff?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ must_reset_password: true }),
  });

  let smsSent = false;
  let smsNote: string | undefined;
  if (notify) {
    if (!contractor.phone) {
      smsNote = "No phone number on file. Share the password manually.";
    } else {
      const msg = `Your Raleigh Concrete Group CRM password was reset.\nSign in: ${SITE_ORIGIN}/crm/login\nEmail: ${contractor.email}\nTemp password: ${password}\nYou'll set a new password when you sign in.`;
      const sms = await sendSmsResult(contractor.phone, msg);
      smsSent = sms.ok;
      if (!sms.ok) smsNote = `Couldn't text them (${sms.detail || sms.status || "unknown error"}). Share the password manually.`;
    }
  }

  revalidatePath("/crm/contractors");
  return { ok: true, password, smsSent, smsNote };
}

export async function setContractorActive(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session || session.staff.role !== "owner") return;

  const id = String(formData.get("id") ?? "");
  const active = String(formData.get("active") ?? "") === "true";
  if (!id) return;

  await pgAdmin(`staff?id=eq.${id}&role=eq.contractor`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ active }),
  });
  revalidatePath("/crm/contractors");
}
