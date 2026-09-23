import { pacificDateLabel } from "@/lib/gsc/date-range";

const DAY_MS = 86_400_000;

function parseDay(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("Expected YYYY-MM-DD date");
  const date = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== day) throw new Error("Invalid date");
  return date;
}

function shift(day: string, delta: number) {
  return new Date(parseDay(day).getTime() + delta * DAY_MS).toISOString().slice(0, 10);
}

export function comparisonWindow(changedAt: string, days = 28) {
  if (!Number.isInteger(days) || days < 7 || days > 90) throw new Error("Comparison period must be 7–90 days");
  parseDay(changedAt);
  return {
    baselineStart: shift(changedAt, -(days + 2)),
    baselineEnd: shift(changedAt, -3),
    afterStart: shift(changedAt, 2),
    afterEnd: shift(changedAt, days + 1),
  };
}

export function outcomeReady(afterEnd: string, asOf: string) {
  return parseDay(asOf).getTime() >= parseDay(afterEnd).getTime() + 2 * DAY_MS;
}

export function observedOutcome(input: {
  baselineClicks: number | null;
  afterClicks: number | null;
  baselineImpressions: number | null;
  afterImpressions: number | null;
}) {
  if (input.baselineClicks === null || input.afterClicks === null ||
      input.baselineImpressions === null || input.afterImpressions === null) {
    return {
      status: "UNAVAILABLE" as const, clickDelta: null, clickChangePct: null,
      impressionDelta: null, qualification: "A complete comparable GSC baseline is unavailable.",
    };
  }
  return {
    status: "OBSERVED" as const,
    clickDelta: input.afterClicks - input.baselineClicks,
    clickChangePct: input.baselineClicks > 0 ? Math.round((input.afterClicks - input.baselineClicks) / input.baselineClicks * 1000) / 10 : null,
    impressionDelta: input.afterImpressions - input.baselineImpressions,
    qualification: "The change preceded this difference; other factors may have contributed.",
  };
}

export type MetricScope = "PAGE" | "QUERY" | "PROPERTY";
export type MetricRange = { startDate: string; endDate: string };
export type MetricTotals = { clicks: number; impressions: number };
export type GscMetricReader = {
  siteScope(siteId: string): Promise<{ property: string; searchType: string } | null>;
  completeCoverage(siteId: string, report: "page" | "query" | "total", range: MetricRange): Promise<boolean>;
  sumMetrics(scope: MetricScope, siteId: string, property: string, searchType: string, key: string | null, range: MetricRange): Promise<{ clicks: number | null; impressions: number | null }>;
};

export async function readGscMetricWindow(
  siteId: string, scope: MetricScope, key: string | null, range: MetricRange, reader: GscMetricReader,
): Promise<MetricTotals | null> {
  if ((scope === "PAGE" || scope === "QUERY") && !key) return null;
  const site = await reader.siteScope(siteId);
  if (!site?.property) return null;
  const report = { PAGE: "page", QUERY: "query", PROPERTY: "total" }[scope] as "page" | "query" | "total";
  if (!await reader.completeCoverage(siteId, report, range)) return null;
  const totals = await reader.sumMetrics(scope, siteId, site.property, site.searchType, key, range);
  return { clicks: totals.clicks ?? 0, impressions: totals.impressions ?? 0 };
}

export type CompletionInput = { description: string; changedAt: string };
export type CompletionStore = {
  findAction(siteId: string, actionId: string): Promise<{ id: string; siteId: string; status: string; pageUrl: string | null; query: string | null } | null>;
  readMetrics(siteId: string, scope: MetricScope, key: string | null, range: MetricRange): Promise<MetricTotals | null>;
  saveCompletion(input: {
    siteId: string; actionId: string; description: string; changedAt: string;
    metricScope: MetricScope; metricKey: string | null;
    baselineStart: string; baselineEnd: string;
    afterStart: string; afterEnd: string;
    baselineClicks: number | null; baselineImpressions: number | null;
  }): Promise<{ id: string }>;
};

export async function completeAction(siteId: string, actionId: string, input: CompletionInput, store: CompletionStore) {
  if (!input.description?.trim() || input.description.length > 4000) throw new Error("Describe the completed change");
  const range = comparisonWindow(input.changedAt);
  if (input.changedAt > pacificDateLabel(new Date())) throw new Error("Change date cannot be in the future");
  const action = await store.findAction(siteId, actionId);
  if (!action || action.siteId !== siteId) throw new Error("Action not found");
  if (!["NEW", "PLANNED", "IN_PROGRESS"].includes(action.status)) throw new Error("Action is not ready for completion");
  const metricScope: MetricScope = action.pageUrl ? "PAGE" : action.query ? "QUERY" : "PROPERTY";
  const metricKey = action.pageUrl || action.query;
  const baseline = await store.readMetrics(siteId, metricScope, metricKey, {
    startDate: range.baselineStart, endDate: range.baselineEnd,
  });
  return store.saveCompletion({
    siteId, actionId, description: input.description.trim(), changedAt: input.changedAt,
    metricScope, metricKey,
    ...range,
    baselineClicks: baseline?.clicks ?? null,
    baselineImpressions: baseline?.impressions ?? null,
  });
}

export type PendingChange = {
  id: string; siteId: string; actionId: string;
  metricScope: MetricScope; metricKey: string | null;
  baselineStart: string; baselineEnd: string;
  afterStart: string; afterEnd: string;
  baselineClicks: number | null; baselineImpressions: number | null;
};

export type EvaluationStore = {
  listPending(siteId: string): Promise<PendingChange[]>;
  readMetrics(siteId: string, scope: MetricScope, key: string | null, range: MetricRange): Promise<MetricTotals | null>;
  saveBaseline(input: { siteId: string; actionId: string; changeId: string; baselineClicks: number; baselineImpressions: number }): Promise<unknown>;
  saveOutcome(input: {
    siteId: string; actionId: string; changeId: string;
    status: "OBSERVED" | "UNAVAILABLE";
    afterClicks: number; afterImpressions: number;
    clickDelta: number | null; clickChangePct: number | null; impressionDelta: number | null;
    qualification: string;
  }): Promise<unknown>;
};

export async function evaluateDueChanges(siteId: string, asOf: string, store: EvaluationStore) {
  parseDay(asOf);
  const changes = await store.listPending(siteId);
  let evaluated = 0;
  let pending = 0;
  for (const change of changes) {
    if (change.siteId !== siteId || !outcomeReady(change.afterEnd, asOf)) { pending++; continue; }
    let baselineClicks = change.baselineClicks;
    let baselineImpressions = change.baselineImpressions;
    if (baselineClicks === null || baselineImpressions === null) {
      const baseline = await store.readMetrics(siteId, change.metricScope, change.metricKey, {
        startDate: change.baselineStart, endDate: change.baselineEnd,
      });
      if (!baseline) { pending++; continue; }
      baselineClicks = baseline.clicks;
      baselineImpressions = baseline.impressions;
      await store.saveBaseline({ siteId, actionId: change.actionId, changeId: change.id,
        baselineClicks, baselineImpressions });
    }
    const after = await store.readMetrics(siteId, change.metricScope, change.metricKey, {
      startDate: change.afterStart, endDate: change.afterEnd,
    });
    if (!after) { pending++; continue; }
    const outcome = observedOutcome({
      baselineClicks, baselineImpressions,
      afterClicks: after.clicks, afterImpressions: after.impressions,
    });
    await store.saveOutcome({
      siteId, actionId: change.actionId, changeId: change.id,
      afterClicks: after.clicks, afterImpressions: after.impressions,
      ...outcome,
    });
    evaluated++;
  }
  return { evaluated, pending };
}
