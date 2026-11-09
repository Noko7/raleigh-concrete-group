// The Claude connector's sign-in rules: who may register, where a code may go, PKCE, scopes and tokens.
//
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  bearerOf,
  cleanText,
  hashToken,
  isAllowedRedirectUri,
  newToken,
  parseAuthorize,
  parseRegistration,
  pkceMatches,
  redirectMatches,
  tokenKindOf,
} from "./policy.ts";

const MCP = "https://raleighconcrete.net/api/mcp";
const CLAUDE = "https://claude.ai/api/mcp/auth_callback";
const verifier = "a".repeat(20) + "-._~" + "B".repeat(30);
const challenge = createHash("sha256").update(verifier).digest("base64url");

test("only Claude's callbacks and loopback can be redirect targets", () => {
  assert.ok(isAllowedRedirectUri(CLAUDE));
  assert.ok(isAllowedRedirectUri("https://claude.com/api/mcp/auth_callback"));
  assert.ok(isAllowedRedirectUri("http://localhost:53682/callback"));
  assert.ok(isAllowedRedirectUri("http://127.0.0.1:4000/callback"));
  for (const bad of [
    "https://evil.com/api/mcp/auth_callback",
    "https://claude.ai.evil.com/api/mcp/auth_callback",
    "https://claude.ai/api/mcp/auth_callback?x=1",
    "https://claude.ai/other",
    "http://claude.ai/api/mcp/auth_callback",
    "https://user:pw@claude.ai/api/mcp/auth_callback",
    "http://localhost.evil.com/callback",
    "http://localhost:1/cb?next=https://evil.com",
    "https://localhost/callback",
    "javascript:alert(1)",
    "not a url",
  ]) {
    assert.equal(isAllowedRedirectUri(bad), false, bad);
  }
});

test("redirect must match what was registered; a loopback port may move", () => {
  assert.ok(redirectMatches([CLAUDE], CLAUDE));
  assert.equal(redirectMatches([CLAUDE], "https://claude.com/api/mcp/auth_callback"), false);
  assert.ok(redirectMatches(["http://localhost:1111/callback"], "http://localhost:2222/callback"));
  assert.equal(redirectMatches(["http://localhost:1111/callback"], "http://localhost:2222/other"), false);
  assert.equal(redirectMatches(["http://localhost:1111/callback"], "http://127.0.0.1:1111/callback"), false);
});

test("registration refuses foreign callbacks and odd grants, and cleans the name", () => {
  const ok = parseRegistration({ client_name: "Claude‮ evil", redirect_uris: [CLAUDE] });
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.equal(ok.value.clientName, "Claude evil");
    assert.equal(ok.value.authMethod, "none");
  }
  assert.equal(parseRegistration({ redirect_uris: ["https://evil.com/cb"] }).ok, false);
  assert.equal(parseRegistration({ redirect_uris: [] }).ok, false);
  assert.equal(parseRegistration({ redirect_uris: [CLAUDE], grant_types: ["client_credentials"] }).ok, false);
  assert.equal(parseRegistration({ redirect_uris: [CLAUDE], grant_types: ["refresh_token"] }).ok, false);
  assert.equal(parseRegistration({ redirect_uris: [CLAUDE], response_types: ["token"] }).ok, false);
  assert.equal(parseRegistration({ redirect_uris: [CLAUDE], token_endpoint_auth_method: "private_key_jwt" }).ok, false);
  assert.equal(parseRegistration([CLAUDE]).ok, false);
  assert.equal(cleanText("  a\n\tb  ", 10), "a b");
});

test("PKCE: S256 only, the right verifier only", () => {
  assert.ok(pkceMatches(verifier, challenge));
  assert.equal(pkceMatches(verifier + "x", challenge), false);
  assert.equal(pkceMatches("short", challenge), false);
  assert.equal(pkceMatches(verifier, verifier.slice(0, 43)), false);
});

test("authorize: unknown client or wrong redirect never redirects", () => {
  const base = {
    client_id: "c",
    redirect_uri: CLAUDE,
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "s1",
  };
  const unknown = parseAuthorize(base, null, MCP);
  assert.equal(unknown.ok, false);
  assert.equal(!unknown.ok && unknown.redirectable, false);

  const wrongBack = parseAuthorize({ ...base, redirect_uri: "https://claude.com/api/mcp/auth_callback" }, { redirectUris: [CLAUDE] }, MCP);
  assert.equal(!wrongBack.ok && wrongBack.redirectable, false);

  const good = parseAuthorize(base, { redirectUris: [CLAUDE] }, MCP);
  assert.ok(good.ok);
  if (good.ok) assert.equal(good.value.scope, "crm.read");
});

test("authorize: PKCE required, read scope only, tokens only for this server", () => {
  const client = { redirectUris: [CLAUDE] };
  const base = { client_id: "c", redirect_uri: CLAUDE, response_type: "code", code_challenge: challenge, code_challenge_method: "S256" };
  const err = (p: Record<string, string | undefined>) => {
    const r = parseAuthorize(p, client, MCP);
    return !r.ok && r.redirectable ? r.error : r.ok ? "ok" : "page";
  };
  assert.equal(err({ ...base, code_challenge_method: "plain" }), "invalid_request");
  assert.equal(err({ ...base, code_challenge: undefined }), "invalid_request");
  assert.equal(err({ ...base, response_type: "token" }), "unsupported_response_type");
  assert.equal(err({ ...base, scope: "crm.read crm.write" }), "invalid_scope");
  assert.equal(err({ ...base, resource: "https://evil.com/mcp" }), "invalid_target");
  assert.equal(err({ ...base, resource: MCP + "/" }), "ok");
  assert.equal(err({ ...base, scope: "crm.read" }), "ok");
});

test("tokens are random, typed, and stored only as a hash", () => {
  const a = newToken("access");
  const b = newToken("access");
  assert.notEqual(a, b);
  assert.ok(a.length > 40);
  assert.equal(tokenKindOf(a), "access");
  assert.equal(tokenKindOf(newToken("refresh")), "refresh");
  assert.equal(tokenKindOf("rcg_xx_1"), null);
  assert.equal(hashToken(a).length, 64);
  assert.notEqual(hashToken(a), a);
  assert.equal(bearerOf(`Bearer ${a}`), a);
  assert.equal(bearerOf(`Basic ${a}`), null);
  assert.equal(bearerOf("Bearer a b"), null);
});
