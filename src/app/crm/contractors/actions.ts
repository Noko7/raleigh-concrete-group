"use server";

import { revalidatePath } from "next/cache";

import { getSession } from "@/lib/crm/auth";
import { adminCreateUser, pgAdmin } from "@/lib/crm/rest";
import type { AddState } from "./types";

function tempPassword(): string {
  return `Rcg-${crypto.randomUUID().slice(0, 8)}-${crypto.randomUUID().slice(0, 4)}`;
}

export async function createContractor(_prev: AddState, formData: FormData): Promise<AddState> {
  const session = await getSession();
  if (!session || session.staff.role !== "owner") return { ok: false, error: "Owners only." };

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const fullName = String(formData.get("full_name") ?? "").trim().slice(0, 120);
  const phone = String(formData.get("phone") ?? "").trim().slice(0, 32);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "Enter a valid email." };
  if (fullName.length < 2) return { ok: false, error: "Enter the contractor's name." };

  const password = tempPassword();
  const created = await adminCreateUser(email, password, fullName);
  if ("error" in created) return { ok: false, error: created.error };

  // The on-signup trigger created the staff row as a contractor; fill in details.
  await pgAdmin(`staff?id=eq.${created.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ full_name: fullName, phone: phone || null, role: "contractor", active: true }),
  });

  revalidatePath("/crm/contractors");
  return { ok: true, email, password };
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
