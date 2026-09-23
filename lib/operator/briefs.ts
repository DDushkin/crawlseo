import type { KeywordDecision } from "./pages";

export type BriefInput = {
  decision: KeywordDecision;
  query: string;
  pageUrl: string | null;
  gsc: { clicks: number; impressions: number; position: number | null; startDate: string; endDate: string } | null;
  competitorResults: Array<{ domain: string; url: string; query: string; position: number | null; observedAt: string }>;
};

export function buildContentBrief(input: BriefInput) {
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
    gscEvidence: input.gsc ? { source: "GSC" as const, ...input.gsc } : null,
    competitorStatus: input.competitorResults.length ? "OBSERVED" as const : "UNAVAILABLE" as const,
    competitorEvidence: input.competitorResults.map((result) => ({ ...result, source: "DataForSEO" as const })),
    suggestedStructure: [
      `Answer the customer question behind “${input.query}” clearly near the start.`,
      "Explain the workflow with concrete, verifiable examples and cite primary sources for changing facts.",
      "Show how the relevant product feature works and its limitations; avoid unsupported superiority claims.",
    ],
    aiCitability: "Use a self-contained answer passage, descriptive headings, attribution, author information, and visible update date.",
    nextStep,
  };
}
