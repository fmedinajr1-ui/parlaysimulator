import { Link, useLocation } from "react-router-dom";
import type { EdgePick } from "@/hooks/useResearchData";

interface Props {
  logs: number;
  players: number;
  lines: number;
  injuries: number;
  latest: string | null;
  edges: EdgePick[];
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex flex-col leading-none">
      <span className="desk-label">{label}</span>
      <span className={`desk-mono truncate text-sm font-semibold sm:text-base ${accent ? "text-[hsl(var(--desk-amber))]" : "text-[hsl(var(--desk-text))]"}`}>
        {value}
      </span>
    </div>
  );
}

export function DeskTopBar({ logs, players, lines, injuries, latest, edges }: Props) {
  const location = useLocation();
  const tickerItems = edges.length
    ? edges.map(
        (e) =>
          `${e.player.toUpperCase()} · ${e.stat.toUpperCase()} · LINE ${e.line} · ${e.side.toUpperCase()} · PROJ ${Math.round(e.median * 10) / 10} · WIN ${Math.round(e.hitRate * 100)}%`,
      )
    : ["NO SPORTSBOOK LINES LOADED TODAY · ADD A WORKING ODDS KEY TO SEE LIVE EDGES"];

  return (
    <header className="sticky top-0 z-30 border-b border-[hsl(var(--desk-line))] bg-[hsl(var(--desk-bg)/0.88)] backdrop-blur">
      <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-3 px-3 py-2.5 sm:gap-4 sm:px-4 sm:py-3">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg border border-[hsl(var(--desk-amber)/0.5)] bg-[hsl(var(--desk-amber)/0.12)]">
            <span className="desk-mono text-sm font-bold text-[hsl(var(--desk-amber))]">PF</span>
          </div>
          <div className="leading-none">
            <div className="desk-display text-lg font-bold tracking-tight">PARLAYFARM</div>
            <div className="desk-label mt-1">Research Desk · 2026–27</div>
          </div>
        </div>

        <div className="grid w-full grid-cols-5 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:gap-5">
          <Stat label="Logs" value={logs.toLocaleString()} />
          <Stat label="Players" value={players.toLocaleString()} />
          <Stat label="Lines today" value={String(lines)} accent />
          <Stat label="Injuries" value={String(injuries)} />
          <Stat label="Latest" value={latest ?? "—"} />
          <nav className="col-span-5 flex items-center gap-1 overflow-x-auto sm:pl-2">
            <Link to="/" className="desk-tab" data-active={location.pathname === "/" ? "true" : undefined}>Desk</Link>
            <Link to="/projections" className="desk-tab" data-active={location.pathname === "/projections" ? "true" : undefined}>Projections</Link>
            <Link to="/bets" className="desk-tab">My bets</Link>
          </nav>
        </div>
      </div>

      <div className="overflow-hidden border-t border-[hsl(var(--desk-line))] bg-[hsl(var(--desk-panel)/0.6)] py-1.5">
        {edges.length ? (
          <div className="desk-ticker">
            {[0, 1].map((dup) => (
              <div key={dup} className="flex gap-10 pr-10">
                {tickerItems.map((t, i) => (
                  <span key={`${dup}-${i}`} className="desk-mono text-[11px] tracking-wide text-[hsl(var(--desk-muted))]">
                    <span className="text-[hsl(var(--desk-amber))]">▸</span> {t}
                  </span>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div className="mx-auto max-w-[1500px] px-4">
            <span className="desk-mono text-[11px] tracking-wide text-[hsl(var(--desk-muted))]">
              <span className="text-[hsl(var(--desk-amber))]">▸</span> {tickerItems[0]}
            </span>
          </div>
        )}
      </div>
    </header>
  );
}
