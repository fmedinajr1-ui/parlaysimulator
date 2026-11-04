import { STAT_OPTIONS, type EdgePick } from "@/hooks/useResearchData";
import { statValue, type GameLog } from "@/utils/nbaBoxScoreMath";

interface Props {
  edges: EdgePick[];
  onPick: (player: string) => void;
}

const shortOf = (stat: string) => STAT_OPTIONS.find((s) => s.key === stat)?.short ?? stat.toUpperCase();

export function EdgeCards({ edges, onPick }: Props) {
  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {edges.map((e) => {
        const over = e.median >= e.line;
        return (
          <button
            key={`${e.player}-${e.stat}`}
            onClick={() => onPick(e.player)}
            className="desk-panel desk-amber-glow group relative overflow-hidden p-4 text-left transition-transform hover:-translate-y-0.5"
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
                <div className="desk-label">L10 median</div>
                <div className="desk-mono text-2xl font-bold text-[hsl(var(--desk-amber))]">
                  {Math.round(e.median * 10) / 10}
                </div>
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between border-t border-[hsl(var(--desk-line))] pt-2">
              <span className="desk-mono text-[11px] text-[hsl(var(--desk-muted))]">
                {over ? "OVER" : "UNDER"} HIT {Math.round(e.hitRate * 100)}% · {e.thisSeason}/10 this season
              </span>
              <span
                className={`desk-mono text-[11px] font-semibold ${
                  e.edge > 0 ? "text-[hsl(var(--desk-win))]" : "text-[hsl(var(--desk-loss))]"
                }`}
              >
                EDGE {e.edge > 0 ? "+" : ""}
                {Math.round(e.edge * 10) / 10}
              </span>
            </div>
          </button>
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
