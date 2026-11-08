import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { STAT_OPTIONS } from "@/hooks/useResearchData";
import type { GameLog, StatKey } from "@/utils/nbaBoxScoreMath";
import { buildSeasonVenueLeaders, type SeasonVenueRow, type Venue, type VenueSide } from "@/utils/seasonVenueLeaders";
import { restProfile } from "@/utils/restProfile";
import { RestBadge } from "@/components/desk/RestBadge";

interface Props {
  byPlayer: Map<string, GameLog[]>;
  propLines: Map<string, number>;
  today: string;
  onPick: (player: string) => void;
}

const fmt = (value: number) => (Math.round(value * 10) / 10).toString();
const pct = (value: number) => `${Math.round(value * 100)}%`;

function VenueLeaders({ venue, rows, side, teams, byPlayer, today, onPick }: {
  venue: Venue;
  rows: SeasonVenueRow[];
  side: VenueSide;
  teams: Map<string, string>;
  byPlayer: Map<string, GameLog[]>;
  today: string;
  onPick: (player: string) => void;
}) {
  const label = venue === "home" ? "Home" : "Road";
  return (
    <div className="min-w-0 rounded-lg border border-[hsl(var(--desk-line))] bg-[hsl(var(--desk-panel)/0.55)] p-2.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`desk-mono rounded px-1.5 py-0.5 text-[10px] font-bold ${venue === "home" ? "bg-[hsl(var(--desk-win)/0.15)] text-[hsl(var(--desk-win))]" : "bg-[hsl(var(--desk-indigo)/0.18)] text-[hsl(var(--desk-indigo))]"}`}>
            {label.toUpperCase()}
          </span>
          <span className="desk-label">Best {side}s</span>
        </div>
        <span className="desk-mono text-[10px] text-[hsl(var(--desk-muted))]">Hit · Line · Med</span>
      </div>
      {rows.length > 0 ? (
        <ol className="grid gap-1">
          {rows.map((row, index) => (
            <li key={row.player}>
              <button
                type="button"
                className="desk-row grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-2 text-left"
                onClick={() => onPick(row.player)}
                aria-label={`Open ${row.player}: ${pct(row.hitRate)} ${side} hit rate at ${label.toLowerCase()}`}
              >
                <span className="min-w-0">
                  <span className="flex items-baseline gap-1.5">
                    <span className="desk-mono text-[10px] text-[hsl(var(--desk-muted))]">{index + 1}.</span>
                    <span className="truncate text-xs font-semibold text-[hsl(var(--desk-text))]">{row.player}</span>
                    {teams.get(row.player.toLowerCase()) && <span className="desk-mono text-[10px] text-[hsl(var(--desk-muted))]">{teams.get(row.player.toLowerCase())}</span>}
                    <RestBadge rest={restProfile(byPlayer.get(row.player) ?? [], today)} />
                  </span>
                  <span className="desk-mono mt-1 block text-[10px] text-[hsl(var(--desk-muted))]">
                    Line {row.line} · Med {fmt(row.median)} · Avg {fmt(row.average)}
                  </span>
                </span>
                <span className="text-right">
                  <span className={`desk-mono block text-sm font-bold ${side === "over" ? "text-[hsl(var(--desk-win))]" : "text-[hsl(var(--desk-amber))]"}`}>{pct(row.hitRate)}</span>
                  <span className="desk-mono block text-[10px] text-[hsl(var(--desk-muted))]">{row.hits}/{row.games} {side === "over" ? "O" : "U"}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="px-2 py-5 text-center text-[11px] leading-relaxed text-[hsl(var(--desk-muted))]">
          No players have 3+ {label.toLowerCase()} games and a line tonight.
        </p>
      )}
    </div>
  );
}

export function SeasonVenueBoard({ byPlayer, propLines, today, onPick }: Props) {
  const [stat, setStat] = useState<StatKey>("points");
  const [side, setSide] = useState<VenueSide>("over");
  const [teams, setTeams] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data, error } = await supabase.from("research_player_teams").select("player_name,team_abbr").limit(2000);
        if (error) throw error;
        if (alive) setTeams(new Map((data ?? []).map((team) => [team.player_name.toLowerCase(), team.team_abbr ?? ""])));
      } catch {
        if (alive) setTeams(new Map());
      }
    })();
    return () => { alive = false; };
  }, []);

  const home = useMemo(() => buildSeasonVenueLeaders(byPlayer, stat, propLines, "home", { side }), [byPlayer, stat, propLines, side]);
  const road = useMemo(() => buildSeasonVenueLeaders(byPlayer, stat, propLines, "road", { side }), [byPlayer, stat, propLines, side]);
  const statLabel = STAT_OPTIONS.find((option) => option.key === stat)?.label ?? stat;

  return (
    <section className="desk-panel p-3 sm:p-4" aria-labelledby="season-venue-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="desk-label">2026–27 season · 3+ games at venue</div>
          <h2 id="season-venue-heading" className="desk-display text-base font-semibold">Home / road line leaders</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-[hsl(var(--desk-muted))]">
            Best {statLabel.toLowerCase()} {side}s against tonight's main line. Season history only; not a win prediction.
          </p>
        </div>
        <div className="flex gap-1 rounded-lg border border-[hsl(var(--desk-line))] p-1" aria-label="Venue leader direction">
          {(["over", "under"] as const).map((value) => (
            <button key={value} type="button" className="desk-tab" data-active={side === value} onClick={() => setSide(value)} aria-pressed={side === value}>
              {value === "over" ? "Overs" : "Unders"}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label="Venue leader stat">
        {STAT_OPTIONS.map((option) => (
          <button key={option.key} type="button" className="desk-tab" data-active={stat === option.key} onClick={() => setStat(option.key)} title={option.label} aria-pressed={stat === option.key}>
            {option.short}
          </button>
        ))}
      </div>

      <div className="mt-2 grid gap-2 md:grid-cols-2">
        <VenueLeaders venue="home" rows={home} side={side} teams={teams} byPlayer={byPlayer} today={today} onPick={onPick} />
        <VenueLeaders venue="road" rows={road} side={side} teams={teams} byPlayer={byPlayer} today={today} onPick={onPick} />
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-[hsl(var(--desk-muted))]">
        Hit % counts games strictly {side === "over" ? "above" : "below"} tonight's line; pushes do not count as hits. Ties favor more games, then a stronger venue median.
      </p>
    </section>
  );
}
