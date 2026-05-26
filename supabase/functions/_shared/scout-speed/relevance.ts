// Event → market relevance map for Scout Speed Edge (Phase 0)
export const EVENT_MARKET_MAP: Record<string, string[]> = {
  ASSIST:       ["player_ast", "player_pra"],
  REBOUND:      ["player_reb", "player_pra"],
  SHOT_MADE:    ["player_pts", "player_pra", "live_total", "team_score"],
  FOUL:         ["player_pts", "player_ast"],
  SUBSTITUTION: ["player_pts", "player_ast", "player_reb", "player_pra"],
  INJURY:       [
    "player_pts", "player_ast", "player_reb", "player_pra", "live_spread",
    // MLB injury also fades player props + shifts spread
    "player_strikeouts", "player_hits", "player_home_runs", "player_total_bases",
    "player_rbi", "player_runs", "player_stolen_bases", "player_walks",
  ],
  TIMEOUT:      ["live_spread", "live_total"],
  GOAL:         ["live_total", "team_score"],
  TD:           ["live_total", "team_score", "live_spread"],

  // ── MLB ──
  STRIKEOUT:     ["player_strikeouts", "player_hits", "live_total", "team_score"],
  WALK:          ["player_strikeouts", "player_walks", "live_total"],
  HIT:           ["player_hits", "player_total_bases", "player_rbi", "player_runs", "live_total", "team_score"],
  HOME_RUN:      ["player_home_runs", "player_hits", "player_total_bases", "player_rbi", "player_runs", "live_total", "team_score"],
  RBI:           ["player_rbi", "player_runs", "live_total", "team_score"],
  RUN_SCORED:    ["player_runs", "live_total", "team_score"],
  STOLEN_BASE:   ["player_stolen_bases"],
  PITCHER_PULLED:["player_strikeouts", "live_total", "team_score"],
};

export function isRelevant(eventType: string, marketType: string): boolean {
  return EVENT_MARKET_MAP[eventType]?.includes(marketType) ?? false;
}