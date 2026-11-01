// The site's own request log: one row per request, keyed by Vercel's request id so the middleware's row and a
// download route's row (with its byte count) are the same row.
//
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { requestKey, selfLogRow } from "./request-log-row.ts";

const headers = (h: Record<string, string>) => ({ get: (k: string) => h[k.toLowerCase()] ?? null });

test("self-log row: masked path, client IP, probe tag, keyed by Vercel's request id", () => {
  const h = headers({
    "x-vercel-id": "iad1::abcde-1793498369540-c1114f1ad4a9",
    "x-forwarded-for": "203.0.113.9, 10.0.0.1",
    "user-agent": "curl/8.0",
    host: "raleighconcrete.net",
    referer: "https://evil.example/x",
  });
  const r = selfLogRow({ headers: h, method: "get", url: "https://raleighconcrete.net/q/0123456789abcdef0123456789abcdef?preview=1", source: "middleware" });
  assert.equal(r.log_key, "v:iad1::abcde-1793498369540-c1114f1ad4a9");
  assert.equal(r.ip, "203.0.113.9");
  assert.equal(r.method, "GET");
  assert.equal(r.path, "/q/:id?preview");
  assert.equal(r.referer_host, "evil.example");
  assert.equal(r.probe, null);
  const probe = selfLogRow({ headers: h, method: "GET", url: "https://raleighconcrete.net/.env", source: "middleware" });
  assert.equal(probe.probe, "dotfile");
});

test("the same request gets the same key from middleware and route; no id gets a random one", () => {
  const h = headers({ "x-vercel-id": "iad1::xyz-1" });
  assert.equal(requestKey(h), requestKey(h));
  const a = requestKey(headers({}));
  const b = requestKey(headers({}));
  assert.ok(a.startsWith("x:") && a !== b);
  assert.ok(!requestKey(headers({ "x-vercel-id": "a\u0000b<script>" })).includes("<"));
});
