"use client";

import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface TrafficChartProps {
  siteId: string;
  days?: number;
}

interface ChartData {
  date: string;
  clicks: number;
  impressions: number;
}

function formatAxisDate(value: string) {
  const d = new Date(`${value}T00:00:00Z`);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function TrafficChart({ siteId, days = 90 }: TrafficChartProps) {
  const [data, setData] = useState<ChartData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/sites/${siteId}/traffic?days=${days}`);
        if (!res.ok) throw new Error("Failed to load traffic");
        const json = (await res.json()) as ChartData[];
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load chart");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [siteId, days]);

  if (loading) {
    return (
      <div className="panel flex h-80 items-center justify-center">
        <p className="text-atom-body text-muted-foreground">Loading traffic…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="panel flex h-80 items-center justify-center">
        <p className="text-atom-body text-danger">{error}</p>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="panel flex h-80 flex-col items-center justify-center gap-2">
        <p className="font-heading text-atom-subheader font-medium text-foreground">
          No traffic yet
        </p>
        <p className="text-atom-body text-muted-foreground">
          Sync GSC data to populate the last {days} days.
        </p>
      </div>
    );
  }

  const info = "#0284FE";
  const success = "#36AB80";
  const axis = "#8A94A6";
  const grid = "#E1E4E8";

  return (
    <div className="panel p-5 sm:p-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="font-heading text-atom-subheader font-semibold text-foreground">
            Search traffic
          </h3>
          <p className="text-atom-caption text-muted-foreground">
            Daily clicks & impressions · last {days} days
          </p>
        </div>
        <div className="flex gap-4 text-atom-caption">
          <span className="inline-flex items-center gap-2 text-muted-foreground">
            <span className="size-2 rounded-full" style={{ background: info }} /> Clicks
          </span>
          <span className="inline-flex items-center gap-2 text-muted-foreground">
            <span className="size-2 rounded-full" style={{ background: success }} /> Impressions
          </span>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={320}>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="clicksFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={info} stopOpacity={0.28} />
              <stop offset="100%" stopColor={info} stopOpacity={0} />
            </linearGradient>
            <linearGradient id="imprFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={success} stopOpacity={0.18} />
              <stop offset="100%" stopColor={success} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={grid} strokeDasharray="4 6" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={formatAxisDate}
            tick={{ fill: axis, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            minTickGap={28}
          />
          <YAxis
            yAxisId="clicks"
            tick={{ fill: axis, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={40}
          />
          <YAxis
            yAxisId="impressions"
            orientation="right"
            tick={{ fill: axis, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={48}
          />
          <Tooltip
            contentStyle={{
              background: "#FFFFFF",
              border: "1px solid #E1E4E8",
              borderRadius: 12,
              fontSize: 12,
              boxShadow: "0 0 1px 0 rgba(8,11,14,0.06), 0 16px 16px -1px rgba(8,11,14,0.1)",
              color: "#0A1F44",
            }}
            labelFormatter={(label) => formatAxisDate(String(label))}
            formatter={(value, name) => [
              typeof value === "number" ? value.toLocaleString() : value,
              name === "clicks" ? "Clicks" : "Impressions",
            ]}
          />
          <Area
            yAxisId="impressions"
            type="monotone"
            dataKey="impressions"
            stroke={success}
            fill="url(#imprFill)"
            strokeWidth={2}
            isAnimationActive={false}
          />
          <Area
            yAxisId="clicks"
            type="monotone"
            dataKey="clicks"
            stroke={info}
            fill="url(#clicksFill)"
            strokeWidth={2}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
