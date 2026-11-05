import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { callResearchAi, Prose } from "@/components/research/ResearchAiPanel";

export function MathSlip({ today }: { today: string }) {
  const [top, setTop] = useState<string | null>(null);
  const [topAt, setTopAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [job, setJob] = useState<{
    last_run_at: string | null;
    paused_reason: string | null;
    last_report: Record<string, { skipped?: string; error?: string }> | null;
  } | null>(null);

  const [msgs, setMsgs] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [input, setInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatErr, setChatErr] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const [{ data: rep }, { data: js }] = await Promise.all([
          supabase
            .from("research_ai_reports" as never)
            .select("content,created_at")
            .eq("kind", "top_plays")
            .eq("game_date", today)
            .order("created_at", { ascending: false })
            .limit(1),
          supabase
            .from("research_job_state" as never)
            .select("last_run_at,paused_reason,last_report")
            .eq("job", "research-daily")
            .maybeSingle(),
        ]);
        const r = (rep as { content: string; created_at: string }[] | null)?.[0];
        if (r) {
          setTop(r.content);
          setTopAt(r.created_at);
        }
        setJob(js as never);
      } catch (e) {
        setErr(String(e));
      }
    })();
  }, [today]);

  useEffect(() => endRef.current?.scrollIntoView({ block: "nearest" }), [msgs]);

  const refreshTop = async () => {
    setBusy(true);
    setErr(null);
    try {
      setTop(await callResearchAi({ mode: "top" }));
      setTopAt(new Date().toISOString());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    const q = input.trim();
    if (!q || chatBusy) return;
    const next = [...msgs, { role: "user" as const, content: q }];
    setMsgs(next);
    setInput("");
    setChatBusy(true);
    setChatErr(null);
    try {
      setMsgs([...next, { role: "assistant", content: await callResearchAi({ mode: "chat", messages: next }) }]);
    } catch (e) {
      setChatErr((e as Error).message);
      setInput(q);
      setMsgs(msgs);
    } finally {
      setChatBusy(false);
    }
  };

  const linesNote = job?.last_report?.lines?.skipped;

  return (
    <div className="flex flex-col gap-3">
      <section className="desk-panel desk-indigo-glow p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="desk-label">Math slip</div>
            <h2 className="desk-display text-base font-semibold">AI Top Plays · {today}</h2>
          </div>
          <button className="desk-btn" onClick={refreshTop} disabled={busy}>
            {busy ? "Thinking…" : "Refresh"}
          </button>
        </div>

        <div className="desk-scroll mt-3 max-h-72 overflow-y-auto pr-1">
          {top ? (
            <Prose text={top} />
          ) : (
            <p className="text-sm text-[hsl(var(--desk-muted))]">
              No top plays yet today. They're written automatically once sportsbook lines load (daily, 8 AM ET).
            </p>
          )}
        </div>

        {topAt && <p className="desk-mono mt-2 text-[11px] text-[hsl(var(--desk-muted))]">Updated {new Date(topAt).toLocaleTimeString()}</p>}
        {err && <p className="desk-mono mt-2 text-sm text-[hsl(var(--desk-loss))]">{err}</p>}

        <div className="desk-mono mt-3 space-y-0.5 border-t border-[hsl(var(--desk-line))] pt-2 text-[11px] text-[hsl(var(--desk-muted))]">
          <div>Last daily update: {job?.last_run_at ? new Date(job.last_run_at).toLocaleString() : "never"}</div>
          {linesNote && <div className="text-[hsl(var(--desk-loss))]">Sportsbook lines: {linesNote}</div>}
          {job?.paused_reason && <div className="text-[hsl(var(--desk-loss))]">AI paused: {job.paused_reason}</div>}
        </div>
      </section>

      <section className="desk-panel flex flex-col p-4">
        <div className="desk-label">Ask the data</div>
        <h2 className="desk-display mb-2 text-base font-semibold">Chat the box scores</h2>

        <div className="desk-scroll max-h-64 flex-1 space-y-3 overflow-y-auto pr-1">
          {!msgs.length && (
            <p className="text-sm text-[hsl(var(--desk-muted))]">
              Try: "Who's hot on rebounds?" or "How has Jalen Brunson been scoring?"
            </p>
          )}
          {msgs.map((m, i) => (
            <div
              key={i}
              className={
                m.role === "user"
                  ? "desk-mono ml-auto max-w-[85%] rounded-lg bg-[hsl(var(--desk-amber))] px-3 py-2 text-sm text-[hsl(30_60%_8%)]"
                  : "max-w-full"
              }
            >
              {m.role === "user" ? m.content : <Prose text={m.content} />}
            </div>
          ))}
          {chatBusy && <p className="desk-mono text-sm text-[hsl(var(--desk-muted))]">Thinking…</p>}
          <div ref={endRef} />
        </div>

        {chatErr && <p className="desk-mono mt-2 text-sm text-[hsl(var(--desk-loss))]">{chatErr}</p>}

        <div className="mt-3 flex items-end gap-2">
          <textarea
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about any player…"
            className="desk-input flex-1 resize-none px-3 py-2"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button className="desk-btn desk-btn-solid self-end" onClick={send} disabled={chatBusy || !input.trim()}>
            Send
          </button>
        </div>
      </section>
    </div>
  );
}
