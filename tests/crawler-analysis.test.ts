import assert from "node:assert/strict";
import test from "node:test";

import {
  buildInlinkCount,
  computeHealthScore,
  filterIssuesForSearchCandidates,
  findMissingFromSitemap,
  findOrphanPages,
  getIndexingState,
  type LinkSource,
} from "../lib/crawler/analysis";

function page(overrides: Partial<LinkSource> & Pick<LinkSource, "url">): LinkSource {
  return {
    statusCode: 200,
    canonical: null,
    indexable: true,
    internalOutlinks: [],
    ...overrides,
  };
}

test("classifies indexable, excluded, canonicalized, and unsuccessful pages", () => {
  assert.equal(getIndexingState(page({ url: "https://example.com/guide" })), "indexable");
  assert.equal(
    getIndexingState(page({ url: "https://example.com/login", indexable: false })),
    "excluded"
  );
  assert.equal(
    getIndexingState(
      page({
        url: "https://example.com/register?plan=active",
        canonical: "https://example.com/register",
      })
    ),
    "canonicalized"
  );
  assert.equal(
    getIndexingState(page({ url: "https://example.com/missing", statusCode: 404 })),
    "non_success"
  );
});

test("sitemap coverage ignores noindex and canonicalized URL variants", () => {
  const pages = [
    page({ url: "https://example.com/" }),
    page({ url: "https://example.com/guide" }),
    page({ url: "https://example.com/login", indexable: false }),
    page({
      url: "https://example.com/register?plan=active",
      canonical: "https://example.com/register",
    }),
  ];

  const missing = findMissingFromSitemap(pages, ["https://example.com/"]);

  assert.deepEqual(missing.map(({ url }) => url), ["https://example.com/guide"]);
});

test("does not display recommendations for excluded or canonicalized pages", () => {
  const pages = [
    page({ url: "https://example.com/" }),
    page({ url: "https://example.com/login", indexable: false }),
    page({
      url: "https://example.com/register?plan=active",
      canonical: "https://example.com/register",
    }),
  ];
  const issues = [
    { url: "https://example.com/", severity: "WARNING", type: "MISSING_H1" },
    { url: "https://example.com/login", severity: "INFO", type: "MISSING_SCHEMA" },
    {
      url: "https://example.com/",
      severity: "INFO",
      type: "DUPLICATE_DESCRIPTION",
      details: {
        urls: ["https://example.com/", "https://example.com/login"],
      },
    },
    { url: "https://example.com/register?plan=active", severity: "WARNING", type: "MISSING_H1" },
    { url: "https://example.com/sitemap.xml", severity: "WARNING", type: "MISSING_SITEMAP" },
  ];

  assert.deepEqual(
    filterIssuesForSearchCandidates(issues, pages).map(({ url }) => url),
    ["https://example.com/", "https://example.com/sitemap.xml"]
  );
});

test("orphan detection uses incoming links and only evaluates search candidates", () => {
  const pages = [
    page({
      url: "https://example.com/",
      internalOutlinks: [
        "https://example.com/guide",
        "https://example.com/guide",
        "https://example.com/login",
      ],
    }),
    page({ url: "https://example.com/guide" }),
    page({ url: "https://example.com/orphan" }),
    page({ url: "https://example.com/login", indexable: false }),
  ];

  const inlinks = buildInlinkCount(pages);
  const orphans = findOrphanPages(pages, inlinks, "https://example.com/");

  assert.equal(inlinks.get("https://example.com/guide"), 1);
  assert.equal(inlinks.get("https://example.com/login"), 1);
  assert.deepEqual(orphans.map(({ url }) => url), ["https://example.com/orphan"]);
});

test("health scoring only reflects the issues supplied for indexable pages", () => {
  assert.equal(computeHealthScore([], 48), 100);
  assert.equal(computeHealthScore([{ severity: "WARNING" }], 48), 97);
  assert.equal(computeHealthScore([{ severity: "CRITICAL" }], 48), 92);
  assert.equal(computeHealthScore([], 0), 0);
});
