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
