import assert from "node:assert/strict";
import test from "node:test";

import {
  inclusiveRangeEnding,
  pacificDateLabel,
  previousDateRange,
  shiftDateLabel,
  toDbDate,
} from "../lib/gsc/date-range";

test("creates an inclusive 28-date range", () => {
  assert.deepEqual(inclusiveRangeEnding("2026-09-12", 28), {
    startDate: "2026-08-16",
    endDate: "2026-09-12",
  });
});

test("creates the immediately preceding comparison range", () => {
  assert.deepEqual(previousDateRange({ startDate: "2026-08-16", endDate: "2026-09-12" }), {
    startDate: "2026-07-19",
    endDate: "2026-08-15",
  });
});

test("date arithmetic survives leap day and stores a date label without local conversion", () => {
  assert.equal(shiftDateLabel("2024-03-01", -1), "2024-02-29");
  assert.equal(toDbDate("2026-09-12").toISOString(), "2026-09-12T00:00:00.000Z");
});

test("Pacific date label follows America/Los_Angeles at the UTC boundary", () => {
  assert.equal(pacificDateLabel(new Date("2026-09-15T06:30:00.000Z")), "2026-09-14");
  assert.equal(pacificDateLabel(new Date("2026-09-15T08:30:00.000Z")), "2026-09-15");
});
