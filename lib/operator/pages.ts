export type KeywordDecision = "OPTIMIZE_EXISTING" | "CONSOLIDATE" | "CREATE_PAGE" | "REJECT";

export function normalizeSitePageUrl(siteDomain: string, input: string) {
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new Error("Enter an absolute page URL"); }
  const domain = siteDomain.toLowerCase().replace(/^www\./, "");
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || (host !== domain && host !== `www.${domain}`) ||
      url.username || url.password || url.port) {
    throw new Error("Page URL must be HTTPS on the selected site domain");
  }
  if (url.search) throw new Error("Canonical page URL cannot include query parameters");
  url.hash = "";
  return url.toString();
}

/** Provider/crawler URLs are observations, not a license to add external or parameterized pages. */
export function normalizeObservedSitePageUrls(siteDomain: string, urls: string[]) {
  const valid = new Set<string>();
  for (const url of urls) {
    try { valid.add(normalizeSitePageUrl(siteDomain, url)); }
    catch { /* Keep non-canonical observations in their source report, not the managed inventory. */ }
  }
  return [...valid];
}

export function normalizeTargetQuery(query: string) {
  const normalized = query.trim().replace(/\s+/g, " ").toLocaleLowerCase();
  if (normalized.length < 2 || normalized.length > 200) throw new Error("Keyword must be 2–200 characters");
  return normalized;
}

export function validateKeywordDecision(decision: string, pageId: string | null) {
  if (!["OPTIMIZE_EXISTING", "CONSOLIDATE", "CREATE_PAGE", "REJECT"].includes(decision)) throw new Error("Choose a keyword decision");
  if ((decision === "OPTIMIZE_EXISTING" || decision === "CONSOLIDATE") && !pageId) throw new Error("Choose a target page");
  if ((decision === "CREATE_PAGE" || decision === "REJECT") && pageId) throw new Error("This decision cannot have an existing target page");
  return true;
}
