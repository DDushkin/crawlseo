"use client";

import { useEffect, useState } from "react";

type Settings = {
  mode: "SANDBOX" | "LIVE";
  locationCode: number;
  languageCode: string;
  spentUsd: number;
  reservedUsd: number;
  budgetUsd: number;
};
type Run = {
  id: string;
  operation: string;
  target: string;
  mode: string;
  status: string;
  chargedUsd: number | null;
  createdAt: string;
};

export function DataForSeoSettingsSection({ siteId, hasKey }: { siteId: string; hasKey: boolean }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [mode, setMode] = useState<"SANDBOX" | "LIVE">("SANDBOX");
  const [locationCode, setLocationCode] = useState("2804");
  const [languageCode, setLanguageCode] = useState("uk");
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [checkingBalance, setCheckingBalance] = useState(false);

  useEffect(() => {
    fetch(`/api/sites/${siteId}/dataforseo/settings`).then(async (res) => {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load settings");
      setSettings(data.settings);
      setRuns(data.runs ?? []);
      setMode(data.settings.mode);
      setLocationCode(String(data.settings.locationCode));
      setLanguageCode(data.settings.languageCode);
    }).catch((error) => setError(error instanceof Error ? error.message : "Could not load settings"));
  }, [siteId]);

  async function save() {
    if (!settings) return;
    if (mode === "LIVE" && !window.confirm("Enable paid DataForSEO Live requests for this site? Each request still needs confirmation. The $0.15 site guard reserves $0.06 per request, but provider-reported charges can differ; it is not a hard account spending limit.")) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/sites/${siteId}/dataforseo/settings`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, locationCode: Number(locationCode), languageCode: languageCode.trim().toLowerCase(), acknowledgePaid: mode === "LIVE" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save settings");
      setSettings(data.settings);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save settings");
    } finally {
      setSaving(false);
    }
  }

  async function checkBalance() {
    setCheckingBalance(true);
    setError(null);
    try {
      const res = await fetch(`/api/sites/${siteId}/dataforseo/balance`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Balance check failed");
      setBalance(data.balanceUsd);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Balance check failed");
    } finally {
      setCheckingBalance(false);
    }
  }

  return (
    <div className="panel p-5">
      <h3 className="font-heading text-lg font-semibold text-foreground">DataForSEO for this site</h3>
      <p className="mt-1 text-sm text-muted-foreground">Sandbox is free but synthetic. Live requires confirmation for every request. The $0.15 per-site guard reserves $0.06 for each in-flight request; actual provider charges may differ, so this is not a guaranteed account spending cap.</p>
      {settings && (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <label className="text-sm">Mode
              <select value={mode} onChange={(e) => setMode(e.target.value as "SANDBOX" | "LIVE")} className="mt-1 block w-full rounded-lg border border-border bg-background p-2">
                <option value="SANDBOX">Sandbox (dummy data)</option>
                <option value="LIVE" disabled={!hasKey}>Live (billable)</option>
              </select>
            </label>
            <label className="text-sm">Location code
              <input type="number" value={locationCode} onChange={(e) => setLocationCode(e.target.value)} className="mt-1 block w-full rounded-lg border border-border bg-background p-2" />
            </label>
            <label className="text-sm">Language code
              <input value={languageCode} onChange={(e) => setLanguageCode(e.target.value)} className="mt-1 block w-full rounded-lg border border-border bg-background p-2" />
            </label>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Ukraine/Ukrainian: 2804 / uk. United States/English: 2840 / en. Each site has independent market settings.</p>
          <p className="mt-3 text-sm">Live charged: <strong>${settings.spentUsd.toFixed(4)}</strong> / ${settings.budgetUsd.toFixed(2)}; in flight: ${settings.reservedUsd.toFixed(4)}</p>
          {hasKey && <p className="mt-2 text-sm">Provider account balance: {balance === null ? "not checked" : `$${balance.toFixed(4)}`} <button type="button" onClick={checkBalance} disabled={checkingBalance} className="ml-2 text-primary underline disabled:opacity-50">{checkingBalance ? "Checking…" : "Check balance (free)"}</button></p>}
          <button type="button" onClick={save} disabled={saving || (mode === "LIVE" && !hasKey)} className="mt-3 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">{saving ? "Saving…" : "Save provider settings"}</button>
        </>
      )}
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      {runs.length > 0 && (
        <div className="mt-5">
          <h4 className="text-sm font-semibold">Recent provider requests</h4>
          <div className="mt-2 space-y-1 text-xs text-muted-foreground">
            {runs.map((run) => <p key={run.id}>{new Date(run.createdAt).toLocaleString()} · {run.mode} · {run.operation} · {run.target} · {run.status} · ${run.chargedUsd?.toFixed(4) ?? "pending"}</p>)}
          </div>
        </div>
      )}
    </div>
  );
}
