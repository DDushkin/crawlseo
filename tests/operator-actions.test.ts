import assert from "node:assert/strict";
import test from "node:test";
import {
  actionFingerprint,
  priorityForFinding,
  upsertDetectedAction,
  validateActionTransition,
} from "../lib/operator/actions";

test("action fingerprint is stable for the same page and query but changes with finding type", () => {
  const first = actionFingerprint({ type: "content_decay", pageUrl: "https://WWW.strum.capital/blog/x/#part", query: "  ОВДП  " });
  const repeat = actionFingerprint({ type: "content_decay", pageUrl: "https://www.strum.capital/blog/x", query: "овдп" });
  const different = actionFingerprint({ type: "low_ctr", pageUrl: "https://www.strum.capital/blog/x", query: "овдп" });
  assert.equal(first, repeat);
  assert.notEqual(first, different);
});

test("critical availability finding outranks larger ordinary traffic upside", () => {
  const critical = priorityForFinding({ severity: "critical", expectedClicks: null, confidence: "high", effort: "medium" });
  const ordinary = priorityForFinding({ severity: "high", expectedClicks: 1000, confidence: "high", effort: "low" });
  assert.ok(critical > ordinary);
});

test("repeat detection refreshes evidence but does not reset the user's status", async () => {
  let where: unknown;
  let update: Record<string, unknown> | undefined;
  const repository = {
    sitePage: { findUnique: async () => ({ id: "page-1" }) },
    seoAction: {
      upsert: async (args: { where: unknown; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        where = args.where;
        update = args.update;
        assert.equal(args.create.pageId, "page-1");
        assert.equal(args.update.pageId, "page-1");
        return { id: "action-1", status: "PLANNED" };
      },
    },
  };
  const result = await upsertDetectedAction("site-1", {
    type: "content_decay",
    title: "Refresh the OVDP page",
    rationale: "Clicks declined across two finalized 28-day periods.",
    recommendation: "Review and update the page with current examples.",
    pageUrl: "https://www.strum.capital/features/ovdp-tracker/",
    query: null,
    severity: "high",
    expectedClicks: null,
    confidence: "medium",
    effort: "medium",
    evidence: { source: "GSC", startDate: "2026-08-01", endDate: "2026-08-28", previousClicks: 40, currentClicks: 20 },
  }, repository as unknown as Parameters<typeof upsertDetectedAction>[2]);
  assert.equal(result.status, "PLANNED");
  assert.deepEqual(where, { siteId_fingerprint: { siteId: "site-1", fingerprint: actionFingerprint({ type: "content_decay", pageUrl: "https://www.strum.capital/features/ovdp-tracker/", query: null }) } });
  assert.ok(update?.evidence);
  assert.equal(update?.status, undefined);
  assert.equal(update?.completedAt, undefined);
});

test("completed action cannot be silently moved back into progress", () => {
  assert.equal(validateActionTransition("NEW", "PLANNED"), true);
  assert.equal(validateActionTransition("COMPLETED", "IN_PROGRESS"), false);
  assert.equal(validateActionTransition("DISMISSED", "NEW"), true);
});
