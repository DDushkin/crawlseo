import type { DetectedFinding } from "./actions";

type Range = { startDate: string; endDate: string };
type TotalRow = { date: string; clicks: number; impressions: number };
type PageRow = TotalRow & { url: string; position: number };
type QueryRow = TotalRow & { query: string; position: number };
type DetectInput = {
  property: string; searchType: string; previous: Range; current: Range;
  totals: TotalRow[]; pages: PageRow[]; queries: QueryRow[];
};

function inRange(date: string, range: Range) { return date >= range.startDate && date <= range.endDate; }
function sums(rows: TotalRow[]) { return rows.reduce((total, row) => ({ clicks: total.clicks + row.clicks,
  impressions: total.impressions + row.impressions }), { clicks: 0, impressions: 0 }); }
function groupRows<T extends TotalRow>(rows: T[], key: (row: T) => string, range: Range) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    if (!inRange(row.date, range)) continue;
    const name = key(row);
    const group = groups.get(name) || [];
    group.push(row); groups.set(name, group);
  }
  return groups;
}

/** Only facts backed by a complete finalized GSC reporting window should be passed here. */
export function detectGscFindings(input: DetectInput): DetectedFinding[] {
  const evidenceBase = { property: input.property, searchType: input.searchType,
    previousStart: input.previous.startDate, previousEnd: input.previous.endDate,
    currentStart: input.current.startDate, currentEnd: input.current.endDate };
  const findings: DetectedFinding[] = [];
  const previousTotal = sums(input.totals.filter((row) => inRange(row.date, input.previous)));
  const currentTotal = sums(input.totals.filter((row) => inRange(row.date, input.current)));
  const lostSiteClicks = previousTotal.clicks - currentTotal.clicks;
  if (previousTotal.clicks >= 50 && lostSiteClicks >= 30 && currentTotal.clicks <= previousTotal.clicks * 0.75) {
    findings.push({ type: "SITE_TRAFFIC_DECLINE", title: "Investigate the site's search click decline",
      rationale: `GSC property clicks fell from ${previousTotal.clicks} to ${currentTotal.clicks} across two equal 28-day periods (${input.previous.startDate}–${input.previous.endDate} vs ${input.current.startDate}–${input.current.endDate}).`,
      recommendation: "Compare losing pages and queries, check indexing and recent site changes, then record the specific fix you make. Do not assume one cause from this trend alone.",
      severity: lostSiteClicks >= 100 ? "high" : "medium", confidence: "high", effort: "medium", expectedClicks: null,
      evidence: { ...evidenceBase, source: "GSC_PROPERTY_TOTAL", previousClicks: previousTotal.clicks,
        currentClicks: currentTotal.clicks, lostClicks: lostSiteClicks,
        previousImpressions: previousTotal.impressions, currentImpressions: currentTotal.impressions } });
  }

  const previousPages = groupRows(input.pages, (row) => row.url, input.previous);
  const currentPages = groupRows(input.pages, (row) => row.url, input.current);
  const pageLosses = [...previousPages].map(([url, rows]) => {
    const before = sums(rows); const after = sums(currentPages.get(url) || []);
    return { url, before, after, lost: before.clicks - after.clicks };
  }).filter((item) => item.before.clicks >= 20 && item.lost >= 15 && item.after.clicks <= item.before.clicks * 0.65)
    .sort((a, b) => b.lost - a.lost || a.url.localeCompare(b.url)).slice(0, 5);
  for (const item of pageLosses) findings.push({ type: "PAGE_TRAFFIC_DECLINE", pageUrl: item.url,
    title: "Investigate clicks lost on this page",
    rationale: `GSC page clicks fell from ${item.before.clicks} to ${item.after.clicks} (${item.lost} fewer) across two equal 28-day periods.`,
    recommendation: "Check the page's query mix, search appearance, crawl/index status, and recent edits. Improve or repair the page only after identifying the likely issue.",
    severity: item.lost >= 100 ? "high" : "medium", confidence: "high", effort: "medium", expectedClicks: null,
    evidence: { ...evidenceBase, source: "GSC_PAGE", page: item.url,
      previousClicks: item.before.clicks, currentClicks: item.after.clicks, lostClicks: item.lost,
      previousImpressions: item.before.impressions, currentImpressions: item.after.impressions } });

  const queries = [...groupRows(input.queries, (row) => row.query, input.current)].map(([query, rows]) => {
    const totals = sums(rows);
    const position = totals.impressions ? rows.reduce((sum, row) => sum + row.position * row.impressions, 0) / totals.impressions : null;
    return { query, ...totals, position };
  }).filter((row) => row.query.length <= 120 && row.impressions >= 200 && row.position !== null && row.position >= 4 && row.position <= 15)
    .sort((a, b) => b.impressions - a.impressions || a.query.localeCompare(b.query)).slice(0, 5);
  for (const row of queries) findings.push({ type: "QUERY_STRIKING_DISTANCE", query: row.query,
    title: `Review the ranking page for “${row.query}”`,
    rationale: `This query had ${row.impressions} GSC impressions, ${row.clicks} clicks, and average position ${row.position!.toFixed(1)} in ${input.current.startDate}–${input.current.endDate}.`,
    recommendation: "Review the actual ranking page and intent before deciding whether to improve its answer, internal links, or snippet. Confirm one target page in Keyword Map; do not create a competing page by default.",
    severity: row.impressions >= 1000 ? "medium" : "low", confidence: "medium", effort: "medium", expectedClicks: null,
    evidence: { ...evidenceBase, source: "GSC_QUERY", query: row.query, clicks: row.clicks,
      impressions: row.impressions, averagePosition: Number(row.position!.toFixed(2)) } });
  return findings;
}

export function chooseTodayActions<T extends { status: string; priority: number; signalActive?: boolean }>(actions: T[], limit = 3) {
  return actions.filter((action) => action.signalActive !== false && ["NEW", "PLANNED", "IN_PROGRESS"].includes(action.status))
    .sort((a, b) => b.priority - a.priority).slice(0, Math.max(0, Math.min(limit, 5)));
}
