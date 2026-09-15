import { calculatePercentChange } from "../date-utils";
import type { AggregatedGscMetrics } from "./types";

type MetricInput = { clicks: number; impressions: number; position: number };

export function aggregateGscMetrics(rows: MetricInput[]): AggregatedGscMetrics {
  const clicks = rows.reduce((sum, row) => sum + row.clicks, 0);
  const impressions = rows.reduce((sum, row) => sum + row.impressions, 0);
  if (impressions === 0) return { clicks, impressions, ctr: null, position: null };
  const weightedPosition = rows.reduce(
    (sum, row) => sum + row.position * row.impressions,
    0
  );
  return {
    clicks,
    impressions,
    ctr: clicks / impressions,
    position: weightedPosition / impressions,
  };
}

export function compareGscMetrics(current: AggregatedGscMetrics, previous: AggregatedGscMetrics) {
  return {
    clicks: calculatePercentChange(current.clicks, previous.clicks),
    impressions: calculatePercentChange(current.impressions, previous.impressions),
    ctr: current.ctr === null || previous.ctr === null
      ? null
      : calculatePercentChange(current.ctr, previous.ctr),
    position: current.position === null || previous.position === null
      ? null
      : previous.position - current.position,
  };
}
