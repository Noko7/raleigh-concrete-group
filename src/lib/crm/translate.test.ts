// Translating a Spanish-mode writer's quote: what's asked of the API, and how its answer is checked
// before anyone relies on it. The API itself is stood in for; nothing here spends money.
//
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { TRANSLATE_NOT_SET_UP, TRANSLATE_UNAVAILABLE, translateToEnglish } from "./translate.ts";
import type { TranslateItem } from "./translate-fields.ts";

const one = (text: string): TranslateItem[] => [{ field: "Change order note", text }];

type Reply = { stop_reason?: string; text?: string; throws?: boolean };

function fakeApi(reply: Reply) {
  const calls: Record<string, unknown>[] = [];
  const api = {
    messages: {
      create: async (params: Record<string, unknown>) => {
        calls.push(params);
        if (reply.throws) throw new Error("network down");
        return {
          stop_reason: reply.stop_reason ?? "end_turn",
          content: reply.text === undefined ? [] : [{ type: "text", text: reply.text }],
          usage: { input_tokens: 400, output_tokens: 120 },
        };
      },
    },
  };
  // Only messages.create is used; the cast keeps the test free of the SDK's full surface.
  return { api: api as unknown as Parameters<typeof translateToEnglish>[1], calls };
}

test("asks Haiku for the strings in order, cheaply", async () => {
  const { api, calls } = fakeApi({ text: JSON.stringify({ texts: ["Pour the slab", "Rebar"] }) });
  const items = [
    { field: "Quote section: Scope" as const, text: "Colar la losa" },
    { field: "Line item title" as const, text: "Varilla" },
  ];
  const res = await translateToEnglish(items, api);
  assert.deepEqual(res, { ok: true, texts: ["Pour the slab", "Rebar"] });
  const p = calls[0];
  assert.equal(p.model, "claude-haiku-5-5");
  assert.deepEqual(p.thinking, { type: "disabled" });
  assert.equal((p.output_config as { effort: string }).effort, "low");
  // Each string goes with its field, so titles and sentences are formatted the same way every time.
  assert.deepEqual(JSON.parse((p.messages as { content: string }[])[0].content), { items });
  // The rules ride in the system prompt, the same on every call.
  assert.match(String(p.system), /Never use an em dash/);
  assert.match(String(p.system), /same single job/);
});

test("nothing to translate makes no call", async () => {
  const { api, calls } = fakeApi({ text: "{}" });
  assert.deepEqual(await translateToEnglish([], api), { ok: true, texts: [] });
  assert.equal(calls.length, 0);
});

test("without a key it says it isn't set up, and makes no call", async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  assert.deepEqual(await translateToEnglish(one("Hola")), { ok: false, error: TRANSLATE_NOT_SET_UP });
  if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
});

test("an answer that doesn't line up one-for-one is not used", async () => {
  const { api } = fakeApi({ text: JSON.stringify({ texts: ["Only one"] }) });
  assert.deepEqual(await translateToEnglish([...one("Uno"), ...one("Dos")], api), { ok: false, error: TRANSLATE_UNAVAILABLE });
});

test("a refusal, a cut-off answer or a network failure reads as unavailable", async () => {
  for (const reply of [
    { stop_reason: "refusal" },
    { stop_reason: "max_tokens", text: '{"texts": ["Pour' },
    { throws: true },
    { text: "not json" },
  ]) {
    const { api } = fakeApi(reply);
    assert.deepEqual(await translateToEnglish(one("Colar"), api), { ok: false, error: TRANSLATE_UNAVAILABLE });
  }
});

test("em dashes never reach the customer", async () => {
  const { api } = fakeApi({ text: JSON.stringify({ texts: ["Pour — then finish "] }) });
  assert.deepEqual(await translateToEnglish(one("Colar y acabar"), api), { ok: true, texts: ["Pour - then finish"] });
});
