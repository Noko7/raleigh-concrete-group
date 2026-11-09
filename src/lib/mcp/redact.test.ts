// What the connector masks before Claude sees it, and how search text is made safe for a database filter.
//
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { phoneDigits, redactLinks, searchTerm, UUID } from "./redact.ts";

test("customer and crew link tokens are masked, the path kept", () => {
  const sent =
    "View it here:\nhttps://raleighconcrete.net/q/078cf72e6bcc4d3695e1a7e960b4381b\n" +
    "Crew: https://raleighconcrete.net/job/38a987d1df8d467abc17207d10db2b33 pay /pay/abcdefABCDEF123456 " +
    "sign /sign/Zz_9-abcdefghijk receipt /r/0123456789abcdef";
  const out = redactLinks(sent)!;
  assert.doesNotMatch(out, /078cf72e|38a987d1|abcdefABCDEF|Zz_9|0123456789abcdef/);
  assert.match(out, /\/q\/\[link\]/);
  assert.match(out, /\/job\/\[link\]/);
});

test("signed query values are masked", () => {
  assert.equal(redactLinks("x.png?sig=abc123&w=640"), "x.png?sig=[redacted]&w=640");
  assert.equal(redactLinks(null), null);
});

test("ordinary text is untouched", () => {
  assert.equal(redactLinks("Quote is good for 30 days. Call (919) 873-3919."), "Quote is good for 30 days. Call (919) 873-3919.");
});

test("search text can't carry filter syntax", () => {
  assert.equal(searchTerm("Tushar"), "Tushar");
  assert.equal(searchTerm("a),status.eq.paid,(name.ilike.*"), "a status.eq.paid name.ilike.");
  assert.equal(searchTerm('x" ,name.eq.y\\'), "x name.eq.y");
  assert.equal(searchTerm("jane.doe@gmail.com"), "jane.doe@gmail.com");
  assert.equal(searchTerm('x"*:'), null);
  assert.equal(searchTerm("1909 Oak St #2"), "1909 Oak St #2");
  assert.equal(searchTerm(" "), null);
  assert.equal(searchTerm("Ñoño"), "Ñoño");
});

test("phone digits", () => {
  assert.equal(phoneDigits("919 606-7943"), "9196067943");
  assert.equal(phoneDigits("+1 919 606 7943"), "9196067943");
  assert.equal(phoneDigits("Tushar"), null);
});

test("job ids must be uuids", () => {
  const re = new RegExp(UUID);
  assert.ok(re.test("ff740858-0802-4bf5-94cf-132c581db9a9"));
  assert.equal(re.test("ff740858-0802-4bf5-94cf-132c581db9a9&select=*"), false);
});
