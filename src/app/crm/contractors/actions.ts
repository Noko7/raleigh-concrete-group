"use server";

import { revalidatePath } from "next/cache";

import { isEmailAllowed } from "@/lib/crm/access";
import { getSession } from "@/lib/crm/auth";
import { SITE_ORIGIN } from "@/lib/crm/env";
import { sendSmsResult, toE164 } from "@/lib/crm/notify";
import { getStaffById, updateStaff } from "@/lib/crm/queries";
import { adminCreateUser, adminUpdateEmail, adminUpdatePassword, pgAdmin } from "@/lib/crm/rest";
import type { AddState, ContactState, ResetState } from "./types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function tempPassword(): string {
  return `Rcg-${crypto.randomUUID().slice(0, 8)}-${crypto.randomUUID().slice(0, 4)}`;
}

// The login route, getSession and the middleware all reject an address outside
// the CRM allowlist. Without this check an owner can create an account, text out
// the credentials, and the contractor just gets "no CRM access" - so refuse up
// front and say what to change instead.
function accessDenialReason(email: string): string | null {
  if (isEmailAllowed(email)) return null;
  return `${email} isn't allowed to sign in to the CRM. Add it to CRM_ALLOWED_EMAILS (or its domain to CRM_ALLOWED_DOMAINS) in Vercel first, otherwise they'll be blocked at login.`;
}

// The credentials text, built in one place so a new account and a password
// reset can't drift apart. /crm bounces to the login screen when they're signed
// out, so it's the shorter thing to put in a text.
function loginMessage(lead: string, email: string | null, password: string): string {
  return [
    lead,
    "",
    `${SITE_ORIGIN}/crm`,
    `username: ${email ?? ""}`,
    `password: ${password}`,
    "",
    "You'll set your own password the first time you sign in.",
  ].join("\n");
}

export async function createContractor(_prev: AddState, formData: FormData): Promise<AddState> {
  const session = await getSession();
  if (!session || session.staff.role !== "owner") return { ok: false, error: "Owners only." };

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const fullName = String(formData.get("full_name") ?? "").trim().slice(0, 120);
  const phone = String(formData.get("phone") ?? "").trim().slice(0, 32);
  const notify = String(formData.get("notify") ?? "") === "on";
  if (!EMAIL_RE.test(email)) return { ok: false, error: "Enter a valid email." };
  if (fullName.length < 2) return { ok: false, error: "Enter the contractor's name." };
  const denied = accessDenialReason(email);
  if (denied) return { ok: false, error: denied };

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
      const msg = loginMessage("Your Raleigh Concrete Group CRM login is ready.", email, password);
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
      const msg = loginMessage("Your Raleigh Concrete Group CRM password was reset.", contractor.email, password);
      const sms = await sendSmsResult(contractor.phone, msg);
      smsSent = sms.ok;
      if (!sms.ok) smsNote = `Couldn't text them (${sms.detail || sms.status || "unknown error"}). Share the password manually.`;
    }
  }

  revalidatePath("/crm/contractors");
  return { ok: true, password, smsSent, smsNote };
}

// Owner-only: fix a contractor's name or alert number. Their phone is what every
// job notification is sent to, so this needs to be editable without asking them
// to log in and update it themselves.
export async function updateContractorContact(
  _prev: ContactState,
  formData: FormData,
): Promise<ContactState> {
  const session = await getSession();
  if (!session || session.staff.role !== "owner") return { ok: false, error: "Owners only." };

  const id = String(formData.get("id") ?? "").trim();
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) return { ok: false, error: "Missing contractor." };

  // Scope to contractors so this can't be pointed at another owner's row.
  const target = await getStaffById(session, id);
  if (!target || target.role !== "contractor") return { ok: false, error: "That contractor no longer exists." };

  const fullName = String(formData.get("full_name") ?? "").trim().slice(0, 120);
  const rawPhone = String(formData.get("phone") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase().slice(0, 254);

  let phone: string | null = null;
  if (rawPhone !== "") {
    phone = toE164(rawPhone);
    if (!phone) return { ok: false, error: "Enter a valid US number, e.g. (919) 555-1234." };
  }

  if (!EMAIL_RE.test(email)) return { ok: false, error: "Enter a valid email." };
  const denied = accessDenialReason(email);
  if (denied) return { ok: false, error: denied };

  // Changing the login address means updating Supabase Auth first: if that
  // fails, the staff row must not drift away from the identity they sign in
  // with. Only touch auth when it actually changed.
  const emailChanged = email !== (target.email ?? "").trim().toLowerCase();
  if (emailChanged) {
    const res = await adminUpdateEmail(id, email);
    if (!res.ok) return { ok: false, error: res.error };
  }

  const ok = await updateStaff(session, id, { full_name: fullName || null, phone, email });
  if (!ok) return { ok: false, error: "Could not save. Please try again." };

  revalidatePath("/crm/contractors");
  revalidatePath("/crm");
  return { ok: true, phone, emailChanged };
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
