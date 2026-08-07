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
  quote_summary: string | null;
  internal_notes: string | null;
  public_token: string;
  job_token: string;
  viewed_at: string | null;
  view_count: number;
  quote_sent_at: string | null;
  customer_response: "accepted" | "declined" | null;
  customer_responded_at: string | null;
  scheduled_date: string | null;
  discount_accepted: boolean;
  visit_date: string | null;
  visit_time: string | null;
  gcal_event_id: string | null;
  reminder_sent_at: string | null;
  confirmed_at: string | null;
  completed_at: string | null;
  paid_at: string | null;
  payment_requested_at: string | null;
  archived_at: string | null;
};

export type QuoteEvent = {
  id: string;
  quote_id: string;
  type: string;
  meta: Record<string, unknown> | null;
  actor: string | null;
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
