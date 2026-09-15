import assert from "node:assert/strict";
import test from "node:test";

import {
  compareVerificationMetrics,
  parseVerificationArgs,
  runVerification,
} from "../scripts/verify-gsc";
import { parseBackfillArgs, runBackfill } from "../scripts/backfill-gsc";

test("reports exact count matches and bounded floating metric differences", () => {
  assert.deepEqual(
    compareVerificationMetrics(
      { clicks: 1570, impressions: 9860, ctr: 1570 / 9860, position: 7.5 },
      { clicks: 1570, impressions: 9860, ctr: 1570 / 9860, position: 7.5 }
    ),
    {
      matches: true,
      clicksDifference: 0,
      impressionsDifference: 0,
      ctrDifference: 0,
      positionDifference: 0,
    }
  );
});

test("accepts floating differences at tolerance and rejects counts or null mismatches", () => {
  assert.equal(
    compareVerificationMetrics(
      { clicks: 10, impressions: 100, ctr: 0.100001, position: 4.999999 },
      { clicks: 10, impressions: 100, ctr: 0.1, position: 5 }
    ).matches,
    true
  );

  assert.equal(
    compareVerificationMetrics(
      { clicks: 11, impressions: 100, ctr: 0.1, position: null },
      { clicks: 10, impressions: 100, ctr: 0.1, position: null }
    ).matches,
    false
  );

  assert.equal(
    compareVerificationMetrics(
      { clicks: 10, impressions: 100, ctr: 0.100002, position: 5 },
      { clicks: 10, impressions: 100, ctr: 0.1, position: 5 }
    ).matches,
    false
  );

  assert.equal(
    compareVerificationMetrics(
      { clicks: 10, impressions: 100, ctr: null, position: null },
      { clicks: 10, impressions: 100, ctr: 0.1, position: null }
    ).matches,
    false
  );

  assert.equal(
    compareVerificationMetrics(
      { clicks: 0, impressions: 0, ctr: null, position: null },
      { clicks: 0, impressions: 0, ctr: null, position: null }
    ).matches,
    true
  );
});

test("requires one site and a day count from 1 through 180", () => {
  assert.deepEqual(parseVerificationArgs(["--site", "site-a", "--days", "180"]), {
    siteId: "site-a",
    days: 180,
  });
  assert.throws(() => parseVerificationArgs([]), /--site/);
  assert.throws(() => parseVerificationArgs(["--site", "site-a", "--days", "0"]), /1 and 180/);
  assert.throws(() => parseVerificationArgs(["--site", "site-a", "--days", "28", "--user", "owner"]), /Unknown argument/);
});

test("verifies provider and stored totals for the current property over the stored range", async () => {
  const lines: string[] = [];
  const range = { startDate: "2026-08-16", endDate: "2026-09-12" };
  const exitCode = await runVerification(["--site", "site-a", "--days", "28"], {
    findSite: async (siteId) => {
      assert.equal(siteId, "site-a");
      return {
        id: "site-a",
        userId: "owner-a",
        gscProperty: "sc-domain:current.example",
        gscSearchType: "web",
      };
    },
    getStoredRange: async (siteId, days) => {
      assert.deepEqual([siteId, days], ["site-a", 28]);
      return range;
    },
    fetchReport: async (userId, property, requestedRange, kind, options) => {
      assert.deepEqual(
        { userId, property, requestedRange, kind, options },
        {
          userId: "owner-a",
          property: "sc-domain:current.example",
          requestedRange: range,
          kind: "dailyTotal",
          options: { type: "web", dataState: "final" },
        }
      );
      return {
        kind: "dailyTotal",
        complete: true,
        pagesFetched: 1,
        truncatedAt: null,
        rows: [
          { date: "2026-08-16", clicks: 4, impressions: 40, ctr: 0.1, position: 2 },
          { date: "2026-09-12", clicks: 6, impressions: 60, ctr: 0.1, position: 4 },
        ],
      };
    },
    getStoredRows: async (scope) => {
      assert.deepEqual(scope, {
        siteId: "site-a",
        property: "sc-domain:current.example",
        searchType: "web",
        range,
      });
      return [
        { clicks: 4, impressions: 40, position: 2 },
        { clicks: 6, impressions: 60, position: 4 },
      ];
    },
    writeLine: (line) => lines.push(line),
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(JSON.parse(lines[0]), {
    siteId: "site-a",
    property: "sc-domain:current.example",
    searchType: "web",
    dates: range,
    sourceMetrics: { clicks: 10, impressions: 100, ctr: 0.1, position: 3.2 },
    storedMetrics: { clicks: 10, impressions: 100, ctr: 0.1, position: 3.2 },
    differences: {
      clicks: 0,
      impressions: 0,
      ctr: 0,
      position: 0,
    },
    matches: true,
  });
});

test("backfill accepts exactly one stored-site selector", () => {
  assert.deepEqual(parseBackfillArgs(["--site", "site-a"]), { siteId: "site-a", all: false });
  assert.deepEqual(parseBackfillArgs(["--all"]), { siteId: null, all: true });
  assert.throws(() => parseBackfillArgs([]), /either --site or --all/);
  assert.throws(() => parseBackfillArgs(["--site", "site-a", "--all"]), /not both/);
  assert.throws(() => parseBackfillArgs(["--user", "owner-a"]), /Unknown argument/);
});

test("backfill prints one result per stored site and fails on an active run", async () => {
  const lines: string[] = [];
  const exitCode = await runBackfill(["--all"], {
    loadTargets: async (selection) => {
      assert.deepEqual(selection, { siteId: null, all: true });
      return [
        { siteId: "site-a", userId: "owner-a" },
        { siteId: "site-b", userId: "owner-b" },
      ];
    },
    syncSite: async (userId, siteId, trigger, mode) => {
      assert.deepEqual([userId, trigger, mode], [siteId === "site-a" ? "owner-a" : "owner-b", "CLI", "backfill"]);
      return {
        status: siteId === "site-a" ? "completed" : "already-running",
        runId: siteId === "site-a" ? "run-a" : null,
        startDate: siteId === "site-a" ? "2026-06-15" : null,
        endDate: siteId === "site-a" ? "2026-09-12" : null,
        reportCounts: {
          dailyTotal: 90,
          query: 0,
          page: 0,
          queryPage: 0,
          device: 0,
          country: 0,
        },
        warnings: [],
      };
    },
    writeLine: (line) => lines.push(line),
  });

  assert.equal(exitCode, 1);
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]).siteId, "site-a");
  assert.equal(JSON.parse(lines[0]).status, "completed");
  assert.equal(JSON.parse(lines[1]).siteId, "site-b");
  assert.equal(JSON.parse(lines[1]).status, "already-running");
});
