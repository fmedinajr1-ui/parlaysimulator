import { statValue, percentile, type GameLog, type StatKey } from "./nbaBoxScoreMath";
import { projectMinutes } from "./projectedMinutes";
import { minutesElasticity } from "./minutesValidation";
import { restProfile } from "./restProfile";

/** Rough NBA team per-game totals, used to size a missing teammate's share. */
export const TEAM_TOTAL: Record<StatKey, number> = { points: 115, rebounds: 44, assists: 26, threes_made: 13, pra: 185 };

/** Bump whenever the projection rules change, so the pick log can compare versions. */
export const MODEL_VERSION = "v5-rest-aware";

export interface ProjectionContext {
  seasonStart: string;
  today: string; // ET YYYY-MM-DD
  /** Player is home tonight (null = unknown). */
  home: boolean | null;
  /** Tonight's opponent allows this stat vs league average (1 = average). */
  oppFactor: number;
  /** Teammates ruled Out tonight who have played this season. */
  teammatesOut: MissingMate[];
  /** Player's position (ESPN abbreviation, e.g. "PG", "C"). */
  position?: string | null;
  /** Opt-in shadow model; v5 remains the default. */
  projectedMinutesModel?: boolean;
}

export interface MissingMate {
  name: string;
  position: string | null;
  /** Their L10 median of this stat. */
  stat: number;
  /** Their average minutes this season. */
  minutes: number;
}

export interface Reason {
  label: string;
  /** Plain-English explanation with the numbers behind it. */
  why: string;
  /** Effect on the projection, e.g. +4 means +4%. */
  pct: number;
}

type Group = "guard" | "wing" | "big";
export function positionGroup(pos: string | null | undefined): Group | null {
  const p = (pos ?? "").toUpperCase();
  if (["PG", "SG", "G"].includes(p)) return "guard";
  if (["SF", "F", "GF", "SF-PF"].includes(p)) return "wing";
  if (["PF", "C", "FC", "PF-C"].includes(p)) return "big";
  return null;
}
/** How much of a missing teammate's role flows to this player, by position overlap. */
export function positionOverlap(a: string | null | undefined, b: string | null | undefined): number {
  const ga = positionGroup(a), gb = positionGroup(b);
  if (!ga || !gb) return 0.5;
  if (ga === gb) return 1;
  if (ga === "wing" || gb === "wing") return 0.6;
  return 0.25; // guard <-> big
}
const STAT_WORD: Record<StatKey, string> = { points: "pts", rebounds: "reb", assists: "ast", threes_made: "3s", pra: "PRA" };

export interface Projection {
  projection: number;
  side: "over" | "under";
  prob: number; // chance the chosen side wins
  ev: number; // expected profit per $1 at the posted odds
  odds: number;
  thisSeason: number;
  /** Raw last-10 games where the chosen side actually won (display only). */
  hitsL10: number;
  gamesL10: number;
  notes: string[];
  reasons: Reason[];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Profit per $1 staked at American odds. */
export const unitProfit = (odds: number) => (odds > 0 ? odds / 100 : 100 / -odds);

function weightedMedian(vals: { v: number; w: number }[]): number {
  const s = [...vals].sort((a, b) => a.v - b.v);
  const total = s.reduce((t, x) => t + x.w, 0);
  let acc = 0;
  for (const x of s) { acc += x.w; if (acc >= total / 2) return x.v; }
  return s.at(-1)?.v ?? 0;
}

/** Standard normal CDF (Abramowitz-Stegun). */
export function normCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const q = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - q : q;
}

/**
 * Projects a prop from the last 10 played games, with this season's games counted double,
 * then adjusts for minutes trend, home/road, days rest, opponent and missing teammates.
 * Picks whichever side (Over or Under) has the better expected profit at the posted odds.
 */
export function projectProp(
  games: GameLog[], stat: StatKey, line: number, overOdds: number, underOdds: number, ctx: ProjectionContext,
): Projection | null {
  const played = games.filter((g) => Number(g.minutes_played) > 0 && g.game_date < ctx.today)
    .sort((a, b) => b.game_date.localeCompare(a.game_date));
  const l10 = played.slice(0, 10);
  const thisSeason = l10.filter((g) => g.game_date >= ctx.seasonStart).length;
  if (l10.length < 5 || thisSeason < 3) return null;

  const reasons: Reason[] = [];
  const add = (label: string, f: number, why: string) => reasons.push({ label, why, pct: Math.round((f - 1) * 100) });
  const w = STAT_WORD[stat];
  const pts = l10.map((g) => ({ v: statValue(g, stat), w: g.game_date >= ctx.seasonStart ? 2 : 1 }));
  const base = weightedMedian(pts);

  // Minutes: medians prevent one overtime game from looking like a lasting role change.
  const mins = l10.map((g) => Number(g.minutes_played));
  const l3m = percentile(mins.slice(0, 3), 0.5);
  const l10m = percentile(mins, 0.5);
  const estimated = ctx.projectedMinutesModel ? projectMinutes(games, ctx.today, ctx.teammatesOut.reduce((n, m) => n + m.minutes, 0)) : null;
  const elasticity: Record<StatKey, number> = { points: 0.65, rebounds: 0.75, assists: 0.5, threes_made: 0.65, pra: 0.65 };
  const fMin = estimated ? minutesElasticity(estimated.minutes, estimated.l10, elasticity[stat]) : clamp(l10m ? l3m / l10m : 1, 0.85, 1.15);
  if (estimated) add("Projected minutes", fMin, `${estimated.minutes} expected min vs ${estimated.l10} baseline; ${Math.round(elasticity[stat] * 100)}% of the minutes change reaches this stat, capped at 8%.`);
  else if (Math.abs(fMin - 1) >= 0.05)
    add(`Minutes ${fMin > 1 ? "up" : "down"}`, fMin, `Typical minutes were ${Math.round(l3m)} over his last 3 vs ${Math.round(l10m)} over 10, so his role is ${fMin > 1 ? "growing" : "shrinking"}; overtime outliers have less influence.`);

  // Venue splits use this season only, so last year's role cannot create a current boost.
  let fHome = 1;
  const venueGames = played.filter((g) => g.game_date >= ctx.seasonStart && g.is_home != null).slice(0, 20);
  const side = venueGames.filter((g) => g.is_home === ctx.home);
  const other = venueGames.filter((g) => g.is_home !== ctx.home);
  if (ctx.home != null && side.length >= 3 && other.length >= 3) {
    const avg = (a: GameLog[]) => a.reduce((t, g) => t + statValue(g, stat), 0) / a.length;
    const all = avg(venueGames), here = avg(side);
    const trust = Math.min(1, side.length / 8);
    if (all > 0) fHome = clamp(1 + (here / all - 1) * trust, 0.95, 1.05);
    if (Math.abs(fHome - 1) >= 0.02)
      add(`${ctx.home ? "Home" : "Road"} ${fHome > 1 ? "boost" : "dip"}`, fHome,
        `Averages ${here.toFixed(1)} ${w} ${ctx.home ? "at home" : "on the road"} vs ${all.toFixed(1)} overall this season (${side.length} ${ctx.home ? "home" : "road"} games).`);
  }

  // Rest: B2B fatigue, neutral normal rest, and small boosts after 2+ full days off.
  const rest = restProfile(played, ctx.today);
  // v6 minutes already include the B2B trim; only extended rest is applied here.
  const fRest = estimated && rest.b2b ? 1 : rest.factor;
  if (!estimated && rest.b2b)
    add("Back-to-back", fRest, `Played yesterday and averages ${Math.round(l10m)} min; ${rest.daysRest} full days off gives a ${Math.round((1 - fRest) * 100)}% fatigue trim.`);
  else if (rest.daysRest != null && rest.daysRest >= 2)
    add(rest.daysRest >= 3 ? "Well rested" : "Rested", fRest, `Last played ${rest.lastGameDate}, so he has ${rest.daysRest} full days off; the model adds only ${Math.round((fRest - 1) * 100)}%.`);

  // Opponent, shrunk halfway toward average.
  const fOpp = clamp(1 + (ctx.oppFactor - 1) * 0.5, 0.92, 1.08);
  if (Math.abs(fOpp - 1) >= 0.02)
    add(`${fOpp > 1 ? "Soft" : "Tough"} defense`, fOpp,
      `Tonight's opponent allows ${Math.abs(Math.round((ctx.oppFactor - 1) * 100))}% ${fOpp > 1 ? "more" : "fewer"} ${w} than the league average this season.`);

  // Teammates out: only the share that fits this player's position, scaled by how many minutes he plays.
  let freed = 0;
  const helpers: string[] = [];
  for (const m of ctx.teammatesOut) {
    const ov = positionOverlap(ctx.position, m.position);
    const share = m.stat * ov * Math.min(1, m.minutes / 30);
    if (share > 0) { freed += share; if (ov >= 0.6 && m.minutes >= 15) helpers.push(`${m.name}${m.position ? ` (${m.position}, ${Math.round(m.minutes)} min)` : ""}`); }
  }
  const roleScale = clamp(l10m / 30, 0.4, 1.2); // bench players soak up less
  const fMate = clamp(1 + (freed / TEAM_TOTAL[stat]) * 0.3 * roleScale, 1, 1.08);
  if (fMate > 1.005 && helpers.length)
    add("Teammate out", fMate,
      `${helpers.join(", ")} ${helpers.length > 1 ? "are" : "is"} out. ${estimated ? "A small usage adjustment remains separate from estimated playing time." : "Same-position minutes open up"} and he plays ${Math.round(l10m)} min${ctx.position ? ` as a ${ctx.position}` : ""}.`);
  const notes = reasons.map((r) => r.label);

  // Context is uncertain: cap the combined adjustment instead of stacking boosts without limit.
  const factor = clamp(fMin * fHome * fRest * fOpp * fMate, 0.88, 1.12);
  const total = pts.reduce((t, x) => t + x.w, 0);
  // v4: centre on a median/mean blend so zero-heavy stats (threes) don't project a flat 0.
  const meanRaw = pts.reduce((t, x) => t + x.v * x.w, 0) / pts.reduce((t, x) => t + x.w, 0);
  const proj = (0.5 * base + 0.5 * meanRaw) * factor;
  // v4: win chance comes from the projected margin vs the player's game-to-game spread,
  // after every factor is applied. Hit rate is only a small secondary check.
  const mean = pts.reduce((t, x) => t + x.v * x.w, 0) / total;
  const varr = pts.reduce((t, x) => t + x.w * (x.v - mean) ** 2, 0) / total;
  const sd = Math.max(Math.sqrt(varr), 1, 0.15 * Math.max(proj, 0));
  const zOver = (proj - line) / sd;
  const pMarginOver = normCdf(zOver);
  const hitOver = (pts.filter((x) => x.v > line).reduce((t, x) => t + x.w, 0) + 2) / (total + 4);
  const hitUnder = (pts.filter((x) => x.v < line).reduce((t, x) => t + x.w, 0) + 2) / (total + 4);
  const hitNudge = clamp((hitOver - hitUnder) * 0.1, -0.05, 0.05);
  // Blend with the sportsbook's no-vig price: the market is sharp, our context only shifts it.
  const imp = (o: number) => 1 / (1 + unitProfit(o));
  const mOver = imp(overOdds) / (imp(overOdds) + imp(underOdds));
  const model = pMarginOver + hitNudge;
  const pOver = clamp(0.6 * model + 0.4 * mOver, 0.05, 0.8);
  const pUnder = clamp(1 - pOver, 0.05, 0.8);
  const evOver = pOver * unitProfit(overOdds) - (1 - pOver);
  const evUnder = pUnder * unitProfit(underOdds) - (1 - pUnder);
  const over = evOver >= evUnder;
  return {
    projection: r2(proj),
    side: over ? "over" : "under",
    prob: r2(over ? pOver : pUnder),
    ev: r2(over ? evOver : evUnder),
    odds: over ? overOdds : underOdds,
    thisSeason,
    hitsL10: l10.filter((g) => (over ? statValue(g, stat) > line : statValue(g, stat) < line)).length,
    gamesL10: l10.length,
    notes,
    reasons,
  };
}

/** Per-opponent factor: stat allowed per game this season vs the league average (needs 3+ games). */
export function opponentFactors(logs: GameLog[], stat: StatKey, seasonStart: string): Map<string, number> {
  const games = new Map<string, Map<string, number>>(); // opp -> date -> total
  for (const g of logs) {
    if (!g.opponent || g.game_date < seasonStart || !(Number(g.minutes_played) > 0)) continue;
    const m = games.get(g.opponent) ?? new Map();
    m.set(g.game_date, (m.get(g.game_date) ?? 0) + statValue(g, stat));
    games.set(g.opponent, m);
  }
  const avgs = new Map<string, number>();
  for (const [opp, m] of games) if (m.size >= 3) avgs.set(opp, [...m.values()].reduce((a, b) => a + b, 0) / m.size);
  const league = percentile([...avgs.values()], 0.5);
  const out = new Map<string, number>();
  if (league > 0) for (const [opp, a] of avgs) out.set(opp, a / league);
  return out;
}

/** Minimum absolute gap between projection and line, per stat. */
export const MARGIN_FLOOR: Record<StatKey, number> = { points: 1.5, rebounds: 1, assists: 1, threes_made: 0.5, pra: 2.5 };

/** v5: a pick needs a real disagreement with the book: 10%+ of the line AND the stat's absolute floor. */
export function passesMarginGate(stat: StatKey, projection: number, line: number): boolean {
  const gap = Math.abs(projection - line);
  return gap >= MARGIN_FLOOR[stat] && line > 0 && gap / line >= 0.1;
}
