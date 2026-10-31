// The security log's intake: a forged delivery is refused, every body shape Vercel sends is read, one request is
// stored once, tokens never land in the log, and scanners and outsized downloads are named.
//
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import {
  anomalyReasons,
  cleanIp,
  cleanPath,
  formatBytes,
  GB,
  isWindow,
  MAX_STORED_PATH,
  median,
  parseDrainBody,
  probeReason,
  rowsFromDrain,
  safeText,
  toRequestRow,
  verifyDrainSignature,
} from "./request-logs.ts";

const SECRET = "drain-secret-123";
const sign = (body: string) => createHmac("sha1", SECRET).update(body).digest("hex");

const line = (over: Record<string, unknown> = {}, proxy: Record<string, unknown> = {}) => ({
  id: "1573817250283254651097202070",
  deploymentId: "dpl_233NRGRjVZX1caZrXWtz5g1TAksD",
  source: "lambda",
  host: "raleighconcrete.net",
  timestamp: 1793467832370,
  requestId: "643af4e3-975a-4cc7-9e7a-1eda11539d90",
  statusCode: 200,
  proxy: {
    timestamp: 1793467832172,
    method: "GET",
    host: "raleighconcrete.net",
    path: "/api/users?page=1",
    userAgent: ["Mozilla/5.0 (iPhone)"],
    referer: "https://raleighconcrete.net/services",
    region: "iad1",
    statusCode: 200,
    clientIp: "120.75.16.101",
    vercelCache: "MISS",
    responseByteSize: 2048,
    ...proxy,
  },
  ...over,
});

test("signature: Vercel's HMAC-SHA1 of the raw body; anything else is refused", () => {
  const body = JSON.stringify([line()]);
  assert.ok(verifyDrainSignature(body, sign(body), SECRET));
  assert.ok(verifyDrainSignature(Buffer.from(body), sign(body).toUpperCase(), SECRET), "hex case doesn't matter");
  assert.ok(!verifyDrainSignature(body + " ", sign(body), SECRET), "a changed body");
  assert.ok(!verifyDrainSignature(body, sign(body), "other"), "another secret");
  assert.ok(!verifyDrainSignature(body, null, SECRET));
  assert.ok(!verifyDrainSignature(body, "zz", SECRET));
  assert.ok(!verifyDrainSignature(body, sign(body), ""), "no secret configured: nothing is accepted");
});

test("body: JSON array, one object, or NDJSON; bad lines are dropped, not fatal", () => {
  assert.equal(parseDrainBody(JSON.stringify([line(), line()])).length, 2);
  assert.equal(parseDrainBody(JSON.stringify(line())).length, 1);
  assert.equal(parseDrainBody(`${JSON.stringify(line())}\n{broken\n${JSON.stringify(line())}\n`).length, 2);
  assert.deepEqual(parseDrainBody("[not json"), []);
  assert.deepEqual(parseDrainBody(""), []);
});

test("row: the request's own facts, from the proxy block", () => {
  const r = toRequestRow(line())!;
  assert.equal(r.log_key, "r:643af4e3-975a-4cc7-9e7a-1eda11539d90");
  assert.equal(r.at, new Date(1793467832172).toISOString());
  assert.equal(r.ip, "120.75.16.101");
  assert.equal(r.method, "GET");
  assert.equal(r.path, "/api/users?page");
  assert.equal(r.status, 200);
  assert.equal(r.bytes_out, 2048);
  assert.equal(r.ua, "Mozilla/5.0 (iPhone)");
  assert.equal(r.referer_host, "raleighconcrete.net");
  assert.equal(r.cache, "MISS");
  assert.equal(r.probe, null);
});

test("row: build output, the drain's own deliveries and junk are skipped", () => {
  assert.equal(toRequestRow({ id: "1", source: "build", message: "Build completed", timestamp: 1 }), null);
  assert.equal(toRequestRow(line({}, { path: "/api/logs/vercel" })), null);
  assert.notEqual(toRequestRow(line({}, { timestamp: "x" })), null, "falls back to the line's timestamp");
  assert.equal(toRequestRow(line({ timestamp: undefined }, { timestamp: undefined })), null);
  assert.equal(toRequestRow(null), null);
  assert.equal(toRequestRow("text"), null);
});

test("one request, several log lines: stored once, with the line that knows its size", () => {
  const rows = rowsFromDrain([
    line({}, { responseByteSize: undefined }),
    line({ message: "second console.log" }),
    line({ requestId: "other" }, { clientIp: "9.9.9.9" }),
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.ip === "120.75.16.101")?.bytes_out, 2048);
});

test("paths: query values and capability tokens never reach the log; page slugs stay readable", () => {
  assert.equal(cleanPath("/q/b334ea72d40544228d38cf619f298795?preview=1"), "/q/:id?preview");
  assert.equal(cleanPath("/sign/0123456789abcdef0123456789abcdef"), "/sign/:id");
  assert.equal(cleanPath("/crm/quotes/3f2b1c9e-1d2a-4b3c-8d9e-0f1a2b3c4d5e"), "/crm/quotes/:id");
  assert.equal(cleanPath("/services/stamped-concrete-patios-raleigh-nc"), "/services/stamped-concrete-patios-raleigh-nc");
  assert.equal(cleanPath("https://raleighconcrete.net/a?b=secret&c=2&b=3"), "/a?b&c");
  assert.equal(cleanPath(undefined), "/");
});

test("ips: the client's address, or nothing", () => {
  assert.equal(cleanIp("120.75.16.101"), "120.75.16.101");
  assert.equal(cleanIp("2001:DB8::1"), "2001:db8::1");
  assert.equal(cleanIp("1.2.3.4, 10.0.0.1"), "1.2.3.4");
  assert.equal(cleanIp("not an ip"), null);
  assert.equal(cleanIp(42), null);
});

test("probing: scanner paths and attack payloads are named; real pages are not", () => {
  assert.equal(probeReason("/wp-login.php", 404), "wordpress");
  assert.equal(probeReason("/.env", 404), "dotfile");
  assert.equal(probeReason("/.git/config", 404), "dotfile");
  assert.equal(probeReason("/static/../../etc/passwd", 400), "traversal");
  assert.equal(probeReason("/q/abc?id=1%27%20OR%201=1", 200), "sql");
  assert.equal(probeReason("/search?q=<script>alert(1)</script>", 200), "script");
  assert.equal(probeReason("/phpmyadmin/index.php", 404), "admin-panel");
  assert.equal(probeReason("/index.php", 404), "php");
  assert.equal(probeReason("/backup.sql", 404), "backup-file");
  assert.equal(probeReason("/admin", 404), "admin");
  assert.equal(probeReason("/api/nope", 404), "api-guess");
  assert.equal(probeReason("/api/quote-response", 405), "api-method");
  assert.equal(probeReason("/services/driveways", 200), null);
  assert.equal(probeReason("/crm/quotes", 200), null);
  assert.equal(probeReason("/api/quote-response", 200), null);
});

test("anomalies: a lot of data, far more than others, or most of it", () => {
  const MB = 1024 ** 2;
  assert.deepEqual(anomalyReasons(10 * GB, 2 * MB, 11 * GB), ["over 1 GB", "5120x the typical visitor", "over half of all data out"]);
  assert.deepEqual(anomalyReasons(30 * MB, 2 * MB, 200 * MB), ["15x the typical visitor"]);
  assert.deepEqual(anomalyReasons(1 * MB, 10 * 1024, 1.5 * MB), [], "tiny totals aren't alarming");
  assert.deepEqual(anomalyReasons(2 * MB, 2 * MB, 100 * MB), []);
});

test("helpers", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(10 * GB), "10.0 GB");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(median([]), 0);
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 2.5);
});

test("attacker-chosen text is always storable: length, NUL, split emoji", () => {
  // 400-char path + 8 long query names would be 728 chars; the table allows 520.
  const long = "/" + "a".repeat(450) + "?" + Array.from({ length: 8 }, (_, i) => `${"k".repeat(39)}${i}=1`).join("&");
  assert.ok(cleanPath(long).length <= MAX_STORED_PATH);
  // %00 in a query name decodes to NUL, which Postgres refuses.
  assert.ok(!cleanPath("/x?%00=1&ok=2").includes("\u0000"));
  assert.equal(cleanPath("/x?%00=1&ok=2"), "/x?ok");
  // An emoji at the 40-char cut is kept whole or dropped, never halved.
  const name = "k".repeat(39) + "\u{1F600}";
  const out = cleanPath(`/x?${encodeURIComponent(name)}=1`);
  assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])/.test(out));
  assert.equal(safeText("ab\u0000c\ud83d", 10), "abc");
  assert.equal(safeText("\u{1F600}\u{1F600}", 1), "\u{1F600}");
});

test("probes: no false alarm on ordinary text or real downloads; attacks on the drain itself are kept", () => {
  assert.equal(probeReason("/search?q=select colors from menu", 200), null);
  assert.equal(probeReason("/x?id=1 union select password from users", 200), "sql");
  assert.equal(probeReason("/files/plans.zip", 200), null);
  assert.equal(probeReason("/backup.zip", 404), "backup-file");
  const line = (status: number) => ({ id: "x1", requestId: "r1", timestamp: 1, proxy: { timestamp: 1, path: "/api/logs/vercel", statusCode: status, clientIp: "1.2.3.4" } });
  assert.equal(toRequestRow(line(200)), null, "our own accepted delivery");
  assert.ok(toRequestRow(line(403)), "a refused post to the endpoint is kept");
  assert.ok(!isWindow("constructor"));
  assert.ok(isWindow("7d"));
});
