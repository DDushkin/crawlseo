import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OperatorResearchClient } from "../components/research/operator-research-client";

test("each research page presents one workflow and its own run history", () => {
  for (const [kind, label] of [["competitor_gap", "Competitor gaps"], ["placement", "Paid article checks"], ["ai_citation", "AI citations"]] as const) {
    const html = renderToStaticMarkup(createElement(OperatorResearchClient, {
      siteId: "strum", domain: "strum.capital", hasDataForSEO: true, initialHistory: [], kind,
    }));
    assert.match(html, new RegExp(label));
    assert.match(html, /Previous runs/);
    assert.match(html, /Sandbox/);
    assert.match(html, /preview cost/i);
    for (const other of ["Competitor gaps", "Paid article checks", "AI citations"].filter((name) => name !== label)) {
      assert.doesNotMatch(html, new RegExp(`<h2[^>]*>${other}`));
    }
  }
});
