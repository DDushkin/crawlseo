import { db } from "@/lib/db";
import { parseAiCitationSample } from "@/lib/dataforseo/client";
import { executeDataForSeo, getDataForSeoSettings, previewDataForSeo } from "@/lib/dataforseo/gateway";
import { countryForDataForSeoLocation } from "./ai-visibility";

export const MAX_AI_PANEL_PROMPTS = 10;
export type PanelPromptSnapshot = { id: string; fingerprint: string; question: string };

export function nextPendingPanelPrompt(prompts: PanelPromptSnapshot[], results: { promptFingerprint: string }[]) {
  const done = new Set(results.map((result) => result.promptFingerprint));
  return prompts.find((prompt) => !done.has(prompt.fingerprint)) ?? null;
}

function snapshots(value: unknown): PanelPromptSnapshot[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_AI_PANEL_PROMPTS ||
    value.some((item) => !item || typeof item !== "object" || typeof item.id !== "string" ||
      typeof item.fingerprint !== "string" || typeof item.question !== "string")) {
    throw new Error("Stored AI panel questions are invalid");
  }
  return value as PanelPromptSnapshot[];
}

export async function previewAiPanel(siteId: string, domain: string) {
  const prompts = await db.aiPrompt.findMany({ where: { siteId, active: true }, orderBy: { createdAt: "asc" }, take: MAX_AI_PANEL_PROMPTS + 1 });
  if (!prompts.length) throw new Error("Add at least one active customer question");
  if (prompts.length > MAX_AI_PANEL_PROMPTS) throw new Error(`Run up to ${MAX_AI_PANEL_PROMPTS} active questions at once`);
  if (prompts.some((prompt) => prompt.question.length > 200)) throw new Error("An active question exceeds 200 characters; shorten it before running the panel");
  const settings = await getDataForSeoSettings(siteId, domain);
  const country = countryForDataForSeoLocation(settings.locationCode);
  if (!country || prompts.some((prompt) => prompt.country !== country || prompt.language !== settings.languageCode || prompt.platform !== "CHATGPT_WEB")) {
    throw new Error(`Panel questions must match this site's DataForSEO market (${settings.locationCode}/${settings.languageCode}); UA and US panels are supported`);
  }
  const costs = await Promise.all(prompts.map((prompt) => previewDataForSeo(siteId, domain, "ai_citation", prompt.question, 20)));
  const estimatedUsd = Number(costs.reduce((sum, cost) => sum + cost.estimatedUsd, 0).toFixed(4));
  return { prompts, mode: settings.mode, locationCode: settings.locationCode, languageCode: settings.languageCode,
    estimatedUsd, budgetUsd: costs[0].budgetUsd, spentUsd: costs[0].spentUsd, reservedUsd: costs[0].reservedUsd,
    cachedRequests: costs.reduce((sum, cost) => sum + cost.cachedRequests, 0),
    uncachedRequests: costs.reduce((sum, cost) => sum + cost.uncachedRequests, 0) };
}

/** One cron invocation processes at most one paid question. The saved snapshot and lease make the batch resumable. */
export async function processNextAiPanelPrompt(runId: string) {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + 3 * 60_000);
  const claimed = await db.aiVisibilityRun.updateMany({ where: { id: runId, status: { in: ["QUEUED", "RUNNING"] },
    OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] }, data: { status: "RUNNING", leaseUntil } });
  if (claimed.count !== 1) return { status: "BUSY" as const };
  const run = await db.aiVisibilityRun.findUniqueOrThrow({ where: { id: runId },
    include: { site: { select: { domain: true, userId: true } }, results: { select: { promptFingerprint: true } } } });
  let prompt: PanelPromptSnapshot | null = null;
  let chargedUsd = 0;
  try {
    const confirmedPrompts = snapshots(run.promptSnapshots);
    prompt = nextPendingPanelPrompt(confirmedPrompts, run.results);
    if (!prompt) {
      await db.aiVisibilityRun.update({ where: { id: runId }, data: { status: "COMPLETE", activeKey: null, leaseUntil: null, finishedAt: new Date() } });
      return { status: "COMPLETE" as const };
    }
    const settings = await getDataForSeoSettings(run.siteId, run.site.domain);
    if (settings.mode !== run.mode || settings.locationCode !== run.locationCode || settings.languageCode !== run.languageCode) {
      throw new Error("Provider mode or market changed after confirmation; panel stopped before another request");
    }
    const result = await executeDataForSeo(run.siteId, run.site.userId, run.site.domain, "ai_citation", prompt.question, 20);
    chargedUsd = result.chargedUsd;
    const raw = result.results[0] as Parameters<typeof parseAiCitationSample>[0] | undefined;
    const providerResult = raw?.tasks?.[0]?.result?.[0];
    if (!providerResult || typeof providerResult !== "object") throw new Error("Provider returned no AI answer");
    const sample = parseAiCitationSample(raw, run.site.domain);
    const observedAt = sample.observedAt && !Number.isNaN(Date.parse(sample.observedAt)) ? new Date(sample.observedAt) : null;
    const finished = run.results.length + 1 >= confirmedPrompts.length;
    await db.$transaction(async (tx) => {
      await tx.aiVisibilityResult.create({ data: { siteId: run.siteId, runId, promptId: prompt!.id,
        promptFingerprint: prompt!.fingerprint, questionSnapshot: prompt!.question, status: "OBSERVED",
        siteCited: sample.siteCited, sources: sample.sources, model: sample.model, observedAt, cached: result.cached } });
      await tx.aiVisibilityRun.update({ where: { id: runId }, data: { chargedUsd: { increment: chargedUsd },
        status: finished ? "COMPLETE" : "QUEUED", activeKey: finished ? null : run.siteId,
        leaseUntil: null, finishedAt: finished ? new Date() : null } });
    });
    return { status: finished ? "COMPLETE" as const : "QUEUED" as const };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : "AI panel request failed";
    await db.$transaction(async (tx) => {
      if (prompt) await tx.aiVisibilityResult.create({ data: { siteId: run.siteId, runId, promptId: prompt.id,
        promptFingerprint: prompt.fingerprint, questionSnapshot: prompt.question, status: "ERROR",
        siteCited: false, sources: [], error: message } });
      await tx.aiVisibilityRun.update({ where: { id: runId }, data: { chargedUsd: { increment: chargedUsd },
        status: run.results.length ? "PARTIAL" : "FAILED", activeKey: null, leaseUntil: null,
        error: message, finishedAt: new Date() } });
    });
    return { status: run.results.length ? "PARTIAL" as const : "FAILED" as const, error: message };
  }
}
