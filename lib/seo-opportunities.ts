import { previousDateRange } from "@/lib/gsc/date-range";
import { getTopKeywords, getTopPages, getStoredGscRange, getGscPageMetricsForRange, getGscQueryPageRows, hasCompleteGscReportCoverage, type KeywordRow } from "@/lib/seo-metrics";

function hasKnownMetrics(row: KeywordRow): row is KeywordRow & { position: number; ctr: number } {
  return row.position !== null && row.ctr !== null;
}

/** Expected CTR curve (rough industry averages by position). */
function expectedCtr(position: number): number {
  if (position <= 1) return 0.28;
  if (position <= 2) return 0.15;
  if (position <= 3) return 0.11;
  if (position <= 5) return 0.07;
  if (position <= 10) return 0.03;
  if (position <= 20) return 0.01;
  return 0.005;
}

export type Opportunity = {
  type: "striking_distance" | "low_ctr" | "content_decay" | "cannibalization";
  title: string;
  detail: string;
  query?: string;
  url?: string;
  metric?: number;
  severity: "high" | "medium" | "low";
};

export async function getStrikingDistance(siteId: string, limit = 25) {
  const range = await getStoredGscRange(siteId, 28);
  if (!range || !await hasCompleteGscReportCoverage(siteId, "query", range)) return [];
  const keywords = await getTopKeywords(siteId, 28, 200);
  return keywords
    .filter(hasKnownMetrics)
    .filter((k) => k.position >= 4 && k.position <= 20 && k.impressions >= 20)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, limit)
    .map((k) => ({
      query: k.query,
      position: k.position,
      clicks: k.clicks,
      impressions: k.impressions,
      ctr: k.ctr,
      potential: Math.round(k.impressions * expectedCtr(Math.max(1, k.position - 3))),
    }));
}

export async function getLowCtrOpportunities(siteId: string, limit = 25) {
  const range = await getStoredGscRange(siteId, 28);
  if (!range || !await hasCompleteGscReportCoverage(siteId, "query", range)) return [];
  const keywords = await getTopKeywords(siteId, 28, 200);
  return keywords
    .filter(hasKnownMetrics)
    .filter((k) => k.impressions >= 50 && k.position <= 15)
    .map((k) => {
      const exp = expectedCtr(k.position);
      const gap = exp - k.ctr;
      return { ...k, expectedCtr: exp, ctrGap: gap };
    })
    .filter((k) => k.ctrGap > 0.02)
    .sort((a, b) => b.impressions * b.ctrGap - a.impressions * a.ctrGap)
    .slice(0, limit);
}

export async function getContentDecay(siteId: string, limit = 20) {
  const current = await getStoredGscRange(siteId, 28);
  if (!current) return [];
  const previous = previousDateRange(current);
  if (!await hasCompleteGscReportCoverage(siteId, "page", { startDate: previous.startDate, endDate: current.endDate })) return [];

  const [currPages, prevPages] = await Promise.all([
    getGscPageMetricsForRange(siteId, current),
    getGscPageMetricsForRange(siteId, previous),
  ]);

  const curr = new Map<string, number>();
  const prev = new Map<string, number>();
  for (const p of currPages) curr.set(p.url, (curr.get(p.url) || 0) + p.clicks);
  for (const p of prevPages) prev.set(p.url, (prev.get(p.url) || 0) + p.clicks);

  const rows: {
    url: string;
    currentClicks: number;
    previousClicks: number;
    changePct: number;
  }[] = [];

  for (const [url, previousClicks] of prev) {
    if (previousClicks < 10) continue;
    const currentClicks = curr.get(url) || 0;
    const changePct = ((currentClicks - previousClicks) / previousClicks) * 100;
    if (changePct <= -25) {
      rows.push({ url, currentClicks, previousClicks, changePct });
    }
  }

  return rows.sort((a, b) => a.changePct - b.changePct).slice(0, limit);
}

export async function getCannibalization(siteId: string, limit = 20) {
  const r = await getStoredGscRange(siteId, 28);
  if (!r) return [];
  if (!await hasCompleteGscReportCoverage(siteId, "queryPage", r)) return [];
  const rows = await getGscQueryPageRows(siteId, r);

  type Agg = {
    page: string;
    clicks: number;
    impressions: number;
    weightedPos: number;
    positionWeight: number;
  };
  const byQuery = new Map<string, Map<string, Agg>>();

  for (const row of rows) {
    if (!row.url) continue;
    if (!byQuery.has(row.query)) byQuery.set(row.query, new Map());
    const pages = byQuery.get(row.query)!;
    const cur = pages.get(row.url) || {
      page: row.url,
      clicks: 0,
      impressions: 0,
      weightedPos: 0,
      positionWeight: 0,
    };
    cur.clicks += row.clicks;
    cur.impressions += row.impressions;
    if (row.position !== null && row.impressions > 0) {
      cur.weightedPos += row.position * row.impressions;
      cur.positionWeight += row.impressions;
    }
    pages.set(row.url, cur);
  }

  const result: {
    query: string;
    pages: { url: string; clicks: number; impressions: number; position: number | null }[];
  }[] = [];

  for (const [query, pages] of byQuery) {
    if (pages.size < 2) continue;
    const list = [...pages.values()]
      .map((p) => ({
        url: p.page,
        clicks: p.clicks,
        impressions: p.impressions,
        position: p.positionWeight > 0 ? p.weightedPos / p.positionWeight : null,
      }))
      .sort((a, b) => b.impressions - a.impressions);
    if (list[0].impressions < 20) continue;
    result.push({ query, pages: list.slice(0, 5) });
  }

  return result
    .sort(
      (a, b) =>
        b.pages.reduce((s, p) => s + p.impressions, 0) -
        a.pages.reduce((s, p) => s + p.impressions, 0)
    )
    .slice(0, limit);
}

export async function getAllOpportunities(siteId: string) {
  const [striking, lowCtr, decay, cannibal] = await Promise.all([
    getStrikingDistance(siteId, 15),
    getLowCtrOpportunities(siteId, 15),
    getContentDecay(siteId, 15),
    getCannibalization(siteId, 15),
  ]);

  const items: Opportunity[] = [];

  for (const k of striking.slice(0, 8)) {
    items.push({
      type: "striking_distance",
      title: k.query,
      detail: `Position ${k.position.toFixed(1)} · ${k.impressions.toLocaleString()} impressions · push into top 3`,
      query: k.query,
      metric: k.impressions,
      severity: k.impressions > 200 ? "high" : "medium",
    });
  }

  for (const k of lowCtr.slice(0, 8)) {
    items.push({
      type: "low_ctr",
      title: k.query,
      detail: `CTR ${(k.ctr * 100).toFixed(1)}% vs ~${(k.expectedCtr * 100).toFixed(0)}% expected at pos ${k.position.toFixed(1)} — rewrite title/meta`,
      query: k.query,
      metric: k.impressions,
      severity: k.ctrGap > 0.05 ? "high" : "medium",
    });
  }

  for (const p of decay.slice(0, 6)) {
    items.push({
      type: "content_decay",
      title: p.url,
      detail: `Clicks ${p.previousClicks} → ${p.currentClicks} (${p.changePct.toFixed(0)}%) vs prior 28 days`,
      url: p.url,
      metric: p.changePct,
      severity: p.changePct < -50 ? "high" : "medium",
    });
  }

  for (const c of cannibal.slice(0, 6)) {
    items.push({
      type: "cannibalization",
      title: c.query,
      detail: `${c.pages.length} landing pages competing · top: ${c.pages[0]?.url}`,
      query: c.query,
      severity: "medium",
    });
  }

  return {
    summary: {
      strikingDistance: striking.length,
      lowCtr: lowCtr.length,
      contentDecay: decay.length,
      cannibalization: cannibal.length,
    },
    striking,
    lowCtr,
    decay,
    cannibal,
    feed: items,
  };
}

export async function exportKeywordsCsv(siteId: string): Promise<string> {
  const rows = await getTopKeywords(siteId, 28, 500);
  const header = "query,position,clicks,impressions,ctr";
  const lines = rows.map(
    (r) =>
      `"${r.query.replace(/"/g, '""')}",${r.position === null ? "" : r.position.toFixed(2)},${r.clicks},${r.impressions},${r.ctr === null ? "" : `${(r.ctr * 100).toFixed(3)}%`}`
  );
  return [header, ...lines].join("\n");
}

export async function exportPagesCsv(siteId: string): Promise<string> {
  const rows = await getTopPages(siteId, 28, 500);
  const header = "url,position,clicks,impressions,ctr";
  const lines = rows.map(
    (r) =>
      `"${r.url.replace(/"/g, '""')}",${r.position === null ? "" : r.position.toFixed(2)},${r.clicks},${r.impressions},${r.ctr === null ? "" : `${(r.ctr * 100).toFixed(3)}%`}`
  );
  return [header, ...lines].join("\n");
}
