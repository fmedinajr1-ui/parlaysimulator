import { useEffect, useState } from "react";
import "@/components/desk/desk-tokens.css";
import { DeskTopBar } from "@/components/desk/DeskTopBar";
import { supabase } from "@/integrations/supabase/client";
import { PASS_KEY } from "@/components/AdminGate";
import type { MethodResult, Price } from "@/utils/gameModels";

interface BoardGame { home: string; away: string; start?: string; total: number | null; homeSpread: number | null; homeML: Price | null; awayML: Price | null; paceFatigue: MethodResult; sharpStructure: MethodResult }
const fmt = (o?: number) => (o == null ? "—" : o > 0 ? `+${o}` : String(o));
const time = (s?: string) => (s ? new Date(s).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }) + " ET" : "");

function Method({ title, r }: { title: string; r: MethodResult }) {
  return (
    <div className="desk-panel-flat flex-1 p-3">
      <div className="desk-label">{title}</div>
      {r.plays.length ? r.plays.map((p) => (
        <div key={p.pick} className="mt-2">
          <div className="desk-mono text-sm font-bold text-[hsl(var(--desk-amber))]">{p.pick} <span className="text-muted-foreground">{fmt(p.odds)} · {p.book}</span></div>
          <div className="text-xs text-muted-foreground">{p.reason}</div>
        </div>
      )) : <div className="mt-2 text-sm text-muted-foreground">No play</div>}
      <ul className="mt-2 space-y-0.5 text-[11px] text-muted-foreground">{r.notes.map((n) => <li key={n}>{n}</li>)}</ul>
    </div>
  );
}

interface Rec { won: number; lost: number; push: number; open: number; units: number }
interface GameRecord { summary: Record<string, Rec>; recent: { game_date: string; method: string; pick: string; odds: number; status: string; home_score: number | null; away_score: number | null; profit_units: number | null; home: string; away: string }[] }
const line = (r?: Rec) => (r ? `${r.won}–${r.lost}${r.push ? `–${r.push}` : ""} · ${r.units >= 0 ? "+" : ""}${r.units}u${r.open ? ` · ${r.open} pending` : ""}` : "—");

function RecordPanel({ rec }: { rec: GameRecord }) {
  const rows = [["pace_fatigue", "Pace & Fatigue"], ["sharp_structure", "Sharp & Structure"]] as const;
  return (
    <section className="desk-panel mt-3 p-3">
      <div className="desk-label">Running record (1 unit per play, saved before tip-off)</div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {rows.map(([k, name]) => (
          <div key={k} className="desk-panel-flat p-3 desk-mono text-xs">
            <div className="text-sm font-bold">{name}</div>
            <div className="mt-1">All: {line(rec.summary[`${k}:all`])}</div>
            <div>Totals: {line(rec.summary[`${k}:total`])}</div>
            <div>Moneylines: {line(rec.summary[`${k}:moneyline`])}</div>
          </div>
        ))}
      </div>
      {rec.recent.length > 0 && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-muted-foreground">Recent results</summary>
          <ul className="desk-mono mt-1 space-y-0.5">
            {rec.recent.map((r, i) => (
              <li key={i}>{r.game_date} · {r.method === "pace_fatigue" ? "P&F" : "Sharp"} · {r.pick} {fmt(r.odds)} · {r.away.split(" ").pop()} {r.away_score ?? "—"} @ {r.home.split(" ").pop()} {r.home_score ?? "—"} · <b>{r.status}</b></li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

export default function Games() {
  const [rec, setRec] = useState<GameRecord | null>(null);
  const [games, setGames] = useState<BoardGame[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    supabase.functions.invoke("desk-bets", { body: { action: "game_board", passcode: localStorage.getItem(PASS_KEY) ?? "" } })
      .then(({ data, error }) => { if (error || data?.error) setErr(data?.error ?? error?.message ?? "Failed"); setGames(data?.games ?? []); setRec(data?.record ?? null); })
      .catch((e) => { setErr(String(e)); setGames([]); });
  }, []);
  const count = (k: "paceFatigue" | "sharpStructure") => (games ?? []).reduce((s, g) => s + g[k].plays.length, 0);
  return (
    <div className="desk-theme desk-grid-bg min-h-screen">
      <DeskTopBar logs={0} players={0} lines={0} injuries={0} latest={null} edges={[]} />
      <main className="mx-auto max-w-[1100px] px-3 pb-16 pt-4 sm:px-4">
        <h1 className="desk-display text-xl font-bold">Totals & moneylines: two methods</h1>
        <p className="desk-note mt-1 text-sm">
          <b>Pace & Fatigue</b>: projects the total from both teams' pace and scoring, takes points off for tired legs (back-to-back, road back-to-back, 3 in 4, 4 in 6), and backs the rested team when the fatigue gap is 15+. <b>Sharp & Structure</b>: takes the sharp book's fair price, adds +4% for home teams and +2% for Unders, skips moneylines on 9.5+ spreads, and needs 2%+ profit. Both skip favorites over 80%. Plays are saved before tip-off and graded after the games. Display only, not recommendations.
        </p>
        {games && <p className="desk-mono mt-2 text-xs">Plays tonight: Pace & Fatigue {count("paceFatigue")} · Sharp & Structure {count("sharpStructure")}</p>}
        {rec && <RecordPanel rec={rec} />}
        {err && <p className="mt-3 text-sm text-destructive">{err}</p>}
        {!games && <p className="mt-4 text-sm text-muted-foreground">Loading tonight's games…</p>}
        {games?.length === 0 && !err && <p className="mt-4 text-sm text-muted-foreground">No games left tonight.</p>}
        <div className="mt-3 space-y-3">
          {games?.map((g) => (
            <section key={g.home} className="desk-panel p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="desk-display font-bold">{g.away} @ {g.home}</h2>
                <span className="desk-mono text-xs text-muted-foreground">{time(g.start)} · Total {g.total ?? "—"} · {g.home.split(" ").pop()} {g.homeSpread == null ? "—" : g.homeSpread > 0 ? `+${g.homeSpread}` : g.homeSpread} · ML {fmt(g.awayML?.odds)} / {fmt(g.homeML?.odds)}</span>
              </div>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <Method title="Pace & Fatigue" r={g.paceFatigue} />
                <Method title="Sharp & Structure" r={g.sharpStructure} />
              </div>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
