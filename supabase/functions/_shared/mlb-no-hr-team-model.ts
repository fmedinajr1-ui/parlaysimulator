/**
 * mlb-no-hr-team-model.ts
 *
 * Pure-math model for the team-level "No Home Run" market
 * (DraftKings: "1st Home Run Type — No"). Bet wins if team hits 0 HR.
 *
 * Approach: model team HR/game as a Poisson rate λ adjusted for
 * pitcher HR vulnerability, park factor, and weather, then
 * p_no_hr = exp(-λ).
 */

import { getParkHRFactor } from "./mlb-park-factors.ts";

export interface NoHRTeamInput {
  team: string;
  opponent: string;
  homeTeam: string;            // for park lookup
  teamHRPerGameL30: number;    // sum HR / games last 30d
  teamGamesL30: number;        // sample size
  teamHRPerGameSeason: number; // season-long
  pitcherHR9: number | null;   // opposing starter HR/9 (null = unknown)
  pitcherSampleIP: number;     // IP behind pitcherHR9
  weatherMult?: number;        // 1.0 default; >1 = boost (wind out + warm)
  teamL7HRPerGame?: number;    // last 7 days for hot-bat trap check
}

export interface NoHRTeamResult {
  lambda: number;              // modeled team HR/game
  pNoHR: number;               // exp(-lambda)
  parkFactor: number;
  pitcherMult: number;
  blendedHRPerGame: number;
  envMult: number;             // park * weather
  tier: "S" | "A" | "B" | "PASS";
  blockReason: string | null;
  confidenceScore: number;     // 0-100
}

const LEAGUE_AVG_HR9 = 1.20;

/** Bayesian shrinkage of L30 toward season prior. */
function blendHRPerGame(l30: number, l30Games: number, season: number): number {
  // Effective prior weight: 30 games. Heavier season prior when L30 is thin.
  const w = l30Games / (l30Games + 30);
  return w * l30 + (1 - w) * season;
}

/** Pitcher HR/9 multiplier, clamped. Unknown -> neutral 1.0. */
function pitcherMultiplier(hr9: number | null, sampleIP: number): number {
  if (hr9 == null || sampleIP < 10) return 1.0;
  const raw = hr9 / LEAGUE_AVG_HR9;
  return Math.min(1.8, Math.max(0.55, raw));
}

export function modelTeamNoHR(input: NoHRTeamInput): NoHRTeamResult {
  const parkFactor = getParkHRFactor(input.homeTeam);
  const weatherMult = input.weatherMult ?? 1.0;
  const envMult = parkFactor * weatherMult;
  const blended = blendHRPerGame(
    input.teamHRPerGameL30,
    input.teamGamesL30,
    input.teamHRPerGameSeason,
  );
  const pMult = pitcherMultiplier(input.pitcherHR9, input.pitcherSampleIP);
  const lambda = Math.max(0.05, blended * pMult * envMult);
  const pNoHR = Math.exp(-lambda);

  // Block gates (Poison-signal blacklist + hot-bat traps)
  let blockReason: string | null = null;
  if (input.pitcherHR9 == null || input.pitcherSampleIP < 10) {
    blockReason = "missing_pitcher_data";
  } else if (input.teamHRPerGameL30 >= 1.5 && input.teamGamesL30 >= 10) {
    blockReason = "power_team_l30";
  } else if (parkFactor >= 1.20 && envMult >= 1.10) {
    blockReason = "hr_friendly_park_env";
  } else if (
    (input.pitcherHR9 ?? 0) > 1.6 &&
    (input.teamL7HRPerGame ?? 0) > 1.0
  ) {
    blockReason = "hot_bats_vs_gopher_pitcher";
  }

  // Tier assignment (only if not blocked)
  let tier: NoHRTeamResult["tier"] = "PASS";
  if (!blockReason) {
    const aceHR9 = (input.pitcherHR9 ?? 99) <= 0.9;
    const friendlyPark = parkFactor <= 1.0;
    const lowPowerTeam = blended <= 0.9;
    if (pNoHR >= 0.62 && aceHR9 && friendlyPark && lowPowerTeam) tier = "S";
    else if (pNoHR >= 0.55) tier = "A";
    else if (pNoHR >= 0.50) tier = "B";
  }

  // Confidence score: anchored to p_no_hr with bonuses for clean signals.
  let conf = pNoHR * 100;
  if (tier === "S") conf = Math.min(95, conf + 8);
  else if (tier === "A") conf = Math.min(88, conf + 4);
  else if (tier === "B") conf = Math.min(78, conf);
  else conf = Math.min(50, conf);

  return {
    lambda,
    pNoHR,
    parkFactor,
    pitcherMult: pMult,
    blendedHRPerGame: blended,
    envMult,
    tier,
    blockReason,
    confidenceScore: Math.round(conf * 10) / 10,
  };
}