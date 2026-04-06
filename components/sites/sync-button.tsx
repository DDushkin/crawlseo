"use client";

import { useState } from "react";

export function SyncButton({ siteId }: { siteId: string }) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleSync = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    setLoading(true);
    setMessage(null);

    try {
      const response = await fetch("/api/gsc/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId }),
      });

      const data = await response.json();

      if (!response.ok) {
        setMessage(`Error: ${data.error}`);
        return;
      }

      setMessage(
        `Synced! ${data.keywordsInserted} keywords, ${data.pagesInserted} pages`
      );
      setTimeout(() => setMessage(null), 3000);
    } catch (error) {
      setMessage("Sync failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      <button
        onClick={handleSync}
        disabled={loading}
        className="w-full px-3 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white rounded transition-colors font-medium"
      >
        {loading ? "Syncing..." : "Sync Now"}
      </button>
      {message && (
        <p className="text-xs text-center text-slate-600">{message}</p>
      )}
    </div>
  );
}
