import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/encryption";
import { getGa4ServiceAccountToken, parseGa4ServiceAccount } from "@/lib/google/ga4-service-account";

const responseHeaders = { "Cache-Control": "no-store" };

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401, headers: responseHeaders });
  try {
    const credential = await db.ga4Credential.findUnique({
      where: { userId: session.user.id }, select: { clientEmail: true, projectId: true },
    });
    return Response.json(credential ? { connected: true, ...credential } :
      { connected: false, clientEmail: null, projectId: null }, { headers: responseHeaders });
  } catch {
    return Response.json({ error: "Could not load GA4 connection" }, { status: 500, headers: responseHeaders });
  }
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401, headers: responseHeaders });
  const body = await request.json().catch(() => null) as { credentialJson?: unknown } | null;
  if (typeof body?.credentialJson !== "string" || Buffer.byteLength(body.credentialJson, "utf8") > 16_384) {
    return Response.json({ error: "Select a valid service-account JSON key (16 KiB maximum)" },
      { status: 400, headers: responseHeaders });
  }
  let account: ReturnType<typeof parseGa4ServiceAccount>;
  try {
    account = parseGa4ServiceAccount(body.credentialJson);
    await getGa4ServiceAccountToken(account);
  } catch {
    return Response.json({ error: "GA4 key could not be validated or authorized. Check the JSON key and service-account project." },
      { status: 400, headers: responseHeaders });
  }
  try {
    const encryptedJson = encrypt(body.credentialJson);
    await db.ga4Credential.upsert({
      where: { userId: session.user.id },
      create: { userId: session.user.id, encryptedJson,
        clientEmail: account.clientEmail, projectId: account.projectId },
      update: { encryptedJson,
        clientEmail: account.clientEmail, projectId: account.projectId },
    });
    return Response.json({ connected: true, clientEmail: account.clientEmail, projectId: account.projectId },
      { status: 201, headers: responseHeaders });
  } catch {
    return Response.json({ error: "Could not save GA4 connection" }, { status: 500, headers: responseHeaders });
  }
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401, headers: responseHeaders });
  try {
    await db.$transaction(async (tx) => {
      await tx.ga4Credential.deleteMany({ where: { userId: session.user.id } });
      await tx.site.updateMany({ where: { userId: session.user.id }, data: { lastGa4SyncAt: null } });
    });
    return Response.json({ connected: false }, { headers: responseHeaders });
  } catch {
    return Response.json({ error: "Could not remove GA4 connection" }, { status: 500, headers: responseHeaders });
  }
}
