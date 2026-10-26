// nearestOpenSlot: which time the public form books when a customer's own pick
// can't be used (nextOpenVisit walks the days and asks this of each one). An
// in-person request never leaves unbooked, so this decides the time they're
// texted.
//
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_VISIT_SLOTS, nearestOpenSlot } from "./constants.ts";

const SLOTS = DEFAULT_VISIT_SLOTS; // 8:00 AM .. 4:00 PM

test("their own time, when it's open", () => {
  assert.equal(nearestOpenSlot(SLOTS, [], "10:00 AM"), "10:00 AM");
});

test("the nearest open time when theirs went, earlier winning a tie", () => {
  // A 10:00 visit blocks 9, 10 and 11: 8 and 12 are both two hours off.
  assert.equal(nearestOpenSlot(SLOTS, ["9:00 AM", "10:00 AM", "11:00 AM"], "10:00 AM"), "8:00 AM");
  assert.equal(nearestOpenSlot(SLOTS, ["8:00 AM", "9:00 AM", "10:00 AM", "11:00 AM"], "10:00 AM"), "12:00 PM");
});

test("a time outside the window goes to the nearest end of it", () => {
  assert.equal(nearestOpenSlot(SLOTS, [], "6:00 PM"), "4:00 PM");
});

test("no time asked for, or one we can't read, takes the first open slot", () => {
  assert.equal(nearestOpenSlot(SLOTS, ["8:00 AM"], ""), "9:00 AM");
  assert.equal(nearestOpenSlot(SLOTS, ["8:00 AM"], "teatime"), "9:00 AM");
});

test("a full day has nothing, so the caller moves to the next day", () => {
  assert.equal(nearestOpenSlot(SLOTS, SLOTS, "10:00 AM"), null);
});
