import { pickWarnings, type WarnInput } from "./pickWarnings.ts";

export const BOT_STRATEGY_VERSION = "skeptical-risk-v1";
export const BOT_STARTING_BANKROLL = 100;
export const BOT_MAX_PICKS = 3;
export const BOT_DAILY_CAP = 1.5;

export interface BotCandidate extends WarnInput {
  player: string;
  stat: string;
  line: number;
  odds: number;
  median: number;
  ev: number;
  tonight: string | null;
}

export interface BotPosition {
  pick: BotCandidate;
  warnings: string[];
  riskScore: number;
  stakeUnits: number;
  rank: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const floor2 = (n: number) => Math.floor(n * 100) / 100;

/**
 * Selects up to three flagged plays by warning-adjusted EV. Stakes start at
 * 0.75u and shrink for extra warnings, a large model/hit-rate gap, and long odds.
 * Total new daily exposure is capped at 1.5u. No real-money bet is placed.
 */
export function buildBotStrategy(candidates: BotCandidate[]): BotPosition[] {
  const flagged = candidates.flatMap((pick) => {
    const warnings = pickWarnings(pick);
    if (!warnings.length || !Number.isFinite(pick.odds) || Math.abs(pick.odds) < 100 || !Number.isFinite(pick.ev)) return [];
    return [{ pick, warnings, score: pick.ev - 0.02 * (warnings.length - 1) }];
  }).sort((a, b) => b.score - a.score || a.warnings.length - b.warnings.length
    || `${a.pick.player}|${a.pick.stat}`.localeCompare(`${b.pick.player}|${b.pick.stat}`))
    .slice(0, BOT_MAX_PICKS);

  const positions = flagged.map(({ pick, warnings }, index) => {
    const actual = pick.gamesL10 ? pick.hitsL10 / pick.gamesL10 : 0;
    const disagreement = Math.max(0, pick.hitRate - actual);
    const longOdds = pick.odds >= 150;
    const riskScore = Math.min(100, Math.round(45 + (warnings.length - 1) * 15 + disagreement * 100 + (longOdds ? 10 : 0)));
    const rawStake = Math.max(0.1, 0.75 - (warnings.length - 1) * 0.2 - (disagreement >= 0.2 ? 0.25 : 0) - (longOdds ? 0.15 : 0));
    return { pick, warnings, riskScore, stakeUnits: round2(rawStake), rank: index + 1 };
  });
  const total = positions.reduce((sum, p) => sum + p.stakeUnits, 0);
  if (total <= BOT_DAILY_CAP) return positions;
  return positions.map((p) => ({ ...p, stakeUnits: Math.max(0.1, floor2(p.stakeUnits * BOT_DAILY_CAP / total)) }));
}

export interface BotResult {
  status: string;
  odds: number;
  stake_units: number | string;
}

/** Settled profit in units; pushes/voids refund and open positions never count as profit. */
export function settleBotPosition(row: BotResult): number {
  const stake = Number(row.stake_units);
  if (row.status === "lost") return -stake;
  if (row.status !== "won") return 0;
  return stake * (row.odds > 0 ? row.odds / 100 : 100 / -row.odds);
}

export function summarizeBotProfit(rows: BotResult[]) {
  const won = rows.filter((r) => r.status === "won").length;
  const lost = rows.filter((r) => r.status === "lost").length;
  const push = rows.filter((r) => r.status === "push").length;
  const voided = rows.filter((r) => r.status === "void").length;
  const open = rows.filter((r) => r.status === "open").length;
  const settled = rows.filter((r) => ["won", "lost", "push", "void"].includes(r.status));
  const risked = settled.reduce((sum, r) => sum + Number(r.stake_units), 0);
  const exposure = rows.filter((r) => r.status === "open").reduce((sum, r) => sum + Number(r.stake_units), 0);
  const profit = rows.reduce((sum, r) => sum + settleBotPosition(r), 0);
  return {
    won, lost, push, voided, open, profit, risked, exposure,
    bankroll: BOT_STARTING_BANKROLL + profit,
    roi: risked > 0 ? profit / risked : null,
  };
}
