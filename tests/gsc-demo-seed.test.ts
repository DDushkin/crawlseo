import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

type SeedRow = { siteId: string; searchType: string; date: Date; clicks: number; impressions: number; ctr: number; position: number; query?: string; url?: string; device?: string; country?: string };

test("demo seed writes six coherent V2 grains, keeps legacy data and marks only its completed site ready", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-15T01:00:00.000Z") });
  const require = createRequire(import.meta.url);
  const writes = new Map<string, SeedRow[]>();
  const markers: unknown[] = [];
  const events: string[] = [];
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => { finish = resolve; });
  const fake = Object.fromEntries([
    "keyword", "page", "gscDailyTotal", "gscQueryDaily", "gscPageDaily", "gscQueryPageDaily", "gscDeviceDaily", "gscCountryDaily", "savedKeyword", "crawl", "auditPage", "crawlIssue", "auditLink", "vitalsReport", "alert",
  ].map((name) => [name, {
    create: async ({ data }: { data: SeedRow }) => { writes.set(name, [...(writes.get(name) ?? []), data]); events.push(name); return { id: `${name}-id`, ...data }; },
    createMany: async ({ data }: { data: SeedRow[] }) => { writes.set(name, [...(writes.get(name) ?? []), ...data]); events.push(name); return { count: data.length }; },
  }]));
  Object.assign(fake, {
    user: { findFirst: async () => ({ id: "owner", email: "demo@example.com" }) },
    site: {
      findMany: async () => [],
      create: async ({ data }: { data: Record<string, unknown> }) => { markers.push({ create: data }); return { id: "demo-site", ...data }; },
      update: async (input: unknown) => { markers.push(input); events.push("ready"); return {}; },
    },
    $disconnect: async () => finish(),
  });
  const prismaPath = require.resolve("@prisma/client");
  const original = require.cache[prismaPath];
  require.cache[prismaPath] = { exports: { PrismaClient: class { constructor() { return fake; } } } } as NodeModule;
  t.after(() => { if (original) require.cache[prismaPath] = original; else delete require.cache[prismaPath]; });
  t.mock.method(console, "log", () => {});
  t.mock.method(Math, "random", () => 0.5);
  require("../scripts/seed-demo");
  await finished;

  const totals = writes.get("gscDailyTotal") ?? [];
  assert.equal(totals.length, 28);
  // At 01:00 UTC the Pacific calendar is still September 14: minus three days is September 11.
  const labels = totals.map((row) => row.date.toISOString().slice(0, 10)).sort();
  assert.equal(labels.at(-1), "2026-09-11");
  assert.equal(labels[0], "2026-08-15");
  assert.equal(writes.get("keyword")?.length, 1400);
  assert.equal(writes.get("page")?.length, 560);
  assert.equal(new Set(totals.map((row) => row.date.toISOString())).size, 28);
  for (const [table, count] of [["gscQueryDaily", 1400], ["gscPageDaily", 560], ["gscQueryPageDaily", 2800], ["gscDeviceDaily", 56], ["gscCountryDaily", 56]] as const) {
    const rows = writes.get(table)!;
    assert.equal(rows.length, count);
    assert.equal(new Set(rows.map((row) => JSON.stringify([row.siteId, row.searchType, row.date, row.query, row.url, row.device, row.country]))).size, count);
  }
  for (const total of totals) {
    assert.equal(total.siteId, "demo-site");
    assert.equal(total.searchType, "web");
    assert.equal(total.date.toISOString().slice(11), "00:00:00.000Z");
    for (const table of ["gscQueryDaily", "gscPageDaily", "gscQueryPageDaily", "gscDeviceDaily", "gscCountryDaily"]) {
      const rows = (writes.get(table) ?? []).filter((row) => row.date.getTime() === total.date.getTime());
      assert.ok(rows.length > 0, table);
      assert.equal(rows.reduce((sum, row) => sum + row.clicks, 0), total.clicks, `${table} clicks`);
      assert.equal(rows.reduce((sum, row) => sum + row.impressions, 0), total.impressions, `${table} impressions`);
      assert.ok(Math.abs(rows.reduce((sum, row) => sum + row.position * row.impressions, 0) / total.impressions - total.position) < 1e-10);
      for (const row of rows) {
        assert.equal(row.siteId, "demo-site"); assert.equal(row.searchType, "web");
        assert.ok(row.clicks >= 0 && row.clicks <= row.impressions);
        assert.equal(row.ctr, row.clicks / row.impressions);
      }
    }
    const mappings = writes.get("gscQueryPageDaily")!.filter((row) => row.date.getTime() === total.date.getTime());
    for (const [table, dimension] of [["gscQueryDaily", "query"], ["gscPageDaily", "url"]] as const) {
      for (const row of writes.get(table)!.filter((row) => row.date.getTime() === total.date.getTime())) {
        const matching = mappings.filter((mapping) => mapping[dimension] === row[dimension]);
        assert.equal(matching.reduce((sum, mapping) => sum + mapping.clicks, 0), row.clicks);
        assert.equal(matching.reduce((sum, mapping) => sum + mapping.impressions, 0), row.impressions);
      }
    }
  }
  const updates = markers.filter((entry) => "where" in (entry as object)) as { where: unknown; data: { gscDataVersion: number; gscSearchType: string; lastGscSyncAt: Date } }[];
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].where, { id: "demo-site" });
  assert.equal(updates[0].data.gscDataVersion, 2);
  assert.equal(updates[0].data.gscSearchType, "web");
  assert.ok(updates[0].data.lastGscSyncAt instanceof Date);
  assert.equal(updates[0].data.lastGscSyncAt.toISOString(), "2026-09-15T01:00:00.000Z");
  for (const table of ["gscDailyTotal", "gscQueryDaily", "gscPageDaily", "gscQueryPageDaily", "gscDeviceDaily", "gscCountryDaily"]) {
    assert.ok(events.lastIndexOf(table) < events.indexOf("ready"));
  }
});
