import Link from "next/link";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { CreateBriefButton, KeywordTargetForm } from "@/components/operator/workspace-forms";

export default async function KeywordMapPage({ params }: { params: Promise<{ siteId: string }> }) {
  const session = await auth();
  const { siteId } = await params;
  const site = await db.site.findFirst({ where: { id: siteId, userId: session?.user?.id ?? "" }, select: { domain: true } });
  if (!site) redirect("/sites");
  const [pages, targets] = await Promise.all([
    db.sitePage.findMany({ where: { siteId, state: "ACTIVE" }, orderBy: { url: "asc" }, select: { id: true, url: true }, take: 500 }),
    db.keywordTarget.findMany({ where: { siteId }, orderBy: { updatedAt: "desc" }, take: 500, include: { page: { select: { url: true } }, _count: { select: { briefs: true } } } }),
  ]);
  return <div>
    <PageHeader eyebrow={site.domain} title="Keyword map" description="Decide which customer queries deserve a page. Assignments are explicit; GSC rankings alone do not decide your strategy." />
    <KeywordTargetForm siteId={siteId} pages={pages} country="UA" language="uk" />
    {pages.length === 0 && <p className="mb-4 text-sm text-warning">Add managed pages in the <Link href={`/sites/${siteId}/page-inventory`} className="underline">page inventory</Link> to target an existing page.</p>}
    <div className="panel overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead><tr className="border-b border-border text-left text-xs uppercase text-muted-foreground"><th className="p-4">Query</th><th className="p-4">Decision</th><th className="p-4">Target</th><th className="p-4">Market</th><th className="p-4">Briefs</th><th className="p-4">Next</th></tr></thead><tbody className="divide-y divide-border/50">{targets.map((target) => <tr key={target.id}><td className="p-4 font-medium">{target.query}</td><td className="p-4">{target.decision.replaceAll("_", " ").toLowerCase()}</td><td className="max-w-xs break-all p-4">{target.page?.url || "—"}</td><td className="p-4">{target.country}/{target.language}</td><td className="p-4">{target._count.briefs}</td><td className="p-4"><CreateBriefButton siteId={siteId} targetId={target.id} /></td></tr>)}</tbody></table>{targets.length === 0 && <p className="p-5 text-sm text-muted-foreground">No confirmed targets. Start with a query from GSC or a customer question.</p>}</div>
    <p className="mt-4 text-sm text-muted-foreground"><Link href={`/sites/${siteId}/content-briefs`} className="text-signal hover:underline">Review brief history</Link></p>
  </div>;
}
