import { parseAiCitationSample, parseCompetitorGap, parsePlacementCheck } from "./client";
import type { DataForSeoKind } from "./gateway";

type ProviderResponse = Parameters<typeof parseCompetitorGap>[0];
export type OperatorKind = Extract<DataForSeoKind, "competitor_gap" | "placement" | "ai_citation">;

export function normalizeOperatorEvidence(kind: OperatorKind, response: ProviderResponse, domain: string, target: string) {
  if (kind === "competitor_gap") {
    const evidence = parseCompetitorGap(response);
    return {
      evidence,
      nextStep: evidence.length > 0
        ? "Review relevant commercial queries with your copywriter. Map each to an existing service page; create a brief only when no page fits the intent. DataForSEO ranking estimates are not GSC clicks."
        : "No competitor-only keywords appeared in this sample. Check that this is a direct competitor in the selected market, then try another domain.",
    };
  }
  if (kind === "placement") {
    const evidence = parsePlacementCheck(response, target);
    return {
      evidence,
      nextStep: evidence.observed
        ? "Check the destination URL, anchor, and link attribute against the placement agreement. Then monitor the target page's GSC trend; a link alone does not prove impact."
        : "Not observed in DataForSEO's backlink index. Verify the live article and ask the publisher if needed; this is not proof that the link is absent.",
    };
  }
  const evidence = parseAiCitationSample(response, domain);
  return {
    evidence,
    nextStep: evidence.siteCited
      ? "Inspect which Strum page was cited and keep its answer passages, authorship, and source evidence current. This is one sampled answer, not overall citation share."
      : evidence.sources.length > 0
        ? "Review the cited sources and answer the same user question clearly on the best-fitting Strum page. Recheck the same prompt later; this is one sampled answer."
        : "No final-answer sources were returned. Try a more specific question later; this sample cannot establish citation visibility.",
  };
}
