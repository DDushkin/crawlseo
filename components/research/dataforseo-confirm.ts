export async function confirmDataForSeoRequest(
  siteId: string,
  kind: "keywords" | "domain" | "backlinks" | "competitor_gap" | "placement" | "ai_citation",
  target: string,
  limit?: number
): Promise<boolean> {
  const res = await fetch(`/api/sites/${siteId}/dataforseo/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, target, limit }),
  });
  const preview = await res.json();
  if (!res.ok) throw new Error(preview.error || "Could not preview provider cost");
  if (preview.mode === "SANDBOX") {
    return window.confirm(`DataForSEO Sandbox is free, but returns dummy values. Do not use these values for SEO decisions. Run ${preview.uncachedRequests} sandbox request(s)?`);
  }
  const remaining = Math.max(0, preview.budgetUsd - preview.spentUsd - preview.reservedUsd);
  return window.confirm(
    `DataForSEO Live for ${preview.target}${preview.marketApplies ? ` (${preview.languageCode}/${preview.locationCode})` : " (global backlink index)"}.\n` +
    `Planning estimate: $${preview.estimatedUsd.toFixed(3)}; cache hits: ${preview.cachedRequests}.\n` +
    `Pilot budget remaining: $${remaining.toFixed(3)}. Actual provider billing can vary. Continue?`
  );
}
