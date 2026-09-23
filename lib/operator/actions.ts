import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export type ActionStatus = "NEW" | "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "DISMISSED" | "MONITORING";
export type FindingSeverity = "critical" | "high" | "medium" | "low";
export type FindingConfidence = "high" | "medium" | "low";
export type FindingEffort = "low" | "medium" | "high";

export type DetectedFinding = {
  type: string;
  title: string;
  rationale: string;
  recommendation: string;
  pageUrl?: string | null;
  query?: string | null;
  severity: FindingSeverity;
  expectedClicks: number | null;
  confidence: FindingConfidence;
  effort: FindingEffort;
  evidence: Record<string, string | number | boolean | null>;
};

function normalizePageUrl(value: string | null | undefined) {
  if (!value) return "";
  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";
    url.hostname = url.hostname.toLowerCase();
    return url.toString().replace(/\/$/, "");
  } catch {
    return value.trim().toLowerCase();
  }
}

export function actionFingerprint(input: { type: string; pageUrl?: string | null; query?: string | null }) {
  const key = JSON.stringify([
    input.type.trim().toLowerCase(),
    normalizePageUrl(input.pageUrl),
    input.query?.trim().toLocaleLowerCase() ?? "",
  ]);
  return createHash("sha256").update(key).digest("hex");
}

export function priorityForFinding(input: {
  severity: FindingSeverity;
  expectedClicks: number | null;
  confidence: FindingConfidence;
  effort: FindingEffort;
}) {
  if (input.severity === "critical") return 1000;
  const severity = { high: 60, medium: 35, low: 15 }[input.severity];
  const upside = input.expectedClicks && input.expectedClicks > 0 ? Math.min(30, Math.round(Math.log2(input.expectedClicks + 1) * 3)) : 0;
  const confidence = { high: 1, medium: 0.75, low: 0.5 }[input.confidence];
  const effort = { low: 1, medium: 0.8, high: 0.6 }[input.effort];
  return Math.round((severity + upside) * confidence * effort);
}

const transitions: Record<ActionStatus, ActionStatus[]> = {
  NEW: ["PLANNED", "IN_PROGRESS", "DISMISSED"],
  PLANNED: ["NEW", "IN_PROGRESS", "DISMISSED"],
  IN_PROGRESS: ["PLANNED", "COMPLETED", "DISMISSED"],
  COMPLETED: ["MONITORING"],
  DISMISSED: ["NEW"],
  MONITORING: ["COMPLETED"],
};

export function validateActionTransition(from: ActionStatus, to: ActionStatus) {
  return from === to || transitions[from].includes(to);
}

export async function upsertDetectedAction(
  siteId: string,
  finding: DetectedFinding,
  repository: Pick<typeof db, "seoAction" | "sitePage"> = db,
) {
  const fingerprint = actionFingerprint(finding);
  const priority = priorityForFinding(finding);
  const evidence = finding.evidence as Prisma.InputJsonValue;
  const page = finding.pageUrl ? await repository.sitePage.findUnique({
    where: { siteId_url: { siteId, url: finding.pageUrl } }, select: { id: true },
  }) : null;
  return repository.seoAction.upsert({
    where: { siteId_fingerprint: { siteId, fingerprint } },
    create: {
      siteId, fingerprint, type: finding.type, title: finding.title,
      rationale: finding.rationale, recommendation: finding.recommendation,
      pageId: page?.id ?? null, pageUrl: finding.pageUrl ?? null, query: finding.query ?? null,
      evidence, expectedClicks: finding.expectedClicks,
      confidence: finding.confidence, effort: finding.effort,
      severity: finding.severity, priority, signalActive: true,
    },
    update: {
      ...(page ? { pageId: page.id } : {}),
      title: finding.title, rationale: finding.rationale, recommendation: finding.recommendation,
      evidence, expectedClicks: finding.expectedClicks,
      confidence: finding.confidence, effort: finding.effort,
      severity: finding.severity, priority, signalActive: true, lastSeenAt: new Date(),
    },
  });
}
