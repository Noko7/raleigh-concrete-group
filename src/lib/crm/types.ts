import type { Status } from "./env";

export type Role = "owner" | "contractor";

export type Staff = {
  id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  role: Role;
  active: boolean;
  must_reset_password: boolean;
  // Job types this contractor is routed. Null or empty means no restriction.
  service_types: string[] | null;
  // Which language the CRM renders in for this person.
  locale: string;
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
  // Legacy free-text quote body. Superseded by the five sections below, kept
  // so quotes sent before that change still read correctly.
  quote_summary: string | null;
  // The five sections every quote covers. "Not applicable" is a valid answer
  // for any of them, but none may be blank on a quote that has been sent.
  quote_scope: string | null;
  quote_permits: string | null;
  quote_prep: string | null;
  quote_pour: string | null;
  quote_cleanup: string | null;
  // Seven days from the moment the quote was last sent. Null on quotes that
  // predate expiry, which stay valid.
  quote_expires_at: string | null;
  // Photos staff add: internal reference shots, and the before/after pair a
  // contractor must upload to mark the job complete. The customer's own
  // uploads stay in file_urls.
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
  scheduled_date: string | null;
  // Crew-chosen start time for the booked day, display copy like "9:00 AM".
  scheduled_time: string | null;
  // Days the customer said work for them; the crew confirms one of these.
  preferred_dates: string[] | null;
  scheduled_by: string | null;
  scheduled_at: string | null;
  discount_accepted: boolean;
  visit_date: string | null;
  visit_time: string | null;
  gcal_event_id: string | null;
  reminder_sent_at: string | null;
  // Which crew countdown texts have gone out for this booking ("3", "1", "0").
  // Cleared whenever the date moves so the new date gets its own run.
  crew_reminders: string[] | null;
  confirmed_at: string | null;
  completed_at: string | null;
  paid_at: string | null;
  payment_requested_at: string | null;
  archived_at: string | null;
  // 12h nudge: a new lead nobody has quoted or scheduled a visit for.
  stale_lead_reminded_at: string | null;
  // Night-before reminders for an in-person quote VISIT (not the booked work day).
  visit_reminder_sent_at: string | null;
  visit_crew_reminded_at: string | null;
  // 48h nudge: a sent quote nobody has accepted or declined.
  quote_followup_sent_at: string | null;
};

// One line item on a quote. A quote either has none of these (the original
// single-price quote) or a list of them, each of which the customer answers on
// its own - which is what lets somebody take the patio and leave the sidewalk.
export type QuoteOption = {
  id: string;
  quote_id: string;
  title: string;
  description: string | null;
  // numeric(10,2) comes back from PostgREST as a string, so read it through
  // optionAmount() rather than assuming a number.
  amount: number | string;
  // Part of the base job, rather than an extra the customer chooses.
  required: boolean;
  sort_order: number;
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

// A one-time link that lets a contractor create their own account.
export type ContractorInvite = {
  id: string;
  token: string;
  phone: string;
  full_name: string | null;
  created_by: string | null;
  created_at: string;
  expires_at: string;
  // First time the link was opened, and how many times - the difference between
  // "never clicked" and "clicked but didn't finish".
  opened_at: string | null;
  open_count: number;
  used_at: string | null;
  used_by: string | null;
  revoked_at: string | null;
};

export type AgreementKind = "contractor" | "customer";
export type AgreementStatus = "pending" | "sent" | "signed" | "declined" | "void";

// One contract we track in the CRM. The signing itself happens in DocuSeal
// (managed separately); this is the record of it, plus the stored file.
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
