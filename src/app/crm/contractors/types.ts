export type AddState = {
  ok: boolean;
  error?: string;
  email?: string;
  password?: string;
  smsSent?: boolean;
  smsNote?: string;
};

export type ResetState = {
  ok: boolean;
  error?: string;
  password?: string;
  smsSent?: boolean;
  smsNote?: string;
};
