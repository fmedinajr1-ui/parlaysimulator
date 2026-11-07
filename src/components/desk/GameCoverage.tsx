import { useEffect, useState } from "react";
import { getTeamAbbreviation } from "@/lib/team-abbreviations";
import { STAT_OPTIONS } from "@/hooks/useResearchData";
import { isStrongPick, type CoveragePick, type CoveredPlayer, type GameCoverage } from "@/utils/gameCoverage";
import { legKey, readSlip, SLIP_EVENT, toggleLeg } from "@/utils/betSlip";
import type { StatKey } from "@/utils/nbaBoxScoreMath";

const ab = (team: string) => getTeamAbbreviation(team) || team.slice(0, 3).toUpperCase();
const shortOf = (stat: string) => STAT_OPTIONS.find((option) => option.key === stat)?.short ?? stat.toUpperCase();
const r1 = (n: number) => Math.round(n * 10) / 10;

function PickChip({ pick, inSlip }: { pick: CoveragePick; inSlip: boolean }) {
  const over = pick.side === "over";
  const strong = isStrongPick(pick);
  return (
    <button
      type="button"
      onClick={() => toggleLeg({ player: pick.player, stat: pick.stat as StatKey, side: pick.side, line: pick.line, odds: pick.odds ?? -110, opp: pick.tonight ?? null })}
      title={inSlip ? "In your slip · tap to remove" : "Tap to add to my bets"}
      className={`desk-mono flex flex-col items-start rounded px-1.5 py-1 text-left text-[9px] font-semibold leading-tight ${over ? "bg-[hsl(var(--desk-win)/0.12)] text-[hsl(var(--desk-win))]" : "bg-[hsl(var(--desk-loss)/0.12)] text-[hsl(var(--desk-loss))]"} ${inSlip ? "ring-2 ring-[hsl(var(--desk-amber))]" : ""}`}
    >
      <span>{inSlip ? "✓ " : strong ? "★ " : "+ "}{over ? "O" : "U"} {pick.line} {shortOf(pick.stat)}</span>
      {pick.median != null && pick.hitRate != null && (
        <span className="font-normal text-[hsl(var(--desk-muted))]">proj {r1(pick.median)} · {Math.round(pick.hitRate * 100)}%</span>
      )}
    </button>
  );
}

function TeamPlayers({ team, home, players, onPick, slip, strongOnly }: {
  team: string; home: boolean; players: CoveredPlayer[]; onPick: (player: string) => void; slip: Set<string>; strongOnly: boolean;
}) {
  const shown = strongOnly ? players.filter((p) => p.picks.some(isStrongPick)) : players;
  return (
    <div className="min-w-0 flex-1">
      <div className="mb-2 flex items-center gap-2">
        <span className="desk-mono text-xs font-bold text-[hsl(var(--desk-text))]">{ab(team)}</span>
        <span className={`desk-mono rounded px-1.5 py-0.5 text-[9px] font-bold ${home ? "bg-[hsl(var(--desk-win)/0.15)] text-[hsl(var(--desk-win))]" : "bg-[hsl(var(--desk-indigo)/0.18)] text-[hsl(var(--desk-indigo))]"}`}>
          {home ? "HOME" : "ROAD"}
        </span>
      </div>
      <div className="space-y-1.5">
        {shown.map((player) => {
          const picks = strongOnly ? player.picks.filter(isStrongPick) : player.picks;
          return (
            <div key={player.player} className="rounded-lg border border-[hsl(var(--desk-line))] bg-[hsl(var(--desk-panel))] px-2.5 py-2">
              <div className="flex items-center justify-between gap-2">
                <button type="button" onClick={() => onPick(player.player)} className="min-w-0 truncate text-left text-xs font-medium text-[hsl(var(--desk-text))] hover:text-[hsl(var(--desk-amber))]">
                  {player.player}
                </button>
                <span className="desk-mono shrink-0 text-[9px] text-[hsl(var(--desk-muted))]" title={player.props.map(shortOf).join(", ")}>
                  {player.props.length} line{player.props.length === 1 ? "" : "s"}
                </span>
              </div>
              {picks.length > 0 ? (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {picks.map((pick) => <PickChip key={`${pick.stat}-${pick.side}-${pick.line}`} pick={pick} inSlip={slip.has(legKey(pick))} />)}
                </div>
              ) : (
                <div className="desk-mono mt-1 text-[9px] text-[hsl(var(--desk-muted))]">Covered · no qualifying pick</div>
              )}
            </div>
          );
        })}
        {!shown.length && <div className="desk-mono text-[9px] text-[hsl(var(--desk-muted))]">No strong picks.</div>}
      </div>
    </div>
  );
}

export function GameCoverageBoard({ games, onPick }: { games: GameCoverage[]; onPick: (player: string) => void }) {
  const [slipKeys, setSlipKeys] = useState(() => new Set(readSlip().map(legKey)));
  const [strongOnly, setStrongOnly] = useState(false);
  useEffect(() => {
    const f = () => setSlipKeys(new Set(readSlip().map(legKey)));
    window.addEventListener(SLIP_EVENT, f);
    return () => window.removeEventListener(SLIP_EVENT, f);
  }, []);
  if (!games.length) return null;
  const list = strongOnly ? games.filter((g) => g.strongCount > 0) : games;

  return (
    <section className="mt-3" aria-labelledby="game-coverage-title">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="game-coverage-title" className="desk-display text-sm font-semibold">Tonight's games · best to bet first</h2>
          <p className="desk-note mt-0.5 text-[11px]">Ranked by total expected profit. Tap a pick to add it to my bets. ★ = strong (65%+ win, 8¢+ profit per $1).</p>
        </div>
        <div className="flex gap-1">
          <button type="button" className="desk-tab" data-active={!strongOnly} onClick={() => setStrongOnly(false)}>All picks</button>
          <button type="button" className="desk-tab" data-active={strongOnly} onClick={() => setStrongOnly(true)}>★ Strong only</button>
        </div>
      </div>
      <div className="grid gap-2 lg:grid-cols-2">
        {list.map((game, index) => (
          <details key={game.id} className="desk-panel-flat overflow-hidden" open={index === 0}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-3 [&::-webkit-details-marker]:hidden">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="desk-mono flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--desk-amber)/0.14)] text-[10px] font-bold text-[hsl(var(--desk-amber))]">#{index + 1}</span>
                <div className="min-w-0">
                  <div className="desk-mono truncate text-xs font-bold text-[hsl(var(--desk-text))]">{ab(game.away)} @ {ab(game.home)}</div>
                  <div className="desk-mono mt-1 text-[9px] text-[hsl(var(--desk-muted))]">{game.home} is home</div>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                <span className="desk-mono hidden text-[9px] text-[hsl(var(--desk-muted))] sm:inline">{game.playerCount} players</span>
                <span className="desk-mono text-[9px] text-[hsl(var(--desk-win))]">+{Math.round(game.strength * 100)}¢</span>
                <span className="desk-mono rounded bg-[hsl(var(--desk-amber)/0.14)] px-1.5 py-0.5 text-[9px] font-bold text-[hsl(var(--desk-amber))]">
                  {game.strongCount}★ / {game.pickCount}
                </span>
                <span aria-hidden="true" className="text-[hsl(var(--desk-muted))]">⌄</span>
              </div>
            </summary>
            <div className="flex flex-col gap-4 border-t border-[hsl(var(--desk-line))] p-3 sm:flex-row">
              <TeamPlayers team={game.away} home={false} players={game.players.filter((p) => p.team === game.away)} onPick={onPick} slip={slipKeys} strongOnly={strongOnly} />
              <TeamPlayers team={game.home} home players={game.players.filter((p) => p.team === game.home)} onPick={onPick} slip={slipKeys} strongOnly={strongOnly} />
            </div>
          </details>
        ))}
        {!list.length && <p className="desk-note text-xs">No strong picks tonight.</p>}
      </div>
    </section>
  );
}
