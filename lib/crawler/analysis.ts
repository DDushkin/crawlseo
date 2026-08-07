export type SeoPageSignals = {
  url: string;
  statusCode: number;
  canonical: string | null;
  indexable: boolean;
};

export type LinkSource = SeoPageSignals & {
  internalOutlinks: string[];
};

export type IssueForScore = {
  severity: "CRITICAL" | "WARNING" | "INFO";
};

export type IndexingState =
  | "indexable"
  | "excluded"
  | "canonicalized"
  | "non_success";

export function getIndexingState(page: SeoPageSignals): IndexingState {
  if (page.statusCode < 200 || page.statusCode >= 300) return "non_success";
  if (!page.indexable) return "excluded";
  if (page.canonical && page.canonical !== page.url) return "canonicalized";
  return "indexable";
}

export function isSearchIndexCandidate(page: SeoPageSignals): boolean {
  return getIndexingState(page) === "indexable";
}

/**
 * Retain site-level issues and issues for URLs that were not stored as crawl
 * pages (for example, a failed request), but never display recommendations for
 * a crawled URL intentionally excluded from search.
 */
export function filterIssuesForSearchCandidates<
  TIssue extends { url: string; type?: string; details?: unknown },
  TPage extends SeoPageSignals,
>(issues: TIssue[], pages: TPage[]): TIssue[] {
  const indexableByUrl = new Map(
    pages.map((page) => [page.url, isSearchIndexCandidate(page)])
  );

  return issues.filter((issue) => {
    if (indexableByUrl.get(issue.url) === false) return false;

    if (
      issue.type !== "DUPLICATE_TITLE" &&
      issue.type !== "DUPLICATE_DESCRIPTION"
    ) {
      return true;
    }

    const urls = (issue.details as { urls?: unknown } | null)?.urls;
    if (!Array.isArray(urls)) return true;

    return (
      urls.filter(
        (url): url is string =>
          typeof url === "string" && indexableByUrl.get(url) === true
      ).length > 1
    );
  });
}

export function findMissingFromSitemap<TPage extends SeoPageSignals>(
  pages: TPage[],
  sitemapUrls: Iterable<string>
): TPage[] {
  const sitemapSet = new Set(sitemapUrls);
  if (sitemapSet.size === 0) return [];

  return pages.filter(
    (page) => isSearchIndexCandidate(page) && !sitemapSet.has(page.url)
  );
}

export function buildInlinkCount(pages: LinkSource[]): Map<string, number> {
  const inlinkCount = new Map<string, number>();

  for (const page of pages) {
    for (const targetUrl of new Set(page.internalOutlinks)) {
      inlinkCount.set(targetUrl, (inlinkCount.get(targetUrl) ?? 0) + 1);
    }
  }

  return inlinkCount;
}

export function findOrphanPages<TPage extends SeoPageSignals>(
  pages: TPage[],
  inlinkCount: ReadonlyMap<string, number>,
  seedUrl: string
): TPage[] {
  return pages.filter((page) => {
    if (!isSearchIndexCandidate(page)) return false;

    const isHome = new URL(page.url).pathname === "/" || page.url === seedUrl;
    return !isHome && (inlinkCount.get(page.url) ?? 0) === 0;
  });
}

export function computeHealthScore(
  issues: IssueForScore[],
  indexablePagesFound: number
): number {
  if (indexablePagesFound === 0) return 0;

  let score = 100;
  for (const issue of issues) {
    if (issue.severity === "CRITICAL") score -= 8;
    else if (issue.severity === "WARNING") score -= 3;
    else score -= 1;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}
