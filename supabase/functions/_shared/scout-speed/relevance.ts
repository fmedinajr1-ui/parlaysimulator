// Event → market relevance map for Scout Speed Edge (Phase 0)
export const EVENT_MARKET_MAP: Record<string, string[]> = {
  ASSIST:       ["player_ast", "player_pra"],
  REBOUND:      ["player_reb", "player_pra"],
  SHOT_MADE:    ["player_pts", "player_pra", "live_total", "team_score"],
  FOUL:         ["player_pts", "player_ast"],
  SUBSTITUTION: ["player_pts", "player_ast", "player_reb", "player_pra"],
  INJURY:       ["player_pts", "player_ast", "player_reb", "player_pra", "live_spread"],
  TIMEOUT:      ["live_spread", "live_total"],
  GOAL:         ["live_total", "team_score"],
  TD:           ["live_total", "team_score", "live_spread"],
};

export function isRelevant(eventType: string, marketType: string): boolean {
  return EVENT_MARKET_MAP[eventType]?.includes(marketType) ?? false;
}