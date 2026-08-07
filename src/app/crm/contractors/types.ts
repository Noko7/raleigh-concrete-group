export type AddState = {
  ok: boolean;
  error?: string;
  email?: string;
  password?: string;
  smsSent?: boolean;
  smsNote?: string;
};

export type ContactState = {
  ok: boolean;
  error?: string;
  phone?: string | null;
};

export type ResetState = {
  ok: boolean;
  error?: string;
  password?: string;
  smsSent?: boolean;
  smsNote?: string;
};
