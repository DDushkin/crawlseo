import {
  GscSyncError,
  type GscSyncErrorCode,
  type GscSyncResult,
} from "./sync-service";

type ErrorBody = { error: string; code?: GscSyncErrorCode };

export type ManualGscSyncResponse = {
  status: number;
  body: GscSyncResult | ErrorBody;
};

export type HandleManualGscSyncInput = {
  userId: string | null;
  body: unknown;
  sync: (userId: string, siteId: string) => Promise<GscSyncResult>;
};

const ERROR_MESSAGES: Record<GscSyncErrorCode, string> = {
  NOT_FOUND: "Site or synchronization run was not found.",
  UNAUTHORIZED: "You do not own this site.",
  NO_PROPERTY: "Connect a Search Console property first.",
  REAUTH_REQUIRED: "Your Google connection has expired. Please reconnect your account.",
  PROVIDER_ERROR: "Search Console synchronization failed. Please try again.",
};

function errorResponse(code: GscSyncErrorCode): ManualGscSyncResponse {
  const status = code === "REAUTH_REQUIRED" ? 401
    : code === "NOT_FOUND" || code === "UNAUTHORIZED" ? 404
    : code === "NO_PROPERTY" ? 400
    : 502;
  return { status, body: { error: ERROR_MESSAGES[code], code } };
}

function sanitizedErrorCode(code: string | undefined): GscSyncErrorCode {
  return code === "NOT_FOUND" || code === "UNAUTHORIZED" || code === "NO_PROPERTY" ||
    code === "REAUTH_REQUIRED" || code === "PROVIDER_ERROR" ? code : "PROVIDER_ERROR";
}

function isBodyWithSiteId(body: unknown): body is { siteId: string } {
  return Boolean(body) && typeof body === "object" && typeof (body as { siteId?: unknown }).siteId === "string";
}

export async function handleManualGscSync({
  userId,
  body,
  sync,
}: HandleManualGscSyncInput): Promise<ManualGscSyncResponse> {
  if (!userId) return { status: 401, body: { error: "Unauthorized" } };
  if (!isBodyWithSiteId(body)) return { status: 400, body: { error: "A site ID is required." } };

  try {
    const result = await sync(userId, body.siteId);
    if (result.status === "already-running") return { status: 409, body: result };
    if (result.status === "failed") return errorResponse(sanitizedErrorCode(result.error?.code));
    return { status: 200, body: result };
  } catch (error) {
    if (error instanceof GscSyncError) return errorResponse(error.code);
    return errorResponse("PROVIDER_ERROR");
  }
}
