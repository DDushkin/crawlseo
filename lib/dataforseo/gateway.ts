import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/encryption";

export const LIVE_SITE_BUDGET_USD = 0.15;
export const MAX_REQUEST_USD = 0.06;

export type DataForSeoKind = "keywords" | "domain" | "backlinks" | "competitor_gap" | "placement" | "ai_citation";
export type DataForSeoMode = "SANDBOX" | "LIVE";
type Operation = "related_keywords" | "domain_rank_overview" | "backlinks_summary" | "backlinks_list" | "competitor_gap" | "placement_check" | "ai_citation";

export class DataForSeoError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export function defaultDataForSeoMarket(domain: string) {
  // STRUM's Ukraine market is explicit; unrelated sites retain their own defaults.
  return /^(www\.)?strum\.capital$/i.test(domain)
    ? { locationCode: 2804, languageCode: "uk" }
    : { locationCode: 2840, languageCode: "en" };
}

export async function getDataForSeoSettings(siteId: string, domain: string) {
  return db.dataForSeoSettings.upsert({
    where: { siteId },
    create: { siteId, ...defaultDataForSeoMarket(domain) },
    update: {},
  });
}

export async function getDataForSeoAccountBalance(userId: string): Promise<number> {
  const creds = await db.apiKey.findUnique({ where: { userId_provider: { userId, provider: "dataforseo" } } });
  if (!creds) throw new DataForSeoError("Connect a DataForSEO API key first", 409);
  const res = await fetch("https://api.dataforseo.com/v3/appendix/user_data", {
    method: "GET",
    headers: { Authorization: "Basic " + Buffer.from(`${decrypt(creds.encryptedLogin)}:${decrypt(creds.encryptedPassword)}`).toString("base64") },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new DataForSeoError("Could not read DataForSEO account balance", 502);
  const data = await res.json();
  const balance = data.tasks?.[0]?.result?.[0]?.money?.balance;
  if (data.status_code !== 20000 || typeof balance !== "number") throw new DataForSeoError("DataForSEO account balance unavailable", 502);
  return balance;
}

export function normalizeDataForSeoTarget(target: string, kind: DataForSeoKind): string {
  const clean = target.trim();
  if (kind === "keywords" || kind === "ai_citation") {
    if (clean.length < 3 || clean.length > 200) throw new DataForSeoError("Keyword must be 3–200 characters");
    return clean;
  }
  if (kind === "placement") {
    let url: URL;
    try { url = new URL(clean); } catch { throw new DataForSeoError("Enter a public article URL"); }
    const host = url.hostname.toLowerCase();
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port || url.search || url.hash ||
        isIP(host) || host === "localhost" || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(host) || url.pathname === "/") {
      throw new DataForSeoError("Enter a public article URL without query parameters");
    }
    return url.toString();
  }
  const domain = clean.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").replace(/^www\./i, "").toLowerCase();
  const labels = domain.split(".");
  if (domain.length > 253 || labels.length < 2 || !/^[a-z]{2,}$/.test(labels.at(-1) ?? "") ||
      labels.some((label) => label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) {
    throw new DataForSeoError("Enter a valid domain, without a path");
  }
  return domain;
}

function operations(kind: DataForSeoKind): Operation[] {
  if (kind === "keywords") return ["related_keywords"];
  if (kind === "domain") return ["domain_rank_overview", "backlinks_summary"];
  if (kind === "backlinks") return ["backlinks_summary", "backlinks_list"];
  if (kind === "placement") return ["placement_check"];
  return [kind];
}

export function buildDataForSeoRequest(
  operation: Operation,
  target: string,
  siteDomain: string,
  market: { locationCode: number; languageCode: string },
  limit: number
) {
  switch (operation) {
    case "related_keywords":
      return {
        endpoint: "/dataforseo_labs/google/related_keywords/live",
        params: { keyword: target, location_code: market.locationCode, language_code: market.languageCode, limit: 50 },
        estimatedUsd: 0.025,
        ttlDays: 30,
        timeoutMs: 30_000,
      };
    case "domain_rank_overview":
      return {
        endpoint: "/dataforseo_labs/google/domain_rank_overview/live",
        params: { target, location_code: market.locationCode, language_code: market.languageCode },
        estimatedUsd: 0.02,
        ttlDays: 7,
        timeoutMs: 30_000,
      };
    case "backlinks_summary":
      return {
        endpoint: "/backlinks/summary/live",
        params: { target, internal_list_limit: 10 },
        estimatedUsd: 0.03,
        ttlDays: 7,
        timeoutMs: 30_000,
      };
    case "backlinks_list":
      return {
        endpoint: "/backlinks/backlinks/live",
        params: { target, mode: "as_is", limit, offset: 0, order_by: ["rank,desc"] },
        estimatedUsd: 0.035,
        ttlDays: 7,
        timeoutMs: 30_000,
      };
    case "competitor_gap":
      if (target === normalizeDataForSeoTarget(siteDomain, "domain")) throw new DataForSeoError("Choose a different domain as competitor");
      return {
        endpoint: "/dataforseo_labs/google/domain_intersection/live",
        params: { target1: target, target2: normalizeDataForSeoTarget(siteDomain, "domain"), intersections: false,
          item_types: ["organic"], location_code: market.locationCode, language_code: market.languageCode,
          include_serp_info: false, limit },
        estimatedUsd: 0.02, ttlDays: 7, timeoutMs: 30_000,
      };
    case "placement_check":
      return {
        endpoint: "/backlinks/backlinks/live",
        params: { target: normalizeDataForSeoTarget(siteDomain, "domain"), mode: "as_is", filters: ["url_from", "=", target], limit, offset: 0 },
        estimatedUsd: 0.035, ttlDays: 7, timeoutMs: 30_000,
      };
    case "ai_citation":
      return {
        endpoint: "/ai_optimization/chat_gpt/llm_scraper/live/advanced",
        params: { keyword: target, force_web_search: true, location_code: market.locationCode, language_code: market.languageCode },
        estimatedUsd: 0.004, ttlDays: 1, timeoutMs: 130_000,
      };
  }
}

function cacheKey(siteId: string, mode: DataForSeoMode, endpoint: string, params: unknown) {
  return createHash("sha256").update(JSON.stringify({ siteId, mode, endpoint, params })).digest("hex");
}

function validatedLimit(value: number | undefined) {
  const limit = value ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new DataForSeoError("Limit must be 1–50");
  return limit;
}

export async function previewDataForSeo(
  siteId: string,
  domain: string,
  kind: DataForSeoKind,
  targetInput: string,
  limitInput?: number
) {
  const target = normalizeDataForSeoTarget(targetInput, kind);
  const limit = validatedLimit(limitInput);
  const settings = await getDataForSeoSettings(siteId, domain);
  const market = { locationCode: settings.locationCode, languageCode: settings.languageCode };
  const specs = operations(kind).map((operation) => {
    const spec = buildDataForSeoRequest(operation, target, domain, market, limit);
    return { operation, ...spec, cacheKey: cacheKey(siteId, settings.mode as DataForSeoMode, spec.endpoint, spec.params) };
  });
  const cached = await db.dataForSeoRun.findMany({
    where: { siteId, status: "SUCCEEDED", cacheKey: { in: specs.map((spec) => spec.cacheKey) }, expiresAt: { gt: new Date() } },
    select: { cacheKey: true },
  });
  const cachedKeys = new Set(cached.map((run) => run.cacheKey));
  const estimatedUsd = Number(specs.reduce((sum, spec) => sum + (cachedKeys.has(spec.cacheKey) ? 0 : spec.estimatedUsd), 0).toFixed(3));
  return {
    mode: settings.mode as DataForSeoMode,
    target,
    estimatedUsd: settings.mode === "SANDBOX" ? 0 : estimatedUsd,
    uncachedRequests: specs.filter((spec) => !cachedKeys.has(spec.cacheKey)).length,
    cachedRequests: specs.filter((spec) => cachedKeys.has(spec.cacheKey)).length,
    spentUsd: settings.spentUsd,
    reservedUsd: settings.reservedUsd,
    budgetUsd: LIVE_SITE_BUDGET_USD,
    locationCode: settings.locationCode,
    languageCode: settings.languageCode,
    marketApplies: kind !== "backlinks" && kind !== "placement",
  };
}

type ApiResponse = {
  status_code?: number;
  status_message?: string;
  cost?: number;
  tasks?: Array<{ id?: string; status_code?: number; status_message?: string; cost?: number; result?: unknown[] }>;
};

async function runOne(
  siteId: string,
  userId: string,
  domain: string,
  operation: Operation,
  target: string,
  limit: number
): Promise<{ data: ApiResponse; cached: boolean; chargedUsd: number; mode: DataForSeoMode }> {
  const settings = await getDataForSeoSettings(siteId, domain);
  const mode = settings.mode as DataForSeoMode;
  const spec = buildDataForSeoRequest(operation, target, domain, settings, limit);
  if (spec.estimatedUsd > MAX_REQUEST_USD) throw new DataForSeoError("Request exceeds the per-request cost cap");
  const key = cacheKey(siteId, mode, spec.endpoint, spec.params);
  const hit = await db.dataForSeoRun.findFirst({
    where: { siteId, cacheKey: key, status: "SUCCEEDED", expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (hit?.response) return { data: hit.response as ApiResponse, cached: true, chargedUsd: 0, mode };

  const creds = await db.apiKey.findUnique({ where: { userId_provider: { userId, provider: "dataforseo" } } });
  if (!creds) throw new DataForSeoError("Connect a DataForSEO API key in Settings", 409);

  const activeKey = `${siteId}:${key}`;
  let runId: string;
  try {
    // Serializable transaction prevents concurrent requests from exceeding the per-site cap.
    const run = await db.$transaction(async (tx) => {
      const current = await tx.dataForSeoSettings.findUniqueOrThrow({ where: { siteId } });
      if (current.mode === "LIVE" && current.spentUsd + current.reservedUsd + spec.estimatedUsd > LIVE_SITE_BUDGET_USD + 1e-9) {
        throw new DataForSeoError("DataForSEO pilot budget reached. No paid request was sent", 402);
      }
      if (current.mode !== mode) throw new DataForSeoError("DataForSEO mode changed; retry the preview", 409);
      if (mode === "LIVE") await tx.dataForSeoSettings.update({ where: { siteId }, data: { reservedUsd: { increment: spec.estimatedUsd } } });
      return tx.dataForSeoRun.create({
        data: { siteId, operation, target, mode, cacheKey: key, activeKey, status: "RESERVED", estimatedUsd: spec.estimatedUsd },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    runId = run.id;
  } catch (error) {
    if (error instanceof DataForSeoError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034")) {
      throw new DataForSeoError("An identical request is running. Try again shortly", 409);
    }
    throw error;
  }

  let response: ApiResponse | null = null;
  let failure: Error | null = null;
  try {
    const res = await fetch(`https://${mode === "SANDBOX" ? "sandbox" : "api"}.dataforseo.com/v3${spec.endpoint}`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${decrypt(creds.encryptedLogin)}:${decrypt(creds.encryptedPassword)}`).toString("base64"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify([spec.params]),
      signal: AbortSignal.timeout(spec.timeoutMs),
    });
    response = await res.json() as ApiResponse;
    if (!res.ok || response.status_code !== 20000 || response.tasks?.[0]?.status_code !== 20000) {
      throw new Error(response.tasks?.[0]?.status_message || response.status_message || `HTTP ${res.status}`);
    }
  } catch (error) {
    failure = error instanceof Error ? error : new Error("DataForSEO request failed");
  }

  // If the provider returned a cost, use it. If the transport failed, retain the
  // reservation as a conservative charge until an operator can reconcile it.
  const reportedCost = response?.cost ?? response?.tasks?.[0]?.cost;
  const chargedUsd = mode === "SANDBOX" ? 0 : typeof reportedCost === "number" && Number.isFinite(reportedCost)
    ? Math.max(0, reportedCost)
    : spec.estimatedUsd;
  await db.$transaction(async (tx) => {
    await tx.dataForSeoRun.update({
      where: { id: runId },
      data: {
        activeKey: null,
        status: failure ? "FAILED" : "SUCCEEDED",
        chargedUsd,
        taskId: response?.tasks?.[0]?.id,
        response: failure ? Prisma.JsonNull : response as Prisma.InputJsonValue,
        error: failure?.message.slice(0, 500),
        expiresAt: failure ? null : new Date(Date.now() + spec.ttlDays * 86_400_000),
      },
    });
    if (mode === "LIVE") await tx.dataForSeoSettings.update({
      where: { siteId },
      data: { reservedUsd: { decrement: spec.estimatedUsd }, spentUsd: { increment: chargedUsd } },
    });
  });
  if (failure) throw new DataForSeoError(`DataForSEO: ${failure.message}`, 502);
  return { data: response!, cached: false, chargedUsd, mode };
}

export async function executeDataForSeo(
  siteId: string,
  userId: string,
  domain: string,
  kind: DataForSeoKind,
  targetInput: string,
  limitInput?: number
) {
  const target = normalizeDataForSeoTarget(targetInput, kind);
  const limit = validatedLimit(limitInput);
  const results = [];
  for (const operation of operations(kind)) {
    results.push(await runOne(siteId, userId, domain, operation, target, limit));
  }
  return {
    target,
    mode: results[0].mode,
    cached: results.every((result) => result.cached),
    chargedUsd: Number(results.reduce((sum, result) => sum + result.chargedUsd, 0).toFixed(6)),
    results: results.map((result) => result.data),
  };
}
