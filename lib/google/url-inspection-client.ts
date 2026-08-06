import { getAccessToken } from "./google-auth";

const URL_INSPECTION_API_BASE =
  "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect";

export interface UrlInspectionResult {
  url: string;
  inspectionResult: {
    indexStatusResult?: {
      coverageState: string;
      robotsTexted: boolean;
      robotsAllowed: boolean;
      indexingState: string;
      lastCrawlTime?: string;
      pagesFetched?: number;
      pageFetchedGoogleBot?: number;
      pageIndexed?: boolean;
    };
    mobileUsabilityResult?: {
      mobileFriendliness: string;
      issues: Array<{
        rule: string;
        issueCode: string;
      }>;
    };
  };
}

/**
 * Inspects a URL to check its index status
 */
export async function inspectUrl(
  userId: string,
  siteUrl: string,
  inspectionUrl: string
): Promise<UrlInspectionResult> {
  const accessToken = await getAccessToken(userId);

  const response = await fetch(URL_INSPECTION_API_BASE, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inspectionUrl,
      siteUrl,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(
      `Failed to inspect URL: ${response.statusText} - ${error}`
    );
  }

  const data = (await response.json()) as UrlInspectionResult;

  return data;
}

/**
 * Checks if a URL is indexed in Google
 */
export async function isUrlIndexed(
  userId: string,
  siteUrl: string,
  inspectionUrl: string
): Promise<boolean> {
  try {
    const result = await inspectUrl(userId, siteUrl, inspectionUrl);

    const coverage = result.inspectionResult?.indexStatusResult?.coverageState;

    return (
      coverage === "Indexed" ||
      coverage === "Submitted, but not indexed" ||
      coverage === "Crawled - not indexed"
    );
  } catch {
    // If inspection fails, assume not indexed
    return false;
  }
}

/**
 * Gets the index status for a URL
 */
export async function getIndexStatus(
  userId: string,
  siteUrl: string,
  inspectionUrl: string
): Promise<string | null> {
  try {
    const result = await inspectUrl(userId, siteUrl, inspectionUrl);
    return result.inspectionResult?.indexStatusResult?.coverageState || null;
  } catch {
    return null;
  }
}
