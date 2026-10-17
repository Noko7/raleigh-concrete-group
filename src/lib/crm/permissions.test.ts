// Who may change what on a job: the app's copy of the stage 1 price lockdown
// (supabase/stage1-price-lockdown.sql enforces the same rules on the row).
//
// The shape of every test is the same question: this person, this job, this
// write - refused or not? A contractor before the customer answers, a
// contractor after, and the owner, against each column that carries money or
// the customer's decision, plus every status move the crew make today.
//
// Same setup as fees.test.ts: Node's own runner, no framework.
//
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ANSWER_COLUMNS,
  CHANGE_COLUMNS,
  CONTACT_COLUMNS,
  OFFICE_ONLY_COLUMNS,
  PRICE_COLUMNS,
  changeOrderRefusal,
  customerHasAnswered,
  jobPatchRefusal,
  refusalBasis,
  type JobForPermissions,
} from "./permissions.ts";

const OWNER = "owner";
const CREW = "contractor";
const CREW_ID = "crew-1";

// Spelled out rather than read from the module, so dropping a column from
// permissions.ts fails here instead of quietly shrinking what is tested. Same
// lists as the guard in supabase/stage1-price-lockdown.sql.
const OFFICE_ONLY = [
  "fee_rate",
  "fee_total_cents",
  "fee_waived_cents",
  "fee_waived_note",
  "is_test",
  "archived_at",
  "paid_at",
  "deposit_target_cents",
];
const CONTACT = ["phone", "email"];
const PRICE = ["quote_amount", "discount_accepted"];
const ANSWER = ["customer_response", "customer_responded_at"];
const CHANGE = [
  "change_note",
  "change_amount",
  "change_requested_at",
  "change_requested_by",
  "change_lines",
  "change_deposit_cents",
];

test("the column groups are exactly the guard's", () => {
  assert.deepEqual([...OFFICE_ONLY_COLUMNS], OFFICE_ONLY);
  assert.deepEqual([...CONTACT_COLUMNS], CONTACT);
  assert.deepEqual([...PRICE_COLUMNS], PRICE);
  assert.deepEqual([...ANSWER_COLUMNS], ANSWER);
  assert.deepEqual([...CHANGE_COLUMNS], CHANGE);
});

// A job in each of the states that matter. Money columns as PostgREST returns
// them - numeric can arrive as a string.
const base = {
  name: "Dave Smith",
  phone: "9195550142",
  email: "dave@example.com",
  quote_amount: "8250.00",
  discount_accepted: false,
  customer_responded_at: null,
  fee_rate: 0.15,
  fee_total_cents: 123750,
  fee_waived_cents: 0,
  fee_waived_note: null,
  is_test: false,
  archived_at: null,
  paid_at: null,
  deposit_target_cents: null,
  change_note: null,
  change_amount: null,
  change_requested_at: null,
  change_requested_by: null,
  change_lines: null,
  change_deposit_cents: null,
};

const open: JobForPermissions = { ...base, status: "quoted", customer_response: null };
const approved: JobForPermissions = {
  ...base,
  status: "approved",
  customer_response: "accepted",
  customer_responded_at: "2026-10-01T12:00:00+00:00",
};
const scheduled: JobForPermissions = { ...approved, status: "scheduled" };
const completed: JobForPermissions = { ...approved, status: "completed" };
const paid: JobForPermissions = { ...approved, status: "paid", paid_at: "2026-10-10T12:00:00+00:00" };
// Declined and still Lost: answered. Declined but moved off Lost by the office:
// open again (isOpenAgain).
const declinedLost: JobForPermissions = { ...base, status: "lost", customer_response: "declined" };
const reopened: JobForPermissions = { ...base, status: "quoted", customer_response: "declined" };

const pending: JobForPermissions = {
  ...approved,
  change_note: "Patio two feet wider",
  change_amount: "9400.00",
  change_requested_at: "2026-10-12T12:00:00+00:00",
  change_requested_by: "crew-1",
  change_lines: null,
  change_deposit_cents: null,
};

/** A different value for each column, of the right kind. */
function anotherValue(column: string, job: JobForPermissions): unknown {
  const now = job[column];
  if (typeof now === "boolean") return !now;
  if (column === "quote_amount") return 4125;
  if (column === "customer_response") return now === null ? "declined" : null;
  if (column.endsWith("_at")) return "2026-10-17T09:00:00.000Z";
  if (column.endsWith("_note")) return "something else";
  if (column === "phone") return "9195550199";
  if (column === "email") return "someone@example.com";
  if (column === "fee_rate") return 0;
  return typeof now === "number" ? now + 1 : 100;
}

// ── When the customer counts as having answered ─────────────────────────────

test("answered is accepted, or declined and still Lost", () => {
  assert.equal(customerHasAnswered(open), false);
  assert.equal(customerHasAnswered(approved), true);
  assert.equal(customerHasAnswered(scheduled), true);
  assert.equal(customerHasAnswered(paid), true);
  assert.equal(customerHasAnswered(declinedLost), true);
  // The office moved it off Lost: their link shows the quote again.
  assert.equal(customerHasAnswered(reopened), false);
});

// ── The price ───────────────────────────────────────────────────────────────

for (const column of PRICE) {
  test(`contractor may change ${column} before the customer answers`, () => {
    assert.equal(jobPatchRefusal(CREW, open, { [column]: anotherValue(column, open) }), null);
  });

  test(`contractor may change ${column} on a declined quote the office reopened`, () => {
    assert.equal(jobPatchRefusal(CREW, reopened, { [column]: anotherValue(column, reopened) }), null);
  });

  for (const job of [approved, scheduled, completed, declinedLost]) {
    test(`contractor may NOT change ${column} once answered (${job.status})`, () => {
      const why = jobPatchRefusal(CREW, job, { [column]: anotherValue(column, job) });
      assert.ok(why, "expected a refusal");
    });
  }

  test(`owner may change ${column} after the customer answers`, () => {
    assert.equal(jobPatchRefusal(OWNER, approved, { [column]: anotherValue(column, approved) }), null);
  });
}

test("the refusal on an approved price points at a change order, by name", () => {
  const why = jobPatchRefusal(CREW, approved, { quote_amount: 4125 });
  assert.equal(why, "Dave already approved this price, so it can't be edited. To change it, send Dave a change order to approve.");
});

test("lowering, raising and clearing an approved price are all refused", () => {
  assert.ok(jobPatchRefusal(CREW, approved, { quote_amount: 1 }));
  assert.ok(jobPatchRefusal(CREW, approved, { quote_amount: 99_999 }));
  assert.ok(jobPatchRefusal(CREW, approved, { quote_amount: null }));
});

test("writing back the same price is not a change, however PostgREST spelled it", () => {
  // The stored figure is "8250.00"; the editor posts 8250.
  assert.equal(jobPatchRefusal(CREW, approved, { quote_amount: 8250 }), null);
  assert.equal(jobPatchRefusal(CREW, approved, { quote_amount: "8250.00" }), null);
  assert.equal(jobPatchRefusal(CREW, approved, { quote_amount: 8250.001 }), null);
});

test("a column the write doesn't carry is not a change", () => {
  assert.equal(jobPatchRefusal(CREW, approved, {}), null);
  assert.equal(jobPatchRefusal(CREW, approved, { quote_amount: undefined }), null);
});

// ── The customer's answer ───────────────────────────────────────────────────

for (const column of ANSWER) {
  test(`contractor may NOT change ${column} once answered`, () => {
    assert.ok(jobPatchRefusal(CREW, approved, { [column]: anotherValue(column, approved) }));
  });

  test(`owner may change ${column} once answered`, () => {
    assert.equal(jobPatchRefusal(OWNER, approved, { [column]: anotherValue(column, approved) }), null);
  });
}

test("clearing the answer and re-pricing in one write is refused", () => {
  assert.ok(jobPatchRefusal(CREW, approved, { customer_response: null, customer_responded_at: null, quote_amount: 1 }));
});

test("contractor may record a phone approval on an open quote (recordOfflineAcceptance)", () => {
  const patch = {
    customer_response: "accepted",
    customer_responded_at: "2026-10-17T09:00:00.000Z",
    status: "approved",
    quote_amount: 7900,
    preferred_dates: ["2026-10-23"],
    preferred_times: ["9:00 AM"],
  };
  assert.equal(jobPatchRefusal(CREW, open, patch), null);
});

test("contractor may reopen a declined quote the office moved off Lost (saveQuote)", () => {
  const patch = { customer_response: null, customer_responded_at: null, discount_accepted: false, quote_amount: 6000 };
  assert.equal(jobPatchRefusal(CREW, reopened, patch), null);
});

// ── Columns that are never the crew's ───────────────────────────────────────

for (const column of [...OFFICE_ONLY, ...CONTACT]) {
  for (const job of [open, approved]) {
    const when = job.customer_response ? "after" : "before";
    test(`contractor may NOT change ${column} ${when} the customer answers`, () => {
      assert.ok(jobPatchRefusal(CREW, job, { [column]: anotherValue(column, job) }));
    });
    test(`owner may change ${column} ${when} the customer answers`, () => {
      assert.equal(jobPatchRefusal(OWNER, job, { [column]: anotherValue(column, job) }), null);
    });
  }
}

test("the phone and email refusal says who changes them", () => {
  assert.equal(
    jobPatchRefusal(CREW, approved, { email: "new@example.com" }),
    "Only the office can change the customer's phone or email.",
  );
  assert.ok(jobPatchRefusal(CREW, open, { email: null }));
  // Written back as they are is not a change.
  assert.equal(jobPatchRefusal(CREW, approved, { phone: "9195550142", email: "dave@example.com" }), null);
});

test("an unknown role is held to the contractor's rules", () => {
  assert.ok(jobPatchRefusal("", approved, { quote_amount: 1 }));
  assert.ok(jobPatchRefusal("admin", open, { status: "paid" }));
});

// ── Status ──────────────────────────────────────────────────────────────────

test("contractor may NOT mark a job paid, at any stage", () => {
  for (const job of [open, approved, scheduled, completed]) {
    assert.ok(jobPatchRefusal(CREW, job, { status: "paid" }), job.status);
    // How moveQuote and saveQuote send it.
    assert.ok(jobPatchRefusal(CREW, job, { status: "paid", paid_at: "2026-10-17T09:00:00.000Z" }), job.status);
  }
});

test("contractor may NOT move a job off Paid", () => {
  for (const to of ["completed", "scheduled", "approved", "quoted", "new", "lost"]) {
    assert.ok(jobPatchRefusal(CREW, paid, { status: to }), to);
  }
});

test("owner may mark a job paid, and move it off Paid", () => {
  assert.equal(jobPatchRefusal(OWNER, completed, { status: "paid", paid_at: "2026-10-17T09:00:00.000Z" }), null);
  assert.equal(jobPatchRefusal(OWNER, paid, { status: "completed", paid_at: null }), null);
});

test("every status move the crew make today is still theirs", () => {
  // Sending a quote, from New.
  assert.equal(jobPatchRefusal(CREW, { ...open, status: "new" }, { status: "quoted", quote_sent_at: "2026-10-17T09:00:00.000Z" }), null);
  // Booking the day (confirmSchedule).
  assert.equal(
    jobPatchRefusal(CREW, approved, {
      scheduled_date: "2026-10-23",
      scheduled_time: "9:00 AM",
      status: "scheduled",
      scheduled_by: "crew-1",
      scheduled_at: "2026-10-17T09:00:00.000Z",
      confirmed_at: null,
      reminder_sent_at: null,
    }),
    null,
  );
  // Booking on a closed-out job keeps its status (confirmSchedule).
  assert.equal(jobPatchRefusal(CREW, paid, { scheduled_date: "2026-10-23", status: "paid" }), null);
  // Releasing the day (clearAppointment).
  assert.equal(jobPatchRefusal(CREW, scheduled, { scheduled_date: null, scheduled_time: null, status: "approved" }), null);
  // Marking it done (completeJob).
  assert.equal(jobPatchRefusal(CREW, scheduled, { status: "completed", completed_at: "2026-10-17T09:00:00.000Z" }), null);
  // Lost, from any open stage (written by the server for them).
  for (const job of [open, approved, scheduled, completed]) {
    assert.equal(jobPatchRefusal(CREW, job, { status: "lost" }), null, job.status);
  }
  // The board's other moves are unchanged too.
  assert.equal(jobPatchRefusal(CREW, open, { status: "approved" }), null);
  assert.equal(jobPatchRefusal(CREW, completed, { status: "scheduled" }), null);
});

test("Lost does not carry a new price along with it", () => {
  assert.ok(jobPatchRefusal(CREW, approved, { status: "lost", quote_amount: 1 }));
});

test("everyday writes on an approved job are untouched", () => {
  const writes = [
    { internal_notes: "Gate code 4411" },
    { name: "Dave Smyth" },
    { before_urls: ["quote-uploads/a.jpg"] },
    { visit_date: "2026-10-20", visit_time: "10:00 AM", quote_type: "inperson", visit_reminder_sent_at: null },
    { public_token: "a".repeat(32), job_token: "b".repeat(32) },
    { payment_requested_at: "2026-10-17T09:00:00.000Z" },
  ];
  for (const w of writes) assert.equal(jobPatchRefusal(CREW, approved, w), null, Object.keys(w).join(","));
});

// ── A change order ──────────────────────────────────────────────────────────

// How requestChange opens one.
const opening = {
  change_note: "Patio two feet wider",
  change_amount: 9400,
  change_requested_at: "2026-10-17T09:00:00.000Z",
  change_requested_by: CREW_ID,
  change_lines: null,
  change_deposit_cents: null,
};

test("contractor may send a change order that raises the total (requestChange)", () => {
  assert.equal(jobPatchRefusal(CREW, approved, opening), null);
  assert.equal(jobPatchRefusal(CREW, approved, opening, CREW_ID), null);
  assert.equal(jobPatchRefusal(CREW, approved, { ...opening, change_amount: "8250.01" }, CREW_ID), null);
});

test("contractor may send the same total with a new breakdown", () => {
  const lines = [{ title: "Slab", description: null, amount: 8250 }];
  assert.equal(jobPatchRefusal(CREW, approved, { ...opening, change_amount: 8250, change_lines: lines }, CREW_ID), null);
});

test("contractor may NOT send a change order that lowers the total - they can reach the customer's Approve", () => {
  for (const amount of [8249.99, "8249.99", 7000, 0]) {
    assert.equal(
      jobPatchRefusal(CREW, approved, { ...opening, change_amount: amount }, CREW_ID),
      "Lowering an approved price is done by the office.",
      String(amount),
    );
  }
  // Against the agreed total in cents, the figure the fee is worked out from.
  assert.equal(jobPatchRefusal(CREW, approved, { ...opening, change_amount: 8249.995 }, CREW_ID), null);
  assert.ok(jobPatchRefusal(CREW, approved, { ...opening, change_amount: 8249.994 }, CREW_ID));
  assert.ok(jobPatchRefusal(CREW, scheduled, { ...opening, change_amount: 1 }, CREW_ID));
});

test("owner may send a change order that lowers the total", () => {
  assert.equal(jobPatchRefusal(OWNER, approved, { ...opening, change_amount: 7000, change_requested_by: "owner-1" }, "owner-1"), null);
});

test("a change order opened in somebody else's name is refused", () => {
  assert.equal(
    jobPatchRefusal(CREW, approved, { ...opening, change_requested_by: "owner-1" }, CREW_ID),
    "A change order can only be sent in your own name.",
  );
  assert.ok(jobPatchRefusal(CREW, approved, { ...opening, change_requested_by: null }, CREW_ID));
  const { change_requested_by: _dropped, ...unnamed } = opening;
  assert.ok(jobPatchRefusal(CREW, approved, unnamed, CREW_ID));
});

test("sendChangeOrder refuses a lower total from anybody but the owner", () => {
  assert.equal(
    changeOrderRefusal(CREW, { agreed: false, fromTotal: "8250.00", toTotal: 7000 }),
    "Lowering an approved price is done by the office.",
  );
  assert.equal(changeOrderRefusal(CREW, { agreed: false, fromTotal: "8250.00", toTotal: 8250 }), null);
  assert.equal(changeOrderRefusal(CREW, { agreed: false, fromTotal: "8250.00", toTotal: 9400 }), null);
  assert.equal(changeOrderRefusal(OWNER, { agreed: true, fromTotal: "8250.00", toTotal: 7000 }), null);
  assert.ok(changeOrderRefusal("", { agreed: false, fromTotal: 100, toTotal: 99 }));
  // A total that was never given is not a lower one.
  assert.equal(changeOrderRefusal(CREW, { agreed: false, fromTotal: "8250.00" }), null);
});

test("contractor may withdraw a pending change (cancelChange clears all six)", () => {
  const clear = Object.fromEntries(CHANGE.map((c) => [c, null]));
  assert.equal(jobPatchRefusal(CREW, pending, clear), null);
});

test("contractor may NOT rewrite a change the customer is looking at", () => {
  assert.ok(jobPatchRefusal(CREW, pending, { change_amount: 8000 }));
  assert.ok(jobPatchRefusal(CREW, pending, { change_lines: [{ title: "Labor", description: null, amount: 8000 }] }));
  assert.ok(jobPatchRefusal(CREW, pending, { change_deposit_cents: 100 }));
  // Clearing only some of it is not a withdrawal.
  assert.ok(jobPatchRefusal(CREW, pending, { change_amount: null, change_note: null, change_requested_at: null }));
});

test("writing a pending change back unchanged is not a rewrite", () => {
  assert.equal(jobPatchRefusal(CREW, pending, { change_amount: 9400, change_note: "Patio two feet wider" }), null);
});

test("owner may rewrite a pending change", () => {
  assert.equal(jobPatchRefusal(OWNER, pending, { change_amount: 8000 }), null);
});

test("the no-text 'already agreed' change is the owner's alone", () => {
  assert.ok(changeOrderRefusal(CREW, { agreed: true, customerName: "Dave Smith" }));
  assert.ok(changeOrderRefusal("", { agreed: true }));
  assert.equal(changeOrderRefusal(OWNER, { agreed: true, customerName: "Dave Smith" }), null);
});

test("anybody may send a change for the customer to approve", () => {
  assert.equal(changeOrderRefusal(CREW, { agreed: false, customerName: "Dave Smith" }), null);
  assert.equal(changeOrderRefusal(OWNER, { agreed: false }), null);
});

test("the no-text refusal tells the crew what to do instead", () => {
  assert.equal(
    changeOrderRefusal(CREW, { agreed: true, customerName: "Dave Smith" }),
    "Only the owner can apply a change without texting the customer. Send it to Dave to approve instead - nothing moves until they do.",
  );
  assert.match(changeOrderRefusal(CREW, { agreed: true }) ?? "", /send it to the customer to approve/i);
});

// ── The Lost write the server makes for a contractor ────────────────────────

test("a Lost write is pinned to the answer and status it was checked against", () => {
  assert.deepEqual(refusalBasis(open, { status: "lost" }), {
    status: "quoted",
    customer_response: null,
    change_requested_at: null,
  });
});

test("every guarded column the write carries is pinned too, at its value when checked", () => {
  const basis = refusalBasis(open, {
    status: "lost",
    quote_amount: 6000,
    discount_accepted: true,
    phone: "9195550199",
    internal_notes: "gone with another crew",
  });
  assert.deepEqual(basis, {
    status: "quoted",
    customer_response: null,
    change_requested_at: null,
    quote_amount: "8250.00",
    discount_accepted: false,
    phone: "9195550142",
  });
});

test("change_lines is not pinned (jsonb), change_requested_at stands in for it", () => {
  const basis = refusalBasis(pending, { status: "lost", change_lines: null, change_amount: null });
  assert.equal("change_lines" in basis, false);
  assert.equal(basis.change_requested_at, "2026-10-12T12:00:00+00:00");
  assert.equal(basis.change_amount, "9400.00");
});
