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

const norm = (n: string) => n.toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, "").replace(/[^a-z ]/g, "").trim();

/** Maps game-log names onto current roster names (e.g. "Herb Jones" -> "Herbert Jones"); null = not on a roster. */
export function rosterResolver(roster: string[]) {
  const exact = new Map(roster.map((r) => [norm(r), r]));
  return (name: string): string | null => {
    const n = norm(name);
    if (exact.has(n)) return exact.get(n)!;
    const [first, ...rest] = n.split(" ");
    const last = rest.join(" ");
    const hits = roster.filter((r) => {
      const [rf, ...rr] = norm(r).split(" ");
      return rr.join(" ") === last && first.length >= 3 && (rf.startsWith(first) || first.startsWith(rf));
    });
    return hits.length === 1 ? hits[0] : null;
  };
}

export function useResearchData() {
  const [logs, setLogs] = useState<GameLog[]>(memoryLogs ?? []);
  const [loading, setLoading] = useState(!memoryLogs);
  const [err, setErr] = useState<string | null>(null);
  const [propLines, setPropLines] = useState<Map<string, number>>(new Map());
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

  const [roster, setRoster] = useState<string[] | null>(null);
  useEffect(() => {
    supabase.from("research_player_teams").select("player_name").limit(2000)
      .then(({ data }) => setRoster((data ?? []).map((r) => r.player_name)), () => setRoster(null));
  }, []);

  const byPlayer = useMemo(() => {
    const resolve = roster?.length ? rosterResolver(roster) : (n: string) => n;
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
  }, [logs]);

  const edges = useMemo(() => computeEdges(byPlayer, propLines, 4), [byPlayer, propLines]);

  return { logs, loading, err, byPlayer, propLines, injuries, today, edges };
}
