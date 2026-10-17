// Server-only CRM data access: public token pages and customer responses. Re-exported from ../queries.ts.
import { offlineAcceptanceRefusal, repeatAnswer, unansweredFilter } from "../answered";
import { ymdInDays } from "../clock";
import {
  DECLINE_CREDIT,
  LEAD_TIME_DAYS,
  MAX_PREFERRED_DATES,
  TIME_RE,
  isChoice,
  optionAmount,
  optionsTotal,
} from "../constants";
import { pgUser, pgAdmin } from "../rest";
import type { Quote, QuoteOption, QuotePackage, Session } from "../types";
import { ISO_DATE } from "./shared";
import { getQuote } from "./quotes";
import { listQuoteOptions, listQuoteOptionsAdmin, listQuotePackages, listQuotePackagesAdmin } from "./line-items";

// ── Public token pages (service-role; no user session) ──────────────────────
export async function getQuoteByToken(column: "public_token" | "job_token", token: string): Promise<Quote | null> {
  if (!/^[a-f0-9]{16,40}$/i.test(token)) return null;
  const res = await pgAdmin(`quote_requests?${column}=eq.${token}&select=*&limit=1`);
  if (!res.ok) return null;
  const rows = (await res.json()) as Quote[];
  return rows[0] ?? null;
}

// Has this quote's offer run out? Only while the customer still has to decide:
// once answered, the page is their record of the job and never expires. A null
// quote_expires_at never expires.
export function isQuoteExpired(q: Pick<Quote, "quote_expires_at" | "customer_response">): boolean {
  if (q.customer_response) return false;
  if (!q.quote_expires_at) return false;
  return new Date(q.quote_expires_at).getTime() < Date.now();
}

export async function recordCustomerView(token: string): Promise<void> {
  if (!/^[a-f0-9]{16,40}$/i.test(token)) return;
  const res = await pgAdmin(`quote_requests?public_token=eq.${token}&select=id,view_count,viewed_at,status&limit=1`);
  if (!res.ok) return;
  const rows = (await res.json()) as Pick<Quote, "id" | "view_count" | "viewed_at" | "status">[];
  const q = rows[0];
  if (!q) return;

  const patch: Partial<Quote> = { view_count: (q.view_count ?? 0) + 1 };
  if (!q.viewed_at) patch.viewed_at = new Date().toISOString();

  await pgAdmin(`quote_requests?id=eq.${q.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(patch),
  });
  await pgAdmin("quote_events", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ quote_id: q.id, type: "customer_viewed", meta: { at: new Date().toISOString() } }),
  });
}

// Customer accepts (with preferred dates, optionally the $150 credit) or
// declines from the quote page. Service role; token-gated.
export type OptionChoice = "accepted" | "declined";

export type CustomerResponseResult = {
  ok: boolean;
  error?: string;
  // The answer was already on file and nothing was written; the caller skips
  // the texts so nobody hears about the same job twice.
  duplicate?: boolean;
  // What they said yes and no to, in page order, for the owner and crew texts.
  accepted?: QuoteOption[];
  declined?: QuoteOption[];
  // The package they picked, if a choice was offered; else null. The crew needs
  // it: "approved" doesn't say what to load the truck with.
  package?: QuotePackage | null;
};

/**
 * A quote the customer declined and the office has since reopened by moving
 * the job off Lost. Read as unanswered everywhere the customer is: their page
 * shows the quote again and their Approve goes through. The next save or send
 * from the CRM clears the old answer for good (saveQuote).
 */
export function isOpenAgain(q: Pick<Quote, "customer_response" | "status">): boolean {
  return q.customer_response === "declined" && q.status !== "lost";
}

/**
 * Forget the customer's per-item answers on a quote that is being reopened.
 * A decline stamps every line item and option "declined"; left in place, the
 * reopened quote would carry answers to an offer that has been put back on
 * the table. The caller has already checked the reader may edit this quote.
 */
export async function clearQuoteResponses(quoteId: string): Promise<void> {
  const body = JSON.stringify({ customer_response: null, responded_at: null });
  const q = `quote_id=eq.${encodeURIComponent(quoteId)}`;
  await Promise.all([
    pgAdmin(`quote_options?${q}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body }),
    pgAdmin(`quote_packages?${q}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body }),
  ]);
}

export async function recordCustomerResponse(
  token: string,
  input: {
    action: "accept" | "decline";
    discount?: boolean;
    preferredDates?: string[];
    // Start time per preferred date, index-aligned. Invalid entries become null
    // and the crew card uses its default.
    preferredTimes?: (string | null)[];
    // Per optional line item, keyed by option id. Required if the quote has items.
    options?: Record<string, OptionChoice>;
    // Package id. Required if a choice is offered; no default, since picking one
    // would pick their price.
    packageId?: string;
  },
): Promise<CustomerResponseResult> {
  if (!/^[a-f0-9]{16,40}$/i.test(token)) return { ok: false, error: "Invalid link." };
  const res = await pgAdmin(
    `quote_requests?public_token=eq.${token}` +
      `&select=id,quote_amount,customer_response,discount_accepted,quote_expires_at,status&limit=1`,
  );
  if (!res.ok) return { ok: false, error: "Could not load your quote." };
  const rows = (await res.json()) as Pick<
    Quote,
    "id" | "quote_amount" | "customer_response" | "discount_accepted" | "quote_expires_at" | "status"
  >[];
  const q = rows[0];
  if (!q) return { ok: false, error: "Quote not found." };

  // Also checked here: a tab opened before expiry can still POST.
  if (isQuoteExpired(q)) {
    return { ok: false, error: "This quote has expired. Please call us and we'll send you an updated one." };
  }

  // ── Already answered ──
  // Double tap, retry or two tabs. The same answer is reported as success with
  // nothing written; re-running would recompute an itemised total and undo the
  // $150 credit. A different answer is refused, so a stale tab can't flip a
  // booked job. A decline on a job moved off Lost is no longer an answer (isOpenAgain).
  const openAgain = isOpenAgain(q);
  const already = openAgain ? null : q.customer_response;
  if (already) return repeatAnswer(already, input.action);

  const [options, packages] = await Promise.all([
    listQuoteOptionsAdmin(q.id),
    listQuotePackagesAdmin(q.id),
  ]);
  const patch: Partial<Quote> = { customer_responded_at: new Date().toISOString() };
  let accepted: QuoteOption[] = [];
  let declined: QuoteOption[] = [];
  // Null unless the quote offered a choice.
  let chosenPackage: QuotePackage | null = null;
  let eventType: string;

  if (input.action === "decline") {
    patch.customer_response = "declined";
    patch.status = "lost";
    declined = options;
    eventType = "customer_declined";
  } else {
    // Approving doesn't book a day: the customer proposes dates and the job
    // stays "approved" until the crew confirms one. Both sides are Raleigh
    // calendar dates, so this is a plain string comparison.
    const min = ymdInDays(LEAD_TIME_DAYS);
    const seen = new Set<string>();
    const dates: string[] = [];
    // Index-aligned with `dates`, so a rejected day doesn't shift later times.
    const times: (string | null)[] = [];
    const rawTimes = input.preferredTimes ?? [];
    for (const [i, raw] of (input.preferredDates ?? []).entries()) {
      const date = String(raw).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || seen.has(date)) continue;
      if (date < min) continue;
      seen.add(date);
      dates.push(date);
      // Shape-checked so a tampered form can't put arbitrary text in the crew's message.
      const t = typeof rawTimes[i] === "string" ? (rawTimes[i] as string).trim().toUpperCase().replace(/\s+/, " ") : "";
      times.push(t && TIME_RE.test(t) ? t : null);
      if (dates.length >= MAX_PREFERRED_DATES) break;
    }
    if (dates.length === 0) {
      return { ok: false, error: `Please pick at least one date ${LEAD_TIME_DAYS} days from now or later.` };
    }

    // Exactly one, and from this quote: another quote's package id would set this price.
    if (isChoice(packages)) {
      chosenPackage = packages.find((p) => p.id === input.packageId) ?? null;
      if (!chosenPackage) {
        return { ok: false, error: "Please choose one of the options before approving." };
      }
    }

    // Every optional item needs an answer: a blank isn't a no, and billing from
    // silence starts disputes.
    if (options.length > 0) {
      const answers = input.options ?? {};
      const unanswered = options.filter((o) => !o.required && !answers[o.id]);
      if (unanswered.length > 0) {
        return { ok: false, error: "Please answer yes or no to each option before approving." };
      }
      accepted = options.filter((o) => o.required || answers[o.id] === "accepted");
      declined = options.filter((o) => !o.required && answers[o.id] === "declined");
      // Only refused when nothing else is bought; with a package, no add-ons is normal.
      if (accepted.length === 0 && !chosenPackage) {
        return {
          ok: false,
          error: "You've said no to everything. Use Decline below if you don't want any of it.",
        };
      }
    }

    // The price follows the answers: chosen package plus accepted items.
    // Downstream readers keep using quote_amount.
    if (options.length > 0 || chosenPackage) {
      patch.quote_amount =
        Math.round((optionAmount(chosenPackage ?? { amount: 0 }) + optionsTotal(accepted)) * 100) / 100;
    }

    patch.customer_response = "accepted";
    patch.status = "approved";
    patch.preferred_dates = dates;
    // Written even if all null, so it always aligns with preferred_dates.
    patch.preferred_times = times;
    if (input.discount && !q.discount_accepted) {
      patch.discount_accepted = true;
      // Off what they actually bought, not the all-in figure.
      const base = patch.quote_amount ?? q.quote_amount;
      if (base != null) {
        patch.quote_amount = Math.max(0, Math.round((Number(base) - DECLINE_CREDIT) * 100) / 100);
      }
    }
    eventType = "customer_accepted";
  }

  // Conditional on the row still being unanswered. Of two racing submissions the
  // second matches nothing and is answered from what the first wrote.
  const savePatch = (body: Partial<Quote>) =>
    pgAdmin(`quote_requests?id=eq.${q.id}${unansweredFilter(openAgain)}&select=id`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(body),
    });

  const upd = await savePatch(patch);
  if (!upd.ok) return { ok: false, error: "Could not save your response. Please call us." };
  const written = (await upd.json().catch(() => [])) as unknown[];
  if (written.length === 0) {
    const again = await pgAdmin(`quote_requests?id=eq.${q.id}&select=customer_response,status&limit=1`);
    const now = again.ok
      ? ((await again.json()) as Pick<Quote, "customer_response" | "status">[])[0]
      : undefined;
    const answered = now && !isOpenAgain(now) ? now.customer_response : null;
    if (answered) return repeatAnswer(answered, input.action);
    return { ok: false, error: "Could not save your response. Please call us." };
  }

  // Stamp each line item's answer so the record survives later edits. After the
  // quote row on purpose: the decision is saved even if this fails.
  const stamp = new Date().toISOString();
  for (const [response, rows] of [
    ["accepted", accepted],
    ["declined", declined],
  ] as const) {
    if (rows.length === 0) continue;
    await pgAdmin(`quote_options?id=in.(${rows.map((o) => o.id).join(",")})`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ customer_response: response, responded_at: stamp }),
    }).catch(() => {});
  }

  // Likewise for packages: chosen accepted, others declined, so it stays visible
  // that a choice was offered.
  if (isChoice(packages)) {
    for (const [response, rows] of [
      ["accepted", chosenPackage ? [chosenPackage] : []],
      ["declined", packages.filter((p) => p.id !== chosenPackage?.id)],
    ] as const) {
      if (rows.length === 0) continue;
      await pgAdmin(`quote_packages?id=in.(${rows.map((p) => p.id).join(",")})`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ customer_response: response, responded_at: stamp }),
      }).catch(() => {});
    }
  }

  await pgAdmin("quote_events", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      quote_id: q.id,
      type: eventType,
      meta: {
        discount: Boolean(input.discount),
        preferred_dates: patch.preferred_dates ?? null,
        preferred_times: patch.preferred_times ?? null,
        chosen_package: chosenPackage?.title ?? null,
        accepted_options: accepted.map((o) => o.title),
        declined_options: declined.map((o) => o.title),
        total: patch.quote_amount ?? null,
      },
    }),
  });
  return { ok: true, accepted, declined, package: chosenPackage };
}

// ── The customer said yes on the phone ──────────────────────────────────────
// Separate from recordCustomerResponse on purpose: that one is the customer's
// own tap (token, service role, expiry check). This is staff recording a call,
// so it runs as them (pgUser) and RLS keeps contractors to their own jobs.
// It writes the same customer_response/status everything else reads; only the
// event differs, recording who entered it and that it came by phone.
export async function recordOfflineAcceptance(
  session: Session,
  id: string,
  input: {
    // Per optional line item, keyed by option id. Same rule as the customer
    // path: silence is not consent to bill.
    options?: Record<string, OptionChoice>;
    // Package id, required if a choice is offered. No default.
    packageId?: string;
    // Day/time agreed on the call, recorded as their preference; booking is
    // confirmSchedule's job.
    agreedDate?: string | null;
    agreedTime?: string | null;
  },
): Promise<{
  ok: boolean;
  error?: string;
  accepted?: QuoteOption[];
  declined?: QuoteOption[];
  package?: QuotePackage | null;
}> {
  const q = await getQuote(session, id);
  if (!q) return { ok: false, error: "You don't have access to this quote." };

  // Already answered or closed out (offlineAcceptanceRefusal).
  const refusal = offlineAcceptanceRefusal(q);
  if (refusal) return { ok: false, error: refusal };
  if (q.quote_amount == null || Number(q.quote_amount) <= 0) {
    return { ok: false, error: "Put a price on this quote before recording an approval." };
  }
  // Expiry deliberately not checked: they just agreed to a price staff can see.

  const [options, packages] = await Promise.all([
    listQuoteOptions(session, id),
    listQuotePackages(session, id),
  ]);
  const patch: Partial<Quote> = {
    customer_response: "accepted",
    customer_responded_at: new Date().toISOString(),
    status: "approved",
  };
  let accepted: QuoteOption[] = [];
  let declined: QuoteOption[] = [];
  let chosenPackage: QuotePackage | null = null;

  if (isChoice(packages)) {
    chosenPackage = packages.find((p) => p.id === input.packageId) ?? null;
    if (!chosenPackage) {
      return { ok: false, error: "Say which option they went with before recording the approval." };
    }
  }

  if (options.length > 0) {
    const answers = input.options ?? {};
    const unanswered = options.filter((o) => !o.required && !answers[o.id]);
    if (unanswered.length > 0) {
      return { ok: false, error: "Mark each optional line yes or no before recording the approval." };
    }
    accepted = options.filter((o) => o.required || answers[o.id] === "accepted");
    declined = options.filter((o) => !o.required && answers[o.id] === "declined");
    // With a package chosen, no to every add-on is ordinary.
    if (accepted.length === 0 && !chosenPackage) {
      return { ok: false, error: "They said no to every line. That's a declined quote, not an approved one." };
    }
  }

  // Price follows the answers, as on the customer path.
  if (options.length > 0 || chosenPackage) {
    patch.quote_amount =
      Math.round((optionAmount(chosenPackage ?? { amount: 0 }) + optionsTotal(accepted)) * 100) / 100;
  }

  // The lead-time floor deliberately doesn't apply: it stops customers
  // committing a crew unchecked, and the person entering this is the crew.
  if (input.agreedDate && ISO_DATE.test(input.agreedDate)) {
    patch.preferred_dates = [input.agreedDate];
    const time = (input.agreedTime ?? "").trim().toUpperCase().replace(/\s+/, " ");
    patch.preferred_times = [time && TIME_RE.test(time) ? time : null];
  }

  // Conditional on no answer on file, so two people (or the customer's own tap)
  // can't both write. Zero rows: someone got there first, or RLS hid it.
  const save = async (body: Partial<Quote>): Promise<{ rows: number } | { error: string }> => {
    const res = await pgUser(
      `quote_requests?id=eq.${encodeURIComponent(id)}&customer_response=is.null&select=id`,
      session.accessToken,
      { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(body) },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[offline-acceptance] failed", { id, status: res.status, body: text });
      return { error: `Could not save (error ${res.status}). Please try again or call the office.` };
    }
    return { rows: ((await res.json().catch(() => [])) as unknown[]).length };
  };

  const saved = await save(patch);
  if ("error" in saved) return { ok: false, error: saved.error };
  if (saved.rows === 0) {
    const now = await getQuote(session, id);
    return {
      ok: false,
      error:
        (now && offlineAcceptanceRefusal(now)) ??
        "You can't change this job. It may have been reassigned to someone else.",
    };
  }

  // Stamp line items after the quote row, best-effort, as on the customer path.
  const stamp = new Date().toISOString();
  for (const [response, rows] of [
    ["accepted", accepted],
    ["declined", declined],
  ] as const) {
    if (rows.length === 0) continue;
    await pgUser(`quote_options?id=in.(${rows.map((o) => o.id).join(",")})`, session.accessToken, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ customer_response: response, responded_at: stamp }),
    }).catch(() => {});
  }
  if (isChoice(packages)) {
    for (const [response, rows] of [
      ["accepted", chosenPackage ? [chosenPackage] : []],
      ["declined", packages.filter((p) => p.id !== chosenPackage?.id)],
    ] as const) {
      if (rows.length === 0) continue;
      await pgUser(`quote_packages?id=in.(${rows.map((p) => p.id).join(",")})`, session.accessToken, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ customer_response: response, responded_at: stamp }),
      }).catch(() => {});
    }
  }

  return { ok: true, accepted, declined, package: chosenPackage };
}
