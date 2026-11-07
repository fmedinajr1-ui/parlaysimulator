import { percentile, statValue, type GameLog, type StatKey } from "./nbaBoxScoreMath";

export type Venue = "home" | "road";
export type VenueSide = "over" | "under";

export interface SeasonVenueRow {
  player: string;
  venue: Venue;
  games: number;
  hits: number;
  hitRate: number;
  line: number;
  median: number;
  average: number;
  /** Median distance in the ranked direction: projection minus line for Overs, line minus projection for Unders. */
  margin: number;
}

export interface SeasonVenueOptions {
  seasonStart?: string;
  minGames?: number;
  limit?: number;
  side?: VenueSide;
}

/**
 * Ranks current-season venue splits against tonight's posted line.
 * Descriptive research only: this does not adjust projections or pick probabilities.
 */
export function buildSeasonVenueLeaders(
  byPlayer: Map<string, GameLog[]>,
  stat: StatKey,
  propLines: Map<string, number>,
  venue: Venue,
  options: SeasonVenueOptions = {},
): SeasonVenueRow[] {
  const seasonStart = options.seasonStart ?? "2026-10-01";
  const minGames = options.minGames ?? 3;
  const limit = options.limit ?? 5;
  const side = options.side ?? "over";
  const rows: SeasonVenueRow[] = [];

  for (const [player, logs] of byPlayer) {
    const line = propLines.get(`${player.toLowerCase()}|${stat}`);
    if (line == null || !Number.isFinite(line)) continue;

    const games = logs.filter((game) =>
      game.game_date >= seasonStart &&
      (Number(game.minutes_played) || 0) > 0 &&
      game.is_home === (venue === "home")
    );
    if (games.length < minGames) continue;

    const values = games.map((game) => statValue(game, stat));
    const hits = values.filter((value) => side === "over" ? value > line : value < line).length;
    const median = percentile(values, 0.5);
    rows.push({
      player,
      venue,
      games: games.length,
      hits,
      hitRate: hits / values.length,
      line,
      median,
      average: values.reduce((total, value) => total + value, 0) / values.length,
      margin: side === "over" ? median - line : line - median,
    });
  }

  return rows
    .sort((a, b) =>
      b.hitRate - a.hitRate ||
      b.games - a.games ||
      b.margin - a.margin ||
      a.player.localeCompare(b.player)
    )
    .slice(0, limit);
}
