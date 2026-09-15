import assert from "node:assert/strict";
import test from "node:test";

import {
  dimensionsForReport,
  GscApiError,
  paginateGscReport,
  probeFinalizedCoverage,
  querySearchAnalyticsPage,
} from "../lib/google/gsc-client";

test("maps each report to an independent dimension set", () => {
  assert.deepEqual(dimensionsForReport("dailyTotal"), ["date"]);
  assert.deepEqual(dimensionsForReport("query"), ["date", "query"]);
  assert.deepEqual(dimensionsForReport("page"), ["date", "page"]);
  assert.deepEqual(dimensionsForReport("queryPage"), ["date", "query", "page"]);
  assert.deepEqual(dimensionsForReport("device"), ["date", "device"]);
  assert.deepEqual(dimensionsForReport("country"), ["date", "country"]);
});

test("paginates until a short page and preserves unrounded provider metrics", async () => {
  const starts: number[] = [];
  const result = await paginateGscReport(
    { kind: "query", rowLimit: 2, maxRows: 10 },
    async (startRow) => {
      starts.push(startRow);
      return startRow === 0
        ? {
            rows: [
              { keys: ["2026-09-10", "strum"], clicks: 3, impressions: 7, ctr: 3 / 7, position: 1.23456 },
              { keys: ["2026-09-10", "strum ua"], clicks: 1, impressions: 9, ctr: 1 / 9, position: 5.67891 },
            ],
          }
        : {
            rows: [
              { keys: ["2026-09-11", "strum"], clicks: 4, impressions: 8, ctr: 0.5, position: 1.11111 },
            ],
          };
    }
  );
  assert.deepEqual(starts, [0, 2]);
  assert.deepEqual(result.rows[0], {
    date: "2026-09-10",
    query: "strum",
    url: undefined,
    device: undefined,
    country: undefined,
    clicks: 3,
    impressions: 7,
    ctr: 3 / 7,
    position: 1.23456,
  });
  assert.equal(result.complete, true);
  assert.equal(result.truncatedAt, null);
  assert.equal(result.pagesFetched, 2);
});

test("marks the report truncated at the application safety cap", async () => {
  const result = await paginateGscReport(
    { kind: "dailyTotal", rowLimit: 2, maxRows: 2 },
    async () => ({
      rows: [
        { keys: ["2026-09-10"], clicks: 1, impressions: 2, ctr: 0.5, position: 3 },
        { keys: ["2026-09-11"], clicks: 2, impressions: 4, ctr: 0.5, position: 4 },
      ],
    })
  );
  assert.equal(result.complete, false);
  assert.equal(result.truncatedAt, 2);
  assert.equal(result.pagesFetched, 1);
});

test("emits an explicit Search Analytics payload", async (t) => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  let requestedInit: RequestInit | undefined;
  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    requestedInit = init;
    return new Response(JSON.stringify({ rows: [] }), { status: 200 });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await querySearchAnalyticsPage("access-token", {
    siteUrl: "sc-domain:example.com",
    range: { startDate: "2026-09-01", endDate: "2026-09-10" },
    dimensions: ["date", "query"],
    type: "web",
    dataState: "final",
    rowLimit: 500,
    startRow: 1_000,
  });

  assert.equal(
    requestedUrl,
    "https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Aexample.com/searchAnalytics/query"
  );
  assert.equal(requestedInit?.method, "POST");
  assert.deepEqual(requestedInit?.headers, {
    Authorization: "Bearer access-token",
    "Content-Type": "application/json",
  });
  assert.deepEqual(JSON.parse(String(requestedInit?.body)), {
    startDate: "2026-09-01",
    endDate: "2026-09-10",
    dimensions: ["date", "query"],
    type: "web",
    dataState: "final",
    rowLimit: 500,
    startRow: 1_000,
  });
});

test("surfaces sanitized Search Analytics provider failures", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: { code: 403, message: "secret provider detail" } }), {
      status: 403,
    });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await assert.rejects(
    querySearchAnalyticsPage("access-token", {
      siteUrl: "https://example.com/",
      range: { startDate: "2026-09-01", endDate: "2026-09-10" },
      dimensions: ["date"],
      type: "web",
      dataState: "final",
      rowLimit: 1,
      startRow: 0,
    }),
    (error: unknown) => {
      assert.ok(error instanceof GscApiError);
      assert.equal(error.status, 403);
      assert.equal(error.code, 403);
      assert.equal(error.message.includes("secret provider detail"), false);
      return true;
    }
  );
});

test("uses the first incomplete date to find finalized coverage", async (t) => {
  const originalFetch = globalThis.fetch;
  let payload: Record<string, unknown> | undefined;
  globalThis.fetch = async (_input, init) => {
    payload = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        rows: [
          { keys: ["2026-09-14"], clicks: 1, impressions: 2, ctr: 0.5, position: 3 },
        ],
        metadata: { first_incomplete_date: "2026-09-13" },
      }),
      { status: 200 }
    );
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const coverage = await probeFinalizedCoverage("access-token", "sc-domain:example.com", {
    now: new Date("2026-09-15T08:30:00.000Z"),
  });

  assert.deepEqual(payload, {
    startDate: "2026-09-02",
    endDate: "2026-09-15",
    dimensions: ["date"],
    type: "web",
    dataState: "all",
    rowLimit: 25_000,
    startRow: 0,
  });
  assert.deepEqual(coverage, { finalizedThrough: "2026-09-12", source: "metadata" });
});

test("uses a conservative fallback when coverage has neither rows nor metadata", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ rows: [] }), { status: 200 });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const coverage = await probeFinalizedCoverage("access-token", "sc-domain:example.com", {
    now: new Date("2026-09-15T08:30:00.000Z"),
  });

  assert.deepEqual(coverage, {
    finalizedThrough: "2026-09-12",
    source: "conservative-fallback",
  });
});
