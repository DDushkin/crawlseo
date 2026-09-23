import { parseCsvTable } from "./import";
import { pacificDateLabel, toDbDate } from "@/lib/gsc/date-range";

export function summarizeCitationPanel(input: { mode: string; promptCount: number;
  results: { status: string; siteCited: boolean; sources: { domain: string; url: string }[] }[] }) {
  const observed = input.results.filter((item) => item.status === "OBSERVED");
  const cited = observed.filter((item) => item.siteCited).length;
  const validPanel = input.mode === "LIVE" && input.promptCount > 0;
  return { promptCount: input.promptCount, observed: observed.length, cited,
    citationRate: validPanel && observed.length ? cited / observed.length : null,
    coverage: !validPanel ? "SYNTHETIC" : observed.length === input.promptCount ? "COMPLETE" : "PARTIAL" };
}

type ComparablePanel = { mode: string; status: string; locationCode: number; languageCode: string; promptCount: number;
  results: { promptFingerprint: string; status: string; siteCited: boolean }[] };

/** A trend is meaningful only when both complete runs asked the same fixed questions in the same market. */
export function compareCitationPanels(current: ComparablePanel, previous: ComparablePanel) {
  const complete = (run: ComparablePanel) => run.mode === "LIVE" && run.status === "COMPLETE" && run.promptCount > 0 &&
    run.results.length === run.promptCount && run.results.every((item) => item.status === "OBSERVED") &&
    new Set(run.results.map((item) => item.promptFingerprint)).size === run.promptCount;
  if (!complete(current) || !complete(previous) || current.promptCount !== previous.promptCount ||
      current.locationCode !== previous.locationCode || current.languageCode !== previous.languageCode) return null;
  const before = new Map(previous.results.map((item) => [item.promptFingerprint, item.siteCited]));
  if (current.results.some((item) => !before.has(item.promptFingerprint))) return null;
  return { newlyCited: current.results.filter((item) => item.siteCited && !before.get(item.promptFingerprint)).map((item) => item.promptFingerprint),
    lostCitations: current.results.filter((item) => !item.siteCited && before.get(item.promptFingerprint)).map((item) => item.promptFingerprint) };
}

/** Counts answers containing a source, not total source links or a market-wide share-of-voice. */
export function summarizeCitationSources(siteDomain: string, results: { status: string;
  sources: { domain: string; url: string }[] }[]) {
  const own = siteDomain.toLowerCase().replace(/^www\./, "");
  const citedPages = new Map<string, number>();
  const externalDomains = new Map<string, number>();
  for (const result of results) {
    if (result.status !== "OBSERVED") continue;
    const answerPages = new Set<string>();
    const answerDomains = new Set<string>();
    for (const source of result.sources) {
      try {
        const url = new URL(source.url);
        if (!['http:', 'https:'].includes(url.protocol)) continue;
        const domain = url.hostname.toLowerCase().replace(/^www\./, "");
        if (domain === own || domain.endsWith(`.${own}`)) answerPages.add(url.toString());
        else answerDomains.add(domain);
      } catch { /* Ignore an invalid provider source URL. */ }
    }
    for (const url of answerPages) citedPages.set(url, (citedPages.get(url) ?? 0) + 1);
    for (const domain of answerDomains) externalDomains.set(domain, (externalDomains.get(domain) ?? 0) + 1);
  }
  return { citedPages: [...citedPages].map(([url, answers]) => ({ url, answers })).sort((a, b) => b.answers - a.answers),
    externalDomains: [...externalDomains].map(([domain, answers]) => ({ domain, answers })).sort((a, b) => b.answers - a.answers) };
}

export function parseGscAiCsv(csv: string) {
  const table = parseCsvTable(csv);
  if (table.length < 2 || table.length > 366) throw new Error("Export must contain 1–365 daily rows");
  const headings = table[0].map((value) => value.trim().toLowerCase());
  const dateCol = headings.findIndex((value) => ["date", "дата"].includes(value));
  const impressionCol = headings.findIndex((value) => ["impressions", "покази", "показы"].includes(value));
  if (dateCol < 0 || impressionCol < 0) throw new Error("Use chart CSV with Date and Impressions columns");
  const seen = new Set<string>();
  const rows = table.slice(1).map((row, index) => {
    const date = row[dateCol]?.trim() || "";
    const value = row[impressionCol]?.trim() || "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) ||
        new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error(`Row ${index + 2}: invalid date`);
    if (seen.has(date)) throw new Error(`Duplicate date: ${date}`);
    seen.add(date);
    if (value === "~" || value === "-" || !/^\d[\d, ]*$/.test(value)) throw new Error(`Row ${index + 2}: unavailable or invalid impressions`);
    const impressions = Number(value.replace(/[ ,]/g, ""));
    if (!Number.isSafeInteger(impressions) || impressions < 0) throw new Error(`Row ${index + 2}: invalid impressions`);
    return { date, impressions };
  });
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

export function countryForDataForSeoLocation(locationCode: number) {
  return ({ 2804: "UA", 2840: "US" } as Record<number, string>)[locationCode] ?? null;
}

export function recentAiWindow(now = new Date()) {
  const pacificToday = new Date(`${pacificDateLabel(now)}T00:00:00Z`);
  const endDate = new Date(pacificToday.getTime() - 2 * 86_400_000).toISOString().slice(0, 10);
  const startDate = new Date(pacificToday.getTime() - 29 * 86_400_000).toISOString().slice(0, 10);
  return { startDate, endDate, db: { gte: toDbDate(startDate), lte: toDbDate(endDate) } };
}

export function summarizeAiWindow(rows: { date: Date; impressions: number }[], window: { startDate: string; endDate: string }) {
  const expectedDays = Math.round((Date.parse(`${window.endDate}T00:00:00Z`) - Date.parse(`${window.startDate}T00:00:00Z`)) / 86_400_000) + 1;
  const observedDays = new Set(rows.map((row) => row.date.toISOString().slice(0, 10))).size;
  const observedImpressions = rows.reduce((sum, row) => sum + row.impressions, 0);
  const state = observedDays === 0 ? "UNAVAILABLE" as const : observedDays === expectedDays ? "COMPLETE" as const : "PARTIAL" as const;
  return { state, impressions: state === "COMPLETE" ? observedImpressions : null, observedImpressions, observedDays, expectedDays };
}

/** GA4 sync replaces the entire trailing 90-day UTC report, including measured zero days. */
export function ga4WindowCovered(lastSync: Date | null, window: { startDate: string; endDate: string }) {
  if (!lastSync) return false;
  const syncDay = lastSync.toISOString().slice(0, 10);
  const earliest = new Date(Date.parse(`${syncDay}T00:00:00Z`) - 91 * 86_400_000).toISOString().slice(0, 10);
  const latest = new Date(Date.parse(`${syncDay}T00:00:00Z`) - 2 * 86_400_000).toISOString().slice(0, 10);
  return window.startDate >= earliest && window.endDate <= latest;
}
