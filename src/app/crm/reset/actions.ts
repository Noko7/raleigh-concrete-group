"use server";

import { revalidatePath } from "next/cache";

import { getSession } from "@/lib/crm/auth";
import { adminUpdatePassword, pgAdmin } from "@/lib/crm/rest";
import type { ResetState } from "./types";

export async function setNewPassword(_prev: ResetState, formData: FormData): Promise<ResetState> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Your session expired. Please sign in again." };

  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (password.length < 8) return { ok: false, error: "Use at least 8 characters." };
  if (password.length > 72) return { ok: false, error: "That password is too long." };
  if (password !== confirm) return { ok: false, error: "The two passwords don't match." };

  const ok = await adminUpdatePassword(session.user.id, password);
  if (!ok) return { ok: false, error: "Could not update your password. Try again." };

  await pgAdmin(`staff?id=eq.${session.user.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ must_reset_password: false }),
  });

  revalidatePath("/crm");
  return { ok: true };
}
