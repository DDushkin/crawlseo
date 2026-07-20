/**
 * Google Autocomplete suggestions — free, no API key needed.
 * Server-side only to avoid CORS issues.
 */

export async function fetchSuggestions(
  query: string,
  language = "en"
): Promise<string[]> {
  if (!query.trim()) return [];

  const url = new URL("https://suggestqueries.google.com/complete/search");
  url.searchParams.set("client", "firefox");
  url.searchParams.set("q", query);
  url.searchParams.set("hl", language);

  try {
    const res = await fetch(url.toString(), {
      headers: { "User-Agent": "Mozilla/5.0" },
    });

    if (!res.ok) return [];

    // Response format: [query, [suggestion1, suggestion2, ...]]
    const json = await res.json();
    if (Array.isArray(json) && Array.isArray(json[1])) {
      return json[1].filter((s: unknown): s is string => typeof s === "string");
    }

    return [];
  } catch (error) {
    console.error("Google Autocomplete error:", error);
    return [];
  }
}
