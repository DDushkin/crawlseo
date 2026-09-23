import { normalizeSitePageUrl } from "./pages";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

export function normalizeArticleUrl(input: string) {
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new Error("Enter a publisher article URL"); }
  if (url.protocol !== "https:" || !url.hostname.includes(".") || url.username || url.password || url.port) {
    throw new Error("Publisher article must use a public HTTPS URL");
  }
  url.hash = "";
  url.search = "";
  return url.toString();
}

export function normalizePlacement(siteDomain: string, input: { articleUrl: string; targetUrl: string; costUah: number; feeUah: number }) {
  const articleUrl = normalizeArticleUrl(input.articleUrl);
  const targetUrl = normalizeSitePageUrl(siteDomain, input.targetUrl);
  const domain = siteDomain.toLowerCase().replace(/^www\./, "");
  const publisher = new URL(articleUrl).hostname.toLowerCase();
  if (publisher === domain || publisher === `www.${domain}` || publisher.endsWith(`.${domain}`)) throw new Error("Publisher must be outside the selected site");
  if (!Number.isFinite(input.costUah) || !Number.isFinite(input.feeUah) || input.costUah < 0 || input.feeUah < 0 || input.costUah > 10_000_000 || input.feeUah > 10_000_000) throw new Error("Invalid placement cost in UAH");
  return { articleUrl, targetUrl, publisher, costUah: Math.round(input.costUah * 100) / 100,
    feeUah: Math.round(input.feeUah * 100) / 100,
    totalUah: Math.round((input.costUah + input.feeUah) * 100) / 100 };
}

export function placementTotals(placements: { costUah: number; feeUah: number; totalUah: number }[]) {
  const costUah = placements.reduce((sum, item) => sum + item.costUah, 0);
  const feeUah = placements.reduce((sum, item) => sum + item.feeUah, 0);
  return { costUah: Math.round(costUah * 100) / 100, feeUah: Math.round(feeUah * 100) / 100,
    totalUah: Math.round((costUah + feeUah) * 100) / 100 };
}

export function matchingArticleLinks<T extends { sourceUrl: string; targetUrl: string }>(articleUrl: string, targetUrl: string, links: T[]) {
  const source = normalizeArticleUrl(articleUrl);
  const target = new URL(targetUrl).toString();
  return links.filter((link) => {
    try { return normalizeArticleUrl(link.sourceUrl) === source && new URL(link.targetUrl).toString() === target; }
    catch { return false; }
  });
}

export function isPublicAddress(address: string): boolean {
  const mapped = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPublicAddress(mapped[1]);
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 0 && c === 2))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113));
  }
  if (isIP(address) === 6) {
    const lower = address.toLowerCase();
    return !(lower === "::" || lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") ||
      lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb") ||
      lower.startsWith("2001:db8"));
  }
  return false;
}

function decodeHtml(input: string) {
  return input.replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");
}

export function extractArticleLinks(html: string, sourceUrl: string) {
  const links: { sourceUrl: string; targetUrl: string; anchorText: string; rel: string | null }[] = [];
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = match[1];
    const href = attrs.match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2];
    if (!href) continue;
    try {
      const targetUrl = new URL(decodeHtml(href), sourceUrl);
      if (!/^https?:$/.test(targetUrl.protocol)) continue;
      targetUrl.hash = "";
      targetUrl.search = "";
      const rel = attrs.match(/\brel\s*=\s*(["'])(.*?)\1/i)?.[2] ?? null;
      links.push({ sourceUrl, targetUrl: targetUrl.toString(),
        anchorText: decodeHtml(match[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()).slice(0, 200), rel });
    } catch { /* malformed href */ }
  }
  return links;
}

async function fetchPublicHtml(input: string, remainingRedirects = 3): Promise<{ status: number; html: string; finalUrl: string }> {
  const url = new URL(input);
  if (url.protocol !== "https:" || url.username || url.password || url.port) throw new Error("Article verification requires a public HTTPS URL");
  const addresses = isIP(url.hostname) ? [{ address: url.hostname, family: isIP(url.hostname) }] : await lookup(url.hostname, { all: true });
  const selected = addresses.find(({ address }) => isPublicAddress(address));
  if (!selected) throw new Error("Publisher resolves only to private or reserved addresses");
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, {
      method: "GET", timeout: 10_000, headers: { "User-Agent": "CrawlSEOPlacementCheck/1.0", Accept: "text/html" },
      lookup: (_host, _options, callback) => callback(null, selected.address, selected.family),
    }, (response) => {
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        if (remainingRedirects <= 0) { reject(new Error("Too many article redirects")); return; }
        const next = new URL(response.headers.location, url);
        fetchPublicHtml(next.toString(), remainingRedirects - 1).then(resolve, reject);
        return;
      }
      if (status !== 200) { response.resume(); resolve({ status, html: "", finalUrl: url.toString() }); return; }
      if (!String(response.headers["content-type"] || "").toLowerCase().includes("text/html")) {
        response.resume(); reject(new Error("Publisher did not return HTML")); return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 2_000_000) { response.destroy(new Error("Article HTML exceeds 2 MB")); return; }
        chunks.push(chunk);
      });
      response.on("end", () => resolve({ status, html: Buffer.concat(chunks).toString("utf8"), finalUrl: url.toString() }));
      response.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("Article request timed out")));
    req.on("error", reject);
    req.end();
  });
}

export async function verifyPublishedArticle(articleUrl: string, targetUrl: string) {
  const source = normalizeArticleUrl(articleUrl);
  try {
    const fetched = await fetchPublicHtml(source);
    if (fetched.status !== 200) return { status: "UNAVAILABLE", httpStatus: fetched.status, observedUrl: null,
      anchorText: null, rel: null, error: `Publisher returned HTTP ${fetched.status}` };
    const links = extractArticleLinks(fetched.html, fetched.finalUrl);
    const matches = matchingArticleLinks(fetched.finalUrl, targetUrl, links);
    const match = matches[0];
    return { status: match ? "OBSERVED" : "NOT_FOUND_IN_HTML", httpStatus: fetched.status,
      observedUrl: match?.targetUrl ?? null, anchorText: match?.anchorText ?? null,
      rel: match?.rel ?? null, error: match ? null : "No exact target link in fetched HTML; client-rendered links may be missed" };
  } catch (error) {
    return { status: "UNAVAILABLE", httpStatus: null, observedUrl: null, anchorText: null,
      rel: null, error: error instanceof Error ? error.message.slice(0, 300) : "Article check failed" };
  }
}
