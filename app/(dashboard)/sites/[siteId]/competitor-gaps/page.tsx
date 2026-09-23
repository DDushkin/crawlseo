import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { OperatorResearchClient } from "@/components/research/operator-research-client";

export default async function CompetitorGapsPage({ params }: { params: Promise<{ siteId: string }> }) {
  const session = await auth(); const { siteId } = await params;
  const site = await db.site.findFirst({ where: { id: siteId, userId: session?.user?.id ?? "" }, select: { domain: true } });
  if (!site) redirect("/sites");
  const hasDataForSEO = !!(await db.apiKey.findUnique({ where: { userId_provider: { userId: session!.user!.id!, provider: "dataforseo" } }, select: { id: true } }));
  return <div><PageHeader eyebrow={site.domain} title="Competitor gaps" description="Research a direct competitor's ranking queries, then decide which are relevant to your service pages. Research is sampled and paid only after confirmation." />
    <OperatorResearchClient siteId={siteId} domain={site.domain} hasDataForSEO={hasDataForSEO} initialHistory={[]} kind="competitor_gap" /></div>;
}
