export type LiveGameState = {
  game_id: string;
  sport: string;
  league: string | null;
  home_team: string;
  away_team: string;
  home_score: number;
  away_score: number;
  period: string | null;
  clock: string | null;
  possession: string | null;
  status: string;
  situation: Record<string, unknown>;
  commence_time: string | null;
  updated_at: string;
};

export type PropQuote = {
  id: number;
  event_id: string;
  sport: string;
  player_name: string;
  prop_type: string;
  line: number | null;
  bookmaker: string;
  over_price: number | null;
  under_price: number | null;
  fetched_at: string;
};

export const SPORT_KEY: Record<string, string> = {
  NBA: "basketball_nba",
  WNBA: "basketball_wnba",
  NCAAB: "basketball_ncaab",
  NFL: "americanfootball_nfl",
  NCAAF: "americanfootball_ncaaf",
  MLB: "baseball_mlb",
  NHL: "icehockey_nhl",
  Soccer: "soccer_epl",
};