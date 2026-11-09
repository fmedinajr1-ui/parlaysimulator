import { useEffect, useMemo, useState } from "react";
import "@/components/desk/desk-tokens.css";
import { DeskTopBar } from "@/components/desk/DeskTopBar";
import { STAT_OPTIONS, useResearchData, type EdgePick } from "@/hooks/useResearchData";
import { projectMinutes } from "@/utils/projectedMinutes";
import { legKey, readSlip, SLIP_EVENT, toggleLeg } from "@/utils/betSlip";
import type { StatKey } from "@/utils/nbaBoxScoreMath";
import { RestBadge } from "@/components/desk/RestBadge";
import { Button } from "@/components/ui/button";
import { V6_MODEL_VERSION } from "@/utils/minutesValidation";

type Sort = "gap" | "win" | "ev" | "minutes";
const short = (s: StatKey) => STAT_OPTIONS.find((o) => o.key === s)?.short ?? s;
const fmtOdds = (o: number) => (o > 0 ? `+${o}` : String(o));

export default function Projections() {
  const { logs, byPlayer, propLines, injuries, today, edges, boardEdges, v6BoardEdges, loading } = useResearchData();
  const [trial, setTrial] = useState(false);
  const [stat, setStat] = useState<StatKey | "all">("all");
  const [sort, setSort] = useState<Sort>("gap");
  const [onlyPicks, setOnlyPicks] = useState(false);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [slip, setSlip] = useState(() => new Set(readSlip().map(legKey)));
  useEffect(() => {
    const f = () => setSlip(new Set(readSlip().map(legKey)));
    window.addEventListener(SLIP_EVENT, f);
    return () => window.removeEventListener(SLIP_EVENT, f);
  }, []);

  const rows = useMemo(() => {
    const mins = new Map<string, ReturnType<typeof projectMinutes>>();
    const minFor = (e: EdgePick) => {
      if (!mins.has(e.player)) mins.set(e.player, projectMinutes(byPlayer.get(e.player) ?? [], today, e.mateMinutesOut ?? 0));
      return mins.get(e.player) ?? null;
    };
    const needle = q.trim().toLowerCase();
    const list = (trial ? v6BoardEdges : boardEdges)
      .filter((e) => (stat === "all" || e.stat === stat) && (!onlyPicks || e.qualifies))
      .filter((e) => !needle || e.player.toLowerCase().includes(needle) || (e.team ?? "").toLowerCase().includes(needle) || (e.tonight ?? "").toLowerCase().includes(needle))
      .map((e) => ({ e, m: minFor(e), gapPct: e.line ? (e.median - e.line) / e.line : 0 }));
    const key: Record<Sort, (r: (typeof list)[number]) => number> = {
      gap: (r) => Math.abs(r.gapPct), win: (r) => r.e.hitRate, ev: (r) => r.e.ev, minutes: (r) => r.m?.minutes ?? 0,
    };
    return list.sort((a, b) => key[sort](b) - key[sort](a));
  }, [boardEdges, v6BoardEdges, trial, byPlayer, today, stat, sort, onlyPicks, q]);

  return (
    <div className="desk-theme desk-grid-bg min-h-screen">
      <DeskTopBar logs={logs.length} players={byPlayer.size} lines={propLines.size} injuries={injuries.size} latest={logs[0]?.game_date ?? null} edges={edges} />
      <main className="mx-auto max-w-[1100px] px-3 pb-16 pt-4 sm:px-4">
        <h1 className="desk-display text-xl font-bold">Projections vs tonight's lines</h1>
        <div className="mt-3 flex gap-2" aria-label="Projection model">
          <Button variant={trial ? "ghost" : "secondary"} onClick={() => setTrial(false)}>V5 active</Button>
          <Button variant={trial ? "secondary" : "ghost"} onClick={() => setTrial(true)}>V6 trial preview</Button>
        </div>
        {trial && <p className="mt-2 text-xs text-muted-foreground">{V6_MODEL_VERSION} · Experimental, not active recommendations · Minutes accuracy gate still applies.</p>}
        <p className="desk-note mt-1 text-sm">
          Every player with a line tonight: our projected total, projected minutes, and how far the sportsbook line sits from it.
          <b> PICK</b> = passes every model rule. Minutes are an estimate to explain the projection.
        </p>
        <p className="desk-note mt-1 text-[11px]">
          Rest formula: back-to-back −5% for 32+ minute players (otherwise −3%), 1 day off neutral, 2 days off +1%, 3+ days off +2%.
        </p>

        <div className="desk-panel-flat mt-3 flex flex-col gap-2 p-3">
          <input className="desk-input w-full" placeholder="Search player or team" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="flex gap-1 overflow-x-auto">
            {(["all", ...STAT_OPTIONS.map((o) => o.key)] as const).map((k) => (
              <button key={k} className="desk-tab shrink-0" data-active={stat === k ? "true" : undefined} onClick={() => setStat(k)}>
                {k === "all" ? "All" : short(k)}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <span className="desk-label mr-1">Sort</span>
            {([["gap", "Biggest gap"], ["win", "Win %"], ["ev", "Profit"], ["minutes", "Minutes"]] as const).map(([k, l]) => (
              <button key={k} className="desk-tab" data-active={sort === k ? "true" : undefined} onClick={() => setSort(k)}>{l}</button>
            ))}
            <button className="desk-tab ml-auto" data-active={onlyPicks ? "true" : undefined} onClick={() => setOnlyPicks((v) => !v)}>
              Picks only
            </button>
          </div>
        </div>

        <p className="desk-label mt-3">{loading ? "Loading…" : `${rows.length} props`}</p>
        {!loading && !rows.length && <p className="desk-note mt-2 text-sm">No lines posted yet for today. They load with the 8 AM update.</p>}

        <ul className="mt-2 flex flex-col gap-2">
          {rows.slice(0, 300).map(({ e, m, gapPct }) => {
            const id = `${e.player}|${e.stat}`;
            const over = e.median > e.line;
            const inSlip = slip.has(legKey(e));
            const gapCls = Math.abs(gapPct) < 0.05 ? "text-[hsl(var(--desk-muted))]" : over ? "text-[hsl(var(--desk-up,142_70%_50%))]" : "text-[hsl(var(--desk-down,0_80%_62%))]";
            return (
              <li key={id} className="desk-panel p-3">
                <div className="flex items-start justify-between gap-2">
                  <button className="min-w-0 text-left" onClick={() => setOpen(open === id ? null : id)}>
                    <div className="truncate font-semibold">{e.player}</div>
                    <div className="desk-label mt-0.5">
                      {e.team ?? "—"} · {e.home == null ? "" : e.home ? "HOME" : "ROAD"} vs {e.tonight ?? "?"}
                    </div>
                  </button>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                    <RestBadge rest={e.rest} />
                    {e.qualifies && <span className="desk-chip">{trial ? "TRIAL" : "PICK"}</span>}
                    <span className="desk-chip">{short(e.stat)}</span>
                  </div>
                </div>

                <div className="desk-mono mt-2 grid grid-cols-4 gap-2 text-center">
                  <div><div className="desk-label">Line</div><div className="text-base font-semibold">{e.line}</div></div>
                  <div><div className="desk-label">Proj</div><div className="text-base font-semibold text-[hsl(var(--desk-amber))]">{e.median.toFixed(1)}</div></div>
                  <div><div className="desk-label">Gap</div><div className={`text-base font-semibold ${gapCls}`}>{e.edge > 0 ? "+" : ""}{e.edge} <span className="text-[10px]">({Math.round(gapPct * 100)}%)</span></div></div>
                  <div><div className="desk-label">Min</div><div className="text-base font-semibold">{m ? m.minutes : "—"}</div></div>
                </div>

                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="desk-mono text-xs">
                    Lean <b>{e.side.toUpperCase()}</b> {fmtOdds(e.odds)} · win {Math.round(e.hitRate * 100)}% · {e.ev >= 0 ? "+" : ""}{Math.round(e.ev * 100)}¢/$1
                  </span>
                  <button disabled={trial} className="desk-btn shrink-0 text-xs" onClick={() => toggleLeg({ player: e.player, stat: e.stat, side: e.side, line: e.line, odds: e.odds, opp: e.tonight })}>
                    {inSlip ? "✓ In slip" : "+ Slip"}
                  </button>
                </div>

                {e.production && <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-border pt-2 text-xs">
                  <div><dt className="text-muted-foreground">Shot attempts · L5 / L10</dt><dd>{e.production.fgaL5?.toFixed(1) ?? "—"} / {e.production.fgaL10?.toFixed(1) ?? "—"}</dd></div>
                  <div><dt className="text-muted-foreground">Plus-minus · L10 available</dt><dd>{e.production.plusMinus?.toFixed(1) ?? "—"} · {e.production.plusMinusGames} games</dd></div>
                  {([ ["Assists allowed", e.production.assistsAllowed], ["Rebounds allowed", e.production.reboundsAllowed] ] as const).map(([label, a]) => <div key={label}><dt className="text-muted-foreground">{label} · opponent/game</dt><dd>{a ? `${a.average.toFixed(1)} vs ${a.league.toFixed(1)} league · ${a.games} games` : "Not enough complete games"}</dd></div>)}
                </dl>}

                {open === id && (
                  <div className="mt-2 border-t border-[hsl(var(--desk-line))] pt-2 text-xs">
                    {m && (
                      <p className="desk-note">
                        Minutes: last 10 median {m.l10}, last 3 median {m.l3}
                        {m.b2b ? ", back-to-back trim" : ""}{m.mateBump ? `, +${m.mateBump} from teammates out` : ""} → {m.minutes} tonight.
                      </p>
                    )}
                    {e.reasons.length ? (
                      <ul className="mt-1 flex flex-col gap-1">
                        {e.reasons.map((r) => (
                          <li key={r.label}><span className="desk-chip mr-1">{r.label} {r.pct > 0 ? "+" : ""}{r.pct}%</span>{r.why}</li>
                        ))}
                      </ul>
                    ) : <p className="desk-note mt-1">No adjustments tonight; projection is his recent baseline.</p>}
                    {!e.qualifies && <p className="desk-note mt-1">Not a pick: the gap, win chance or profit is too small to pass the model's rules.</p>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </main>
    </div>
  );
}
