// The site's own request log: one row per request, keyed by Vercel's request id so the middleware's row and a
// download route's row (with its byte count) are the same row.
//
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { API_ROUTES, isUnknownApi, requestKey, selfLogRow } from "./request-log-row.ts";

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
  assert.equal(r.log_key, "v:abcde-1793498369540-c1114f1ad4a9");
  assert.equal(r.ip, "203.0.113.9");
  assert.equal(r.method, "GET");
  assert.equal(r.path, "/q/:id?preview");
  assert.equal(r.referer_host, "evil.example");
  assert.equal(r.probe, null);
  const probe = selfLogRow({ headers: h, method: "GET", url: "https://raleighconcrete.net/.env", source: "middleware" });
  assert.equal(probe.probe, "dotfile");
});

test("the same request gets the same key from middleware and route; no id gets a random one", () => {
  // The function sees one more region than the middleware; the request id at the end is the same.
  assert.equal(requestKey(headers({ "x-vercel-id": "iad1::xyz-1" })), requestKey(headers({ "x-vercel-id": "iad1::iad1::xyz-1" })));
  assert.equal(requestKey(headers({ "x-vercel-id": "iad1::xyz-1" })), "v:xyz-1");
  const a = requestKey(headers({}));
  const b = requestKey(headers({}));
  assert.ok(a.startsWith("x:") && a !== b);
  assert.ok(!requestKey(headers({ "x-vercel-id": "a\u0000b<script>" })).includes("<"));
});

test("the known API list matches the route files, and unknown /api addresses are logged as 404 guesses", () => {
  const found: string[] = [];
  const walk = (dir: string, url: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, `${url}/${name}`);
      else if (name === "route.ts") found.push(url);
    }
  };
  walk("src/app/api", "/api");
  walk("src/app/crm/api", "/crm/api");
  assert.deepEqual([...API_ROUTES].sort(), found.sort(), "API_ROUTES must list every route.ts under /api and /crm/api");

  assert.ok(isUnknownApi("/api/v1/users"));
  assert.ok(!isUnknownApi("/api/quote"));
  assert.ok(!isUnknownApi("/api/quote/"));
  assert.ok(!isUnknownApi("/about"));
  const h = headers({ "x-vercel-id": "iad1::q-1" });
  const guess = selfLogRow({ headers: h, method: "POST", url: "https://raleighconcrete.net/api/admin/users", source: "middleware" });
  assert.equal(guess.status, 404);
  assert.equal(guess.probe, "api-guess");
  const real = selfLogRow({ headers: h, method: "POST", url: "https://raleighconcrete.net/api/quote", source: "middleware" });
  assert.equal(real.status, null);
  // The crm. subdomain serves /api/login from /crm/api/login: a staff sign-in is not a guess.
  const crm = headers({ "x-vercel-id": "iad1::q-2", host: "crm.raleighconcrete.net" });
  const login = selfLogRow({ headers: crm, method: "POST", url: "https://crm.raleighconcrete.net/api/login", source: "middleware" });
  assert.equal(login.status, null);
  assert.equal(login.probe, null);
  const crmGuess = selfLogRow({ headers: crm, method: "GET", url: "https://crm.raleighconcrete.net/api/admin", source: "middleware" });
  assert.equal(crmGuess.status, 404);
});
