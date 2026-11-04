import { statValue, type GameLog, type StatKey } from "./nbaBoxScoreMath";

export type Side = "over" | "under";
export type BetStatus = "open" | "won" | "lost" | "push" | "void";

export interface PaperBet {
  id: string;
  player: string;
  stat: StatKey;
  side: Side;
  line: number;
  odds: number; // American
  stake: number;
  gameDate: string; // ET YYYY-MM-DD
  placedAt: string;
}

/** Profit (not including stake) if an American-odds bet wins. */
export function winProfit(stake: number, odds: number): number {
  if (!stake || !odds) return 0;
  const p = odds > 0 ? (stake * odds) / 100 : (stake * 100) / -odds;
  return Math.round(p * 100) / 100;
}

/** Grades a bet against the player's box score for that date. No game yet = open; 0 minutes = void. */
export function settleBet(bet: PaperBet, logs: GameLog[]): BetStatus {
  const g = logs.find((l) => l.player_name === bet.player && l.game_date === bet.gameDate);
  if (!g) return "open";
  if (!(Number(g.minutes_played) > 0)) return "void";
  const v = statValue(g, bet.stat);
  if (v === bet.line) return "push";
  return (bet.side === "over" ? v > bet.line : v < bet.line) ? "won" : "lost";
}

/** Profit/loss for a settled bet (open/push/void = 0). */
export function betPnl(bet: PaperBet, status: BetStatus): number {
  if (status === "won") return winProfit(bet.stake, bet.odds);
  if (status === "lost") return -bet.stake;
  return 0;
}

export interface Summary { bankroll: number; atRisk: number; profit: number; won: number; lost: number; open: number }

/** Bankroll = starting money + settled profit − stakes still open. */
export function summarize(start: number, bets: { bet: PaperBet; status: BetStatus }[]): Summary {
  let profit = 0, atRisk = 0, won = 0, lost = 0, open = 0;
  for (const { bet, status } of bets) {
    profit += betPnl(bet, status);
    if (status === "open") { atRisk += bet.stake; open++; }
    if (status === "won") won++;
    if (status === "lost") lost++;
  }
  profit = Math.round(profit * 100) / 100;
  return { bankroll: Math.round((start + profit - atRisk) * 100) / 100, atRisk, profit, won, lost, open };
}
