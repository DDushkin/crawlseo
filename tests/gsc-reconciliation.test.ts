import assert from "node:assert/strict";
import test from "node:test";
import { reconcileGscReports } from "../lib/gsc/reconciliation";

const reports = {
  totals: { clicks: 100, impressions: 1000 },
  query: { clicks: 80, impressions: 700, complete: true },
  page: { clicks: 100, impressions: 1200, complete: true },
  device: { clicks: 100, impressions: 1000, complete: true },
  country: { clicks: 99, impressions: 995, complete: true },
};

test("labels missing query traffic as privacy coverage, not corruption", () => {
  const result = reconcileGscReports(reports);
  assert.equal(result.queryCoverage.clicks, 0.8);
  assert.equal(result.queryCoverage.impressions, 0.7);
  assert.equal(result.queryCoverage.expectedPrivacyGap, true);
  assert.equal(result.pageCoverage.impressions, 1.2);
  assert.deepEqual(result.warnings, []);
});

test("warns when a property-additive device breakdown materially differs", () => {
  const result = reconcileGscReports({ ...reports, device: { clicks: 60, impressions: 600, complete: true } });
  assert.deepEqual(result.warnings.map((warning) => warning.code), ["DEVICE_TOTAL_MISMATCH"]);
});

test("uses inclusive one-percent tolerance for both property-additive metrics", () => {
  assert.deepEqual(reconcileGscReports({ ...reports, device: { clicks: 101, impressions: 990, complete: true } }).warnings, []);
  assert.deepEqual(reconcileGscReports({ ...reports, country: { clicks: 100, impressions: 1011, complete: true } }).warnings.map((warning) => warning.code), ["COUNTRY_TOTAL_MISMATCH"]);
});

test("reports truncation separately and does not compare incomplete breakdowns", () => {
  const result = reconcileGscReports({ ...reports, device: { clicks: 1, impressions: 1, complete: false }, reportStates: { device: { complete: false, pagesFetched: 10, truncatedAt: 250000 }, queryPage: { complete: false, pagesFetched: 10, truncatedAt: 250000 } } });
  assert.deepEqual(result.warnings.map((warning) => warning.code), ["DEVICE_TRUNCATED", "QUERY_PAGE_TRUNCATED"]);
});

test("zero totals have null coverage and still flag positive additive traffic", () => {
  const result = reconcileGscReports({ totals: { clicks: 0, impressions: 0 }, query: { clicks: 0, impressions: 0, complete: true }, page: { clicks: 0, impressions: 0, complete: true }, device: { clicks: 0, impressions: 0, complete: true }, country: { clicks: 1, impressions: 0, complete: true } });
  assert.equal(result.queryCoverage.clicks, null);
  assert.equal(result.queryCoverage.impressions, null);
  assert.equal(result.queryCoverage.expectedPrivacyGap, false);
  assert.deepEqual(result.warnings.map((warning) => warning.code), ["COUNTRY_TOTAL_MISMATCH"]);
});
