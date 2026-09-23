"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Preview = { headers: string[]; rows: string[][] };
type Column = "url" | "query" | "pageType" | "intent" | "notes";
const columns: { key: Column; label: string }[] = [
  { key: "url", label: "Page URL" }, { key: "query", label: "Target query" },
  { key: "pageType", label: "Page type" }, { key: "intent", label: "Intent" }, { key: "notes", label: "Notes" },
];

export function PageMapImport({ siteId }: { siteId: string }) {
  const router = useRouter();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<Column, number>>({ url: -1, query: -1, pageType: -1, intent: -1, notes: -1 });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  async function upload(file: File) {
    setBusy(true); setError(""); setResult(""); setPreview(null);
    try {
      const form = new FormData(); form.set("file", file);
      const response = await fetch(`/api/sites/${siteId}/page-map-import/preview`, { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not preview file");
      setPreview(data);
      const headers = (data.headers as string[]).map((header) => header.toLowerCase());
      setMapping({ url: headers.findIndex((header) => /^(url|page url|page|сторінка|посилання)$/.test(header.trim())),
        query: headers.findIndex((header) => /^(keyword|query|ключ|запит)$/.test(header.trim())),
        pageType: headers.findIndex((header) => /^(type|page type|тип)$/.test(header.trim())),
        intent: headers.findIndex((header) => /^(intent|інтент)$/.test(header.trim())),
        notes: headers.findIndex((header) => /^(notes|note|примітки)$/.test(header.trim())) });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not preview file"); }
    finally { setBusy(false); }
  }
  async function commit() {
    if (!preview || mapping.url < 0) return;
    setBusy(true); setError("");
    const rows = preview.rows.filter((row) => row.some((cell) => cell.trim())).map((row) => {
      const field = (key: Column) => mapping[key] < 0 ? "" : (row[mapping[key]] || "");
      return { url: field("url"), query: field("query"), pageType: field("pageType"), intent: field("intent"), notes: field("notes") };
    });
    try {
      const response = await fetch(`/api/sites/${siteId}/page-map-import`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not import rows");
      setResult(`Imported ${data.pages} pages and ${data.targets} keyword assignments.`);
      setPreview(null); router.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not import rows"); }
    finally { setBusy(false); }
  }
  return <section className="panel mb-5 p-4"><h2 className="font-heading text-base font-semibold">Import page map</h2>
    <p className="mt-1 text-xs text-muted-foreground">CSV or XLSX, first worksheet, up to 1 MB. Preview the columns before saving. All rows must belong to this site.</p>
    <input type="file" accept=".csv,.xlsx" className="mt-3 block text-sm" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
    {preview && <div className="mt-4"><p className="text-sm">{preview.rows.length} rows found. Choose the columns:</p><div className="mt-2 grid gap-2 sm:grid-cols-3">{columns.map((column) => <label key={column.key} className="text-xs text-muted-foreground">{column.label}<select className="mt-1 w-full rounded-lg border border-border bg-card p-2 text-sm" value={mapping[column.key]} onChange={(event) => setMapping({ ...mapping, [column.key]: Number(event.target.value) })}><option value={-1}>Not included</option>{preview.headers.map((header, index) => <option key={index} value={index}>{header || `Column ${index + 1}`}</option>)}</select></label>)}</div>
      <div className="mt-4 overflow-x-auto"><table className="min-w-full text-xs"><tbody>{preview.rows.slice(0, 5).map((row, index) => <tr key={index} className="border-t border-border">{row.slice(0, 8).map((cell, col) => <td key={col} className="max-w-40 truncate p-2">{cell}</td>)}</tr>)}</tbody></table></div>
      <button className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50" disabled={busy || mapping.url < 0 || preview.rows.length > 500} onClick={() => void commit()}>{busy ? "Importing…" : "Confirm import"}</button>
      {preview.rows.length > 500 && <p className="mt-2 text-xs text-warning">Split this file into batches of up to 500 data rows.</p>}
    </div>}
    {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}{result && <p role="status" className="mt-2 text-sm text-signal">{result}</p>}
  </section>;
}
