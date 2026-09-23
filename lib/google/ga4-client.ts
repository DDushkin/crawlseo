import { db } from "@/lib/db";
import { decrypt } from "@/lib/encryption";
import { createHash } from "node:crypto";
import { getGa4ServiceAccountToken, parseGa4ServiceAccount } from "./ga4-service-account";

const AI_SOURCES: Array<[RegExp, string]> = [
  [/^(?:www\.)?(?:chatgpt\.com|chat\.openai\.com)$/i, "ChatGPT"],
  [/^(?:www\.)?perplexity\.ai$/i, "Perplexity"],
  [/^(?:www\.)?claude\.ai$/i, "Claude"],
  [/^(?:www\.)?gemini\.google\.com$/i, "Gemini"],
  [/^(?:www\.)?copilot\.microsoft\.com$/i, "Copilot"],
];

export function classifyAiReferrer(source: string) {
  const normalized = source.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return AI_SOURCES.find(([pattern]) => pattern.test(normalized))?.[1] ?? null;
}

type Ga4Row = { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] };
type Ga4Report = { rows?: Ga4Row[]; rowCount?: number; credentialVersion?: string };

export function ga4CredentialVersion(encryptedJson: string) {
  return createHash("sha256").update(encryptedJson).digest("hex");
}

export function ga4ReportRowCount(report: Ga4Report) {
  if (report.rowCount === undefined && (!report.rows || report.rows.length === 0)) return 0;
  if (!Number.isSafeInteger(report.rowCount) || report.rowCount! < 0 || report.rowCount! < (report.rows?.length ?? 0)) {
    throw new Error("GA4 report is missing a valid row count");
  }
  return report.rowCount!;
}

export function parseGa4TrafficRows(report: Ga4Report) {
  const ai = new Map<string, { date: string; source: string; sessions: number; keyEvents: number }>();
  const organic = new Map<string, { date: string; sessions: number; keyEvents: number }>();
  for (const row of report.rows || []) {
    const [rawDate, source, , channel] = (row.dimensionValues || []).map((value) => value.value || "");
    if (!/^\d{8}$/.test(rawDate)) throw new Error("GA4 returned an invalid date");
    const date = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;
    const parsedDate = new Date(`${date}T00:00:00.000Z`);
    if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
      throw new Error("GA4 returned an invalid date");
    }
    const sessions = Number(row.metricValues?.[0]?.value);
    const keyEvents = Number(row.metricValues?.[1]?.value);
    if (!Number.isFinite(sessions) || !Number.isFinite(keyEvents) || sessions < 0 || keyEvents < 0) throw new Error("GA4 returned invalid metrics");
    const aiSource = classifyAiReferrer(source);
    if (aiSource) {
      const key = `${date}\0${aiSource}`;
      const prior = ai.get(key) || { date, source: aiSource, sessions: 0, keyEvents: 0 };
      prior.sessions += sessions; prior.keyEvents += keyEvents; ai.set(key, prior);
    }
    if (channel === "Organic Search") {
      const prior = organic.get(date) || { date, sessions: 0, keyEvents: 0 };
      prior.sessions += sessions; prior.keyEvents += keyEvents; organic.set(date, prior);
    }
  }
  return { ai: [...ai.values()].sort((a, b) => a.date.localeCompare(b.date) || a.source.localeCompare(b.source)),
    organic: [...organic.values()].sort((a, b) => a.date.localeCompare(b.date)) };
}

export async function fetchGa4Report(userId: string, propertyId: string, startDate: string, endDate: string): Promise<Ga4Report> {
  if (!/^\d{1,20}$/.test(propertyId)) throw new Error("GA4 property ID must be numeric");
  const credential = await db.ga4Credential.findUnique({ where: { userId }, select: { encryptedJson: true } });
  if (!credential) throw new Error("Connect a GA4 service account in Settings first");
  const token = await getGa4ServiceAccountToken(parseGa4ServiceAccount(decrypt(credential.encryptedJson)));
  const rows: Ga4Row[] = [];
  let rowCount = 0;
  for (let offset = 0; offset <= 50_000; offset += 10_000) {
    const response = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: "date" }, { name: "sessionSource" }, { name: "sessionMedium" }, { name: "sessionDefaultChannelGroup" }],
        metrics: [{ name: "sessions" }, { name: "keyEvents" }], limit: "10000", offset: String(offset) }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      if (response.status === 403) throw new Error("GA4 report unavailable (HTTP 403); check GA4 Viewer access and Analytics Data API enablement in the service-account project");
      if (response.status === 404) throw new Error("GA4 report unavailable (HTTP 404); check GA4 property ID and access");
      throw new Error(`GA4 report unavailable (HTTP ${response.status})`);
    }
    const data = await response.json() as Ga4Report;
    if (!Array.isArray(data.rows) && data.rows !== undefined) throw new Error("Unexpected GA4 report shape");
    rowCount = ga4ReportRowCount(data);
    if (rowCount > 50_000) throw new Error("GA4 report exceeds the 50,000-row safe import limit");
    rows.push(...(data.rows || []));
    if (rows.length >= rowCount) break;
  }
  if (rows.length !== rowCount) throw new Error("GA4 report is incomplete");
  return { rows, rowCount, credentialVersion: ga4CredentialVersion(credential.encryptedJson) };
}
