import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { projectProp, passesMarginGate, opponentFactors, type MissingMate, type Reason } from "@/utils/nbaProjection";
import { trendContext, type TrendContext } from "@/utils/trendContext";
import { buildGameCoverage, type GameCoveragePlayerInput } from "@/utils/gameCoverage";
import {
  summarizePlayer,
  type GameLog,
  type PlayerSummary,
  type StatKey,
} from "@/utils/nbaBoxScoreMath";

const COLS = "player_name,game_date,opponent,minutes_played,points,rebounds,assists,threes_made,is_home,field_goals_attempted,threes_attempted";

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
  /** Adjusted projection (kept as `median` for older callers). */
  median: number;
  edge: number;
  side: "over" | "under";
  /** Chance the recommended side wins. */
  hitRate: number;
  /** Expected profit per $1 at the posted odds. */
  ev: number;
  odds: number;
  notes: string[];
  reasons: Reason[];
  trend: PlayerSummary["trend"];
  lastDate: string;
  lastOpponent: string | null;
  tonight: string | null;
  /** How many of the last 10 games were played this season. */
  thisSeason: number;
  /** True = player's team is home tonight, false = he is on the road, null = venue unknown. */
  home: boolean | null;
  /** Player's team, full name (e.g. "Utah Jazz"). */
  team: string | null;
  /** Passes every pick rule (EV, win %, margin gate). */
  qualifies?: boolean;
  /** Season minutes per game of same-team players ruled Out tonight. */
  mateMinutesOut?: number;
}

export interface EdgeInputs {
  byPlayer: Map<string, GameLog[]>;
  propLines: Map<string, number>;
  lineOdds: Map<string, { over: number | null; under: number | null }>;
  tonight: Map<string, string>;
  homeTonight: Map<string, boolean>;
  injuries: Map<string, string>;
  teamOf: Map<string, string>;
  positionOf?: Map<string, string | null>;
  today: string;
  seasonStart?: string;
  limit?: number;
  /** Keep every projected prop (projections board), flagging which ones qualify. */
  all?: boolean;
  projectedMinutesModel?: boolean;
}

const SKIP_STATUS = /out|doubtful|suspend/i;

/** Ranks every prop with a line tonight by expected profit; Overs and Unders compete on the same scale. */
export function computeEdges(i: EdgeInputs): EdgePick[] {
  const seasonStart = i.seasonStart ?? "2026-10-01";
  const all: GameLog[] = [];
  for (const g of i.byPlayer.values()) all.push(...g);
  const oppCache = new Map<StatKey, Map<string, number>>();
  const opp = (stat: StatKey) => oppCache.get(stat) ?? oppCache.set(stat, opponentFactors(all, stat, seasonStart)).get(stat)!;
  // Teammates ruled out tonight, by team.
  const outByTeam = new Map<string, string[]>();
  for (const [name, status] of i.injuries) {
    if (!/out/i.test(status)) continue;
    const real = [...i.teamOf.keys()].find((n) => n.toLowerCase() === name);
    const team = real && i.teamOf.get(real);
    if (team) outByTeam.set(team, [...(outByTeam.get(team) ?? []), real]);
  }
  const out: EdgePick[] = [];
  for (const [name, games] of i.byPlayer) {
    const lower = name.toLowerCase();
    if (SKIP_STATUS.test(i.injuries.get(lower) ?? "")) continue;
    const team = i.teamOf.get(name);
    for (const { key } of STAT_OPTIONS) {
      const k = `${lower}|${key}`;
      const line = i.propLines.get(k);
      if (!line) continue;
      const odds = i.lineOdds.get(k);
      const oppName = i.tonight.get(lower);
      const mates = (team && outByTeam.get(team)) || [];
      // Only teammates who've actually played this season free up a role.
      const matesOut: MissingMate[] = [];
      for (const m of mates) {
        const g = (i.byPlayer.get(m) ?? []).filter((x) => x.game_date >= seasonStart && Number(x.minutes_played) > 0);
        const s = summarizePlayer(g, key);
        if (!s || !g.length) continue;
        const minutes = g.reduce((t, x) => t + Number(x.minutes_played), 0) / g.length;
        matesOut.push({ name: m, position: i.positionOf?.get(m) ?? null, stat: s.l10.median, minutes });
      }
      const p = projectProp(games, key, line, odds?.over ?? -110, odds?.under ?? -110, {
        seasonStart, today: i.today, home: i.homeTonight.get(lower) ?? null,
        oppFactor: (oppName && opp(key).get(oppName)) || 1, teammatesOut: matesOut,
        position: i.positionOf?.get(name) ?? null,
        projectedMinutesModel: i.projectedMinutesModel,
      });
      if (!p) continue;
      const qualifies = p.ev >= 0.03 && p.prob >= 0.55 && passesMarginGate(key, p.projection, line);
      if (!qualifies && !i.all) continue;
      const s = summarizePlayer(games, key, line)!;
      out.push({
        player: name, stat: key, line, median: p.projection, edge: Math.round((p.projection - line) * 10) / 10,
        side: p.side, hitRate: p.prob, ev: p.ev, odds: p.odds, notes: p.notes, reasons: p.reasons, trend: s.trend,
        lastDate: s.lastDate, lastOpponent: s.lastOpponent, tonight: oppName ?? null, thisSeason: p.thisSeason,
        home: i.homeTonight.get(lower) ?? null, team: team ?? null,
        qualifies, mateMinutesOut: matesOut.reduce((t, m) => t + m.minutes, 0),
      });
    }
  }
  return out.sort((a, b) => b.ev - a.ev).slice(0, i.limit ?? 4);
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

type RawLine = { player_name: string; stat: string; line: number; book: string; event_label: string | null; over_price: number | null; under_price: number | null };

/** Implied probability of American odds. */
const implied = (o: number | null) => (o == null ? 0.5 : o < 0 ? -o / (-o + 100) : 100 / (o + 100));
/** How far a line is from a fair 50/50 main line (0 = perfectly balanced). */
const juice = (r: RawLine) => Math.abs(implied(r.over_price) - implied(r.under_price));

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
            .select("player_name,stat,line,book,event_label,over_price,under_price")
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

  const [roster, setRoster] = useState<{ player_name: string; team: string; position: string | null }[] | null>(null);
  useEffect(() => {
    supabase.from("research_player_teams").select("player_name,team,position").limit(2000)
      .then(({ data }) => setRoster(data ?? []), () => setRoster(null));
  }, []);
  const resolver = useMemo(
    () => (roster?.length ? rosterResolver(roster.map((r) => r.player_name)) : (n: string) => n),
    [roster],
  );

  // Today's lines keyed by roster name, plus tonight's opponent from the game the line belongs to.
  const { propLines, tonight, lineOdds, homeTonight } = useMemo(() => {
    const m = new Map<string, number>();
    const best = new Map<string, number>();
    const t = new Map<string, string>();
    const h = new Map<string, boolean>();
    const o = new Map<string, { over: number | null; under: number | null; book: string }>();
    const teamOf = new Map((roster ?? []).map((r) => [r.player_name, r.team]));
    for (const r of rawLines) {
      const name = resolver(r.player_name);
      if (!name) continue;
      const k = `${name.toLowerCase()}|${r.stat}`;
      // Keep the main line (most balanced odds), not juiced alternates like 0.5 at -240.
      const j = juice(r) - (r.book === "fanduel" ? 0.01 : 0);
      if (!best.has(k) || j < best.get(k)!) { best.set(k, j); m.set(k, Number(r.line)); o.set(k, { over: r.over_price, under: r.under_price, book: r.book }); }
      const [away, home] = (r.event_label ?? "").split(" @ ");
      const team = teamOf.get(name);
      if (team && away && home && (team === home || team === away)) h.set(name.toLowerCase(), team === home);
      if (team && away && home) t.set(name.toLowerCase(), team === home ? away : team === away ? home : r.event_label!);
    }
    return { propLines: m, tonight: t, lineOdds: o, homeTonight: h };
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

  const allEdges = useMemo(() => computeEdges({
    byPlayer, propLines, lineOdds, tonight, homeTonight, injuries, today,
    teamOf: new Map((roster ?? []).map((r) => [r.player_name, r.team])),
    positionOf: new Map((roster ?? []).map((r) => [r.player_name, r.position])),
    limit: 10000,
  }), [byPlayer, propLines, lineOdds, tonight, homeTonight, injuries, today, roster]);
  const edges = useMemo(() => allEdges.slice(0, 4), [allEdges]);
  const v6Edges = useMemo(() => computeEdges({
    byPlayer, propLines, lineOdds, tonight, homeTonight, injuries, today,
    teamOf: new Map((roster ?? []).map((r) => [r.player_name, r.team])),
    positionOf: new Map((roster ?? []).map((r) => [r.player_name, r.position])),
    projectedMinutesModel: true,
  }), [byPlayer, propLines, lineOdds, tonight, homeTonight, injuries, today, roster]);
  const boardEdges = useMemo(() => computeEdges({
    byPlayer, propLines, lineOdds, tonight, homeTonight, injuries, today,
    teamOf: new Map((roster ?? []).map((r) => [r.player_name, r.team])),
    positionOf: new Map((roster ?? []).map((r) => [r.player_name, r.position])),
    limit: 10000, all: true,
  }), [byPlayer, propLines, lineOdds, tonight, homeTonight, injuries, today, roster]);

  const gameCoverage = useMemo(() => {
    const rows: GameCoveragePlayerInput[] = [];
    const teamOf = new Map((roster ?? []).map((r) => [r.player_name, r.team]));
    for (const raw of rawLines) {
      const player = resolver(raw.player_name);
      if (!player || !byPlayer.has(player)) continue;
      const team = teamOf.get(player);
      const [away, home] = (raw.event_label ?? "").split(" @ ");
      if (!team || !away || !home || (team !== away && team !== home)) continue;
      rows.push({
        player,
        team,
        opponent: team === home ? away : home,
        home: team === home,
        stat: raw.stat,
      });
    }
    return buildGameCoverage(rows, allEdges);
  }, [rawLines, resolver, roster, byPlayer, allEdges]);

  // Previous main line per player|stat (last 14 days) for line-movement context.
  const [prevLines, setPrevLines] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    const since = new Date(Date.parse(today) - 14 * 86400000).toISOString().slice(0, 10);
    (async () => {
      try {
        const rows: (RawLine & { game_date: string })[] = [];
        for (let from = 0; from < 20000; from += 1000) {
          const { data, error } = await supabase.from("research_prop_lines" as never)
            .select("player_name,stat,line,book,event_label,over_price,under_price,game_date")
            .gte("game_date", since).lt("game_date", today).range(from, from + 999);
          if (error) throw error;
          rows.push(...((data ?? []) as never[]));
          if (!data || data.length < 1000) break;
        }
        const best = new Map<string, { d: string; j: number; line: number }>();
        for (const r of rows) {
          const k = `${r.player_name.toLowerCase()}|${r.stat}`;
          const b = best.get(k), j = juice(r);
          if (!b || r.game_date > b.d || (r.game_date === b.d && j < b.j)) best.set(k, { d: r.game_date, j, line: Number(r.line) });
        }
        setPrevLines(new Map([...best].map(([k, v]) => [k, v.line])));
      } catch (e) { console.error("prev lines failed", e); }
    })();
  }, [today]);

  // Teammate context: dates each player's regular teammates (24+ min this season) sat.
  const mateContext = useMemo(() => {
    const seasonStart = "2026-10-01";
    const teamOf = new Map((roster ?? []).map((r) => [r.player_name, r.team]));
    const teamDates = new Map<string, Set<string>>();
    const played = new Map<string, Set<string>>();
    const regulars = new Map<string, string[]>();
    for (const [name, games] of byPlayer) {
      const team = teamOf.get(name); if (!team) continue;
      const g = games.filter((x) => x.game_date >= seasonStart && Number(x.minutes_played) > 0);
      played.set(name, new Set(g.map((x) => x.game_date)));
      const ds = teamDates.get(team) ?? new Set(); g.forEach((x) => ds.add(x.game_date)); teamDates.set(team, ds);
      if (g.length >= 3 && g.reduce((t, x) => t + Number(x.minutes_played), 0) / g.length >= 24)
        regulars.set(team, [...(regulars.get(team) ?? []), name]);
    }
    return (player: string) => {
      const team = teamOf.get(player);
      if (!team) return undefined;
      const dates = new Set<string>(); const missing = new Set<string>();
      for (const d of teamDates.get(team) ?? []) for (const m of regulars.get(team) ?? [])
        if (m !== player && !played.get(m)?.has(d)) { dates.add(d); missing.add(m); }
      const back = missing.size > 0 && [...missing].every((m) => !/out|doubtful/i.test(injuries.get(m.toLowerCase()) ?? ""));
      return { dates, back };
    };
  }, [byPlayer, roster, injuries]);

  const oppByStat = useMemo(() => {
    const all: GameLog[] = []; for (const g of byPlayer.values()) all.push(...g);
    const m = new Map<StatKey, Map<string, number>>();
    for (const { key } of STAT_OPTIONS) m.set(key, opponentFactors(all, key, "2026-10-01"));
    return m;
  }, [byPlayer]);

  const trendFor = (player: string, stat: StatKey): TrendContext => {
    const k = `${player.toLowerCase()}|${stat}`;
    const mc = mateContext(player);
    return trendContext(byPlayer.get(player) ?? [], stat, {
      oppFactor: oppByStat.get(stat), mateOutDates: mc?.dates, matesBackTonight: mc?.back, today,
      homeTonight: homeTonight.get(player.toLowerCase()) ?? null, lineTonight: propLines.get(k), linePrev: prevLines.get(k),
    });
  };

  return { logs, loading, err, byPlayer, propLines, lineOdds, tonight, injuries, today, edges, v6Edges, allEdges, boardEdges, gameCoverage, trendFor };
}
