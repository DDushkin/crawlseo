import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { SaveKeywordForm, DeleteKeywordButton } from "@/components/sites/saved-keyword-actions";
import { PositionBadge, NumCell, CtrCell } from "@/components/ui/data-table";
import { getGscSavedQueryMetrics } from "@/lib/seo-metrics";

interface Props {
  params: Promise<{ siteId: string }>;
}

export default async function SavedKeywordsPage({ params }: Props) {
  const session = await auth();
  const { siteId } = await params;

  const site = await db.site.findUnique({
    where: { id: siteId },
    select: { userId: true, domain: true },
  });
  if (!site || site.userId !== session?.user?.id) redirect("/sites");

  const saved = await db.savedKeyword.findMany({
    where: { siteId },
    orderBy: { createdAt: "desc" },
  });

  const dataMap = await getGscSavedQueryMetrics(siteId, saved.map((s) => s.query), 28);

  return (
    <div>
      <PageHeader
        eyebrow={site.domain}
        title="Saved Keywords"
        description="Track specific keywords over time"
        actions={<SaveKeywordForm siteId={siteId} />}
      />

      {saved.length === 0 ? (
        <EmptyState
          icon="⭐"
          title="No saved keywords"
          description="Save keywords you want to track closely. Use the form above to add your first keyword."
        />
      ) : (
        <div className="panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border/70 bg-muted/30">
                  <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    Keyword
                  </th>
                  <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    Notes
                  </th>
                  <th className="px-4 py-3 text-right text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    Position
                  </th>
                  <th className="px-4 py-3 text-right text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    Clicks
                  </th>
                  <th className="px-4 py-3 text-right text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    Impr.
                  </th>
                  <th className="px-4 py-3 text-right text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    CTR
                  </th>
                  <th className="px-4 py-3 text-right text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {saved.map((kw) => {
                  const data = dataMap.get(kw.query);
                  return (
                    <tr key={kw.id} className="transition-colors hover:bg-muted/25">
                      <td className="px-4 py-3 font-medium text-foreground">
                        {kw.query}
                      </td>
                      <td className="max-w-xs truncate px-4 py-3 text-muted-foreground">
                        {kw.notes || "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {data ? <PositionBadge position={data.position} /> : "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {data ? <NumCell value={data.clicks} /> : "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {data ? <NumCell value={data.impressions} /> : "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {data ? <CtrCell ctr={data.ctr} /> : "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <DeleteKeywordButton siteId={siteId} query={kw.query} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="border-t border-border/60 bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
            {saved.length} saved keywords · last 28 days aggregated
          </div>
        </div>
      )}
    </div>
  );
}
