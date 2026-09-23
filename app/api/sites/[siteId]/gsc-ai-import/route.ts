import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { toDbDate, pacificDateLabel } from "@/lib/gsc/date-range";
import { parseGscAiCsv } from "@/lib/operator/ai-visibility";

export async function POST(req: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { siteId } = await params;
  const site = await db.site.findFirst({ where: { id: siteId, userId: session.user.id }, select: { gscProperty: true } });
  if (!site) return Response.json({ error: "Not found" }, { status: 404 });
  if (!site.gscProperty) return Response.json({ error: "Connect the selected GSC property first" }, { status: 409 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const property = form?.get("property");
  if (!(file instanceof File) || !/\.csv$/i.test(file.name) || file.size > 100_000) return Response.json({ error: "Select the chart CSV from Search Console (100 KB maximum)" }, { status: 400 });
  if (property !== site.gscProperty || form?.get("confirmedProperty") !== "true") return Response.json({ error: "Confirm that this export is from the selected GSC property" }, { status: 400 });
  let rows: ReturnType<typeof parseGscAiCsv>;
  let csv: string;
  try { csv = await file.text(); rows = parseGscAiCsv(csv); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Invalid CSV" }, { status: 400 }); }
  if (rows.some((row) => row.date > pacificDateLabel(new Date()))) return Response.json({ error: "Export contains a future date" }, { status: 400 });
  const fileHash = createHash("sha256").update(csv).digest("hex");
  const existing = await db.gscAiImport.findUnique({ where: { siteId_property_fileHash: { siteId, property: site.gscProperty, fileHash } }, select: { id: true } });
  if (existing) return Response.json({ imported: false, rows: rows.length, reason: "This exact file was already imported" });
  let imported: { id: string };
  try { imported = await db.$transaction(async (tx) => {
    const stillSelected = await tx.site.findFirst({ where: { id: siteId, userId: session.user.id, gscProperty: site.gscProperty }, select: { id: true } });
    if (!stillSelected) throw new Error("Selected GSC property changed during import");
    const batch = await tx.gscAiImport.create({ data: { siteId, property: site.gscProperty!, fileName: file.name.slice(0, 200), fileHash,
      rowCount: rows.length, firstDate: toDbDate(rows[0].date), lastDate: toDbDate(rows.at(-1)!.date) } });
    for (const row of rows) {
      await tx.gscAiDaily.upsert({ where: { siteId_property_date: { siteId, property: site.gscProperty!, date: toDbDate(row.date) } },
        create: { siteId, property: site.gscProperty!, date: toDbDate(row.date), impressions: row.impressions },
        update: { impressions: row.impressions, importedAt: new Date() } });
    }
    return batch;
  }); }
  catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return Response.json({ imported: false, rows: rows.length, reason: "This exact file was already imported" });
    }
    if (error instanceof Error && error.message === "Selected GSC property changed during import") {
      return Response.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
  return Response.json({ imported: true, rows: rows.length, importId: imported.id,
    qualification: "User-attested GSC chart export. CSV does not embed a verifiable property identifier; export zeros can include unavailable values." });
}
