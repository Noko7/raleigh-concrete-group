// After signing in, "next" may only lead to a page on this site (an open redirect here is a phishing tool).
//
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { safeNext } from "./safe-next.ts";

test("same-site paths pass", () => {
  assert.equal(safeNext("/crm/documents/1b2c3d4e-0000-4000-8000-000000000000"), "/crm/documents/1b2c3d4e-0000-4000-8000-000000000000");
  assert.equal(safeNext("/job/abc"), "/job/abc");
  assert.equal(safeNext("/documents/x?tab=1"), "/documents/x?tab=1");
});

test("anything that could leave the site is refused", () => {
  for (const bad of ["//evil.com", "/\\evil.com", "/\t/evil.com", "/\n/evil.com", "https://evil.com", "evil.com", "/\u0000x", "", undefined, null, ["/a", "/b"]]) {
    assert.equal(safeNext(bad), undefined, JSON.stringify(bad));
  }
  // What the login page receives after the browser decodes "?next=/%5Cevil.com" and "?next=/%09/evil.com".
  assert.equal(safeNext(decodeURIComponent("/%5Cevil.com")), undefined);
  assert.equal(safeNext(decodeURIComponent("/%09/evil.com")), undefined);
});
