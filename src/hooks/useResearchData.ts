import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  summarizePlayer,
  type GameLog,
  type PlayerSummary,
  type StatKey,
} from "@/utils/nbaBoxScoreMath";

const COLS = "player_name,game_date,opponent,minutes_played,points,rebounds,assists,threes_made";

export const STAT_OPTIONS: { key: StatKey; label: string; short: string }[] = [
  { key: "points", label: "Points", short: "PTS" },
  { key: "rebounds", label: "Rebounds", short: "REB" },
  { key: "assists", label: "Assists", short: "AST" },
  { key: "threes_made", label: "3-Pointers", short: "3PM" },
  { key: "pra", label: "Pts+Reb+Ast", short: "PRA" },
];

/** Today's date in Eastern Time (YYYY-MM-DD). */
export function etToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

async function fetchAllLogs(): Promise<GameLog[]> {
  const out: GameLog[] = [];
  for (let from = 0; from < 60000; from += 1000) {
    const { data, error } = await supabase
      .from("nba_player_game_logs")
      .select(COLS)
      .order("game_date", { ascending: false })
      .range(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as GameLog[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export interface EdgePick {
  player: string;
  stat: StatKey;
  line: number;
  median: number;
  edge: number;
  hitRate: number;
  trend: PlayerSummary["trend"];
  lastDate: string;
  lastOpponent: string | null;
}

/** Players with a live sportsbook line today whose L10 median sits off that line. */
export function computeEdges(
  byPlayer: Map<string, GameLog[]>,
  propLines: Map<string, number>,
  limit = 4,
): EdgePick[] {
  const out: EdgePick[] = [];
  for (const [name, games] of byPlayer) {
    for (const { key } of STAT_OPTIONS) {
      const line = propLines.get(`${name.toLowerCase()}|${key}`);
      if (!line) continue;
      const s = summarizePlayer(games, key, line);
      if (!s || s.l10.games < 5) continue;
      const edge = (s.l10.median - line) / line;
      if (Math.abs(edge) < 0.05) continue;
      out.push({
        player: name,
        stat: key,
        line,
        median: s.l10.median,
        edge,
        hitRate: s.l10.hitRate,
        trend: s.trend,
        lastDate: s.lastDate,
        lastOpponent: s.lastOpponent,
      });
    }
  }
  return out.sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge)).slice(0, limit);
}

export function useResearchData() {
  const [logs, setLogs] = useState<GameLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [propLines, setPropLines] = useState<Map<string, number>>(new Map());
  const [injuries, setInjuries] = useState<Map<string, string>>(new Map());
  const today = useMemo(etToday, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr(null);

    (async () => {
      try {
        const all = await fetchAllLogs();
        if (alive) setLogs(all);
      } catch (e) {
        if (alive) setErr(String((e as Error)?.message ?? e));
      } finally {
        if (alive) setLoading(false);
      }
    })();

    (async () => {
      try {
        const [{ data: pl }, { data: inj }] = await Promise.all([
          supabase
            .from("research_prop_lines" as never)
            .select("player_name,stat,line,book")
            .eq("game_date", today)
            .limit(5000),
          supabase
            .from("nba_injury_reports")
            .select("player_name,status")
            .eq("game_date", today)
            .limit(1000),
        ]);
        const m = new Map<string, number>();
        for (const r of (pl ?? []) as { player_name: string; stat: string; line: number; book: string }[]) {
          const k = `${r.player_name.toLowerCase()}|${r.stat}`;
          if (!m.has(k) || r.book === "fanduel") m.set(k, Number(r.line));
        }
        if (alive) setPropLines(m);
        if (alive)
          setInjuries(new Map((inj ?? []).map((i) => [String(i.player_name).toLowerCase(), String(i.status)])));
      } catch (e) {
        console.error("research extras failed", e);
      }
    })();

    return () => {
      alive = false;
    };
  }, [today]);

  const byPlayer = useMemo(() => {
    const m = new Map<string, GameLog[]>();
    for (const g of logs) {
      const arr = m.get(g.player_name) ?? [];
      arr.push(g);
      m.set(g.player_name, arr);
    }
    return m;
  }, [logs]);

  const edges = useMemo(() => computeEdges(byPlayer, propLines, 4), [byPlayer, propLines]);

  return { logs, loading, err, byPlayer, propLines, injuries, today, edges };
}
