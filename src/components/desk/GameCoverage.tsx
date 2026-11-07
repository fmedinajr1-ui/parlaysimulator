import { getTeamAbbreviation } from "@/lib/team-abbreviations";
import { STAT_OPTIONS } from "@/hooks/useResearchData";
import type { CoveredPlayer, GameCoverage } from "@/utils/gameCoverage";

const ab = (team: string) => getTeamAbbreviation(team) || team.slice(0, 3).toUpperCase();
const shortOf = (stat: string) => STAT_OPTIONS.find((option) => option.key === stat)?.short ?? stat.toUpperCase();

function TeamPlayers({ team, home, players, onPick }: {
  team: string;
  home: boolean;
  players: CoveredPlayer[];
  onPick: (player: string) => void;
}) {
  return (
    <div className="min-w-0 flex-1">
      <div className="mb-2 flex items-center gap-2">
        <span className="desk-mono text-xs font-bold text-[hsl(var(--desk-text))]">{ab(team)}</span>
        <span className={`desk-mono rounded px-1.5 py-0.5 text-[9px] font-bold ${home ? "bg-[hsl(var(--desk-win)/0.15)] text-[hsl(var(--desk-win))]" : "bg-[hsl(var(--desk-indigo)/0.18)] text-[hsl(var(--desk-indigo))]"}`}>
          {home ? "HOME" : "ROAD"}
        </span>
      </div>
      <div className="space-y-1.5">
        {players.map((player) => (
          <div key={player.player} className="rounded-lg border border-[hsl(var(--desk-line))] bg-[hsl(var(--desk-panel))] px-2.5 py-2">
            <div className="flex items-center justify-between gap-2">
              <button type="button" onClick={() => onPick(player.player)} className="min-w-0 truncate text-left text-xs font-medium text-[hsl(var(--desk-text))] hover:text-[hsl(var(--desk-amber))]">
                {player.player}
              </button>
              <span className="desk-mono shrink-0 text-[9px] text-[hsl(var(--desk-muted))]" title={player.props.map(shortOf).join(", ")}>
                {player.props.length} prop{player.props.length === 1 ? "" : "s"}
              </span>
            </div>
            {player.picks.length > 0 ? (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {player.picks.map((pick) => (
                  <span key={`${pick.stat}-${pick.side}-${pick.line}`} className={`desk-mono rounded px-1.5 py-0.5 text-[9px] font-semibold ${pick.side === "over" ? "bg-[hsl(var(--desk-win)/0.12)] text-[hsl(var(--desk-win))]" : "bg-[hsl(var(--desk-loss)/0.12)] text-[hsl(var(--desk-loss))]"}`}>
                    {pick.side === "over" ? "O" : "U"} {pick.line} {shortOf(pick.stat)}
                  </span>
                ))}
              </div>
            ) : (
              <div className="desk-mono mt-1 text-[9px] text-[hsl(var(--desk-muted))]">Covered · no qualifying pick</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function GameCoverageBoard({ games, onPick }: {
  games: GameCoverage[];
  onPick: (player: string) => void;
}) {
  if (!games.length) return null;

  return (
    <section className="mt-3" aria-labelledby="game-coverage-title">
      <div className="mb-2">
        <h2 id="game-coverage-title" className="desk-display text-sm font-semibold">Tonight's game coverage</h2>
        <p className="desk-note mt-0.5 text-[11px]">Players with a line and saved game history. Open a game to see every matchup the model covers.</p>
      </div>
      <div className="grid gap-2 lg:grid-cols-2">
        {games.map((game, index) => (
          <details key={game.id} className="desk-panel-flat overflow-hidden" open={index === 0}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-3 [&::-webkit-details-marker]:hidden">
              <div className="min-w-0">
                <div className="desk-mono truncate text-xs font-bold text-[hsl(var(--desk-text))]">{ab(game.away)} @ {ab(game.home)}</div>
                <div className="desk-mono mt-1 text-[9px] text-[hsl(var(--desk-muted))]">{game.home} is home</div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="desk-mono text-[9px] text-[hsl(var(--desk-muted))]">{game.playerCount} players · {game.propCount} props</span>
                <span className={`desk-mono rounded px-1.5 py-0.5 text-[9px] font-bold ${game.pickCount ? "bg-[hsl(var(--desk-amber)/0.14)] text-[hsl(var(--desk-amber))]" : "text-[hsl(var(--desk-muted))]"}`}>
                  {game.pickCount} pick{game.pickCount === 1 ? "" : "s"}
                </span>
                <span aria-hidden="true" className="text-[hsl(var(--desk-muted))]">⌄</span>
              </div>
            </summary>
            <div className="flex flex-col gap-4 border-t border-[hsl(var(--desk-line))] p-3 sm:flex-row">
              <TeamPlayers team={game.away} home={false} players={game.players.filter((player) => player.team === game.away)} onPick={onPick} />
              <TeamPlayers team={game.home} home players={game.players.filter((player) => player.team === game.home)} onPick={onPick} />
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
