import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseGscAiCsv } from "@/lib/operator/ai-visibility";

export async function POST(req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { siteId } = await params;
  const site = await db.site.findFirst({ where: { id: siteId, userId: session.user.id }, select: { gscProperty: true } });
  if (!site) return Response.json({ error: "Not found" }, { status: 404 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || !/\.csv$/i.test(file.name) || file.size > 100_000) return Response.json({ error: "Select the chart CSV (100 KB maximum)" }, { status: 400 });
  try { const rows = parseGscAiCsv(await file.text());
    return Response.json({ property: site.gscProperty, rowCount: rows.length, firstDate: rows[0].date,
      lastDate: rows.at(-1)!.date, impressions: rows.reduce((sum, row) => sum + row.impressions, 0),
      qualification: "CSV has no authenticated property metadata. You must confirm the source property before importing." }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Invalid CSV" }, { status: 400 }); }
}
