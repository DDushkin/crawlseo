import { auth } from "@/lib/auth";
import { handleManualGscSync } from "@/lib/gsc/manual-sync-handler";
import { syncGscSite } from "@/lib/gsc/sync-service";

export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  const body = userId ? await req.json().catch(() => null) : null;
  const response = await handleManualGscSync({
    userId,
    body,
    sync: (ownerId, siteId) => syncGscSite(ownerId, siteId, "MANUAL", "auto"),
  });

  return Response.json(response.body, { status: response.status });
}
