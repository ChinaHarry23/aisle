"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { WorkflowJob } from "@/lib/workflow/types";

type Snapshot = { enabled: boolean; jobs: WorkflowJob[]; worker: { online: boolean; lastSeen: string | null } };
export default function OperationsPage() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [retrying, setRetrying] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false, loading = false;
    const refresh = async () => {
      if (loading) return;
      loading = true;
      try {
        const res = await fetch("/api/engine/jobs", { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Workflow unavailable.");
        if (!cancelled) { setSnapshot(data); setError(""); }
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : "Connection failed."); }
      finally { loading = false; }
    };
    void refresh();
    const timer = setInterval(refresh, 2000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);
  async function retry(id: string) {
    if (!window.confirm("A provider call may have completed before the worker stopped. Check provider usage first. Retry from the last saved checkpoint?")) return;
    setRetrying(id);
    try {
      const response = await fetch(`/api/engine/jobs/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmRetry: true }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Retry failed."); }
    finally { setRetrying(null); }
  }
  return <div className="flex flex-col gap-6">
    <header><p className="text-xs uppercase tracking-widest text-signal">AHR 01-06 / service operations</p><h1 className="mt-2 font-serif text-4xl">Work continues off-screen.</h1><p className="mt-3 max-w-3xl text-sm text-ink-soft">The web app submits a durable job. A separate agent worker performs the hand-offs, saves each completed step and stops for your approval. Closing the browser does not cancel the job.</p></header>
    <aside className="hairline bg-surface p-4 text-sm"><strong>Prototype boundaries:</strong> publishing records a simulated release; channel metrics and internal retail signals are synthetic. Public research and configured LLM / ComfyUI adapters can make real calls. No social platform receives a post from this workflow.</aside>
    {error && <p role="alert" className="hairline p-4 text-red-700">{error}</p>}
    {!snapshot ? <p role="status">Checking workflow services...</p> : !snapshot.enabled ? <section className="hairline p-5"><h2 className="font-medium">Service mode is not running.</h2><p className="mt-2 text-sm">From the project directory, run <code>npm run dev:services</code>. It starts the web app, workflow API and agent worker. Existing legacy campaigns are preserved; create a new draft to exercise the durable workflow.</p></section> : <>
      <div className="hairline p-4 text-sm" role="status">Worker: <strong>{snapshot.worker.online ? "online" : "offline / waiting for heartbeat"}</strong>{snapshot.worker.lastSeen && <span className="ml-3 text-mute">Last seen {new Date(snapshot.worker.lastSeen).toLocaleTimeString()}</span>}<p className="mt-1 text-mute">Jobs are saved before execution. Interrupted calls require an explicit retry; they are never silently replayed.</p></div>
      <section className="overflow-x-auto border-y border-line"><table className="w-full text-left text-sm"><caption className="py-4 text-left font-medium">Your latest 50 workflow jobs</caption><thead><tr className="border-b border-line"><th className="p-3">Campaign / command</th><th className="p-3">State</th><th className="p-3">Last confirmed progress</th><th className="p-3">Action</th></tr></thead><tbody>{snapshot.jobs.map(job => <tr key={job.id} className="border-b border-line"><td className="p-3"><Link href={`/campaigns/${job.campaignId}`} className="text-signal underline">{job.result?.campaign.name || job.campaignId}</Link><p className="mt-1 text-xs text-mute">{job.command} / {new Date(job.updatedAt).toLocaleString()}</p></td><td className="p-3">{job.status}</td><td className="max-w-xl p-3">{job.message}<p className="mt-1 text-xs text-mute">{job.result?.run.step || "Waiting for first checkpoint"}</p></td><td className="p-3">{["failed", "interrupted"].includes(job.status) && <button disabled={retrying !== null} className="rounded-full border border-ink px-3 py-1 disabled:opacity-40" onClick={() => void retry(job.id)}>{retrying === job.id ? "Queuing..." : "Review and retry"}</button>}</td></tr>)}</tbody></table>{snapshot.jobs.length === 0 && <p className="p-4 text-mute">Create and launch a new campaign to see the service hand-offs.</p>}</section>
    </>}
  </div>;
}
