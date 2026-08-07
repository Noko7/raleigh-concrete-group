export type SaveState = { ok: boolean; saved?: boolean; error?: string };

export type TestSmsResult = {
  to: string;
  ok: boolean;
  status: number | null;
  detail: string | null;
};

export type TestSmsState = {
  ok: boolean;
  error?: string;
  results?: TestSmsResult[];
};
