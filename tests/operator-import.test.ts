import assert from "node:assert/strict";
import test from "node:test";
import { parseCsvTable, preparePageMapImport } from "../lib/operator/import";

test("CSV parser preserves quoted commas and newlines", () => {
  assert.deepEqual(parseCsvTable('URL,Keyword,Notes\r\n"https://strum.capital/a","трекер, акції","line 1\nline 2"'), [
    ["URL", "Keyword", "Notes"], ["https://strum.capital/a", "трекер, акції", "line 1\nline 2"],
  ]);
});

test("import rejects foreign-domain rows atomically", () => {
  assert.throws(() => preparePageMapImport("strum.capital", [
    { url: "https://www.strum.capital/features/", query: "трекер акцій" },
    { url: "https://other.example/", query: "x" },
  ]), /Row 2/);
});

test("import deduplicates canonical URLs and market-specific targets", () => {
  const prepared = preparePageMapImport("strum.capital", [
    { url: "https://www.strum.capital/features/#heading", query: "Трекер ОВДП", pageType: "Service", notes: "High priority" },
    { url: "https://www.strum.capital/features/", query: "трекер овдп" },
  ]);
  assert.equal(prepared.pages.length, 1);
  assert.equal(prepared.targets.length, 1);
  assert.equal(prepared.targets[0].query, "трекер овдп");
  assert.equal(prepared.targets[0].notes, "High priority");
});
