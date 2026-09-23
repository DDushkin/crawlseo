import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { GscDataHealthPanel } from "@/components/sites/gsc-data-health";
import { getGscDataHealth } from "@/lib/gsc/health";
import { ActionControls, DetectActionsButton } from "@/components/operator/action-controls";

type Action = Awaited<ReturnType<typeof loadActions>>[number];
async function loadActions(siteId: string) {
  return db.seoAction.findMany({ where: { siteId }, orderBy: [{ priority: "desc" }, { lastSeenAt: "desc" }], take: 100,
    include: { changes: { orderBy: { createdAt: "desc" }, take: 1, include: { outcome: true } } } });
}

function Evidence({ action }: { action: Action }) {
  const raw = action.evidence;
  const evidence = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const source = typeof evidence.source === "string" ? evidence.source.replaceAll("_", " ") : "Recorded evidence";
  const start = typeof evidence.currentStart === "string" ? evidence.currentStart : null;
  const end = typeof evidence.currentEnd === "string" ? evidence.currentEnd : null;
  return <p className="mt-2 text-xs text-muted-foreground">Source: {source}{start && end ? ` · ${start} to ${end}` : ""} · confidence {action.confidence} · effort {action.effort}
    {action.expectedClicks !== null ? ` · estimated upside ${action.expectedClicks} clicks` : " · no numeric uplift claimed"}</p>;
}

function ActionCard({ siteId, action }: { siteId: string; action: Action }) {
  const change = action.changes[0];
  return <article id={`action-${action.id}`} className="panel p-5"><div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
    <span className="rounded bg-muted px-2 py-1">{action.status.replaceAll("_", " ")}</span><span>{action.severity}</span><span>Priority {action.priority}</span>
    {!action.signalActive && <span className="text-warning">Signal no longer present in latest complete check</span>}</div>
    <h3 className="mt-2 font-heading text-lg font-semibold">{action.title}</h3>
    {action.pageUrl && <a href={action.pageUrl} target="_blank" rel="noopener noreferrer" className="mt-1 block break-all text-xs text-signal hover:underline">{action.pageUrl}</a>}
    {action.query && <p className="mt-1 text-xs text-muted-foreground">Query: {action.query}</p>}
    <p className="mt-2 text-sm text-muted-foreground">{action.rationale}</p><p className="mt-2 text-sm"><span className="font-medium">Next step:</span> {action.recommendation}</p>
    <Evidence action={action} />
    {change && <div className="mt-3 rounded-lg border border-border p-3 text-xs"><p><span className="font-medium">Changed {change.changedAt.toISOString().slice(0, 10)}:</span> {change.description}</p>
      <p className="mt-1 text-muted-foreground">{change.outcome ? change.outcome.status === "OBSERVED" ?
        `Observed GSC clicks ${change.outcome.clickDelta !== null && change.outcome.clickDelta > 0 ? "+" : ""}${change.outcome.clickDelta ?? "unavailable"} (${change.outcome.clickChangePct ?? "n/a"}%). ${change.outcome.qualification}` : change.outcome.qualification :
        `Awaiting comparable GSC data through ${change.afterEnd.toISOString().slice(0, 10)} plus finalization.`}</p></div>}
    <ActionControls siteId={siteId} action={{ id: action.id, status: action.status, notes: action.notes,
      owner: action.owner, dueAt: action.dueAt?.toISOString() ?? null }} />
  </article>;
}

export default async function ActionsPage({ params }: { params: Promise<{ siteId: string }> }) {
  const session = await auth(); const { siteId } = await params;
  const site = await db.site.findFirst({ where: { id: siteId, userId: session?.user?.id ?? "" }, select: { domain: true } });
  if (!site) redirect("/sites");
  const [actions, health] = await Promise.all([loadActions(siteId), getGscDataHealth(siteId)]);
  const open = actions.filter((action) => action.signalActive && ["NEW", "PLANNED", "IN_PROGRESS"].includes(action.status));
  const inactive = actions.filter((action) => !action.signalActive && ["NEW", "PLANNED", "IN_PROGRESS"].includes(action.status));
  const history = actions.filter((action) => !["NEW", "PLANNED", "IN_PROGRESS"].includes(action.status));
  return <div><PageHeader eyebrow={site.domain} title="Action backlog" description="A small, durable work queue: inspect evidence, plan the fix, record the change, then compare equivalent GSC periods." actions={<DetectActionsButton siteId={siteId} />} />
    <GscDataHealthPanel health={health} />
    <p className="mb-5 text-xs text-muted-foreground">Free-data detection uses only complete finalized GSC windows. A failed or stale sync does not turn missing data into a zero or a new recommendation. Critical crawl findings also enter this queue after a completed crawl comparison.</p>
    <div className="mb-5 grid gap-3 sm:grid-cols-3"><div className="panel p-4"><p className="text-xs text-muted-foreground">Active work</p><p className="mt-1 text-2xl font-semibold">{open.length}</p></div>
      <div className="panel p-4"><p className="text-xs text-muted-foreground">Awaiting measurement</p><p className="mt-1 text-2xl font-semibold">{history.filter((item) => item.status === "COMPLETED" && item.changes[0] && !item.changes[0].outcome).length}</p></div>
      <div className="panel p-4"><p className="text-xs text-muted-foreground">Observed outcomes</p><p className="mt-1 text-2xl font-semibold">{history.filter((item) => item.changes[0]?.outcome?.status === "OBSERVED").length}</p></div></div>
    <h2 className="mb-3 font-heading text-xl font-semibold">Work next</h2>{open.length ? <div className="space-y-3">{open.map((action) => <ActionCard key={action.id} siteId={siteId} action={action} />)}</div> :
      <div className="panel p-5 text-sm text-muted-foreground">No active recommendations yet. Refresh after a complete GSC sync, or inspect the page and keyword map for strategic work.</div>}
    {inactive.length > 0 && <details className="mt-6"><summary className="cursor-pointer font-heading text-lg font-semibold">Signals no longer present ({inactive.length})</summary>
      <div className="mt-3 space-y-3">{inactive.map((action) => <ActionCard key={action.id} siteId={siteId} action={action} />)}</div></details>}
    {history.length > 0 && <details className="mt-6"><summary className="cursor-pointer font-heading text-lg font-semibold">Completed and dismissed history ({history.length})</summary>
      <div className="mt-3 space-y-3">{history.map((action) => <ActionCard key={action.id} siteId={siteId} action={action} />)}</div></details>}
  </div>;
}
