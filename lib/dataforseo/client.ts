// The only direct request here is the free credential check. Paid requests must
// pass through gateway.ts so site budgets, caching and the usage ledger apply.

export type KeywordResult = {
  keyword: string;
  volume: number | null;
  difficulty: number | null;
  cpc: number | null;
  competition: number | null;
  trend: number[] | null;
};

export type DomainOverviewResult = {
  organicKeywords: number;
  organicTraffic: number;
  organicCost: number;
  backlinks: number | null;
  referringDomains: number | null;
};

export type BacklinksOverviewResult = {
  totalBacklinks: number;
  referringDomains: number;
  referringIps: number;
  dofollow: number;
  nofollow: number;
};

export type BacklinkItem = {
  referringDomain: string;
  sourceUrl: string;
  targetUrl: string;
  anchorText: string;
  dofollow: boolean | null;
  firstSeen: string | null;
  lastSeen: string | null;
};

export type CompetitorGapItem = {
  keyword: string;
  volume: number | null;
  difficulty: number | null;
  intent: string | null;
  competitorRank: number | null;
  competitorUrl: string | null;
};

export type AiCitationSample = {
  model: string | null;
  observedAt: string | null;
  siteCited: boolean;
  sources: Array<{ domain: string; url: string; title: string }>;
};

export type SerpBriefEvidence = { observedAt: string | null; locationCode: number | null; languageCode: string | null;
  organic: Array<{ url: string; domain: string; title: string; description: string; position: number | null }>;
  questions: string[]; relatedSearches: string[] };

type DataForSeoResponse = { tasks?: Array<{ result?: Array<Record<string, unknown>> }> };
type KeywordItem = {
  keyword?: string;
  keyword_data?: {
    keyword?: string;
    keyword_info?: { search_volume?: number; cpc?: number; competition?: number; monthly_searches?: Array<{ search_volume: number }> };
    keyword_properties?: { keyword_difficulty?: number };
  };
};
type DomainItem = { metrics?: { organic?: { count?: number; etv?: number; estimated_paid_traffic_cost?: number } } };
type BacklinksItem = { backlinks?: number; referring_links_attributes?: { nofollow?: number }; referring_domains?: number; referring_ips?: number };
type ProfileItem = { referring_main_domain?: string; url_from?: string; url_to?: string; anchor?: string; dofollow?: boolean; first_seen?: string; last_seen?: string };

function firstResult(data: DataForSeoResponse) {
  return data.tasks?.[0]?.result?.[0];
}

export function parseKeywordResults(data: DataForSeoResponse): KeywordResult[] {
  const items = firstResult(data)?.items;
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    const row = item as KeywordItem;
    const keywordData = row.keyword_data ?? {};
    const info = keywordData.keyword_info ?? {};
    return {
      keyword: keywordData.keyword ?? row.keyword ?? "",
      volume: info.search_volume ?? null,
      difficulty: keywordData.keyword_properties?.keyword_difficulty ?? null,
      cpc: info.cpc ?? null,
      competition: info.competition ?? null,
      trend: info.monthly_searches?.map((month: { search_volume: number }) => month.search_volume) ?? null,
    };
  });
}

export function parseDomainOverview(data: DataForSeoResponse): DomainOverviewResult | null {
  const item = firstResult(data) as DomainItem | undefined;
  if (!item) return null;
  return {
    organicKeywords: item.metrics?.organic?.count ?? 0,
    organicTraffic: item.metrics?.organic?.etv ?? 0,
    organicCost: item.metrics?.organic?.estimated_paid_traffic_cost ?? 0,
    backlinks: null, // Backlinks belong to the separate Backlinks API, not Labs.
    referringDomains: null,
  };
}

export function parseBacklinksOverview(data: DataForSeoResponse): BacklinksOverviewResult | null {
  const item = firstResult(data) as BacklinksItem | undefined;
  if (!item) return null;
  const total = item.backlinks ?? 0;
  const nofollow = item.referring_links_attributes?.nofollow ?? 0;
  return {
    totalBacklinks: total,
    referringDomains: item.referring_domains ?? 0,
    referringIps: item.referring_ips ?? 0,
    dofollow: Math.max(0, total - nofollow),
    nofollow,
  };
}

export function parseBacklinksProfile(data: DataForSeoResponse): BacklinkItem[] {
  const items = firstResult(data)?.items;
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    const row = item as ProfileItem;
    return {
      referringDomain: row.referring_main_domain ?? "",
      sourceUrl: row.url_from ?? "",
      targetUrl: row.url_to ?? "",
      anchorText: row.anchor ?? "",
      dofollow: row.dofollow ?? null,
      firstSeen: row.first_seen ?? null,
      lastSeen: row.last_seen ?? null,
    };
  });
}

export function parseCompetitorGap(data: DataForSeoResponse): CompetitorGapItem[] {
  const items = firstResult(data)?.items;
  if (!Array.isArray(items)) return [];
  return items.flatMap((item) => {
    const row = item as {
      keyword_data?: { keyword?: string; keyword_info?: { search_volume?: number }; keyword_properties?: { keyword_difficulty?: number }; search_intent_info?: { main_intent?: string } };
      first_domain_serp_element?: { rank_group?: number; url?: string };
    };
    if (!row.keyword_data?.keyword) return [];
    return [{
      keyword: row.keyword_data.keyword,
      volume: row.keyword_data.keyword_info?.search_volume ?? null,
      difficulty: row.keyword_data.keyword_properties?.keyword_difficulty ?? null,
      intent: row.keyword_data.search_intent_info?.main_intent ?? null,
      competitorRank: row.first_domain_serp_element?.rank_group ?? null,
      competitorUrl: row.first_domain_serp_element?.url ?? null,
    }];
  });
}

export function parseSerpBrief(data: DataForSeoResponse): SerpBriefEvidence {
  const result = firstResult(data) as { datetime?: string; location_code?: number; language_code?: string; items?: unknown[] } | undefined;
  const task = data.tasks?.[0] as { data?: { location_code?: number; language_code?: string } } | undefined;
  const items = Array.isArray(result?.items) ? result.items as Array<Record<string, unknown>> : [];
  const organic = items.filter((item) => item.type === "organic" && typeof item.url === "string")
    .slice(0, 10).map((item) => ({ url: item.url as string, domain: typeof item.domain === "string" ? item.domain : "",
      title: typeof item.title === "string" ? item.title : "", description: typeof item.description === "string" ? item.description : "",
      position: typeof item.rank_group === "number" ? item.rank_group : null }));
  const childText = (type: string, key: "title" | "keyword") => [...new Set(items.filter((item) => item.type === type)
    .flatMap((item) => Array.isArray(item.items) ? item.items as unknown[] : [])
    .map((item) => typeof item === "string" ? item : item && typeof item === "object" ? (item as Record<string, unknown>)[key] : null)
    .filter((value): value is string => typeof value === "string" && !!value.trim()))].slice(0, 20);
  return { observedAt: result?.datetime ?? null, locationCode: result?.location_code ?? task?.data?.location_code ?? null,
    languageCode: result?.language_code ?? task?.data?.language_code ?? null, organic,
    questions: childText("people_also_ask", "title"), relatedSearches: childText("related_searches", "keyword") };
}

export function parsePlacementCheck(data: DataForSeoResponse, sourceUrl: string) {
  const links = parseBacklinksProfile(data).filter((link) => link.sourceUrl.replace(/\/$/, "") === sourceUrl.replace(/\/$/, ""));
  return { observed: links.length > 0, links };
}

export function parseAiCitationSample(data: DataForSeoResponse, siteDomain: string): AiCitationSample {
  const result = firstResult(data) as {
    model?: string; datetime?: string;
    sources?: Array<{ domain?: string; url?: string; title?: string }>;
  } | undefined;
  const sources = (result?.sources ?? []).flatMap((source) => {
    if (!source.url) return [];
    try {
      const url = new URL(source.url);
      if (!/^(https?:)$/.test(url.protocol)) return [];
      const domain = url.hostname.toLowerCase().replace(/^www\./, "");
      return [{ domain, url: url.toString(), title: source.title ?? domain }];
    } catch { return []; }
  });
  const domain = siteDomain.toLowerCase().replace(/^www\./, "");
  return {
    model: result?.model ?? null,
    observedAt: result?.datetime ?? null,
    siteCited: sources.some((source) => source.domain === domain || source.domain.endsWith(`.${domain}`)),
    sources,
  };
}

export async function testConnection(login: string, password: string): Promise<boolean> {
  try {
    const res = await fetch("https://api.dataforseo.com/v3/appendix/user_data", {
      method: "GET",
      headers: { Authorization: "Basic " + Buffer.from(`${login}:${password}`).toString("base64") },
    });
    if (!res.ok) return false;
    const json = await res.json();
    return json.status_code === 20000;
  } catch {
    return false;
  }
}
