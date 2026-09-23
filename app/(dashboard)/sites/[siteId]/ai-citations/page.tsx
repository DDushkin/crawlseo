import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { OperatorResearchClient } from "@/components/research/operator-research-client";
import { AiPromptPanel } from "@/components/operator/ai-prompt-panel";

export default async function AiCitationsPage({ params }: { params: Promise<{ siteId: string }> }) {
  const session = await auth(); const { siteId } = await params;
  const site = await db.site.findFirst({ where: { id: siteId, userId: session?.user?.id ?? "" }, select: { domain: true } });
  if (!site) redirect("/sites");
  const [hasDataForSEO, prompts] = await Promise.all([
    db.apiKey.findUnique({ where: { userId_provider: { userId: session!.user!.id!, provider: "dataforseo" } }, select: { id: true } }),
    db.aiPrompt.findMany({ where: { siteId }, orderBy: [{ active: "desc" }, { createdAt: "asc" }], take: 100 }),
  ]);
  return <div><PageHeader eyebrow={site.domain} title="AI citations" description="Build a stable question panel and inspect individual ChatGPT web-search citations. Samples are not a record of real user prompts or an overall visibility rate." />
    <AiPromptPanel siteId={siteId} prompts={prompts} />
    <OperatorResearchClient siteId={siteId} domain={site.domain} hasDataForSEO={!!hasDataForSEO} initialHistory={[]} kind="ai_citation" /></div>;
}
