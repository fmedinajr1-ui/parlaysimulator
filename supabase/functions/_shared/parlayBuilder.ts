// Nuke Parlay Scout Phase 2 — multi-sport parlay builder.
// Replaces the placeholder loop in nuke-build-parlays. Selects parlay legs
// from sport-specific templates, applies juice gates, dedupes players, and
// windows combined American odds to [+1000, +3000].
//
// Tennis lives alongside in this file under its own templates because tennis
// has no team-favorite/dog blowout script — it pivots on heavy ML favorite +
// surface prior gap.

import { normalizeName } from "./rosters.ts";
import { tournamentTier, thresholdsFor } from "./court-edge-tournament-tier.ts";

export type SportKey = "nba" | "mlb" | "soccer" | "tennis";
export type ScriptTier = "strong" | "medium" | "weak" | "skip";

export interface PropForBuilder {
  player_name: string;
  team?: string | null;
  prop_type: string;
  current_line: number;
  over_price?: number | null;
  under_price?: number | null;
  // Tennis-specific (cross-game pool): event id and event description.
  event_id?: string;
  event_description?: string;
}

export interface ScriptForBuilder {
  game_id: string;
  sport: SportKey;
  tier: ScriptTier;
  home_team: string;
  away_team: string;
  favorite_team: string;
  dog_team: string;
  fav_ml: number;
  total?: number | null;
  // Tennis-only context (optional)
  best_of?: 3 | 5;
  surface?: "hard" | "clay" | "grass" | "indoor" | "unknown";
  event_name?: string;
}

export interface ParlayLeg {
  player_name: string;
  team: string;
  prop_type: string;
  prop_label: string; // full English (e.g. "Points + Rebounds + Assists")
  line: number;
  side: "over" | "under";
  odds: number;
  event_id?: string;
}

export interface BuiltParlay {
  template: string;
  legs: ParlayLeg[];
  combined_odds_american: number;
  combined_odds_decimal: number;
}

export interface BuilderOptions {
  injuries?: Set<string>;
  minOdds?: number;
  maxOdds?: number;
  // Backtest knobs: when true, drop the tight-juice gate inside templates so
  // historical slates (which often lack the live -110/-105 juice signature)
  // can still produce parlay candidates.
  relaxJuice?: boolean;
}

// ─── Odds math ──────────────────────────────────────────────────────────────

export function americanToDecimal(odds: number): number {
  if (odds > 0) return odds / 100 + 1;
  return 100 / Math.abs(odds) + 1;
}

export function decimalToAmerican(decimal: number): number {
  if (decimal >= 2) return Math.round((decimal - 1) * 100);
  return Math.round(-100 / (decimal - 1));
}

export function combinedOdds(legOdds: number[]): number {
  if (!legOdds.length) return 0;
  const decimal = legOdds.map(americanToDecimal).reduce((a, b) => a * b, 1);
  return decimalToAmerican(decimal);
}

// Reject worse than -140 on the picked side.
function juiceOk(price: number | null | undefined): boolean {
  if (price == null) return false;
  return price >= -140;
}

// "Tight" range used for star/role-player template signal screening.
function tightJuice(price: number | null | undefined): boolean {
  if (price == null) return false;
  return price >= -140 && price <= -100;
}

// ─── Property labels (full English; never abbreviations) ────────────────────

const PROP_LABELS: Record<string, string> = {
  player_points: "Points",
  player_rebounds: "Rebounds",
  player_assists: "Assists",
  player_points_rebounds_assists: "Points + Rebounds + Assists",
  player_threes: "Three Pointers Made",
  pitcher_strikeouts: "Strikeouts",
  pitcher_outs: "Outs Recorded",
  batter_total_bases: "Total Bases",
  batter_hits: "Hits",
  batter_home_runs: "Home Runs",
  player_aces: "Aces",
  player_double_faults: "Double Faults",
  player_total_games_won: "Total Games Won",
  player_shots_on_goal: "Shots on Goal",
  player_shots: "Shots",
  player_passes_attempted: "Passes Attempted",
  player_saves: "Saves",
};

function labelFor(propType: string): string {
  return PROP_LABELS[propType] ?? propType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── ESPN injuries (team sports only) ───────────────────────────────────────

const ESPN_INJURY_MAP: Record<string, { sport: string; league: string } | null> = {
  nba:    { sport: "basketball", league: "nba" },
  wnba:   { sport: "basketball", league: "wnba" },
  nfl:    { sport: "football",   league: "nfl" },
  nhl:    { sport: "hockey",     league: "nhl" },
  mlb:    { sport: "baseball",   league: "mlb" },
  soccer: null,
  tennis: null,
};

const OUT_STATUSES = ["out", "doubtful", "injured reserve", "ir", "suspended"];

export async function fetchEspnInjuries(sport: string): Promise<Set<string>> {
  const out = new Set<string>();
  const map = ESPN_INJURY_MAP[sport];
  if (!map) return out;
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${map.sport}/${map.league}/injuries`;
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[builder] injuries ${sport} ${res.status}`);
      return out;
    }
    const j: any = await res.json();
    const groups: any[] = j?.injuries ?? [];
    for (const g of groups) {
      const items: any[] = g?.injuries ?? [];
      for (const inj of items) {
        const status: string = String(inj?.status ?? "").toLowerCase();
        if (!OUT_STATUSES.some((s) => status.includes(s))) continue;
        const name: string = inj?.athlete?.displayName ?? "";
        if (name) out.add(normalizeName(name));
      }
    }
  } catch (e) {
    console.warn(`[builder] injuries ${sport} failed`, e);
  }
  return out;
}

// ─── Template matrix (Phase 2 active sports) ────────────────────────────────

const TEMPLATES_BY_SPORT_TIER: Record<SportKey, Record<ScriptTier, string[]>> = {
  nba:    { strong: ["role_player_over_carnage", "mixed_chaos"], medium: ["role_player_over_carnage"], weak: [], skip: [] },
  mlb:    { strong: ["ace_domination"],                          medium: [],                            weak: [], skip: [] },
  soccer: { strong: ["possession_dominance"],                    medium: [],                            weak: [], skip: [] },
  tennis: { strong: ["dominant_hold_squad", "fav_handicap_combo"], medium: ["total_games_under"],       weak: [], skip: [] },
};

// ─── Helpers used by templates ──────────────────────────────────────────────

function dropInjured(props: PropForBuilder[], injuries?: Set<string>): PropForBuilder[] {
  if (!injuries || !injuries.size) return props;
  return props.filter((p) => !injuries.has(normalizeName(p.player_name)));
}

function topByLine(props: PropForBuilder[], team: string, propType: string, n: number): PropForBuilder[] {
  return props
    .filter((p) => p.prop_type === propType && (p.team ?? "").toLowerCase() === team.toLowerCase())
    .sort((a, b) => Number(b.current_line) - Number(a.current_line))
    .slice(0, n);
}

function makeLeg(p: PropForBuilder, side: "over" | "under"): ParlayLeg | null {
  const odds = side === "over" ? p.over_price : p.under_price;
  if (!juiceOk(odds)) return null;
  return {
    player_name: p.player_name,
    team: p.team ?? "",
    prop_type: p.prop_type,
    prop_label: labelFor(p.prop_type),
    line: Number(p.current_line),
    side,
    odds: Number(odds),
    event_id: p.event_id,
  };
}

function legsUniqueByPlayer(legs: ParlayLeg[]): boolean {
  const seen = new Set<string>();
  for (const l of legs) {
    const k = normalizeName(l.player_name);
    if (seen.has(k)) return false;
    seen.add(k);
  }
  return true;
}

function legSignature(legs: ParlayLeg[]): string {
  return legs
    .map((l) => `${normalizeName(l.player_name)}|${l.side}|${l.line}|${l.prop_type}`)
    .sort()
    .join(";");
}

// ─── NBA templates ──────────────────────────────────────────────────────────

function tplRolePlayerOverCarnage(props: PropForBuilder[], script: ScriptForBuilder): ParlayLeg[] | null {
  const fav = script.favorite_team;
  const dog = script.dog_team;
  const candidates = props
    .filter((p) => p.prop_type === "player_points_rebounds_assists" || p.prop_type === "player_points")
    .filter((p) => Number(p.current_line) >= 17.5 && Number(p.current_line) <= 28.5)
    .filter((p) => __relaxJuice ? juiceOk(p.over_price) : (p.over_price != null && Number(p.over_price) >= -140 && Number(p.over_price) <= -100))
    .sort((a, b) => Number(a.over_price) - Number(b.over_price)); // most-juiced first

  const favSide = candidates.filter((p) => (p.team ?? "").toLowerCase() === fav.toLowerCase());
  const dogSide = candidates.filter((p) => (p.team ?? "").toLowerCase() === dog.toLowerCase());

  let chosen: PropForBuilder[] = [];
  if (favSide.length >= 2 && dogSide.length >= 2) {
    chosen = [...favSide.slice(0, 3), ...dogSide.slice(0, 3)].slice(0, 5);
  } else {
    chosen = candidates.slice(0, 5);
  }
  // dedupe by player
  const byPlayer = new Map<string, PropForBuilder>();
  for (const c of chosen) {
    const k = normalizeName(c.player_name);
    if (!byPlayer.has(k)) byPlayer.set(k, c);
  }
  const finalProps = [...byPlayer.values()].slice(0, 5);
  if (finalProps.length < 5) return null;
  const legs = finalProps.map((p) => makeLeg(p, "over")).filter((x): x is ParlayLeg => !!x);
  return legs.length === 5 ? legs : null;
}

function tplMixedChaos(props: PropForBuilder[], script: ScriptForBuilder): ParlayLeg[] | null {
  const fav = script.favorite_team;
  const dog = script.dog_team;
  const teamProps = (team: string) => props.filter((p) =>
    (p.team ?? "").toLowerCase() === team.toLowerCase() &&
    (p.prop_type === "player_points_rebounds_assists" || p.prop_type === "player_points")
  ).sort((a, b) => Number(b.current_line) - Number(a.current_line));

  const favTop = teamProps(fav);
  const dogTop = teamProps(dog);

  if (favTop.length < 2 || dogTop.length < 2) return null;

  const used = new Set<string>();
  const legs: ParlayLeg[] = [];

  // 1. fav star UNDER
  for (const p of favTop) {
    if (!tj(p.under_price)) continue;
    const l = makeLeg(p, "under");
    if (!l) continue;
    legs.push(l); used.add(normalizeName(p.player_name)); break;
  }
  // 2. dog star OVER
  for (const p of dogTop) {
    if (!tj(p.over_price)) continue;
    const l = makeLeg(p, "over");
    if (!l || used.has(normalizeName(p.player_name))) continue;
    legs.push(l); used.add(normalizeName(p.player_name)); break;
  }
  // 3. dog star #2 UNDER
  for (const p of dogTop) {
    if (used.has(normalizeName(p.player_name))) continue;
    if (!tj(p.under_price)) continue;
    const l = makeLeg(p, "under");
    if (!l) continue;
    legs.push(l); used.add(normalizeName(p.player_name)); break;
  }
  // 4. fav role OVER (17.5–28.5)
  for (const p of favTop) {
    if (used.has(normalizeName(p.player_name))) continue;
    if (Number(p.current_line) < 17.5 || Number(p.current_line) > 28.5) continue;
    if (!tj(p.over_price)) continue;
    const l = makeLeg(p, "over");
    if (!l) continue;
    legs.push(l); used.add(normalizeName(p.player_name)); break;
  }
  // 5. dog role OVER
  for (const p of dogTop) {
    if (used.has(normalizeName(p.player_name))) continue;
    if (Number(p.current_line) < 17.5 || Number(p.current_line) > 28.5) continue;
    if (!tj(p.over_price)) continue;
    const l = makeLeg(p, "over");
    if (!l) continue;
    legs.push(l); used.add(normalizeName(p.player_name)); break;
  }
  return legs.length === 5 ? legs : null;
}

// ─── MLB template ───────────────────────────────────────────────────────────

function tplAceDomination(props: PropForBuilder[], script: ScriptForBuilder): ParlayLeg[] | null {
  const fav = script.favorite_team;
  const dog = script.dog_team;

  const favPitcherK = topByLine(props, fav, "pitcher_strikeouts", 1)[0];
  const favPitcherOuts = topByLine(props, fav, "pitcher_outs", 1)[0];
  const dogTB = props
    .filter((p) => p.prop_type === "batter_total_bases" && (p.team ?? "").toLowerCase() === dog.toLowerCase())
    .sort((a, b) => Number(b.current_line) - Number(a.current_line));

  const legs: ParlayLeg[] = [];
  if (favPitcherK) {
    const l = makeLeg(favPitcherK, "over"); if (l) legs.push(l);
  }
  if (favPitcherOuts) {
    const l = makeLeg(favPitcherOuts, "over"); if (l) legs.push(l);
  }
  // Need 3 hitter UNDERs (or 4 if no pitcher_outs).
  const needHitters = legs.length === 1 ? 4 : 3;
  for (const h of dogTB) {
    if (legs.length >= 1 + (favPitcherOuts ? 1 : 0) + needHitters) break;
    const l = makeLeg(h, "under");
    if (!l) continue;
    if (legs.some((x) => normalizeName(x.player_name) === normalizeName(h.player_name))) continue;
    legs.push(l);
  }
  return legs.length === 5 && legsUniqueByPlayer(legs) ? legs : null;
}

// ─── Soccer template ────────────────────────────────────────────────────────

function tplPossessionDominance(props: PropForBuilder[], script: ScriptForBuilder): ParlayLeg[] | null {
  const fav = script.favorite_team;
  const dog = script.dog_team;

  const favPasses = props
    .filter((p) => p.prop_type === "player_passes_attempted" && (p.team ?? "").toLowerCase() === fav.toLowerCase())
    .sort((a, b) => Number(b.current_line) - Number(a.current_line))
    .slice(0, 3);

  const dogGK = props
    .filter((p) => p.prop_type === "player_saves" && (p.team ?? "").toLowerCase() === dog.toLowerCase())
    .sort((a, b) => Number(b.current_line) - Number(a.current_line))[0];

  const dogShots = props
    .filter((p) => (p.prop_type === "player_shots_on_goal" || p.prop_type === "player_shots") && (p.team ?? "").toLowerCase() === dog.toLowerCase())
    .sort((a, b) => Number(b.current_line) - Number(a.current_line))[0];

  const legs: ParlayLeg[] = [];
  for (const p of favPasses) { const l = makeLeg(p, "over"); if (l) legs.push(l); }
  if (dogGK) { const l = makeLeg(dogGK, "over"); if (l) legs.push(l); }
  if (dogShots) { const l = makeLeg(dogShots, "under"); if (l) legs.push(l); }
  return legs.length === 5 && legsUniqueByPlayer(legs) ? legs : null;
}

// ─── Tennis templates ───────────────────────────────────────────────────────

// Only used for STRONG tennis; fav ML threshold matches scorer.
function tennisFavStrongOk(script: ScriptForBuilder): boolean {
  const heavyBo3 = (script.best_of ?? 3) === 3 && script.fav_ml <= -350;
  const heavyBo5 = script.best_of === 5 && script.fav_ml <= -500;
  return heavyBo3 || heavyBo5;
}

function tennisTierAllowed(script: ScriptForBuilder): boolean {
  const tier = tournamentTier(script.event_name);
  return !thresholdsFor(tier).auto_quarantine;
}

function tplDominantHoldSquad(props: PropForBuilder[], script: ScriptForBuilder): ParlayLeg[] | null {
  if (!tennisFavStrongOk(script) || !tennisTierAllowed(script)) return null;
  const fav = script.favorite_team;
  const dog = script.dog_team;

  const findOne = (player: string, prop: string, side: "over" | "under"): ParlayLeg | null => {
    const pool = props
      .filter((p) => p.prop_type === prop && (p.team ?? "").toLowerCase() === player.toLowerCase())
      .sort((a, b) => {
        const ao = side === "over" ? Number(a.over_price ?? 0) : Number(a.under_price ?? 0);
        const bo = side === "over" ? Number(b.over_price ?? 0) : Number(b.under_price ?? 0);
        return ao - bo; // most-juiced first
      });
    for (const p of pool) {
      const l = makeLeg(p, side);
      if (l) return l;
    }
    return null;
  };

  const legs: ParlayLeg[] = [];
  const favAcesOver = findOne(fav, "player_aces", "over");
  const favGamesOver = findOne(fav, "player_total_games_won", "over");
  const dogAcesUnder = findOne(dog, "player_aces", "under");
  const dogGamesUnder = findOne(dog, "player_total_games_won", "under");
  const favDfUnder = findOne(fav, "player_double_faults", "under");

  for (const l of [favAcesOver, favGamesOver, dogAcesUnder, dogGamesUnder, favDfUnder]) {
    if (l) legs.push(l);
    if (legs.length === 5) break;
  }
  return legs.length === 5 ? legs : null;
}

function tplFavHandicapCombo(props: PropForBuilder[], script: ScriptForBuilder): ParlayLeg[] | null {
  if (!tennisFavStrongOk(script) || !tennisTierAllowed(script)) return null;
  const fav = script.favorite_team;
  const dog = script.dog_team;
  // Five legs from whatever fav/dog markets exist with valid juice — used as
  // a fallback when player props are thin. Pulls one leg per available market.
  const order: Array<[string, string, "over" | "under"]> = [
    [fav, "player_total_games_won", "over"],
    [dog, "player_total_games_won", "under"],
    [fav, "player_aces", "over"],
    [dog, "player_double_faults", "over"],
    [fav, "player_double_faults", "under"],
    [dog, "player_aces", "under"],
  ];
  const legs: ParlayLeg[] = [];
  for (const [team, prop, side] of order) {
    const pool = props
      .filter((p) => p.prop_type === prop && (p.team ?? "").toLowerCase() === team.toLowerCase())
      .sort((a, b) => Number(b.current_line) - Number(a.current_line));
    for (const p of pool) {
      const l = makeLeg(p, side);
      if (!l) continue;
      // Tennis: 1 leg per (player, market) — never duplicate
      if (legs.some((x) => x.player_name === l.player_name && x.prop_type === l.prop_type)) continue;
      legs.push(l); break;
    }
    if (legs.length === 5) break;
  }
  return legs.length === 5 ? legs : null;
}

function tplTotalGamesUnder(props: PropForBuilder[], _script: ScriptForBuilder): ParlayLeg[] | null {
  // Cross-game: pulls UNDER total-games-won legs across multiple matches/players.
  // Uniqueness key for tennis is (event_id + player_name).
  const pool = props
    .filter((p) => p.prop_type === "player_total_games_won")
    .filter((p) => juiceOk(p.under_price));
  // Sort by tightest (most-juiced) UNDER first.
  pool.sort((a, b) => Number(a.under_price ?? 0) - Number(b.under_price ?? 0));
  const legs: ParlayLeg[] = [];
  const seen = new Set<string>();
  for (const p of pool) {
    const k = `${p.event_id ?? ""}|${normalizeName(p.player_name)}`;
    if (seen.has(k)) continue;
    const l = makeLeg(p, "under");
    if (!l) continue;
    legs.push(l); seen.add(k);
    if (legs.length === 5) break;
  }
  return legs.length === 5 ? legs : null;
}

// ─── Main entry ─────────────────────────────────────────────────────────────

const TEMPLATE_FNS: Record<string, (props: PropForBuilder[], script: ScriptForBuilder) => ParlayLeg[] | null> = {
  role_player_over_carnage: tplRolePlayerOverCarnage,
  mixed_chaos:              tplMixedChaos,
  ace_domination:           tplAceDomination,
  possession_dominance:     tplPossessionDominance,
  dominant_hold_squad:      tplDominantHoldSquad,
  fav_handicap_combo:       tplFavHandicapCombo,
  total_games_under:        tplTotalGamesUnder,
};

let __relaxJuice = false;
function tj(price: number | null | undefined): boolean {
  if (__relaxJuice) return juiceOk(price);
  return tightJuice(price);
}

export function buildParlays(
  script: ScriptForBuilder,
  rawProps: PropForBuilder[],
  options: BuilderOptions = {},
): BuiltParlay[] {
  const minOdds = options.minOdds ?? 1000;
  const maxOdds = options.maxOdds ?? 3000;
  __relaxJuice = options.relaxJuice === true;
  const props = dropInjured(rawProps, options.injuries);
  if (!props.length) return [];

  const templates = TEMPLATES_BY_SPORT_TIER[script.sport]?.[script.tier] ?? [];
  const built: BuiltParlay[] = [];
  const seenSigs = new Set<string>();

  for (const t of templates) {
    const fn = TEMPLATE_FNS[t];
    if (!fn) continue;
    let legs: ParlayLeg[] | null;
    try {
      legs = fn(props, script);
    } catch (e) {
      console.warn(`[builder] template ${t} threw`, e);
      continue;
    }
    if (!legs || legs.length !== 5) continue;
    // Tennis cross-game template uses (event_id, player) uniqueness, not pure player.
    if (t !== "total_games_under" && !legsUniqueByPlayer(legs)) continue;

    const americanLegs = legs.map((l) => l.odds);
    const decimal = americanLegs.map(americanToDecimal).reduce((a, b) => a * b, 1);
    const american = decimalToAmerican(decimal);
    if (american < minOdds || american > maxOdds) continue;

    const sig = legSignature(legs);
    if (seenSigs.has(sig)) continue;
    seenSigs.add(sig);

    built.push({
      template: t,
      legs,
      combined_odds_american: american,
      combined_odds_decimal: Number(decimal.toFixed(4)),
    });
  }

  return built;
}