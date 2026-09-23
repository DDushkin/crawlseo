import assert from "node:assert/strict";
import test from "node:test";
import { buildDataForSeoRequest, normalizeDataForSeoTarget } from "../lib/dataforseo/gateway";
import { parseCompetitorGap, parsePlacementCheck, parseAiCitationSample } from "../lib/dataforseo/client";

const market = { locationCode: 2804, languageCode: "uk" };

test("competitor gap compares the selected site's domain against the competitor in Ukraine", () => {
  const spec = buildDataForSeoRequest("competitor_gap", "competitor.ua", "strum.capital", market, 20);
  assert.equal(spec.endpoint, "/dataforseo_labs/google/domain_intersection/live");
  assert.deepEqual(spec.params, {
    target1: "competitor.ua", target2: "strum.capital", intersections: false,
    item_types: ["organic"], location_code: 2804, language_code: "uk",
    include_serp_info: false, limit: 20,
  });
});

test("placement check filters exact source article while targeting this site", () => {
  const spec = buildDataForSeoRequest("placement_check", "https://delo.ua/story/123", "strum.capital", market, 20);
  assert.equal(spec.endpoint, "/backlinks/backlinks/live");
  assert.deepEqual(spec.params, {
    target: "strum.capital", mode: "as_is", filters: ["url_from", "=", "https://delo.ua/story/123"],
    limit: 20, offset: 0,
  });
});

test("AI citation sample forces web search and uses the site's market", () => {
  const spec = buildDataForSeoRequest("ai_citation", "Який застосунок для обліку інвестицій?", "strum.capital", market, 20);
  assert.equal(spec.endpoint, "/ai_optimization/chat_gpt/llm_scraper/live/advanced");
  assert.deepEqual(spec.params, {
    keyword: "Який застосунок для обліку інвестицій?", force_web_search: true,
    location_code: 2804, language_code: "uk",
  });
  assert.ok(spec.timeoutMs >= 120_000);
  assert.equal(spec.estimatedUsd, 0.004);
});

test("invalid placement URLs and own-domain competitors fail before any provider call", () => {
  assert.throws(() => normalizeDataForSeoTarget("http://localhost/admin", "placement"), /public article URL/);
  assert.throws(() => normalizeDataForSeoTarget("https://delo.ua/a?x=1", "placement"), /public article URL/);
  assert.throws(() => buildDataForSeoRequest("competitor_gap", "strum.capital", "strum.capital", market, 20), /different domain/);
});

test("competitor gaps retain the ranking page and search metrics", () => {
  const result = parseCompetitorGap({ tasks: [{ result: [{ items: [{
    keyword_data: { keyword: "трекер ОВДП", keyword_info: { search_volume: 90 }, keyword_properties: { keyword_difficulty: 17 }, search_intent_info: { main_intent: "commercial" } },
    first_domain_serp_element: { rank_group: 5, url: "https://competitor.ua/ovdp" },
  }] }] }] });
  assert.deepEqual(result, [{ keyword: "трекер ОВДП", volume: 90, difficulty: 17, intent: "commercial", competitorRank: 5, competitorUrl: "https://competitor.ua/ovdp" }]);
});

test("a missing provider-indexed placement is unknown, not proven absent", () => {
  const result = parsePlacementCheck({ tasks: [{ result: [{ items: [] }] }] }, "https://delo.ua/story/123");
  assert.deepEqual(result, { observed: false, links: [] });
});

test("AI citation parser counts final-answer sources, not merely search results", () => {
  const result = parseAiCitationSample({ tasks: [{ result: [{
    model: "gpt-test", datetime: "2026-09-23 10:00:00 +00:00",
    markdown: "Some answer", search_results: [{ domain: "strum.capital", url: "https://strum.capital/" }],
    sources: [{ domain: "example.ua", url: "https://example.ua/guide", title: "Guide" }],
  }] }] }, "strum.capital");
  assert.equal(result.siteCited, false);
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].domain, "example.ua");
  assert.equal(result.model, "gpt-test");
});
