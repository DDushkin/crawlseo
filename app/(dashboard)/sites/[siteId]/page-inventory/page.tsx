import Link from "next/link";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { PageInventoryForm } from "@/components/operator/workspace-forms";
import { PageMapImport } from "@/components/operator/page-map-import";

export default async function PageInventoryPage({ params }: { params: Promise<{ siteId: string }> }) {
  const session = await auth();
  const { siteId } = await params;
  const site = await db.site.findFirst({ where: { id: siteId, userId: session?.user?.id ?? "" }, select: { domain: true } });
  if (!site) redirect("/sites");
  const pages = await db.sitePage.findMany({ where: { siteId }, orderBy: { url: "asc" }, take: 500,
    include: { _count: { select: { keywordTargets: true, actions: true, contentBriefs: true } } } });
  return <div>
    <PageHeader eyebrow={site.domain} title="Page inventory" description="Durable pages you manage, distinct from daily Search Console landing-page rows." />
    <PageInventoryForm siteId={siteId} />
    <PageMapImport siteId={siteId} />
    <div className="panel overflow-x-auto"><table className="w-full min-w-[640px] text-sm"><thead><tr className="border-b border-border text-left text-xs uppercase text-muted-foreground"><th className="p-4">Page</th><th className="p-4">Type</th><th className="p-4">State</th><th className="p-4 text-right">Targets</th><th className="p-4 text-right">Actions</th></tr></thead><tbody className="divide-y divide-border/50">{pages.map((page) => <tr key={page.id}><td className="p-4"><a href={page.url} target="_blank" rel="noopener noreferrer" className="break-all text-signal hover:underline">{page.url}</a></td><td className="p-4">{page.pageType || "—"}</td><td className="p-4">{page.state}</td><td className="p-4 text-right">{page._count.keywordTargets}</td><td className="p-4 text-right">{page._count.actions}</td></tr>)}</tbody></table>{pages.length === 0 && <p className="p-5 text-sm text-muted-foreground">No managed pages yet. Add your important service or blog pages to start a keyword map.</p>}</div>
    <p className="mt-4 text-sm text-muted-foreground">Need Google performance by URL? <Link href={`/sites/${siteId}/pages`} className="text-signal hover:underline">Open GSC pages</Link>.</p>
  </div>;
}
