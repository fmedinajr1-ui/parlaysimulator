// deno-lint-ignore-file no-explicit-any
import { summarizePlayer, type GameLog, type StatKey } from "./math.ts";

export const STAT_LABEL: Record<StatKey, string> = {
  points: "Points", rebounds: "Rebounds", assists: "Assists", threes_made: "3-Pointers Made", pra: "Points + Rebounds + Assists",
};
const COLS = "player_name,game_date,opponent,minutes_played,points,rebounds,assists,threes_made";
const r1 = (n: number) => Math.round(n * 10) / 10;

export async function playerLogs(sb: any, name: string): Promise<GameLog[]> {
  const { data } = await sb.from("nba_player_game_logs").select(COLS).ilike("player_name", name)
    .order("game_date", { ascending: false }).limit(15);
  return data ?? [];
}

export function describe(logs: GameLog[], stat: StatKey, line?: number) {
  const s = summarizePlayer(logs, stat, line);
  if (!s) return null;
  return {
    player: s.player, stat: STAT_LABEL[stat], line: line ?? null,
    last5: { median: r1(s.l5.median), hitRate: Math.round(s.l5.hitRate * 100) },
    last10: { median: r1(s.l10.median), floor: r1(s.l10.floor), ceiling: r1(s.l10.ceiling), hitRate: Math.round(s.l10.hitRate * 100), games: s.l10.games },
    trend: s.trend, recentValues: s.recent, lastGame: `${s.lastDate} vs ${s.lastOpponent ?? "?"}`,
  };
}

const STAT_FROM_LINE: Record<string, StatKey> = { points: "points", rebounds: "rebounds", assists: "assists", threes_made: "threes_made", pra: "pra" };

/** Builds edges for every player with a prop line on the given date: L10 median vs line. */
export async function slateEdges(sb: any, date: string) {
  const { data: lines } = await sb.from("research_prop_lines").select("*").eq("game_date", date).limit(2000);
  const { data: inj } = await sb.from("nba_injury_reports").select("player_name,status,injury_type").order("updated_at", { ascending: false }).limit(500);
  const injMap = new Map<string, any>((inj ?? []).map((i: any) => [i.player_name.toLowerCase(), i]));
  const byKey = new Map<string, any>();
  for (const l of lines ?? []) {
    const k = `${l.player_name}|${l.stat}`;
    if (!byKey.has(k)) byKey.set(k, l);
  }
  const names = [...new Set([...byKey.values()].map((l) => l.player_name))];
  const logsByName = new Map<string, GameLog[]>();
  for (let i = 0; i < names.length; i += 50) {
    const { data } = await sb.from("nba_player_game_logs").select(COLS).in("player_name", names.slice(i, i + 50))
      .order("game_date", { ascending: false }).limit(50 * 15);
    for (const g of data ?? []) {
      const arr = logsByName.get(g.player_name) ?? [];
      if (arr.length < 15) arr.push(g);
      logsByName.set(g.player_name, arr);
    }
  }
  const edges: any[] = [];
  for (const l of byKey.values()) {
    const stat = STAT_FROM_LINE[l.stat];
    const logs = logsByName.get(l.player_name);
    if (!stat || !logs) continue;
    const d = describe(logs, stat, Number(l.line));
    if (!d || d.last10.games < 5) continue;
    const edge = d.last10.median - Number(l.line);
    const injury = injMap.get(l.player_name.toLowerCase());
    edges.push({ ...d, book: l.book, overPrice: l.over_price, underPrice: l.under_price, edge: r1(edge), side: edge >= 0 ? "Over" : "Under", injury: injury ? `${injury.status} (${injury.injury_type ?? "n/a"})` : null });
  }
  return edges.sort((a, b) => Math.abs(b.edge) / Math.max(1, b.line) - Math.abs(a.edge) / Math.max(1, a.line));
}
