import type { GameLog } from "./nbaBoxScoreMath";

export interface Allowance { average: number; league: number; games: number; factor: number }
export interface ProductionContext {
  fgaL5: number | null; fgaL10: number | null; shotFactor: number;
  plusMinus: number | null; plusMinusGames: number;
  assistsAllowed: Allowance | null; reboundsAllowed: Allowance | null;
}

/** Only complete team box scores, before the slate, count as opponent allowances. */
export function opponentAllowances(logs: GameLog[], today: string, seasonStart: string) {
  const games = new Map<string, { opponent: string; minutes: number; assists: number; rebounds: number }>();
  const seen = new Set<string>();
  for (const g of logs) {
    if (!g.opponent || g.game_date < seasonStart || g.game_date >= today || !(Number(g.minutes_played) > 0)) continue;
    const id = `${g.player_name}|${g.game_date}|${g.opponent}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const key = `${g.opponent}|${g.game_date}`;
    const total = games.get(key) ?? { opponent: g.opponent, minutes: 0, assists: 0, rebounds: 0 };
    total.minutes += Number(g.minutes_played);
    total.assists += Number(g.assists) || 0;
    total.rebounds += Number(g.rebounds) || 0;
    games.set(key, total);
  }
  const complete = [...games.values()].filter((g) => g.minutes >= 230);
  const out = new Map<string, { assists: Allowance; rebounds: Allowance }>();
  if (!complete.length) return out;
  const leagueA = complete.reduce((n, g) => n + g.assists, 0) / complete.length;
  const leagueR = complete.reduce((n, g) => n + g.rebounds, 0) / complete.length;
  for (const opponent of new Set(complete.map((g) => g.opponent))) {
    const rows = complete.filter((g) => g.opponent === opponent);
    if (rows.length < 3 || !(leagueA > 0) || !(leagueR > 0)) continue;
    const allowance = (stat: "assists" | "rebounds", league: number): Allowance => {
      const average = rows.reduce((n, g) => n + g[stat], 0) / rows.length;
      return { average, league, games: rows.length, factor: average / league };
    };
    out.set(opponent, { assists: allowance("assists", leagueA), rebounds: allowance("rebounds", leagueR) });
  }
  return out;
}

/** Per-minute attempts separate shooting opportunity from a minutes change. */
export function productionContext(games: GameLog[], today: string, allowance?: { assists: Allowance; rebounds: Allowance }): ProductionContext {
  const played = games.filter((g) => g.game_date < today && Number(g.minutes_played) > 0)
    .sort((a, b) => b.game_date.localeCompare(a.game_date)).slice(0, 10);
  const valid = (rows: GameLog[]) => rows.filter((g) => g.field_goals_attempted != null && Number.isFinite(Number(g.field_goals_attempted)));
  const l5 = valid(played.slice(0, 5)), l10 = valid(played);
  const avg = (rows: GameLog[]) => rows.length ? rows.reduce((n, g) => n + Number(g.field_goals_attempted), 0) / rows.length : null;
  const rate = (rows: GameLog[]) => rows.reduce((n, g) => n + Number(g.field_goals_attempted), 0) / rows.reduce((n, g) => n + Number(g.minutes_played), 0);
  let shotFactor = 1;
  if (l5.length >= 3 && l10.length >= 5 && rate(l10) > 0) shotFactor = Math.min(1.05, Math.max(0.95, 1 + 0.35 * (rate(l5) / rate(l10) - 1)));
  const pm = played.filter((g) => g.plus_minus != null && Number.isFinite(Number(g.plus_minus)));
  return { fgaL5: avg(l5), fgaL10: avg(l10), shotFactor,
    plusMinus: pm.length ? pm.reduce((n, g) => n + Number(g.plus_minus), 0) / pm.length : null,
    plusMinusGames: pm.length, assistsAllowed: allowance?.assists ?? null, reboundsAllowed: allowance?.rebounds ?? null };
}