import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { db } from "../../lib/db";
import { GSC_REPORT_KINDS } from "../../lib/gsc/types";
import type { Prisma } from "@prisma/client";

type RecordRow = Record<string, unknown>;
type Query = { where?: RecordRow; orderBy?: RecordRow; data?: RecordRow };

export function intercept(t: TestContext, target: object, key: string, value: unknown) {
  const original = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { configurable: true, value });
  t.after(() => { if (original) Object.defineProperty(target, key, original); else Reflect.deleteProperty(target, key); });
}

/** Only the database boundary is replaced; sync, transactions, readers and detectors run real code. */
export function coverageDatabase(t: TestContext) {
  const tables: Record<string, RecordRow[]> = { coverage: [], runs: [], leases: [] };
  const site: RecordRow = { id: "site", userId: "owner", domain: "example.com", gscProperty: "sc-domain:example.com", gscLegacyProperty: "sc-domain:example.com", gscDataVersion: 2, gscSearchType: "web", gscSyncLease: null };
  let transaction = false;
  let fenced = false;
  const flag = process.env.GSC_READ_MODEL_V2;
  delete process.env.GSC_READ_MODEL_V2;
  t.after(() => { if (flag === undefined) delete process.env.GSC_READ_MODEL_V2; else process.env.GSC_READ_MODEL_V2 = flag; });
  function matches(row: RecordRow, where: RecordRow = {}): boolean {
    return Object.entries(where).every(([key, value]) => {
      if (value === undefined) return true;
      if (key === "syncRun") return matches(tables.runs.find((run) => run.id === row.syncRunId) ?? {}, value as RecordRow);
      if (value && typeof value === "object" && !(value instanceof Date)) {
        const filter = value as { in?: unknown[]; gte?: Date; lte?: Date; gt?: Date };
        if (filter.in) return filter.in.includes(row[key]);
        const date = row[key] as Date;
        return (!filter.gte || date >= filter.gte) && (!filter.lte || date <= filter.lte) && (!filter.gt || date > filter.gt);
      }
      return row[key] === value;
    });
  }
  function delegate(name: string, target: object) {
    tables[name] ??= [];
    const selected = ({ where, orderBy }: Query) => {
      const rows = tables[name].filter((row) => matches(row, where));
      const order = Object.entries(orderBy ?? {})[0];
      if (order) rows.sort((a, b) => (Number(a[order[0]]) - Number(b[order[0]])) * (order[1] === "desc" ? -1 : 1));
      return rows;
    };
    intercept(t, target, "findFirst", async (query: Query) => selected(query)[0] ?? null);
    intercept(t, target, "findMany", async (query: Query) => selected(query));
    intercept(t, target, "deleteMany", async ({ where }: Query) => { tables[name] = tables[name].filter((row) => !matches(row, where)); return { count: 1 }; });
    intercept(t, target, "create", async ({ data }: { data: RecordRow }) => {
      const row = { id: `${name}-${tables[name].length}`, status: "RUNNING", ...data };
      tables[name].push(row); return row;
    });
    intercept(t, target, "createMany", async ({ data }: { data: RecordRow[] }) => { tables[name].push(...data); return { count: data.length }; });
    intercept(t, target, "update", async ({ where, data }: Query) => {
      const row = tables[name].find((item) => matches(item, where));
      assert.ok(row); Object.assign(row, data); return row;
    });
  }
  delegate("runs", db.gscSyncRun);
  delegate("leases", db.gscSyncLease);
  for (const [index, table] of [db.gscDailyTotal, db.gscQueryDaily, db.gscPageDaily, db.gscQueryPageDaily, db.gscDeviceDaily, db.gscCountryDaily].entries()) delegate(GSC_REPORT_KINDS[index], table);
  const coverage = Reflect.get(db, "gscReportCoverage") ?? {};
  if (!Reflect.get(db, "gscReportCoverage")) intercept(t, db, "gscReportCoverage", coverage);
  delegate("coverage", coverage);
  intercept(t, coverage, "upsert", async ({ where, create, update }: { where: RecordRow; create: RecordRow; update: RecordRow }) => {
    assert.equal(transaction, true, "coverage must share the replacement transaction");
    assert.equal(fenced, true, "coverage must be protected by the lease fence");
    const key = Object.values(where)[0] as RecordRow;
    let row = tables.coverage.find((value) => matches(value, key));
    if (row) Object.assign(row, update);
    else { row = { ...create }; tables.coverage.push(row); }
    return row;
  });
  intercept(t, db, "$transaction", async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
    const snapshot = structuredClone(tables);
    transaction = true; fenced = false;
    try { return await callback(db); }
    catch (error) { Object.assign(tables, snapshot); throw error; }
    finally { transaction = false; fenced = false; }
  });
  intercept(t, db.gscSyncLease, "updateMany", async ({ where, data }: Query) => {
    const lease = tables.leases.find((row) => matches(row, where));
    if (!lease) return { count: 0 };
    if (transaction) fenced = true;
    Object.assign(lease, data); return { count: 1 };
  });
  intercept(t, db.site, "findUnique", async () => site);
  intercept(t, db.site, "update", async ({ data }: Query) => Object.assign(site, data));
  intercept(t, db.gscDailyTotal, "aggregate", async ({ where }: Query) => {
    const dates = tables.dailyTotal.filter((row) => matches(row, where)).map((row) => row.date as Date).sort((a, b) => +a - +b);
    return { _min: { date: dates[0] ?? null }, _max: { date: dates.at(-1) ?? null } };
  });
  return { site, tables };
}
