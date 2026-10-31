import type { Status } from "./env";

export type Role = "owner" | "contractor";

export type Staff = {
  // Practice account: its fee settlements don't count; excluded from the Money page's contractor table.
  is_test?: boolean;
  id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  // Who a payment receipt names as paid (filled in by the owner). Blank = their name.
  business_name?: string | null;
  business_address?: string | null;
  // Printed on customer agreements: the license line and "How you pay".
  license_number?: string | null;
  payment_methods?: string[] | null;
  role: Role;
  active: boolean;
  must_reset_password: boolean;
  // Null or empty = no restriction.
  service_types: string[] | null;
  locale: string;
  // Both are slot START hours, so 8..16 is 8:00 AM to 4:00 PM. work_days is 0=Sunday..6=Saturday.
  // Nullable on old rows: always read through readWorkHours().
  work_start_hour: number | null;
  work_end_hour: number | null;
  work_days: number[] | null;
  // Flags cached from Stripe (kept current by the account.updated webhook) so payment buttons don't wait
  // on a round-trip.
  stripe_account_id: string | null;
  stripe_charges_enabled: boolean;
  stripe_payouts_enabled: boolean;
  stripe_details_submitted: boolean;
  stripe_checked_at: string | null;
  created_at: string;
};

// A card row moved through Stripe; every other method was received and recorded by the crew.
export type QuotePayment = {
  id: string;
  quote_id: string;
  method: string;
  amount_cents: number;
  // Office cut taken out of this payment. Non-zero only on card rows (Stripe application fee).
  fee_cents: number;
  // 'voided' = a row that should never have existed (typo, duplicate, wrong job); counted nowhere, since
  // totals filter on 'paid'/'refunded'. Not 'refunded', which means money really went back.
  status: "pending" | "paid" | "failed" | "refunded" | "voided";
  // Per payment because a job can be reassigned after money moves.
  stripe_account_id: string | null;
  checkout_session_id: string | null;
  payment_intent_id: string | null;
  refunded_cents: number;
  // Null = the customer paid and the webhook wrote the row.
  recorded_by: string | null;
  note: string | null;
  created_at: string;
  paid_at: string | null;
  refunded_at: string | null;
};

// A contractor paying what they owe the office on cash jobs. Owner-recorded only.
export type FeeSettlement = {
  id: string;
  staff_id: string;
  quote_id: string | null;
  amount_cents: number;
  method: string;
  note: string | null;
  recorded_by: string | null;
  created_at: string;
};

export type Quote = {
  id: string;
  created_at: string;
  updated_at: string;
  name: string;
  phone: string;
  email: string | null;
  service: string | null;
  address: string | null;
  city: string | null;
  details: string | null;
  quote_type: string | null;
  preferred_time: string | null;
  file_urls: string[] | null;
  source_path: string | null;
  status: Status;
  assigned_to: string | null;
  quote_amount: number | null;
  // Legacy free-text body, kept so older quotes still read.
  quote_summary: string | null;
  // "Not applicable" is valid, but none may be blank on a sent quote.
  quote_scope: string | null;
  quote_permits: string | null;
  quote_prep: string | null;
  quote_pour: string | null;
  quote_cleanup: string | null;
  // "1-2 days", or "Not applicable". Null on quotes written before it existed.
  estimated_duration: string | null;
  // QUOTE_TTL_DAYS from the last send. Null on quotes predating expiry, which stay valid.
  quote_expires_at: string | null;
  // Staff photos (internal shots, required before/after pair). Customer uploads stay in file_urls.
  internal_urls: string[] | null;
  before_urls: string[] | null;
  after_urls: string[] | null;
  internal_notes: string | null;
  public_token: string;
  job_token: string;
  viewed_at: string | null;
  view_count: number;
  quote_sent_at: string | null;
  customer_response: "accepted" | "declined" | null;
  customer_responded_at: string | null;
  // How the customer plans to pay the contractor (picked at approval). Not money: the ledger is. Null if not asked.
  customer_pay_methods?: string[] | null;
  scheduled_date: string | null;
  // Display copy like "9:00 AM".
  scheduled_time: string | null;
  // The crew confirms one of these.
  preferred_dates: string[] | null;
  // Index-aligned with preferred_dates. Null entries (older accepts) fall back to the card's default.
  preferred_times: (string | null)[] | null;
  // Frozen the first time money moves and never recalculated: crossing the 3-job threshold mid-job must not
  // reprice agreed work.
  fee_rate: number | null;
  fee_total_cents: number | null;
  /** Cents. 0 = none. */
  fee_waived_cents?: number | null;
  fee_waived_note?: string | null;
  scheduled_by: string | null;
  scheduled_at: string | null;
  discount_accepted: boolean;
  visit_date: string | null;
  visit_time: string | null;
  gcal_event_id: string | null;
  reminder_sent_at: string | null;
  // Crew countdown texts sent for this booking ("3", "1", "0"). Cleared when the date moves.
  crew_reminders: string[] | null;
  confirmed_at: string | null;
  completed_at: string | null;
  paid_at: string | null;
  payment_requested_at: string | null;
  archived_at: string | null;
  // Practice lead: excluded from Money figures unless asked.
  is_test?: boolean;
  // Stale-lead nudge: nobody has quoted or booked a visit.
  stale_lead_reminded_at: string | null;
  // Night-before reminder for an in-person quote VISIT (not the work day).
  visit_reminder_sent_at: string | null;
  visit_crew_reminded_at: string | null;
  // Follow-up nudge: a sent quote nobody has answered.
  quote_followup_sent_at: string | null;
  // A pending change order. The four columns are written and cleared together; change_requested_at set
  // means a change is waiting.
  // change_amount is the proposed NEW TOTAL, never the difference; screens derive the delta. Deposits need
  // nothing: the balance is total minus collected.
  change_note: string | null;
  change_amount: number | null;
  change_requested_at: string | null;
  change_requested_by: string | null;
  // Null leaves line items unchanged; a list (even empty) replaces them on approval and sums to change_amount.
  change_lines: ChangeLine[] | null;
  // Cents, paid up front on approval. Null when none asked.
  change_deposit_cents: number | null;
  // Cents the customer should have paid IN TOTAL before work goes ahead. "Due now" is this minus paid, so it
  // clears itself (see depositDueNowCents).
  deposit_target_cents: number | null;
};

export type ChangeLine = { title: string; description: string | null; amount: number };

// A quote has none (single price) or a list the customer answers line by line.
export type QuoteOption = {
  id: string;
  quote_id: string;
  title: string;
  description: string | null;
  // numeric(10,2) arrives from PostgREST as a string; read via optionAmount().
  amount: number | string;
  // Part of the base job, not an optional extra.
  required: boolean;
  sort_order: number;
  customer_response: "accepted" | "declined" | null;
  responded_at: string | null;
  created_at: string;
  updated_at: string;
};

// The customer picks exactly one; line items are added on top.
export type QuotePackage = {
  id: string;
  quote_id: string;
  title: string;
  description: string | null;
  // numeric(10,2) arrives from PostgREST as a string; read via optionAmount().
  amount: number | string;
  // At most one per quote.
  recommended: boolean;
  sort_order: number;
  // 'declined' on every other package, so the record is of the choice.
  customer_response: "accepted" | "declined" | null;
  responded_at: string | null;
  created_at: string;
  updated_at: string;
};

export type QuoteEvent = {
  id: string;
  quote_id: string;
  type: string;
  meta: Record<string, unknown> | null;
  actor: string | null;
  created_at: string;
};

export type ContractorInvite = {
  id: string;
  token: string;
  phone: string;
  full_name: string | null;
  created_by: string | null;
  created_at: string;
  expires_at: string;
  // Tells "never clicked" from "clicked but didn't finish".
  opened_at: string | null;
  open_count: number;
  used_at: string | null;
  used_by: string | null;
  revoked_at: string | null;
};

export type AgreementKind = "contractor" | "customer";
export type AgreementStatus = "pending" | "sent" | "contractor_signed" | "signed" | "declined" | "expired" | "void";

// Signing happens in DocuSeal; this is the record plus the stored file.
export type Agreement = {
  id: string;
  kind: AgreementKind;
  staff_id: string | null;
  quote_id: string | null;
  title: string;
  status: AgreementStatus;
  file_path: string | null;
  docuseal_url: string | null;
  sent_at: string | null;
  signed_at: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /** The latest saved version of an agreement written in the CRM; null for an uploaded file. */
  current_version_id?: string | null;
  // DocuSeal signing (after the signing migration). See src/lib/crm/agreement-signing.ts.
  sent_version_id?: string | null;
  docuseal_submission_id?: number | null;
  contractor_signed_at?: string | null;
  completed_at?: string | null;
  expires_at?: string | null;
  decline_reason?: string | null;
  signed_pdf_path?: string | null;
  audit_log_path?: string | null;
};

/** One saved version of an agreement. Never changed after it is saved (database-enforced). */
export type AgreementVersion = {
  id: string;
  agreement_id: string;
  version_no: number;
  template_version: string;
  body: unknown;
  html: string;
  html_sha256: string;
  note: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
};

export type LoginAttempt = {
  id: string;
  created_at: string;
  email: string | null;
  success: boolean;
  reason: string;
  staff_id: string | null;
  ip: string | null;
  user_agent: string | null;
};

export type Session = {
  accessToken: string;
  user: { id: string; email?: string };
  staff: Staff;
};
