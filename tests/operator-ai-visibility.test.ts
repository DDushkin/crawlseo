import assert from "node:assert/strict";
import test from "node:test";
import { summarizeCitationPanel, parseGscAiCsv, recentAiWindow, summarizeAiWindow, ga4WindowCovered } from "../lib/operator/ai-visibility";
import { classifyAiReferrer, parseGa4TrafficRows, ga4ReportRowCount } from "../lib/google/ga4-client";
import { nextPendingPanelPrompt } from "../lib/operator/ai-panel-run";

test("panel rate uses successful live observations and exposes coverage", () => {
  const summary = summarizeCitationPanel({ mode: "LIVE", promptCount: 3, results: [
    { status: "OBSERVED", siteCited: true, sources: [{ domain: "strum.capital", url: "https://strum.capital/a" }] },
    { status: "OBSERVED", siteCited: false, sources: [{ domain: "example.com", url: "https://example.com" }] },
    { status: "ERROR", siteCited: false, sources: [] },
  ] });
  assert.equal(summary.cited, 1);
  assert.equal(summary.observed, 2);
  assert.equal(summary.promptCount, 3);
  assert.equal(summary.citationRate, 0.5);
  assert.equal(summary.coverage, "PARTIAL");
  assert.equal(summarizeCitationPanel({ mode: "SANDBOX", promptCount: 1, results: [{ status: "OBSERVED", siteCited: true, sources: [] }] }).citationRate, null);
});

test("Google AI CSV import requires actual impression values and unique dates", () => {
  const rows = parseGscAiCsv("Date,Impressions\n2026-09-01,23\n2026-09-02,0");
  assert.deepEqual(rows, [{ date: "2026-09-01", impressions: 23 }, { date: "2026-09-02", impressions: 0 }]);
  assert.throws(() => parseGscAiCsv("Date,Impressions\n2026-09-01,~"), /unavailable/);
  assert.throws(() => parseGscAiCsv("Date,Impressions\n2026-09-01,3\n2026-09-01,4"), /duplicate/i);
});

test("AI dashboard window uses 28 finalized Pacific reporting days", () => {
  const window = recentAiWindow(new Date("2026-09-23T12:00:00Z"));
  assert.deepEqual({ startDate: window.startDate, endDate: window.endDate },
    { startDate: "2026-08-25", endDate: "2026-09-21" });
});

test("a partial GSC AI export is not displayed as a 28-day total", () => {
  const window = recentAiWindow(new Date("2026-09-23T12:00:00Z"));
  const partial = summarizeAiWindow([{ date: new Date("2026-09-21"), impressions: 23 }], window);
  assert.deepEqual(partial, { state: "PARTIAL", impressions: null, observedImpressions: 23, observedDays: 1, expectedDays: 28 });
  const full = summarizeAiWindow(Array.from({ length: 28 }, (_, index) => ({
    date: new Date(Date.UTC(2026, 7, 25 + index)), impressions: 2,
  })), window);
  assert.equal(full.state, "COMPLETE");
  assert.equal(full.impressions, 56);
  assert.equal(ga4WindowCovered(new Date("2026-09-23T12:00:00Z"), window), true);
  assert.equal(ga4WindowCovered(new Date("2026-09-10T12:00:00Z"), window), false);
});

test("panel worker advances one confirmed question at a time without repeating saved results", () => {
  const prompts = [
    { id: "one", fingerprint: "a", question: "First question" },
    { id: "two", fingerprint: "b", question: "Second question" },
  ];
  assert.deepEqual(nextPendingPanelPrompt(prompts, [{ promptFingerprint: "a" }]), prompts[1]);
  assert.equal(nextPendingPanelPrompt(prompts, [{ promptFingerprint: "a" }, { promptFingerprint: "b" }]), null);
});

test("GA4 referrals count identifiable AI sources, not all Bing or Google sessions", () => {
  assert.equal(classifyAiReferrer("chatgpt.com"), "ChatGPT");
  assert.equal(classifyAiReferrer("www.perplexity.ai"), "Perplexity");
  assert.equal(classifyAiReferrer("bing.com"), null);
  const rows = parseGa4TrafficRows({ rows: [
    { dimensionValues: [{ value: "20260901" }, { value: "chatgpt.com" }, { value: "referral" }, { value: "Referral" }], metricValues: [{ value: "5" }, { value: "1" }] },
    { dimensionValues: [{ value: "20260901" }, { value: "google" }, { value: "organic" }, { value: "Organic Search" }], metricValues: [{ value: "50" }, { value: "3" }] },
  ], rowCount: 2 });
  assert.deepEqual(rows.ai, [{ date: "2026-09-01", source: "ChatGPT", sessions: 5, keyEvents: 1 }]);
  assert.deepEqual(rows.organic, [{ date: "2026-09-01", sessions: 50, keyEvents: 3 }]);
  assert.throws(() => parseGa4TrafficRows({ rows: [
    { dimensionValues: [{ value: "20260230" }, { value: "chatgpt.com" }, { value: "referral" }, { value: "Referral" }], metricValues: [{ value: "1" }, { value: "0" }] },
  ] }), /invalid date/i);
});

test("GA4 accepts an empty property report but rejects missing counts when rows exist", () => {
  assert.equal(ga4ReportRowCount({}), 0);
  assert.throws(() => ga4ReportRowCount({ rows: [{ dimensionValues: [], metricValues: [] }] }), /row count/i);
});
