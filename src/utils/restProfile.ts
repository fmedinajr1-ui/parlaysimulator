import { percentile, type GameLog } from "./nbaBoxScoreMath";

export type RestStatus = "back-to-back" | "normal" | "rested" | "well-rested" | "unknown";

export interface RestProfile {
  /** Full calendar days off since the last played game; 0 means back-to-back. */
  daysRest: number | null;
  status: RestStatus;
  label: string;
  /** Multiplier applied to the stat projection. */
  factor: number;
  b2b: boolean;
  lastGameDate: string | null;
  explanation: string;
}

const dayNumber = (date: string) => {
  const [year, month, day] = date.slice(0, 10).split("-").map(Number);
  return Date.UTC(year, month - 1, day) / 86400000;
};

/**
 * Rest uses Eastern-Time game-date keys, not tip-off timestamps.
 * Back-to-back: -5% for 32+ minute players, otherwise -3%.
 * One day off is neutral, two days off adds 1%, and three or more adds 2%.
 */
export function restProfile(games: GameLog[], today: string): RestProfile {
  const played = games
    .filter((g) => Number(g.minutes_played) > 0 && g.game_date < today)
    .sort((a, b) => b.game_date.localeCompare(a.game_date));
  const last = played[0];
  if (!last) return {
    daysRest: null, status: "unknown", label: "REST UNKNOWN", factor: 1, b2b: false,
    lastGameDate: null, explanation: "No earlier played game is available to calculate rest.",
  };

  const daysRest = Math.max(0, dayNumber(today) - dayNumber(last.game_date) - 1);
  const minutes = percentile(played.slice(0, 10).map((g) => Number(g.minutes_played)), 0.5);
  const b2b = daysRest === 0;
  const status: RestStatus = b2b ? "back-to-back" : daysRest === 1 ? "normal" : daysRest === 2 ? "rested" : "well-rested";
  const factor = b2b ? (minutes >= 32 ? 0.95 : 0.97) : daysRest === 2 ? 1.01 : daysRest >= 3 ? 1.02 : 1;
  const label = b2b ? "B2B · 0 REST" : daysRest >= 3 ? "3+ DAYS REST" : `${daysRest} DAY${daysRest === 1 ? "" : "S"} REST`;
  const effect = b2b ? `${Math.round((1 - factor) * 100)}% fatigue trim` : factor > 1 ? `+${Math.round((factor - 1) * 100)}% rest adjustment` : "no projection adjustment";
  return {
    daysRest, status, label, factor, b2b, lastGameDate: last.game_date,
    explanation: `Last played ${last.game_date}; ${daysRest} full day${daysRest === 1 ? "" : "s"} off, ${effect}.`,
  };
}
