import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Ga4CredentialsSection } from "../components/settings/ga4-credentials-section";

test("GA4 Settings offers a private JSON upload and separate-project guidance", () => {
  const html = renderToStaticMarkup(<Ga4CredentialsSection initialStatus={{ connected: false, clientEmail: null, projectId: null }} />);
  assert.match(html, /type="file"/);
  assert.match(html, /application\/json/);
  assert.match(html, /separate Google Cloud project/i);
  assert.match(html, /Analytics Data API/);
  assert.match(html, /Viewer/);
  assert.doesNotMatch(html, /Authorize GA4 read-only/);
});

test("GA4 Settings shows only account metadata after connection", () => {
  const html = renderToStaticMarkup(<Ga4CredentialsSection initialStatus={{ connected: true, clientEmail: "ga4@example.iam.gserviceaccount.com", projectId: "seo-operator" }} />);
  assert.match(html, /ga4@example.iam.gserviceaccount.com/);
  assert.match(html, /seo-operator/);
  assert.match(html, /Remove connection/);
  assert.doesNotMatch(html, /private_key/);
});
