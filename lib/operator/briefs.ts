import type { KeywordDecision } from "./pages";
import type { SerpBriefEvidence } from "../dataforseo/client";

export type BriefInput = {
  decision: KeywordDecision;
  query: string;
  intent?: string | null;
  pageUrl: string | null;
  gsc: { clicks: number; impressions: number; position: number | null; startDate: string; endDate: string } | null;
  competitorResults: Array<{ domain: string; url: string; query: string; position: number | null; observedAt: string }>;
  pageEvidence?: { source: "CRAWL"; crawledAt: string; title: string | null; description: string | null;
    indexable: boolean; canonical: string | null; hasSchema: boolean; internalLinks: number } | null;
  queryPageEvidence?: Array<{ url: string; impressions: number }>;
  serpEvidence?: SerpBriefEvidence | null;
};

export type BriefPlan = { title: string; metaDescription: string; outline: string[]; questions: string[];
  entities: string[]; internalLinks: string[]; expertiseNotes: string; notes: string };

export const emptyBriefPlan = (): BriefPlan => ({ title: "", metaDescription: "", outline: [], questions: [], entities: [],
  internalLinks: [], expertiseNotes: "", notes: "" });

export function buildContentBrief(input: BriefInput) {
  const crawlChecks: string[] = [];
  if (input.pageEvidence) {
    if (!input.pageEvidence.indexable) crawlChecks.push("Resolve indexability before investing in the draft.");
    if (!input.pageEvidence.title) crawlChecks.push("Write a descriptive, unique page title.");
    if (!input.pageEvidence.description) crawlChecks.push("Write a useful search snippet description.");
    if (!input.pageEvidence.hasSchema) crawlChecks.push("Consider only schema types supported by visible page content; validate before publishing.");
    if (input.pageEvidence.internalLinks < 3) crawlChecks.push("Review whether this page links out to relevant service and support pages; this crawl count is outgoing links only.");
  }
  const competingPages = (input.queryPageEvidence ?? []).filter((row) => row.impressions > 0);
  const nextStep = {
    OPTIMIZE_EXISTING: "Review and update the existing page for this intent; keep verifiable facts and expert sources current.",
    CONSOLIDATE: "Review competing pages with your copywriter and choose one canonical page before merging content.",
    CREATE_PAGE: "Draft a new page only after confirming no existing page satisfies this intent.",
    REJECT: "Do not target this query; keep the decision recorded to avoid repeated research.",
  }[input.decision];
  return {
    targetQuery: input.query,
    targetPageUrl: input.pageUrl,
    decision: input.decision,
    intent: input.intent ?? null,
    gscEvidence: input.gsc ? { source: "GSC" as const, ...input.gsc } : null,
    pageEvidence: input.pageEvidence ?? null,
    queryPageEvidence: input.queryPageEvidence ?? [],
    cannibalizationReview: { status: competingPages.length > 1 ? "REVIEW" as const : competingPages.length === 1 ? "SINGLE_OBSERVED" as const : "UNAVAILABLE" as const,
      qualification: "Multiple ranking URLs are a review cue, not proof that pages compete for the same intent." },
    serpStatus: input.serpEvidence ? "OBSERVED" as const : "UNAVAILABLE" as const,
    serpEvidence: input.serpEvidence ? { source: "DataForSEO" as const, ...input.serpEvidence } : null,
    serpQuestionsStatus: input.serpEvidence ? "OBSERVED" as const : "UNAVAILABLE" as const,
    entitiesStatus: "UNAVAILABLE" as const,
    crawlChecks,
    competitorStatus: input.competitorResults.length ? "OBSERVED" as const : "UNAVAILABLE" as const,
    competitorEvidence: input.competitorResults.map((result) => ({ ...result, source: "DataForSEO" as const })),
    suggestedStructure: [
      `Answer the customer question behind “${input.query}” clearly near the start.`,
      "Explain the workflow with concrete, verifiable examples and cite primary sources for changing facts.",
      "Show how the relevant product feature works and its limitations; avoid unsupported superiority claims.",
    ],
    aiCitability: "Use a self-contained answer passage, descriptive headings, attribution, author information, and visible update date.",
    expertiseSignals: ["Name the author and their relevant expertise.", "Cite primary sources for financial and changing facts.",
      "Show the date reviewed, limitations, and the actual product workflow."],
    plan: emptyBriefPlan(),
    nextStep,
  };
}

export function updateBriefPlan<T extends { plan: BriefPlan }>(content: T, plan: BriefPlan): T {
  if (!plan || typeof plan !== "object") throw new Error("Brief plan required");
  const text = (value: unknown, label: string, max: number) => {
    if (typeof value !== "string" || value.length > max) throw new Error(`Invalid ${label}`);
    return value.trim();
  };
  const lines = (value: unknown, label: string) => {
    if (!Array.isArray(value) || value.length > 50 || value.some((item) => typeof item !== "string" || item.length > 500)) throw new Error(`Invalid ${label}`);
    return value.map((item: string) => item.trim()).filter(Boolean);
  };
  return { ...content, plan: { title: text(plan.title, "title", 200), metaDescription: text(plan.metaDescription, "meta description", 500),
    outline: lines(plan.outline, "outline"), questions: lines(plan.questions, "questions"),
    entities: lines(plan.entities, "entities"), internalLinks: lines(plan.internalLinks, "internal links"),
    expertiseNotes: text(plan.expertiseNotes, "expertise notes", 4000), notes: text(plan.notes, "notes", 8000) } };
}
