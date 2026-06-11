"use server";

import { revalidatePath } from "next/cache";

import { getSession } from "@/lib/crm/auth";
import { clearGoogleToken } from "@/lib/crm/gcal";

export async function disconnectGoogle(): Promise<void> {
  const session = await getSession();
  if (!session || session.staff.role !== "owner") return;
  await clearGoogleToken();
  revalidatePath("/crm/calendar");
}
