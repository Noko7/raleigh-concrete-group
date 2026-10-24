"use server";

import { revalidatePath } from "next/cache";

import { getSession } from "@/lib/crm/auth";
import { isLocale } from "@/lib/crm/i18n";
import { SITE_ORIGIN } from "@/lib/crm/env";
import { quoteServiceOptions } from "@/lib/site-data";
import { sendSmsResult, toE164 } from "@/lib/crm/notify";
import {
  createInvite,
  getStaffById,
  INVITE_TTL_DAYS,
  newInviteToken,
  revokeInvite,
  updateStaff,
} from "@/lib/crm/queries";
import {
  adminCreateUser,
  adminDeleteUser,
  adminUpdateEmail,
  adminUpdatePassword,
  pgAdmin,
} from "@/lib/crm/rest";
import { rateLimit } from "@/lib/rate-limit";
import type { AddState, ContactState, DeleteState, InviteState, ResetState } from "./types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function tempPassword(): string {
  return `Rcg-${crypto.randomUUID().slice(0, 8)}-${crypto.randomUUID().slice(0, 4)}`;
}

// Contractors aren't held to the allowlist (see isStaffAllowed); only the format is checked.

// Shared by new accounts and password resets so they can't drift. /crm bounces to login when signed out.
function loginMessage(lead: string, email: string | null, password: string): string {
  return [
    lead,
    "",
    "Sign in here:",
    `${SITE_ORIGIN}/crm`,
    "",
    "Username:",
    email ?? "",
    "",
    "Password:",
    password,
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

  const password = tempPassword();
  const created = await adminCreateUser(email, password, fullName);
  if ("error" in created) return { ok: false, error: created.error };

  // The signup trigger created the row as a contractor; flag a password change on first login.
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

  let smsSent = false;
  let smsNote: string | undefined;
  if (notify) {
    if (!phone) {
      smsNote = "Add a phone number to text their login.";
    } else {
      const msg = loginMessage("Your Raleigh Concrete Group CRM login is ready.", email, password);
      const res = await sendSmsResult(phone, msg);
      smsSent = res.ok;
      // Ignores quiet hours: staff-facing.
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

  // By id AND role, so this can't reset an owner's password.
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

// Owner-only. Their phone receives every job notification, so the owner must be able to fix it.
export async function updateContractorContact(
  _prev: ContactState,
  formData: FormData,
): Promise<ContactState> {
  const session = await getSession();
  if (!session || session.staff.role !== "owner") return { ok: false, error: "Owners only." };

  const id = String(formData.get("id") ?? "").trim();
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) return { ok: false, error: "Missing contractor." };

  // Scoped to contractors so this can't target an owner's row.
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

  // Update Supabase Auth first; if it fails the staff row must not drift from the login identity.
  const emailChanged = email !== (target.email ?? "").trim().toLowerCase();
  if (emailChanged) {
    const res = await adminUpdateEmail(id, email);
    if (!res.ok) return { ok: false, error: res.error };
  }

  // Only services we offer, so a stale checkbox can't write an unroutable type. Empty = no restriction
  // (see resolveAssignee).
  const serviceTypes = formData
    .getAll("service_types")
    .map((s) => String(s))
    .filter((s) => quoteServiceOptions.includes(s));

  const ok = await updateStaff(session, id, {
    full_name: fullName || null,
    phone,
    email,
    service_types: serviceTypes.length ? serviceTypes : null,
  });
  if (!ok) return { ok: false, error: "Could not save. Please try again." };

  revalidatePath("/crm/contractors");
  revalidatePath("/crm");
  return { ok: true, phone, emailChanged };
}

// Owner-only. Nothing is created until the contractor submits the form, so a mistyped number costs one
// expiring text.
export async function sendContractorInvite(
  _prev: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const session = await getSession();
  if (!session || session.staff.role !== "owner") return { ok: false, error: "Owners only." };

  // Each costs a text and creates a public redeemable link.
  if (await rateLimit(`invite:${session.staff.id}`, 10, 60 * 60 * 1000)) {
    return { ok: false, error: "Too many invites in the last hour. Try again shortly." };
  }

  const rawPhone = String(formData.get("phone") ?? "").trim();
  const fullName = String(formData.get("full_name") ?? "").trim().slice(0, 120);
  if (!rawPhone) return { ok: false, error: "Enter the phone number to text the invite to." };

  const phone = toE164(rawPhone);
  if (!phone) return { ok: false, error: "Enter a valid US number, e.g. (919) 555-1234." };

  const token = newInviteToken();
  if (!(await createInvite({ token, phone, fullName, createdBy: session.staff.id }))) {
    return { ok: false, error: "Could not create the invite. Please try again." };
  }

  const link = `${SITE_ORIGIN}/join/${token}`;
  const msg = [
    `${session.staff.full_name || "Raleigh Concrete Group"} invited you to join the Raleigh Concrete Group crew.`,
    "",
    "Set up your login here:",
    link,
    "",
    `This link works once and expires in ${INVITE_TTL_DAYS} days.`,
  ].join("\n");

  const sms = await sendSmsResult(phone, msg);
  revalidatePath("/crm/contractors");

  // The invite is valid even if the text failed, so return the link to share another way.
  return {
    ok: true,
    phone,
    link,
    smsSent: sms.ok,
    smsNote: sms.ok
      ? undefined
      : `Couldn't text it (${sms.detail || sms.status || "unknown error"}). Send them the link yourself.`,
  };
}

export async function revokeContractorInvite(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session || session.staff.role !== "owner") return;
  const id = String(formData.get("id") ?? "");
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) return;
  await revokeInvite(id);
  revalidatePath("/crm/contractors");
}

// Owner-only and irreversible; Deactivate is the reversible option.
export async function deleteContractor(
  _prev: DeleteState,
  formData: FormData,
): Promise<DeleteState> {
  const session = await getSession();
  if (!session || session.staff.role !== "owner") return { ok: false, error: "Owners only." };

  const id = String(formData.get("id") ?? "").trim();
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) return { ok: false, error: "Missing contractor." };
  // Deleting yourself would lock you out.
  if (id === session.staff.id) return { ok: false, error: "You can't delete your own account." };

  // Re-check the role server-side: never remove an owner.
  const target = await getStaffById(session, id);
  if (!target) return { ok: false, error: "That contractor no longer exists." };
  if (target.role !== "contractor") return { ok: false, error: "Only contractors can be deleted here." };

  // Typing the name confirms an irreversible action.
  const typed = String(formData.get("confirm") ?? "").trim().toLowerCase();
  const expected = (target.full_name || target.email || "").trim().toLowerCase();
  if (!expected || typed !== expected) {
    return { ok: false, error: `Type "${target.full_name || target.email}" exactly to confirm.` };
  }

  if (!(await adminDeleteUser(id))) {
    return { ok: false, error: "Could not delete that account. Please try again." };
  }

  revalidatePath("/crm/contractors");
  revalidatePath("/crm");
  return { ok: true, name: target.full_name || target.email || "Contractor" };
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

// Spanish mode: their CRM screens read in Spanish. Customer pages and texts stay English.
export async function setContractorLocale(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session || session.staff.role !== "owner") return;

  const id = String(formData.get("id") ?? "");
  const locale = String(formData.get("locale") ?? "");
  if (!id || !isLocale(locale)) return;

  await pgAdmin(`staff?id=eq.${id}&role=eq.contractor`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ locale }),
  });
  revalidatePath("/crm/contractors");
}
