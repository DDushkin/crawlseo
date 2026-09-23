"use client";

import { useRef, useState } from "react";

type CredentialStatus = {
  connected: boolean;
  clientEmail: string | null;
  projectId: string | null;
};

export function Ga4CredentialsSection({ initialStatus }: { initialStatus: CredentialStatus }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState(initialStatus);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function save() {
    const file = fileInput.current?.files?.[0];
    if (!file) { setMessage("Select a service-account JSON key first."); return; }
    setBusy(true);
    setMessage("");
    try {
      if (file.size > 16_384) throw new Error("The JSON key must be 16 KiB or smaller.");
      const credentialJson = await file.text();
      const response = await fetch("/api/user/ga4-credential", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credentialJson }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save GA4 connection.");
      setStatus({ connected: true, clientEmail: data.clientEmail, projectId: data.projectId });
      setMessage("Service account connected. Enter and verify each site's GA4 property ID on AI Visibility.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save GA4 connection.");
    } finally {
      if (fileInput.current) fileInput.current.value = "";
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm("Remove this GA4 service-account connection for all your sites? Historical reports remain, but new syncs will stop.")) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/user/ga4-credential", { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not remove GA4 connection.");
      setStatus({ connected: false, clientEmail: null, projectId: null });
      setMessage("GA4 connection removed. Existing report history was retained.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not remove GA4 connection.");
    } finally {
      if (fileInput.current) fileInput.current.value = "";
      setBusy(false);
    }
  }

  return <section className="panel p-5">
    <h3 className="font-heading text-lg font-semibold text-foreground">Google Analytics 4 connection</h3>
    <p className="mt-2 text-sm text-muted-foreground">Use a service account from a separate Google Cloud project for this SEO operator. It does not change the STRUM web app&apos;s Google sign-in or consent screen.</p>
    <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
      <li>Enable the Google Analytics Data API in that project and create a service account with a JSON key.</li>
      <li>In Google Analytics, grant that service account Viewer access to the GA4 property.</li>
      <li>Upload the JSON key here, then enter the numeric property ID for each site under AI Visibility.</li>
    </ol>
    <p className="mt-3 text-sm">{status.connected ? <>Connected: <span className="break-all font-medium">{status.clientEmail}</span> · project {status.projectId}</> : "No GA4 service account connected."}</p>
    <label className="mt-4 block text-sm" htmlFor="ga4-service-account-file">Service-account JSON key</label>
    <input ref={fileInput} id="ga4-service-account-file" type="file" accept="application/json,.json" disabled={busy} className="mt-1 block max-w-full text-sm" />
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" disabled={busy} onClick={() => void save()} className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">{busy ? "Working…" : status.connected ? "Replace key" : "Connect service account"}</button>
      {status.connected && <button type="button" disabled={busy} onClick={() => void remove()} className="rounded-lg border border-danger/50 px-4 py-2 text-sm text-danger disabled:opacity-50">Remove connection</button>}
    </div>
    <p className="mt-2 text-xs text-muted-foreground">The private key is encrypted on the server and is never displayed again. Keep your original key secure and rotate it in Google Cloud if exposed.</p>
    {message && <p role="status" className="mt-3 text-sm text-muted-foreground">{message}</p>}
  </section>;
}
