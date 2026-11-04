import type { StatKey } from "./nbaBoxScoreMath";
import type { BetStatus, Side } from "./paperBets";

export interface SlipLeg { player: string; stat: StatKey; side: Side; line: number; odds: number; opp?: string | null }

export const legKey = (l: Pick<SlipLeg, "player" | "stat">) => `${l.player.toLowerCase()}|${l.stat}`;

/** American odds -> decimal odds. */
export const toDecimal = (o: number) => (o > 0 ? 1 + o / 100 : 1 + 100 / -o);
/** Decimal odds -> American (rounded). */
export const toAmerican = (d: number) => (d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1)));

/** Combined American odds for a parlay. Fewer than 1 leg = 0. */
export function parlayOdds(odds: number[]): number {
  if (!odds.length) return 0;
  return toAmerican(odds.reduce((p, o) => p * toDecimal(o), 1));
}

/** Parlay grade: any loss loses; any open leg keeps it open; void/push legs drop out; all dropped = void. */
export function parlayStatus(legs: { status: BetStatus; odds: number }[]): { status: BetStatus; odds: number } {
  if (legs.some((l) => l.status === "lost")) return { status: "lost", odds: parlayOdds(legs.map((l) => l.odds)) };
  const live = legs.filter((l) => l.status !== "void" && l.status !== "push");
  const odds = parlayOdds(live.map((l) => l.odds));
  if (legs.some((l) => l.status === "open")) return { status: "open", odds: parlayOdds(legs.map((l) => l.odds)) };
  if (!live.length) return { status: "void", odds: 0 };
  return { status: "won", odds };
}

// --- Shared slip (desk cards -> My bets) kept on this device ---
const KEY = "desk_slip_v1";
const EVT = "desk-slip-change";
export const readSlip = (): SlipLeg[] => { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; } };
export const writeSlip = (legs: SlipLeg[]) => { localStorage.setItem(KEY, JSON.stringify(legs)); window.dispatchEvent(new Event(EVT)); };
export const toggleLeg = (leg: SlipLeg) => {
  const cur = readSlip();
  const k = legKey(leg);
  writeSlip(cur.some((l) => legKey(l) === k) ? cur.filter((l) => legKey(l) !== k) : [...cur, leg]);
};
export const SLIP_EVENT = EVT;
