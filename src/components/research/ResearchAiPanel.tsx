import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export async function callResearchAi(body: Record<string, unknown>): Promise<string> {
  const { data, error } = await supabase.functions.invoke("research-ai", { body });
  if (error) {
    let msg = error.message;
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx) msg = (await ctx.json())?.error ?? msg;
    } catch { /* keep msg */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data.text as string;
}

function Prose({ text }: { text: string }) {
  return (
    <div className="space-y-1 text-sm leading-relaxed">
      {text.split("\n").filter(Boolean).map((l, i) => (
        <p key={i} dangerouslySetInnerHTML={{ __html: l.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\*\*(.+?)\*\*/g, "<b>$1</b>") }} />
      ))}
    </div>
  );
}
export { Prose };

export function ResearchAiPanel({ today }: { today: string }) {
  const [top, setTop] = useState<string | null>(null);
  const [topAt, setTopAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [job, setJob] = useState<{ last_run_at: string | null; paused_reason: string | null; last_report: Record<string, { skipped?: string; error?: string }> | null } | null>(null);
  const [msgs, setMsgs] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [input, setInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatErr, setChatErr] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const [{ data: rep }, { data: js }] = await Promise.all([
          supabase.from("research_ai_reports" as never).select("content,created_at").eq("kind", "top_plays").eq("game_date", today).order("created_at", { ascending: false }).limit(1),
          supabase.from("research_job_state" as never).select("last_run_at,paused_reason,last_report").eq("job", "research-daily").maybeSingle(),
        ]);
        const r = (rep as { content: string; created_at: string }[] | null)?.[0];
        if (r) { setTop(r.content); setTopAt(r.created_at); }
        setJob(js as never);
      } catch (e) { setErr(String(e)); }
    })();
  }, [today]);

  useEffect(() => endRef.current?.scrollIntoView({ block: "nearest" }), [msgs]);

  const refreshTop = async () => {
    setBusy(true); setErr(null);
    try { setTop(await callResearchAi({ mode: "top" })); setTopAt(new Date().toISOString()); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const send = async () => {
    const q = input.trim();
    if (!q || chatBusy) return;
    const next = [...msgs, { role: "user" as const, content: q }];
    setMsgs(next); setInput(""); setChatBusy(true); setChatErr(null);
    try { setMsgs([...next, { role: "assistant", content: await callResearchAi({ mode: "chat", messages: next }) }]); }
    catch (e) { setChatErr((e as Error).message); setInput(q); setMsgs(msgs); }
    finally { setChatBusy(false); }
  };

  const linesNote = job?.last_report?.lines?.skipped;

  return (
    <div className="grid gap-4 lg:grid-cols-2 mb-6">
      <section className="rounded-md border border-border p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-bold">AI Top Plays · {today}</h2>
          <Button size="sm" variant="outline" onClick={refreshTop} disabled={busy}>{busy ? "Thinking…" : "Refresh"}</Button>
        </div>
        {top ? <Prose text={top} /> : <p className="text-sm text-muted-foreground">No top plays yet today. They're written automatically once sportsbook lines load (daily, 8 AM ET).</p>}
        {topAt && <p className="text-xs text-muted-foreground mt-2">Updated {new Date(topAt).toLocaleTimeString()}</p>}
        {err && <p className="text-sm text-destructive mt-2">{err}</p>}
        <div className="text-xs text-muted-foreground mt-3 border-t border-border pt-2 space-y-0.5">
          <div>Last daily update: {job?.last_run_at ? new Date(job.last_run_at).toLocaleString() : "never"}</div>
          {linesNote && <div className="text-destructive">Sportsbook lines: {linesNote}</div>}
          {job?.paused_reason && <div className="text-destructive">AI paused: {job.paused_reason}</div>}
        </div>
      </section>

      <section className="rounded-md border border-border p-4 flex flex-col">
        <h2 className="font-bold mb-2">Ask the data</h2>
        <div className="flex-1 max-h-64 overflow-y-auto space-y-3 mb-2">
          {!msgs.length && <p className="text-sm text-muted-foreground">Try: "Who's hot on rebounds?" or "How has Jalen Brunson been scoring?"</p>}
          {msgs.map((m, i) => (
            <div key={i} className={m.role === "user" ? "ml-auto max-w-[85%] rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm" : "max-w-full"}>
              {m.role === "user" ? m.content : <Prose text={m.content} />}
            </div>
          ))}
          {chatBusy && <p className="text-sm text-muted-foreground">Thinking…</p>}
          <div ref={endRef} />
        </div>
        {chatErr && <p className="text-sm text-destructive mb-2">{chatErr}</p>}
        <div className="flex gap-2">
          <Textarea rows={2} value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about any player…"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
          <Button onClick={send} disabled={chatBusy || !input.trim()} className="self-end">Send</Button>
        </div>
      </section>
    </div>
  );
}
