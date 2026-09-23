import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { CheckPlacementButton, PlacementForm, PlacementOutcomeButton } from "@/components/operator/placement-controls";
import { placementTotals } from "@/lib/operator/placements";

export default async function PlacementsPage({ params }: { params: Promise<{ siteId: string }> }) {
  const session = await auth();
  const { siteId } = await params;
  const site = await db.site.findFirst({ where: { id: siteId, userId: session?.user?.id ?? "" }, select: { domain: true } });
  if (!site) redirect("/sites");
  const placements = await db.placement.findMany({ where: { siteId }, orderBy: { createdAt: "desc" }, take: 200,
    include: { checks: { orderBy: { checkedAt: "desc" }, take: 1 } } });
  const paid = placementTotals(placements.filter((item) => item.status === "PUBLISHED").map((item) => ({ ...item, totalUah: item.costUah + item.feeUah })));
  const planned = placementTotals(placements.filter((item) => item.status === "PLANNED").map((item) => ({ ...item, totalUah: item.costUah + item.feeUah })));
  return <div><PageHeader eyebrow={site.domain} title="Paid placements" description="Track what was purchased, verify the exact article link, and later compare the linked page's GSC outcome. Domain Rating alone is not ROI." />
    <div className="mb-5 grid gap-3 sm:grid-cols-3"><div className="panel p-4"><p className="text-xs text-muted-foreground">Published spend</p><p className="mt-1 text-2xl font-semibold">{paid.totalUah.toLocaleString()} UAH</p></div><div className="panel p-4"><p className="text-xs text-muted-foreground">Planned spend</p><p className="mt-1 text-2xl font-semibold">{planned.totalUah.toLocaleString()} UAH</p></div><div className="panel p-4"><p className="text-xs text-muted-foreground">Articles recorded</p><p className="mt-1 text-2xl font-semibold">{placements.length}</p></div></div>
    <PlacementForm siteId={siteId} />
    <div className="space-y-3">{placements.map((item) => { const check = item.checks[0]; return <article key={item.id} className="panel p-4"><div className="flex flex-wrap justify-between gap-2"><div><p className="text-sm font-medium">{item.articleTitle || item.publisher}</p><a href={item.articleUrl} target="_blank" rel="noopener noreferrer" className="break-all text-xs text-signal hover:underline">{item.articleUrl}</a></div><span className="text-sm">{item.status} · {(item.costUah + item.feeUah).toLocaleString()} UAH</span></div>
      <p className="mt-2 break-all text-xs text-muted-foreground">Target: {item.targetUrl} · Expected anchor: {item.anchorText || "not recorded"}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3"><CheckPlacementButton siteId={siteId} placementId={item.id} /><PlacementOutcomeButton siteId={siteId} placementId={item.id} /><span className="text-xs text-muted-foreground">{check ? `${check.status.replaceAll("_", " ")} · ${check.checkedAt.toISOString().slice(0, 10)}${check.rel ? ` · rel=${check.rel}` : ""}` : "Not checked"}</span></div>
      {check?.error && <p className="mt-1 text-xs text-muted-foreground">{check.error}</p>}
    </article>; })}{placements.length === 0 && <p className="panel p-5 text-sm text-muted-foreground">No placements recorded yet. Add existing published articles or planned buys to compare cost and link evidence.</p>}</div>
  </div>;
}
