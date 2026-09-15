import assert from "node:assert/strict";
import test from "node:test";

import { aggregateGscMetrics, compareGscMetrics } from "../lib/gsc/aggregate";

test("calculates CTR from totals and position by impressions", () => {
  assert.deepEqual(
    aggregateGscMetrics([
      { clicks: 10, impressions: 100, position: 2 },
      { clicks: 0, impressions: 300, position: 10 },
    ]),
    { clicks: 10, impressions: 400, ctr: 0.025, position: 8 }
  );
});

test("returns unavailable CTR and position when impressions are zero", () => {
  assert.deepEqual(aggregateGscMetrics([{ clicks: 0, impressions: 0, position: 0 }]), {
    clicks: 0,
    impressions: 0,
    ctr: null,
    position: null,
  });
});

test("comparison keeps unavailable metrics unavailable", () => {
  assert.deepEqual(
    compareGscMetrics(
      { clicks: 0, impressions: 0, ctr: null, position: null },
      { clicks: 0, impressions: 0, ctr: null, position: null }
    ),
    { clicks: 0, impressions: 0, ctr: null, position: null }
  );
});
