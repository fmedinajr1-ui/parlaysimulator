import { statValue, type GameLog } from "./math.ts";
import type { EdgePick } from "./deskEdges.ts";
import { projectMinutes } from "./projectedMinutes.ts";
import { simulateProp } from "./propMonteCarlo.ts";

export type DecisionMarket = "sportsbook" | "prizepicks";
export interface DecisionQuote {
  market: DecisionMarket;
  line: number;
  /** Actual quoted price, never the model's fallback -110. */
  odds?: number | null;
  /** Confirmed total return multiplier for a standard Power entry. */
  payout?: number;
  legs?: number;
  payoutConfirmed?: boolean;
}
export interface DecisionReview {
  pick: EdgePick;
  line: number | null;
  status: "review" | "caution" | "pass" | "unavailable";
  estimate: number | null;
  simulation: number | null;
  hurdle: number | null;
  cushion: number | null;
  flags: string[];
  role: string;
  seasonAverage: number | null;
  recentAverage: number | null;
  hits: number;
  games: number;
  pushes: number;
}

/** Separate decision screen, not a calibrated forecast or a change to model picks. */
export function reviewDecision(pick: EdgePick, logs: GameLog[], today: string, quote: DecisionQuote | null, injury = ""): DecisionReview {
  const base: DecisionReview = { pick, line: quote?.line ?? null, status: "unavailable", estimate: null,
    simulation: null, hurdle: null, cushion: null, flags: [], role: "Role unverified", seasonAverage: null,
    recentAverage: null, hits: 0, games: 0, pushes: 0 };
  if (!quote || !Number.isFinite(quote.line) || quote.line < 0) return { ...base, flags: ["Exact platform line is missing."] };
  const seasonYear = Number(today.slice(0, 4)) - (Number(today.slice(5, 7)) < 10 ? 1 : 0);
  const seasonStart = `${seasonYear}-10-01`;
  const played = logs.filter(g => g.game_date < today && g.game_date >= seasonStart && Number(g.minutes_played) >= 5)
    .filter(g => pick.stat === "pra" ? [g.points, g.rebounds, g.assists].every(v => v != null && Number.isFinite(Number(v))) : g[pick.stat] != null && Number.isFinite(Number(g[pick.stat])))
    .sort((a, b) => b.game_date.localeCompare(a.game_date));
  if (played.length < 10) return { ...base, flags: ["Fewer than 10 complete current-season games; pass until history is sufficient."] };
  const average = (gs: GameLog[], value: (g: GameLog) => number) => gs.reduce((sum, g) => sum + value(g), 0) / gs.length;
  const last10 = played.slice(0, 10);
  const seasonAverage = average(played, g => statValue(g, pick.stat));
  const recentAverage = average(played.slice(0, 5), g => statValue(g, pick.stat));
  const minutes = projectMinutes(played, today, pick.mateMinutesOut ?? 0);
  const sim = simulateProp(played, pick.stat, quote.line, pick.median, minutes?.minutes ?? null);
  if (!sim) return { ...base, flags: ["Simulation cannot be verified from usable games."] };
  // Preserve the requested side. Never quietly reverse it when the platform line differs.
  const simulation = pick.side === "over" ? sim.over : 1 - sim.over;
  const avgMinutes = average(last10, g => Number(g.minutes_played));
  const seasonPoints = average(played, g => Number(g.points) || 0);
  const role = avgMinutes < 22 ? "Limited-minute rotation" : seasonPoints >= 25 ? "Primary scorer" : avgMinutes >= 30 ? "Regular starter minutes" : "Supporting rotation";
  const hits = last10.filter(g => pick.side === "over" ? statValue(g, pick.stat) > quote.line : statValue(g, pick.stat) < quote.line).length;
  const pushes = last10.filter(g => statValue(g, pick.stat) === quote.line).length;
  const result = { ...base, simulation, role, seasonAverage, recentAverage, hits, games: last10.length, pushes };
  let hurdle: number;
  if (quote.market === "prizepicks") {
    if (!quote.payoutConfirmed || !Number.isFinite(quote.payout) || !(Number(quote.payout) > 1) || !Number.isInteger(quote.legs) || Number(quote.legs) < 2 || Number(quote.legs) > 6) {
      return { ...result, flags: ["Confirm the standard Power entry's actual leg count and total payout; Flex and special lines are not supported."] };
    }
    hurdle = Math.pow(Number(quote.payout), -1 / Number(quote.legs));
  } else {
    if (quote.line !== pick.line || quote.odds == null || !Number.isFinite(quote.odds) || Math.abs(quote.odds) < 100) {
      return { ...result, flags: ["Matching sportsbook line and actual price are required; no assumed -110 price."] };
    }
    hurdle = quote.odds < 0 ? -quote.odds / (-quote.odds + 100) : 100 / (quote.odds + 100);
  }
  // PP uses exact-line simulation only; book-blended probability cannot migrate to PP.
  const estimate = quote.market === "prizepicks" ? simulation : Math.min(pick.hitRate, simulation);
  const cushion = estimate - hurdle;
  const flags: string[] = [];
  if (quote.line !== pick.line) flags.push(`Platform line ${quote.line} differs from sportsbook ${pick.line}; sportsbook win chance is not transferable.`);
  if (/out|doubtful|suspend/i.test(injury)) return { ...result, estimate, hurdle, cushion, status: "pass", flags: ["Player is unavailable or doubtful."] };
  if (/question|probable|return/i.test(injury)) flags.push("Health/return status needs confirmation before considering a play.");
  if (!pick.team || !pick.tonight || pick.home == null) flags.push("Team, opponent, or venue is unverified.");
  const daysSince = (Date.parse(`${today}T12:00:00Z`) - Date.parse(`${played[0].game_date}T12:00:00Z`)) / 86400000;
  if (daysSince > 7) flags.push("No usable game in the past seven days; return/role risk.");
  if (quote.market === "sportsbook" && Math.abs(simulation - pick.hitRate) >= 0.1 - 1e-9) flags.push("Model and simulation differ by at least 10 percentage points.");
  if (estimate - hits / last10.length >= 0.15 - 1e-9) flags.push("Estimate exceeds the exact-line last-10 hit rate by at least 15 points.");
  if (pick.side === "under" && seasonAverage >= quote.line) flags.push("Season average is at or above this Under line.");
  if (pick.side === "over" && seasonAverage <= quote.line) flags.push("Season average is at or below this Over line.");
  if (pick.side === "under" && (pick.mateMinutesOut ?? 0) >= 28) flags.push("Teammates out may expand this player's role against the Under.");
  if (avgMinutes < 22) flags.push("Limited minutes make production fragile.");
  const minSpread = Math.max(...last10.map(g => Number(g.minutes_played))) - Math.min(...last10.map(g => Number(g.minutes_played)));
  if (minSpread >= 12) flags.push("Last-10 minutes span at least 12 minutes; rotation is unstable.");
  if (pick.stat === "pra" && pick.side === "under") flags.push("Combined-stat Under can lose through any of three categories; not a ladder default.");
  if (pushes && Number.isInteger(quote.line)) flags.push("Integer line has ties in recent history; platform tie rules need checking.");
  if ((pick.side === "over" && pick.trend === "cold") || (pick.side === "under" && pick.trend === "hot")) flags.push("Recent trend opposes the requested side.");
  if (estimate < 0.65 || cushion < 0.05) {
    flags.unshift("Below the 65% screening floor or less than 5 points above break-even.");
    return { ...result, estimate, hurdle, cushion, status: "pass", flags };
  }
  return { ...result, estimate, hurdle, cushion, status: flags.length ? "caution" : "review", flags };
}

/** Diversified review list, never a betting ticket. No forced fill when checks fail. */
export function decisionShortlist(rows: DecisionReview[], limit = 3): DecisionReview[] {
  const players = new Set<string>();
  const teams = new Set<string>();
  return rows.filter(r => r.status === "review").sort((a, b) => (b.cushion ?? 0) - (a.cushion ?? 0))
    .filter(r => {
      const player = r.pick.player.toLowerCase();
      const team = r.pick.team?.toLowerCase();
      if (!team || players.has(player) || teams.has(team)) return false;
      players.add(player); teams.add(team); return true;
    }).slice(0, limit);
}