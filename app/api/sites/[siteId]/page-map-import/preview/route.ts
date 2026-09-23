import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseImportFile } from "@/lib/operator/import";

export async function POST(req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { siteId } = await params;
  const site = await db.site.findFirst({ where: { id: siteId, userId: session.user.id }, select: { id: true } });
  if (!site) return Response.json({ error: "Not found" }, { status: 404 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "CSV or XLSX file required" }, { status: 400 });
  try { return Response.json(await parseImportFile(file)); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Invalid import file" }, { status: 400 }); }
}
