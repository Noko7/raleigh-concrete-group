"use server";

import { revalidatePath } from "next/cache";

import { getSession } from "@/lib/crm/auth";
import { addEvent, getQuote, updateQuote } from "@/lib/crm/queries";
import type { Quote } from "@/lib/crm/types";

// Photos staff attach to a job, kept in three separate columns rather than
// mixed into file_urls (which is the customer's own uploads and is written by
// the public form). Which column a photo lands in is the whole point: the
// before/after pair is a record of the work, and it can't be a record if it
// is indistinguishable from the picture the customer sent in.
export type PhotoKind = "internal" | "before" | "after";

const COLUMN: Record<PhotoKind, "internal_urls" | "before_urls" | "after_urls"> = {
  internal: "internal_urls",
  before: "before_urls",
  after: "after_urls",
};

// Same cap the public form applies per column, so one job can't accumulate an
// unbounded array.
const MAX_PER_KIND = 24;

export type PhotoState = { ok: boolean; error?: string };

export async function addJobPhotos(id: string, kind: PhotoKind, paths: string[]): Promise<PhotoState> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Your session expired. Please sign in again." };
  if (!COLUMN[kind]) return { ok: false, error: "Unknown photo type." };

  // RLS decides whether this person may touch this job: an owner may touch
  // any, a contractor only one assigned to them. getQuote runs as the user,
  // so a missing row here means exactly that.
  const current = await getQuote(session, id);
  if (!current) return { ok: false, error: "You don't have access to this job." };

  // Only paths we minted. The signed upload URL already fixes the object
  // name, so this is belt-and-braces against a hand-rolled request.
  const clean = paths
    .filter((p): p is string => typeof p === "string")
    .map((p) => p.trim().slice(0, 300))
    .filter((p) => p.startsWith("quote-uploads/"));
  if (clean.length === 0) return { ok: false, error: "Nothing to save." };

  const column = COLUMN[kind];
  const existing = current[column] ?? [];
  // Read-modify-write: there's no atomic array append through PostgREST, so
  // two people uploading to the same job at the same moment could drop one
  // batch. Rare enough on a two-person crew to accept, and the fix (a join
  // table) costs more than the problem.
  const merged = [...existing, ...clean].slice(0, MAX_PER_KIND);

  const updated = await updateQuote(session, id, { [column]: merged } as Partial<Quote>);
  if (!updated) return { ok: false, error: "Could not save those photos." };

  await addEvent(session, id, "photos_added", { kind, count: clean.length });

  revalidatePath(`/crm/quotes/${id}`);
  revalidatePath("/job/[token]", "page");
  return { ok: true };
}
