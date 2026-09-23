import { db } from "@/lib/db";
import { inclusiveRangeEnding, pacificDateLabel, previousDateRange, shiftDateLabel, toDbDate } from "@/lib/gsc/date-range";
import { getV2GscReportCoverage } from "@/lib/gsc/read-model";
import { chooseTodayActions } from "./detect";
import { summarizeCitationPanel } from "./ai-visibility";

type Range = { startDate: string; endDate: string };
type Metrics = { clicks: number; impressions: number };
type WeeklyInput = {
  siteId: string; domain: string; window: { current: Range; previous: Range };
  gsc: { current: Metrics | null; previous: Metrics | null; state: "FRESH" | "PARTIAL" | "STALE" | "UNAVAILABLE" };
  ga4: { sessions: number | null; keyEvents: number | null; lastSync: string | null };
  googleAi: { impressions: number | null; days: number };
  aiPanel: { cited: number; observed: number; promptCount: number; citationRate: number | null; observedAt: string } | null;
  technical: { newCount: number; resolvedCount: number; comparedAt: string } | null;
  placements: { spentUah: number; published: number };
  provider: { spentUsd: number };
  actions: { id: string; title: string; status: string; priority: number; signalActive: boolean }[];
  completed: number; pendingOutcomes: number; observedOutcomes: number;
};

export function weeklyWindow(now = new Date()) {
  const endDate = shiftDateLabel(pacificDateLabel(now), -2);
  return weeklyWindowForEnd(endDate);
}

export function weeklyWindowForEnd(endDate: string) {
  const date = new Date(`${endDate}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== endDate) {
    throw new Error("Invalid report date");
  }
  const current = inclusiveRangeEnding(endDate, 7);
  return { current, previous: previousDateRange(current) };
}

export function weeklyGscEvidenceState(enabled: boolean, coverage: Range | null,
  window: { current: Range; previous: Range }, now: Date): "FRESH" | "PARTIAL" | "STALE" | "UNAVAILABLE" {
  if (!enabled || !coverage) return "UNAVAILABLE";
  if (coverage.startDate > window.previous.startDate || coverage.endDate < window.current.endDate) return "PARTIAL";
  return window.current.endDate < shiftDateLabel(pacificDateLabel(now), -4) ? "STALE" : "FRESH";
}

export function buildWeeklyReport(input: WeeklyInput) {
  const before = input.gsc.previous;
  const after = input.gsc.current;
  const clickDelta = before && after ? after.clicks - before.clicks : null;
  const changePct = before && after && before.clicks > 0 ? Math.round((after.clicks - before.clicks) / before.clicks * 1000) / 10 : null;
  return { siteId: input.siteId, domain: input.domain, window: input.window,
    search: { source: "GSC_PROPERTY_TOTAL" as const, state: input.gsc.state,
      clicks: after?.clicks ?? null, impressions: after?.impressions ?? null,
      previousClicks: before?.clicks ?? null, previousImpressions: before?.impressions ?? null,
      clickDelta, changePct },
    ga4: { source: "GA4_KNOWN_AI_REFERRERS" as const, ...input.ga4 },
    googleAi: { source: "GSC_GENERATIVE_AI_EXPORT" as const, ...input.googleAi },
    aiPanel: input.aiPanel ? { source: "DATAFORSEO_CHATGPT_SAMPLE" as const, ...input.aiPanel } : null,
    technical: input.technical, placements: input.placements, provider: input.provider,
    work: { completed: input.completed, pendingOutcomes: input.pendingOutcomes, observedOutcomes: input.observedOutcomes },
    nextActions: chooseTodayActions(input.actions),
    qualifications: [
      "GSC property totals are actual Web search metrics; query/page tables are not substituted for them.",
      "GA4 AI referrals include only identifiable referrers and are not GSC clicks.",
      "Google AI impressions are included in GSC Web totals; do not add them to search impressions.",
      "Citation rate is a fixed prompt sample, not real user prompt volume or a population visibility rate.",
      "Published placement cost is recorded UAH commitment, not a verified payment date or attributed SEO return.",
    ] };
}

export async function loadWeeklyReport(siteId: string, now = new Date(), endDate?: string) {
  const site = await db.site.findUnique({ where: { id: siteId }, select: { domain: true, gscProperty: true, gscSearchType: true,
    gscDataVersion: true, ga4PropertyId: true, lastGa4SyncAt: true } });
  if (!site) throw new Error("Site not found");
  const latestCalendarEnd = weeklyWindow(now).current.endDate;
  if (endDate && endDate > latestCalendarEnd) throw new Error("Report week has not finalized");
  let selectedEnd = endDate ?? latestCalendarEnd;
  if (!endDate && site.gscProperty && site.gscDataVersion === 2) {
    const coverage = await getV2GscReportCoverage({ siteId, property: site.gscProperty, searchType: site.gscSearchType }, "dailyTotal");
    if (coverage && coverage.endDate < selectedEnd && coverage.endDate >= shiftDateLabel(pacificDateLabel(now), -4)) {
      selectedEnd = coverage.endDate;
    }
  }
  const window = weeklyWindowForEnd(selectedEnd);
  const startDate = toDbDate(window.previous.startDate);
  const endDbDate = toDbDate(window.current.endDate);
  const endInstant = new Date(`${window.current.endDate}T23:59:59.999Z`);
  const currentDate = { gte: toDbDate(window.current.startDate), lte: endDbDate };
  const gscScope = site.gscProperty ? { siteId, property: site.gscProperty, searchType: site.gscSearchType } : null;
  const ga4Ready = !!site.lastGa4SyncAt && pacificDateLabel(site.lastGa4SyncAt) >= shiftDateLabel(window.current.endDate, 2) &&
    window.current.startDate >= shiftDateLabel(pacificDateLabel(site.lastGa4SyncAt), -91);
  const gscEnabled = !!gscScope && site.gscDataVersion === 2 && process.env.GSC_READ_MODEL_V2 !== "false";
  const gscCoverage = gscEnabled && gscScope ? await getV2GscReportCoverage(gscScope, "dailyTotal") : null;
  const gscState = weeklyGscEvidenceState(gscEnabled, gscCoverage, window, now);
  const gscComplete = gscState === "FRESH" || gscState === "STALE";
  const [gscRows, aiDays, aiReferrals, comparison, placements, provider, actions, completed, pendingOutcomes, observedOutcomes, latestPanel] = await Promise.all([
    gscComplete && gscScope ? db.gscDailyTotal.findMany({ where: { ...gscScope, date: { gte: startDate, lte: endDbDate }, syncRun: { property: gscScope.property } },
      select: { date: true, clicks: true, impressions: true } }) : [],
    site.gscProperty ? db.gscAiDaily.findMany({ where: { siteId, property: site.gscProperty, date: currentDate }, select: { date: true, impressions: true } }) : [],
    ga4Ready ? db.aiReferralDaily.findMany({ where: { siteId, date: currentDate }, select: { sessions: true, keyEvents: true } }) : [],
    db.crawlComparison.findFirst({ where: { siteId, comparedAt: { gte: toDbDate(window.current.startDate), lte: endInstant } },
      orderBy: { comparedAt: "desc" }, select: { newCount: true, resolvedCount: true, comparedAt: true } }),
    db.placement.findMany({ where: { siteId, status: "PUBLISHED", publishedAt: currentDate }, select: { costUah: true, feeUah: true } }),
    db.dataForSeoRun.aggregate({ where: { siteId, createdAt: { gte: toDbDate(window.current.startDate), lte: endInstant }, mode: "LIVE" },
      _sum: { chargedUsd: true } }),
    db.seoAction.findMany({ where: { siteId }, orderBy: { priority: "desc" }, take: 100,
      select: { id: true, title: true, status: true, priority: true, signalActive: true } }),
    db.seoChange.count({ where: { siteId, changedAt: currentDate } }),
    db.seoChange.count({ where: { siteId, outcome: { is: null } } }),
    db.seoOutcome.count({ where: { siteId, status: "OBSERVED", evaluatedAt: { gte: toDbDate(window.current.startDate), lte: endInstant } } }),
    db.aiVisibilityRun.findFirst({ where: { siteId, mode: "LIVE", status: { in: ["COMPLETE", "PARTIAL"] }, finishedAt: { lte: endInstant } },
      orderBy: { startedAt: "desc" }, include: { results: { select: { status: true, siteCited: true } } } }),
  ]);
  function totals(range: Range): Metrics {
    return gscRows.filter((row) => { const date = row.date.toISOString().slice(0, 10); return date >= range.startDate && date <= range.endDate; })
      .reduce((sum, row) => ({ clicks: sum.clicks + row.clicks, impressions: sum.impressions + row.impressions }), { clicks: 0, impressions: 0 });
  }
  const aiSummary = latestPanel ? summarizeCitationPanel({ mode: latestPanel.mode, promptCount: latestPanel.promptCount,
    results: latestPanel.results.map((result) => ({ ...result, sources: [] })) }) : null;
  return buildWeeklyReport({ siteId, domain: site.domain, window,
    gsc: { current: gscComplete ? totals(window.current) : null, previous: gscComplete ? totals(window.previous) : null,
      state: gscState },
    ga4: { sessions: ga4Ready ? aiReferrals.reduce((sum, row) => sum + row.sessions, 0) : null,
      keyEvents: ga4Ready ? aiReferrals.reduce((sum, row) => sum + row.keyEvents, 0) : null,
      lastSync: site.lastGa4SyncAt?.toISOString() ?? null },
    googleAi: { impressions: aiDays.length === 7 ? aiDays.reduce((sum, row) => sum + row.impressions, 0) : null, days: aiDays.length },
    aiPanel: latestPanel && aiSummary ? { cited: aiSummary.cited, observed: aiSummary.observed,
      promptCount: aiSummary.promptCount, citationRate: aiSummary.citationRate,
      observedAt: latestPanel.finishedAt?.toISOString() ?? latestPanel.startedAt.toISOString() } : null,
    technical: comparison ? { newCount: comparison.newCount, resolvedCount: comparison.resolvedCount,
      comparedAt: comparison.comparedAt.toISOString() } : null,
    placements: { spentUah: Math.round(placements.reduce((sum, row) => sum + row.costUah + row.feeUah, 0) * 100) / 100,
      published: placements.length }, provider: { spentUsd: provider._sum.chargedUsd ?? 0 },
    actions, completed, pendingOutcomes, observedOutcomes });
}
