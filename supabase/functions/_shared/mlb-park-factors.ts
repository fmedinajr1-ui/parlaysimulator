/**
 * mlb-park-factors.ts
 * 3-year (2022-2024) Statcast-derived HR park factors. 1.00 = neutral.
 * Source: baseballsavant park factor leaderboard (HR multiplier).
 * Higher = more HR-friendly. Lower = HR-suppressing.
 */

export const MLB_PARK_HR_FACTORS: Record<string, number> = {
  // Hitters' parks
  "Colorado Rockies": 1.32,
  "Cincinnati Reds": 1.21,
  "New York Yankees": 1.18,
  "Philadelphia Phillies": 1.15,
  "Milwaukee Brewers": 1.12,
  "Baltimore Orioles": 1.10,
  "Atlanta Braves": 1.08,
  "Texas Rangers": 1.07,
  "Chicago Cubs": 1.05,
  "Houston Astros": 1.05,
  // Neutral
  "Toronto Blue Jays": 1.03,
  "Arizona Diamondbacks": 1.02,
  "St. Louis Cardinals": 1.01,
  "Washington Nationals": 1.00,
  "Minnesota Twins": 1.00,
  "Boston Red Sox": 0.99,
  "Tampa Bay Rays": 0.98,
  "Kansas City Royals": 0.97,
  "Chicago White Sox": 0.96,
  "Los Angeles Dodgers": 0.95,
  "New York Mets": 0.94,
  "San Diego Padres": 0.93,
  // Pitchers' parks
  "Cleveland Guardians": 0.92,
  "Detroit Tigers": 0.91,
  "Los Angeles Angels": 0.90,
  "Seattle Mariners": 0.88,
  "Pittsburgh Pirates": 0.86,
  "Oakland Athletics": 0.84,
  "Athletics": 0.84,
  "Miami Marlins": 0.81,
  "San Francisco Giants": 0.79,
};

/**
 * Lookup HR park factor by HOME team name. Defaults to 1.00 if unknown.
 */
export function getParkHRFactor(homeTeam: string): number {
  if (!homeTeam) return 1.0;
  return MLB_PARK_HR_FACTORS[homeTeam] ?? 1.0;
}