import { pathToFileURL } from "node:url";

import { db } from "../lib/db";
import { syncGscSite, type GscSyncResult } from "../lib/gsc/sync-service";

export type BackfillSelection = { siteId: string | null; all: boolean };
type BackfillTarget = { siteId: string; userId: string };
type BackfillDependencies = {
  loadTargets(selection: BackfillSelection): Promise<BackfillTarget[]>;
  syncSite(
    userId: string,
    siteId: string,
    trigger: "CLI",
    mode: "backfill"
  ): Promise<GscSyncResult>;
  writeLine(line: string): void;
};

function optionValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`);
  return value;
}

export function parseBackfillArgs(args: string[]): BackfillSelection {
  let siteId: string | null = null;
  let all = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--site") {
      if (siteId !== null) throw new Error("--site may only be provided once");
      siteId = optionValue(args, index, "--site");
      index += 1;
    } else if (argument === "--all") {
      if (all) throw new Error("--all may only be provided once");
      all = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (siteId && all) throw new Error("Choose --site or --all, not both");
  if (!siteId && !all) throw new Error("Choose either --site or --all");
  return { siteId, all };
}

async function loadStoredTargets(selection: BackfillSelection): Promise<BackfillTarget[]> {
  if (selection.siteId) {
    const site = await db.site.findUnique({
      where: { id: selection.siteId },
      select: { id: true, userId: true, gscProperty: true, gscSearchType: true },
    });
    if (!site) throw new Error(`Site not found: ${selection.siteId}`);
    if (!site.gscProperty) throw new Error(`Site has no connected GSC property: ${site.id}`);
    if (site.gscSearchType !== "web") throw new Error(`Unsupported GSC search type: ${site.gscSearchType}`);
    return [{ siteId: site.id, userId: site.userId }];
  }

  const sites = await db.site.findMany({
    where: { gscProperty: { not: null }, gscSearchType: "web" },
    select: { id: true, userId: true },
    orderBy: { id: "asc" },
  });
  return sites.map((site) => ({ siteId: site.id, userId: site.userId }));
}

const defaultDependencies: BackfillDependencies = {
  loadTargets: loadStoredTargets,
  syncSite: syncGscSite,
  writeLine: (line) => console.log(line),
};

export async function runBackfill(
  args: string[],
  dependencies: BackfillDependencies = defaultDependencies
): Promise<number> {
  const selection = parseBackfillArgs(args);
  const targets = await dependencies.loadTargets(selection);
  let failed = false;

  for (const target of targets) {
    try {
      const result = await dependencies.syncSite(target.userId, target.siteId, "CLI", "backfill");
      dependencies.writeLine(JSON.stringify({ siteId: target.siteId, ...result }));
      if (result.status === "failed" || result.status === "already-running") failed = true;
    } catch {
      failed = true;
      dependencies.writeLine(JSON.stringify({
        siteId: target.siteId,
        status: "failed",
        error: { code: "PROVIDER_ERROR", message: "GSC backfill failed." },
      }));
    }
  }

  return failed ? 1 : 0;
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  try {
    process.exitCode = await runBackfill(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "GSC backfill failed");
    process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
