"use server";

import { revalidatePath } from "next/cache";

import { getSession } from "@/lib/crm/auth";
import { addEvent, getQuote, updateQuote } from "@/lib/crm/queries";
import type { Quote } from "@/lib/crm/types";

// Staff photos live in their own columns, separate from file_urls (the customer's uploads, written by the
// public form): the before/after pair must be distinguishable from what the customer sent.
export type PhotoKind = "internal" | "before" | "after";

const COLUMN: Record<PhotoKind, "internal_urls" | "before_urls" | "after_urls"> = {
  internal: "internal_urls",
  before: "before_urls",
  after: "after_urls",
};

// Same per-column cap as the public form.
const MAX_PER_KIND = 24;

export type PhotoState = { ok: boolean; error?: string };

export async function addJobPhotos(id: string, kind: PhotoKind, paths: string[]): Promise<PhotoState> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Your session expired. Please sign in again." };
  if (!COLUMN[kind]) return { ok: false, error: "Unknown photo type." };

  // getQuote runs as the user, so RLS decides: a missing row means no access.
  const current = await getQuote(session, id);
  if (!current) return { ok: false, error: "You don't have access to this job." };

  // Only paths we minted. The signed upload URL already fixes the name; this guards hand-rolled requests.
  const clean = paths
    .filter((p): p is string => typeof p === "string")
    .map((p) => p.trim().slice(0, 300))
    .filter((p) => p.startsWith("quote-uploads/"));
  if (clean.length === 0) return { ok: false, error: "Nothing to save." };

  const column = COLUMN[kind];
  const existing = current[column] ?? [];
  // Read-modify-write: PostgREST has no atomic array append, so simultaneous uploads could drop a batch.
  // Accepted on a two-person crew.
  const merged = [...existing, ...clean].slice(0, MAX_PER_KIND);

  const updated = await updateQuote(session, id, { [column]: merged } as Partial<Quote>);
  if (!updated) return { ok: false, error: "Could not save those photos." };

  await addEvent(session, id, "photos_added", { kind, count: clean.length });

  revalidatePath(`/crm/quotes/${id}`);
  revalidatePath("/job/[token]", "page");
  return { ok: true };
}
