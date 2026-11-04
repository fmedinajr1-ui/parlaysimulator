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

// Cache so leaving and returning (or the phone dropping the tab) shows data instantly.
let memoryLogs: GameLog[] | null = null;
const DB = "research-cache", STORE = "kv", KEY = "logs";
function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function readCache(): Promise<GameLog[] | null> {
  try {
    const db = await idb();
    return await new Promise((res) => {
      const q = db.transaction(STORE).objectStore(STORE).get(KEY);
      q.onsuccess = () => res((q.result as GameLog[]) ?? null);
      q.onerror = () => res(null);
    });
  } catch { return null; }
}
async function writeCache(logs: GameLog[]) {
  try {
    const db = await idb();
    db.transaction(STORE, "readwrite").objectStore(STORE).put(logs, KEY);
  } catch { /* ignore */ }
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
  tonight: string | null;
}

/** Players with a live sportsbook line today whose L10 median sits off that line. */
export function computeEdges(
  byPlayer: Map<string, GameLog[]>,
  propLines: Map<string, number>,
  limit = 4,
  tonight: Map<string, string> = new Map(),
  seasonStart = "2026-10-01",
): EdgePick[] {
  const out: EdgePick[] = [];
  for (const [name, games] of byPlayer) {
    for (const { key } of STAT_OPTIONS) {
      const line = propLines.get(`${name.toLowerCase()}|${key}`);
      if (!line) continue;
      if (!games.some((g) => g.game_date >= seasonStart)) continue; // must have played this season
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
        tonight: tonight.get(name.toLowerCase()) ?? null,
      });
    }
  }
  return out.sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge)).slice(0, limit);
}

const norm = (n: string) => n.toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, "").replace(/[^a-z ]/g, "").trim();

/** Maps game-log names onto current roster names (e.g. "Herb Jones" -> "Herbert Jones"); null = not on a roster. */
export function rosterResolver(roster: string[]) {
  const exact = new Map(roster.map((r) => [norm(r), r]));
  const memo = new Map<string, string | null>();
  return (name: string): string | null => {
    if (memo.has(name)) return memo.get(name)!;
    const n = norm(name);
    const [first, ...rest] = n.split(" ");
    const last = rest.join(" ");
    const hits = roster.filter((r) => {
      const [rf, ...rr] = norm(r).split(" ");
      return rr.join(" ") === last && first.length >= 3 && (rf.startsWith(first) || first.startsWith(rf));
    });
    const out = exact.get(n) ?? (hits.length === 1 ? hits[0] : null);
    memo.set(name, out);
    return out;
  };
}

type RawLine = { player_name: string; stat: string; line: number; book: string; event_label: string | null };

export function useResearchData() {
  const [logs, setLogs] = useState<GameLog[]>(memoryLogs ?? []);
  const [loading, setLoading] = useState(!memoryLogs);
  const [err, setErr] = useState<string | null>(null);
  const [rawLines, setRawLines] = useState<RawLine[]>([]);
  const [injuries, setInjuries] = useState<Map<string, string>>(new Map());
  const today = useMemo(etToday, []);

  useEffect(() => {
    let alive = true;
    setErr(null);

    (async () => {
      try {
        if (!memoryLogs) {
          const cached = await readCache();
          if (cached?.length && alive) {
            memoryLogs = cached;
            setLogs(cached);
            setLoading(false);
          }
        }
        const all = await fetchAllLogs();
        memoryLogs = all;
        writeCache(all);
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
            .select("player_name,stat,line,book,event_label")
            .eq("game_date", today)
            .limit(5000),
          supabase
            .from("nba_injury_reports")
            .select("player_name,status")
            .eq("game_date", today)
            .limit(1000),
        ]);
        if (alive) setRawLines((pl ?? []) as RawLine[]);
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

  const [roster, setRoster] = useState<{ player_name: string; team: string }[] | null>(null);
  useEffect(() => {
    supabase.from("research_player_teams").select("player_name,team").limit(2000)
      .then(({ data }) => setRoster(data ?? []), () => setRoster(null));
  }, []);
  const resolver = useMemo(
    () => (roster?.length ? rosterResolver(roster.map((r) => r.player_name)) : (n: string) => n),
    [roster],
  );

  // Today's lines keyed by roster name, plus tonight's opponent from the game the line belongs to.
  const { propLines, tonight } = useMemo(() => {
    const m = new Map<string, number>();
    const t = new Map<string, string>();
    const teamOf = new Map((roster ?? []).map((r) => [r.player_name, r.team]));
    for (const r of rawLines) {
      const name = resolver(r.player_name);
      if (!name) continue;
      const k = `${name.toLowerCase()}|${r.stat}`;
      if (!m.has(k) || r.book === "fanduel") m.set(k, Number(r.line));
      const [away, home] = (r.event_label ?? "").split(" @ ");
      const team = teamOf.get(name);
      if (team && away && home) t.set(name.toLowerCase(), team === home ? away : team === away ? home : r.event_label!);
    }
    return { propLines: m, tonight: t };
  }, [rawLines, resolver, roster]);

  const byPlayer = useMemo(() => {
    const resolve = resolver;
    const m = new Map<string, GameLog[]>();
    for (const raw of logs) {
      const name = resolve(raw.player_name);
      if (!name) continue; // not on any current roster
      const g = name === raw.player_name ? raw : { ...raw, player_name: name };
      const arr = m.get(g.player_name) ?? [];
      arr.push(g);
      m.set(g.player_name, arr);
    }
    return m;
  }, [logs, resolver]);

  const edges = useMemo(() => computeEdges(byPlayer, propLines, 4, tonight), [byPlayer, propLines, tonight]);

  return { logs, loading, err, byPlayer, propLines, tonight, injuries, today, edges };
}
