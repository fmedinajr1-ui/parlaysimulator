import { STAT_OPTIONS, type EdgePick } from "@/hooks/useResearchData";
import { statValue, type GameLog } from "@/utils/nbaBoxScoreMath";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { legKey, readSlip, SLIP_EVENT, toggleLeg } from "@/utils/betSlip";
import { getTeamAbbreviation } from "@/lib/team-abbreviations";

interface Props {
  edges: EdgePick[];
  onPick: (player: string) => void;
}

const shortOf = (stat: string) => STAT_OPTIONS.find((s) => s.key === stat)?.short ?? stat.toUpperCase();

export function EdgeCards({ edges, onPick }: Props) {
  const [slip, setSlip] = useState(readSlip);
  useEffect(() => { const f = () => setSlip(readSlip()); window.addEventListener(SLIP_EVENT, f); return () => window.removeEventListener(SLIP_EVENT, f); }, []);
  const inSlip = new Set(slip.map(legKey));
  return (
    <>
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {edges.map((e) => {
        const over = e.side === "over";
        const picked = inSlip.has(legKey(e));
        return (
          <div
            key={`${e.player}-${e.stat}`}
            role="button"
            tabIndex={0}
            onClick={() => onPick(e.player)}
            className={`desk-panel desk-amber-glow group relative overflow-hidden p-4 text-left transition-transform hover:-translate-y-0.5 ${picked ? "ring-2 ring-[hsl(var(--desk-amber))]" : ""}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="desk-label">{shortOf(e.stat)} · {e.tonight ? `Tonight vs ${e.tonight}` : "Tonight"}</div>
                <div className="desk-display truncate text-lg font-semibold">{e.player}</div>
              </div>
              <span
                className={`desk-mono shrink-0 rounded-md px-2 py-1 text-[11px] font-bold ${
                  over
                    ? "bg-[hsl(var(--desk-win)/0.15)] text-[hsl(var(--desk-win))]"
                    : "bg-[hsl(var(--desk-loss)/0.15)] text-[hsl(var(--desk-loss))]"
                }`}
              >
                {over ? "OVER" : "UNDER"}
              </span>
            </div>

            <div className="mt-3 flex items-end justify-between">
              <div className="leading-none">
                <div className="desk-label">Line</div>
                <div className="desk-mono text-2xl font-bold text-[hsl(var(--desk-text))]">{e.line}</div>
              </div>
              <div className="text-right leading-none">
                <div className="desk-label">Projection</div>
                <div className="desk-mono text-2xl font-bold text-[hsl(var(--desk-amber))]">
                  {Math.round(e.median * 10) / 10}
                </div>
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between border-t border-[hsl(var(--desk-line))] pt-2">
              <span className="desk-mono text-[11px] text-[hsl(var(--desk-muted))]">
                WIN {Math.round(e.hitRate * 100)}% at {e.odds > 0 ? `+${e.odds}` : e.odds} · {e.thisSeason}/10 this season
              </span>
              <span
                className={`desk-mono text-[11px] font-semibold ${
                  e.edge > 0 ? "text-[hsl(var(--desk-win))]" : "text-[hsl(var(--desk-loss))]"
                }`}
              >
                PROFIT {e.ev > 0 ? "+" : ""}{Math.round(e.ev * 100)}¢/$1
              </span>
            </div>
            {e.reasons.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {e.reasons.map((r) => (
                  <li key={r.label} className="text-[11px] leading-snug text-[hsl(var(--desk-muted))]">
                    <span className="desk-chip desk-mono mr-1.5 text-[10px]">
                      {r.label} {r.pct > 0 ? "+" : ""}{r.pct}%
                    </span>
                    {r.why}
                  </li>
                ))}
              </ul>
            )}
            <button
              onClick={(ev) => { ev.stopPropagation(); toggleLeg({ player: e.player, stat: e.stat, side: e.side, line: e.line, odds: e.odds, opp: e.tonight }); }}
              className={`desk-mono mt-3 w-full rounded-md py-2 text-xs font-bold ${picked ? "bg-[hsl(var(--desk-amber))] text-[hsl(var(--desk-bg))]" : "border border-[hsl(var(--desk-amber)/0.6)] text-[hsl(var(--desk-amber))]"}`}
            >
              {picked ? "✓ In my slip · tap to remove" : "+ Add to my bets"}
            </button>
          </div>
        );
      })}

      {!edges.length && (
        <div className="desk-panel-flat p-4 sm:col-span-2 xl:col-span-4">
          <div className="desk-label">Daily edge</div>
          <p className="desk-note mt-1 text-sm">
            No sportsbook prop lines loaded for today yet. The desk still ranks every player by box score
            math — the edge cards fill in once live lines land.
          </p>
        </div>
      )}
    </section>
    {slip.length > 0 && (
      <Link to="/bets" className="desk-mono fixed inset-x-3 bottom-4 z-40 mx-auto flex max-w-md items-center justify-between rounded-xl bg-[hsl(var(--desk-amber))] px-4 py-3 text-sm font-bold text-[hsl(var(--desk-bg))] shadow-lg">
        <span>{slip.length} pick{slip.length > 1 ? "s" : ""} in slip{slip.length > 1 ? " · parlay ready" : ""}</span>
        <span>Open my bets →</span>
      </Link>
    )}
    </>
  );
}

export function GameLogStrip({ games, stat, line }: { games: GameLog[]; stat: Parameters<typeof statValue>[1]; line: number }) {
  return (
    <div className="flex flex-wrap gap-2">
      {games
        .filter((g) => (Number(g.minutes_played) || 0) > 0)
        .sort((a, b) => b.game_date.localeCompare(a.game_date))
        .slice(0, 10)
        .map((g) => {
          const v = statValue(g, stat);
          const hit = v > line;
          return (
            <div
              key={g.game_date}
              className={`desk-mono rounded-md border px-2 py-1 text-[11px] ${
                hit
                  ? "border-[hsl(var(--desk-win)/0.5)] bg-[hsl(var(--desk-win)/0.08)] text-[hsl(var(--desk-win))]"
                  : "border-[hsl(var(--desk-line))] bg-[hsl(var(--desk-panel))] text-[hsl(var(--desk-muted))]"
              }`}
            >
              {g.game_date.slice(5)} {g.opponent ?? ""} · <b>{v}</b> · {Math.round(Number(g.minutes_played))}m
            </div>
          );
        })}
    </div>
  );
}
