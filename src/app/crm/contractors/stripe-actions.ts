"use server";

import { revalidatePath } from "next/cache";

import { getSession } from "@/lib/crm/auth";
import { getStaffById } from "@/lib/crm/queries";
import { payeeFor, saveStripeAccount } from "@/lib/crm/payments";
import { ACCOUNT_RE, getAccount } from "@/lib/crm/stripe";

export type StripeLinkState = { ok: boolean; error?: string; message?: string };

/**
 * The account is created in Stripe and onboarded on Stripe's hosted form; the office pastes the acct_ id.
 * No OAuth flow: a handful of contractors, onboarded once.
 * Never trusted: fetched from Stripe and stored as Stripe reports it, so a typo fails now with Stripe's words.
 */
export async function linkStripeAccount(
  _prev: StripeLinkState,
  formData: FormData,
): Promise<StripeLinkState> {
  const session = await getSession();
  if (!session || session.staff.role !== "owner") return { ok: false, error: "Owners only." };

  const staffId = String(formData.get("staff_id") ?? "").trim();
  const raw = String(formData.get("stripe_account_id") ?? "").trim();
  if (!staffId) return { ok: false, error: "Missing contractor." };

  const target = await getStaffById(session, staffId);
  if (!target) return { ok: false, error: "That contractor no longer exists." };

  // Clearing unlinks. Past payments keep the account id on their own rows.
  if (raw === "") {
    const ok = await saveStripeAccount(staffId, {
      stripe_account_id: null,
      stripe_charges_enabled: false,
      stripe_payouts_enabled: false,
      stripe_details_submitted: false,
    });
    if (!ok) return { ok: false, error: "Could not unlink that account." };
    revalidatePath("/crm/contractors");
    return { ok: true, message: `${target.full_name || "They"} can no longer be paid by card.` };
  }

  if (!ACCOUNT_RE.test(raw)) {
    return { ok: false, error: "A Stripe account ID looks like acct_1A2b3C4d5E6f7G8h." };
  }

  const found = await getAccount(raw);
  if (!found.ok) {
    return {
      ok: false,
      // Stripe's message ("No such account") is what an owner pasting IDs can act on.
      error: found.status === 404 ? "Stripe has no account with that ID." : found.error,
    };
  }

  const account = found.data;
  const ok = await saveStripeAccount(staffId, {
    stripe_account_id: account.id,
    stripe_charges_enabled: account.charges_enabled,
    stripe_payouts_enabled: account.payouts_enabled,
    stripe_details_submitted: account.details_submitted,
  });
  if (!ok) return { ok: false, error: "Could not save. Please try again." };

  revalidatePath("/crm/contractors");
  revalidatePath("/crm/money");

  // A linked account that can't take charges looks like a working one everywhere, so say so now.
  if (!account.charges_enabled) {
    const due = account.requirements?.currently_due?.length ?? 0;
    return {
      ok: true,
      message: account.details_submitted
        ? "Linked. Stripe is still reviewing them, so they can't take card payments yet."
        : `Linked, but they haven't finished Stripe's onboarding${due > 0 ? ` (${due} item${due === 1 ? "" : "s"} outstanding)` : ""}. Send them their onboarding link again.`,
    };
  }
  return { ok: true, message: `Linked. ${target.full_name || "They"} can take card payments.` };
}

/** The account.updated webhook keeps flags current; this is for an answer right now. */
export async function refreshStripeAccount(
  _prev: StripeLinkState,
  formData: FormData,
): Promise<StripeLinkState> {
  const session = await getSession();
  if (!session || session.staff.role !== "owner") return { ok: false, error: "Owners only." };

  const staffId = String(formData.get("staff_id") ?? "").trim();
  const target = await payeeFor(staffId);
  if (!target?.stripe_account_id) return { ok: false, error: "No Stripe account linked yet." };

  const found = await getAccount(target.stripe_account_id);
  if (!found.ok) return { ok: false, error: found.error };

  await saveStripeAccount(staffId, {
    stripe_charges_enabled: found.data.charges_enabled,
    stripe_payouts_enabled: found.data.payouts_enabled,
    stripe_details_submitted: found.data.details_submitted,
  });

  revalidatePath("/crm/contractors");
  const due = found.data.requirements?.currently_due ?? [];
  return {
    ok: true,
    message: found.data.charges_enabled
      ? "Ready to take card payments."
      : due.length > 0
        ? `Stripe still needs ${due.length} thing${due.length === 1 ? "" : "s"} from them.`
        : "Stripe is still reviewing them.",
  };
}
