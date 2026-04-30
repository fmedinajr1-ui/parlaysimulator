// Court.Edge — pure projection engine. No I/O. Importable by edge functions and tests.

export type Surface = "clay" | "hard" | "grass";
export type SetsFormat = "bo3" | "bo5";

export interface WeatherInput {
  temp_f?: number | null;
  humidity?: number | null;
  wind_mph?: number | null;
}

export interface ProjectionInput {
  p1_l3: number[];          // last-3 match game totals for player 1 (most recent first)
  p2_l3: number[];          // last-3 match game totals for player 2 (most recent first)
  surface: Surface;
  sets_format: SetsFormat;
  ml_home?: number | null;  // American odds, home/p1
  ml_away?: number | null;  // American odds, away/p2
  weather?: WeatherInput | null;
  indoor?: boolean;
  // Role-driven, player-specific game adjustments. Pure additives — never re-multiplied.
  role_adj_home?: number | null;
  role_adj_away?: number | null;
}

export interface ProjectionBreakdown {
  base_l3: number;
  surface_mult: number;
  sets_mult: number;
  spread_adj: number;
  weather_adj: number;
  indoor_adj: number;
  role_adj_home: number;
  role_adj_away: number;
  projection: number;
}

const WEIGHTS = [0.5, 0.3, 0.2];

export function weightedL3(matches: number[]): number {
  if (!matches || matches.length === 0) return NaN;
  const slice = matches.slice(0, 3);
  let total = 0;
  let wsum = 0;
  for (let i = 0; i < slice.length; i += 1) {
    total += slice[i] * WEIGHTS[i];
    wsum += WEIGHTS[i];
  }
  return total / wsum; // re-normalise when fewer than 3 matches
}

export function surfaceMult(s: Surface): number {
  if (s === "clay") return 1.08;
  if (s === "grass") return 0.92;
  return 1.0;
}

export function setsMult(f: SetsFormat): number {
  return f === "bo5" ? 1.7 : 1.0;
}

// American odds → no-vig implied probability
function americanToProb(odds: number): number {
  if (odds > 0) return 100 / (odds + 100);
  return -odds / (-odds + 100);
}

export function spreadAdj(mlHome?: number | null, mlAway?: number | null): number {
  if (mlHome == null || mlAway == null || !Number.isFinite(mlHome) || !Number.isFinite(mlAway)) return 0;
  const pH = americanToProb(mlHome);
  const pA = americanToProb(mlAway);
  const sum = pH + pA;
  if (sum <= 0) return 0;
  const nH = pH / sum; // de-vig
  const nA = pA / sum;
  return -2.5 * Math.abs(nH - nA);
}

export function weatherAdj(w?: WeatherInput | null): number {
  if (!w) return 0;
  let adj = 0;
  if (typeof w.temp_f === "number") {
    if (w.temp_f > 85) adj += 0.3;
    if (w.temp_f < 50) adj -= 0.4;
  }
  if (typeof w.wind_mph === "number" && w.wind_mph > 15) adj -= 0.5;
  if (typeof w.humidity === "number" && w.humidity > 70) adj -= 0.2;
  return adj;
}

export function indoorAdj(isIndoor?: boolean): number {
  return isIndoor ? -0.5 : 0;
}

export function project(input: ProjectionInput): ProjectionBreakdown {
  const w1 = weightedL3(input.p1_l3);
  const w2 = weightedL3(input.p2_l3);
  const base = (w1 + w2) / 2;
  const sm = surfaceMult(input.surface);
  const sf = setsMult(input.sets_format);
  const sa = spreadAdj(input.ml_home, input.ml_away);
  const wa = weatherAdj(input.weather);
  const ia = indoorAdj(input.indoor);
  const rh = Number.isFinite(input.role_adj_home as number) ? (input.role_adj_home as number) : 0;
  const ra = Number.isFinite(input.role_adj_away as number) ? (input.role_adj_away as number) : 0;
  const projection = base * sm * sf + sa + wa + ia + rh + ra;
  return {
    base_l3: base,
    surface_mult: sm,
    sets_mult: sf,
    spread_adj: sa,
    weather_adj: wa,
    indoor_adj: ia,
    role_adj_home: rh,
    role_adj_away: ra,
    projection,
  };
}

export type Verdict =
  | "STRONG_OVER"
  | "LEAN_OVER"
  | "PASS"
  | "LEAN_UNDER"
  | "STRONG_UNDER";

export function verdictFromEdgePct(edgePct: number): Verdict {
  const a = Math.abs(edgePct);
  if (a >= 6) return edgePct > 0 ? "STRONG_OVER" : "STRONG_UNDER";
  if (a >= 3) return edgePct > 0 ? "LEAN_OVER" : "LEAN_UNDER";
  return "PASS";
}

export function edgeFor(market: "match_total" | "player_total_games", projection: number, line: number) {
  // For player_total_games, the projection (which is a MATCH total) is split in half as a player's share.
  const reference = market === "player_total_games" ? projection / 2 : projection;
  const edge = reference - line;
  const edgePct = line > 0 ? (edge / line) * 100 : 0;
  return { reference, edge, edge_pct: edgePct, verdict: verdictFromEdgePct(edgePct) };
}