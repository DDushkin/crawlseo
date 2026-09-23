import { createPrivateKey, sign } from "node:crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/analytics.readonly";

export type Ga4ServiceAccount = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

export function parseGa4ServiceAccount(raw: string): Ga4ServiceAccount {
  if (Buffer.byteLength(raw, "utf8") > 16_384) throw new Error("GA4 key exceeds size limit");

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Invalid GA4 service-account key");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid GA4 service-account key");
  }
  const data = value as Record<string, unknown>;
  if (data.type !== "service_account" || data.token_uri !== TOKEN_URL ||
      typeof data.project_id !== "string" || typeof data.client_email !== "string" ||
      typeof data.private_key !== "string" ||
      !data.client_email.endsWith(`@${data.project_id}.iam.gserviceaccount.com`)) {
    throw new Error("Invalid GA4 service-account key");
  }
  try {
    if (createPrivateKey(data.private_key).asymmetricKeyType !== "rsa") {
      throw new Error("Non-RSA key");
    }
  } catch {
    throw new Error("Invalid GA4 service-account key");
  }
  return { projectId: data.project_id, clientEmail: data.client_email, privateKey: data.private_key };
}

function base64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export async function getGa4ServiceAccountToken(account: Ga4ServiceAccount, now = new Date()): Promise<string> {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const header = base64url({ alg: "RS256", typ: "JWT" });
  const claims = base64url({ iss: account.clientEmail, scope: SCOPE, aud: TOKEN_URL,
    iat: issuedAt, exp: issuedAt + 3600 });
  const input = `${header}.${claims}`;
  const signature = sign("RSA-SHA256", Buffer.from(input), account.privateKey).toString("base64url");
  let response: Response;
  try {
    response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${input}.${signature}` }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error("GA4 service-account token request failed");
  }
  if (!response.ok) throw new Error(`GA4 service-account token request failed (HTTP ${response.status})`);
  const data = await response.json().catch(() => null) as { access_token?: unknown } | null;
  if (typeof data?.access_token !== "string" || !data.access_token) {
    throw new Error("GA4 service-account token response was invalid");
  }
  return data.access_token;
}
