import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OperatorResearchClient } from "../components/research/operator-research-client";

test("operator workspace explains the three manual workflows and sandbox limitation", () => {
  const html = renderToStaticMarkup(createElement(OperatorResearchClient, {
    siteId: "strum", domain: "strum.capital", hasDataForSEO: true, initialHistory: [],
  }));
  assert.match(html, /Competitor gaps/);
  assert.match(html, /Paid article checks/);
  assert.match(html, /AI citations/);
  assert.match(html, /Sandbox/);
  assert.match(html, /preview cost/i);
});
