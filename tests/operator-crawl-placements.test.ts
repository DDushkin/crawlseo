import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { compareCrawlIssues, compareAndStoreCompletedCrawl, crawlActionShouldDeactivate } from "../lib/operator/crawl-diff";
import { normalizePlacement, placementTotals, matchingArticleLinks, isPublicAddress, extractArticleLinks } from "../lib/operator/placements";
import { db } from "../lib/db";

function intercept(t: TestContext, target: object, method: string, fn: (...args: never[]) => unknown) {
  const original = Object.getOwnPropertyDescriptor(target, method);
  Object.defineProperty(target, method, { configurable: true, value: fn });
  t.after(() => { if (original) Object.defineProperty(target, method, original); else Reflect.deleteProperty(target, method); });
}

test("crawl comparison classifies new, persistent, and resolved issues without treating a failed crawl as baseline", () => {
  const prior = [
    { url: "https://strum.capital/a", type: "BROKEN_LINK", severity: "CRITICAL", message: "404" },
    { url: "https://strum.capital/b", type: "MISSING_TITLE", severity: "WARNING", message: "No title" },
  ];
  const next = [
    { url: "https://strum.capital/a", type: "BROKEN_LINK", severity: "CRITICAL", message: "404" },
    { url: "https://strum.capital/c", type: "MISSING_H1", severity: "WARNING", message: "No H1" },
  ];
  const diff = compareCrawlIssues(prior, next);
  assert.equal(diff.filter((item) => item.status === "NEW").length, 1);
  assert.equal(diff.filter((item) => item.status === "PERSISTENT").length, 1);
  assert.equal(diff.filter((item) => item.status === "RESOLVED").length, 1);
  assert.equal(crawlActionShouldDeactivate({ status: "RESOLVED", severity: "CRITICAL" }, true), true);
  assert.equal(crawlActionShouldDeactivate({ status: "PERSISTENT", severity: "WARNING" }, true), true);
  assert.equal(crawlActionShouldDeactivate({ status: "RESOLVED", severity: "CRITICAL" }, false), false);
});

test("crawl comparison and action writes share one transaction so failed actions can be retried", async (t) => {
  const current = { id: "crawl-1", finishedAt: new Date("2026-09-23"), auditPages: [],
    issues: [{ url: "https://strum.capital/missing", type: "BROKEN_LINK", severity: "CRITICAL", message: "404", details: null }] };
  intercept(t, db.crawl, "findFirst", async ({ where }: { where: { id?: string } }) => where.id ? current : null);
  intercept(t, db.site, "findUniqueOrThrow", async () => ({ domain: "strum.capital" }));
  intercept(t, db.crawlComparison, "findUnique", async () => null);
  let createdInsideTransaction = false;
  let committed = false;
  intercept(t, db, "$transaction", async (callback: (tx: object) => Promise<unknown>) => {
    const result = await callback({
      crawlComparison: { create: async () => { createdInsideTransaction = true; return { id: "comparison-1" }; } },
      sitePage: { findUnique: async () => null },
      seoAction: { upsert: async () => { assert.equal(createdInsideTransaction, true); throw new Error("action write failed"); } },
    });
    committed = true;
    return result;
  });
  await assert.rejects(compareAndStoreCompletedCrawl("site-1", "crawl-1"), /action write failed/);
  assert.equal(createdInsideTransaction, true);
  assert.equal(committed, false);
});

test("article verification blocks private addresses and recognizes exact HTML links", () => {
  assert.equal(isPublicAddress("127.0.0.1"), false);
  assert.equal(isPublicAddress("169.254.169.254"), false);
  assert.equal(isPublicAddress("::ffff:127.0.0.1"), false);
  assert.equal(isPublicAddress("93.184.215.14"), true);
  const links = extractArticleLinks('<a href="https://www.strum.capital/features/ovdp-tracker/" rel="sponsored nofollow">трекер ОВДП</a>', "https://publisher.example/article");
  assert.equal(links[0].targetUrl, "https://www.strum.capital/features/ovdp-tracker/");
  assert.equal(links[0].rel, "sponsored nofollow");
});

test("placement validates source and destination and keeps cost in UAH", () => {
  const result = normalizePlacement("strum.capital", {
    articleUrl: "https://delo.ua/article", targetUrl: "https://www.strum.capital/", costUah: 7500, feeUah: 1012.5,
  });
  assert.equal(result.totalUah, 8512.5);
  assert.equal(placementTotals([result]).totalUah, 8512.5);
  assert.throws(() => normalizePlacement("strum.capital", { articleUrl: "https://strum.capital/article", targetUrl: "https://strum.capital/", costUah: 100, feeUah: 0 }), /Publisher/);
});

test("placement matching requires exact article and target URLs", () => {
  const matches = matchingArticleLinks("https://delo.ua/article", "https://strum.capital/", [
    { sourceUrl: "https://delo.ua/article-other", targetUrl: "https://strum.capital/", anchorText: "bad", dofollow: true },
    { sourceUrl: "https://delo.ua/article", targetUrl: "https://strum.capital/", anchorText: "Strum", dofollow: false },
  ]);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].anchorText, "Strum");
});
