import { Link, useLocation } from "react-router-dom";
import type { EdgePick } from "@/hooks/useResearchData";
import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";

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

  return (
    <header className="sticky top-0 z-30 border-b border-[hsl(var(--desk-line))] bg-[hsl(var(--desk-bg)/0.88)] backdrop-blur">
      <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-3 px-3 py-2.5 sm:gap-4 sm:px-4 sm:py-3">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg border border-[hsl(var(--desk-amber)/0.5)] bg-[hsl(var(--desk-amber)/0.12)]">
            <Bot className="text-primary" size={22} />
          </div>
          <div className="leading-none">
            <div className="desk-display text-lg font-bold tracking-tight">PARLAYFARM</div>
            <div className="desk-label mt-1">Bot Desk · 2026–27</div>
          </div>
        </div>

        <div className="hidden gap-5 lg:flex">
          <Stat label="Logs" value={logs.toLocaleString()} />
          <Stat label="Players" value={players.toLocaleString()} />
          <Stat label="Lines today" value={String(lines)} accent />
          <Stat label="Injuries" value={String(injuries)} />
          <Stat label="Latest" value={latest ?? "—"} />
        </div>
        <nav className="flex items-center gap-1">
          <Button asChild variant={location.pathname === "/" ? "secondary" : "ghost"} size="sm" className="rounded-md px-3"><Link to="/">Desk</Link></Button>
          <Button asChild variant={location.pathname === "/projections" ? "secondary" : "ghost"} size="sm" className="rounded-md px-3"><Link to="/projections">Projections</Link></Button>
          <Button asChild variant="outline" size="sm" className="rounded-md px-3"><Link to="/bets">My bets</Link></Button>
        </nav>
      </div>

    </header>
  );
}
