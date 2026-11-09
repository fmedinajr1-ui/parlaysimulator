import { useEffect, useMemo, useState } from "react";
import { ShieldAlert, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { PASS_KEY } from "@/components/AdminGate";
import { MODEL_VERSION } from "@/utils/nbaProjection";
import { skepticalAccuracy, type SkepticalResult } from "@/utils/skepticalAccuracy";
import { AccuracyResearchBot } from "./AccuracyResearchBot";

interface SavedPick extends SkepticalResult {
  id: string; line: number; win_prob: number; hits_l10: number; games_l10: number;
  result_value: number | null; logged_at: string; warnings: string[];
}
export function SkepticalAccuracyPanel({ today, revision }: { today: string; revision: number }) {
  const [rows, setRows] = useState<SavedPick[]>([]);
  const [reviews, setReviews] = useState<SavedPick[]>([]);
  const [kind, setKind] = useState<"pregame" | "review">("pregame");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState("all");
  useEffect(() => {
    let alive = true;
    setBusy(true);
    (async () => {
      try {
        const { data, error: requestError } = await supabase.functions.invoke("desk-bets", {
          body: { action: "skeptical_record", passcode: localStorage.getItem(PASS_KEY) ?? "", model_version: MODEL_VERSION },
        });
        if (requestError || data?.error) throw requestError ?? new Error(data.error);
        if (alive) { setRows(data?.picks ?? []); setReviews(data?.reviews ?? []); setError(false); }
      } catch { if (alive) setError(true); }
      finally { if (alive) setBusy(false); }
    })();
    return () => { alive = false; };
  }, [today, revision, refresh]);
  const active = kind === "pregame" ? rows : reviews;
  const filtered = useMemo(() => selected === "all" ? active : active.filter(r => r.game_date === selected), [active, selected]);
  const summary = skepticalAccuracy(filtered);
  const dates = [...new Set(active.map(r => r.game_date))].sort().reverse();
  return <section aria-label="Complete skeptical shelf accuracy" className="mb-5 border-y border-border py-4">
    <div className="flex items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 font-semibold"><ShieldAlert size={18} className="text-destructive" />Skeptical shelf accuracy</h2>
      <Button variant="ghost" size="icon" title="Refresh saved skeptical results" aria-label="Refresh skeptical results" disabled={busy} onClick={() => setRefresh(r => r + 1)}><RefreshCw size={16} /></Button>
    </div>
    <div className="my-3 flex flex-wrap items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">{MODEL_VERSION} · Full shelf · {kind === "pregame" ? "Pregame records only" : "After-game review"}</span>
      <select aria-label="Skeptical results date" className="rounded-md border border-border bg-background p-2 text-xs" value={selected} onChange={e => setSelected(e.target.value)}>
        <option value="all">All recorded dates</option>{dates.map(date => <option key={date} value={date}>{date}</option>)}
      </select>
    </div>
    <div className="mb-3 flex gap-2" role="group" aria-label="Skeptical record type">
      <Button size="sm" variant={kind === "pregame" ? "secondary" : "ghost"} onClick={()=>{setKind("pregame");setSelected("all");}}>Pregame</Button>
      <Button size="sm" variant={kind === "review" ? "secondary" : "ghost"} onClick={()=>{setKind("review");setSelected("all");}}>After-game review</Button>
    </div>
    {kind === "review" && <p className="mb-3 text-xs text-muted-foreground">Captured after games, not a verified pregame snapshot. Win chances are from the captured shelf; final results are checked against ESPN.</p>}
    <div className="grid grid-cols-3 gap-2 border-b border-border pb-3 font-mono">
      <div><div className="desk-label">Recorded</div><p className="mt-1 text-xl">{summary.total}</p></div>
      <div><div className="desk-label">Won–Lost</div><p className="mt-1 text-xl">{summary.won}–{summary.lost}</p></div>
      <div><div className="desk-label">Accuracy</div><p className="mt-1 text-xl">{summary.accuracy == null ? "—" : `${(summary.accuracy * 100).toFixed(1)}%`}</p></div>
    </div>
    <p className="mt-2 text-xs text-muted-foreground">{summary.open} pending · {summary.push} push · {summary.voided} void. Accuracy excludes pending, pushes and voids.</p>
    <AccuracyResearchBot picks={filtered} kind={kind} />
    {error && <p role="alert" className="mt-3 text-sm text-destructive">Skeptical records could not be loaded. Try refresh.</p>}
    {!busy && !error && !active.length && <p className="mt-3 text-sm text-muted-foreground">{kind === "pregame" ? "No pregame shelf snapshots yet. Earlier unsaved shelves cannot be counted as recorded accuracy." : "No after-game reviews saved yet."}</p>}
    {busy && <p role="status" className="mt-3 text-xs text-muted-foreground">Loading saved shelf…</p>}
    <div className="divide-y divide-border">
      {filtered.map(r => <article key={r.id} className="py-3">
        <div className="flex flex-wrap justify-between gap-2"><h3 className="text-sm font-semibold">{r.player_name}</h3><span className={r.status === "lost" ? "text-xs text-destructive" : "text-xs text-primary"}>{r.status.toUpperCase()}{r.result_value != null ? ` · ${r.result_value}` : ""}</span></div>
        <p className="mt-1 text-xs capitalize">{r.side} {r.line} {r.stat === "threes_made" ? "threes" : r.stat === "pra" ? "points + rebounds + assists" : r.stat}</p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs"><span>{kind === "pregame" ? "Pregame win" : "Captured win"} {Math.round(r.win_prob * 100)}%</span><span>Real L10 {r.hits_l10}/{r.games_l10} · {Math.round(100 * r.hits_l10 / r.games_l10)}%</span></div>
        <p className="mt-1 text-[11px] text-muted-foreground">{r.game_date} · Saved {new Date(r.logged_at).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" })} ET</p>
        <details className="mt-2 text-xs text-muted-foreground"><summary className="cursor-pointer">{r.warnings.length} saved warning{r.warnings.length === 1 ? "" : "s"}</summary><ul className="mt-2 space-y-1">{r.warnings.map(w => <li key={w}>{w}</li>)}</ul></details>
      </article>)}
    </div>
  </section>;
}