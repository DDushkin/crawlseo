export type ComparableIssue = { url: string; type: string; severity: string; message: string; details?: unknown };
export type CrawlFindingStatus = "NEW" | "PERSISTENT" | "RESOLVED";

export function issueFingerprint(issue: Pick<ComparableIssue, "url" | "type">) {
  return `${issue.type}\0${issue.url.replace(/#.*$/, "")}`;
}

export function compareCrawlIssues(previous: ComparableIssue[], current: ComparableIssue[]) {
  const old = new Map(previous.map((issue) => [issueFingerprint(issue), issue]));
  const now = new Map(current.map((issue) => [issueFingerprint(issue), issue]));
  const findings: Array<ComparableIssue & { fingerprint: string; status: CrawlFindingStatus }> = [];
  for (const [fingerprint, issue] of now) {
    findings.push({ ...issue, fingerprint, status: old.has(fingerprint) ? "PERSISTENT" : "NEW" });
  }
  for (const [fingerprint, issue] of old) {
    if (!now.has(fingerprint)) findings.push({ ...issue, fingerprint, status: "RESOLVED" });
  }
  return findings.sort((a, b) => a.status.localeCompare(b.status) || a.url.localeCompare(b.url));
}

import { db } from "@/lib/db";
import { filterIssuesForSearchCandidates } from "@/lib/crawler/analysis";
import { REMEDIATION } from "@/lib/crawler/remediation";
import { upsertDetectedAction } from "./actions";
import { Prisma } from "@prisma/client";

/** Only a finalized successful crawl can replace the comparison baseline. */
export async function compareAndStoreCompletedCrawl(siteId: string, crawlId: string) {
  const current = await db.crawl.findFirst({ where: { id: crawlId, siteId, status: "COMPLETED" },
    include: { issues: true, auditPages: true } });
  if (!current?.finishedAt) return null;
  const existing = await db.crawlComparison.findUnique({ where: { crawlId } });
  if (existing) return existing;
  const baseline = await db.crawl.findFirst({ where: { siteId, status: "COMPLETED", finishedAt: { lt: current.finishedAt } },
    orderBy: { finishedAt: "desc" }, include: { issues: true, auditPages: true } });
  const filter = (crawl: typeof current) => filterIssuesForSearchCandidates(
    crawl.issues.filter((issue) => {
      const kind = (issue.details as { kind?: string } | null)?.kind;
      return kind !== "crawl_summary" && kind !== "content_score";
    }), crawl.auditPages);
  const currentIssues = filter(current);
  const priorIssues = baseline ? filter(baseline) : [];
  const seenUrls = new Set([...current.auditPages.map((page) => page.url), ...currentIssues.map((issue) => issue.url)]);
  const all = compareCrawlIssues(priorIssues, currentIssues);
  // An uncrawled URL cannot be called resolved merely because it was missing from a partial crawl.
  const findings = baseline ? all.filter((item) => item.status !== "RESOLVED" || seenUrls.has(item.url)) : [];
  const counts = { newCount: findings.filter((item) => item.status === "NEW").length,
    persistentCount: findings.filter((item) => item.status === "PERSISTENT").length,
    resolvedCount: findings.filter((item) => item.status === "RESOLVED").length };
  let comparison;
  try {
    comparison = await db.crawlComparison.create({ data: { siteId, crawlId,
      baselineCrawlId: baseline?.id ?? null, ...counts,
      findings: { create: findings.map((item) => ({ siteId, fingerprint: item.fingerprint,
        url: item.url, type: item.type, severity: item.severity, status: item.status,
        message: item.message, details: item.details == null ? undefined : item.details as Prisma.InputJsonValue })) } } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return db.crawlComparison.findUnique({ where: { crawlId } });
    }
    throw error;
  }
  const actionable = baseline ? findings : currentIssues.map((item) => ({ ...item, status: "BASELINE" as const }));
  for (const item of actionable) {
    if (item.status === "RESOLVED" || item.severity !== "CRITICAL") continue;
    const remediation = REMEDIATION[item.type];
    await upsertDetectedAction(siteId, { type: `CRAWL_${item.type}`, pageUrl: item.url,
      title: remediation?.title ?? item.type.replaceAll("_", " "),
      rationale: item.message,
      recommendation: remediation?.howToFix ?? "Investigate this issue on the affected URL.",
      severity: "critical", confidence: "high", effort: "medium", expectedClicks: null,
      evidence: { source: "Crawler", crawlId, baselineCrawlId: baseline?.id ?? null,
        status: item.status, observedAt: current.finishedAt.toISOString() } });
  }
  return comparison;
}
