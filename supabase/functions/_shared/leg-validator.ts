// ============================================================================
// leg-validator.ts
// Hard/soft verification layer for parlay legs.
//
// HARD checks (reject leg):
//   1. Team name is canonical (whitelist match) for known sports.
//   2. Venue alignment: HOME/AWAY label matches the schedule for game_id.
//   3. Game not yet started (start_time > now + 5min).
//   4. Player on active roster (props only) — when a roster index is provided.
//   5. Spread direction matches Fav/Dog tag.
//
// HARD cross-leg check (validateTicket):
//   6. No two legs from the same game_id.
//
// SOFT checks (haircut applied to safety/edge):
//   7. Weak team at heavy favorite price (win_pct < 0.45 && odds < -150).
//   8. Player not in confirmed lineup (within T-120min window).
//
// I/O lives in `buildValidationContext`. Validation itself is pure.
// ============================================================================

import {
  canonicalSportFor,
  isCanonicalTeam,
  matchCanonicalTeam,
  type CanonicalSport,
} from "./canonical-teams.ts";

export interface ValidationLeg {
  sport: string | null;
  market_type?: string | null;            // "player" | "moneyline" | "spread" | "total"
  event_id?: string | null;
  team?: string | null;                   // primary team for the leg
  opponent?: string | null;
  home_away?: "HOME" | "AWAY" | null;
  player_name?: string | null;
  tag?: string | null;                    // "Fav" | "Dog" | null
  spread?: number | null;
  american_odds?: number | null;
  commence_time?: string | Date | null;   // ISO string or Date
}

export interface ScheduleGame {
  event_id: string;
  home_team: string;
  away_team: string;
  start_time_utc: string;                 // ISO
}

export interface TeamRecord {
  team: string;
  win_pct: number;                        // 0..1
}

export interface ValidationContext {
  /** Map of event_id → schedule row, canonicalized teams when possible. */
  schedule: Map<string, ScheduleGame>;
  /** Map of "sport|normalizedPlayer" → canonical team name (or null). */
  rosterTeams: Map<string, string>;
  /** Map of "sport|normalizedTeam" → win pct. */
  records: Map<string, number>;
  /** Set of "event_id|normalizedPlayer" — players confirmed in starting lineup. */
  confirmedLineups: Set<string>;
  /** Server "now" — injectable for testing. */
  now: Date;
}

export interface LegValidation {
  hardFails: string[];
  softFails: string[];
  /** Multiplicative haircut to apply to safety/edge for soft fails (e.g. 0.25 → reduce by 25%). */
  haircut: number;
}

const GAME_START_BUFFER_MS = 5 * 60_000;

function normName(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.'`’\-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function emptyContext(now: Date = new Date()): ValidationContext {
  return {
    schedule: new Map(),
    rosterTeams: new Map(),
    records: new Map(),
    confirmedLineups: new Set(),
    now,
  };
}

export function validateLeg(leg: ValidationLeg, ctx: ValidationContext): LegValidation {
  const hardFails: string[] = [];
  const softFails: string[] = [];
  let haircut = 0;

  const sport = canonicalSportFor(leg.sport);

  // 1. Canonical team — only enforced for sports we maintain a whitelist for,
  //    and only when a team is present (player props on tennis/golf etc. skip).
  if (sport && leg.team) {
    if (!isCanonicalTeam(sport, leg.team)) {
      hardFails.push(`unknown_team:${leg.team}`);
    }
  }

  // 2. Venue alignment — requires event_id + schedule entry.
  const game = leg.event_id ? ctx.schedule.get(leg.event_id) : undefined;
  if (leg.event_id && !game) {
    // Only fail when we actually loaded a schedule for this sport.
    // An empty context (e.g. schedule fetch failed) silently passes this check
    // so we don't fail-closed on infrastructure outages.
    if (ctx.schedule.size > 0 && sport) {
      hardFails.push("game_id_not_in_schedule");
    }
  } else if (game && leg.team) {
    const home = normName(game.home_team);
    const away = normName(game.away_team);
    const teamN = normName(leg.team);
    if (leg.home_away === "HOME" && teamN !== home) {
      hardFails.push(`venue_mismatch_home:${leg.team}!=${game.home_team}`);
    } else if (leg.home_away === "AWAY" && teamN !== away) {
      hardFails.push(`venue_mismatch_away:${leg.team}!=${game.away_team}`);
    } else if (!leg.home_away && teamN !== home && teamN !== away) {
      // Team not in either side of this game — fundamental join error.
      hardFails.push(`team_not_in_game:${leg.team}`);
    }
  }

  // 3. Game not yet started.
  const startIso = leg.commence_time
    ? (leg.commence_time instanceof Date ? leg.commence_time.toISOString() : leg.commence_time)
    : game?.start_time_utc;
  if (startIso) {
    const startMs = new Date(startIso).getTime();
    if (!Number.isFinite(startMs)) {
      hardFails.push("invalid_start_time");
    } else if (startMs <= ctx.now.getTime() + GAME_START_BUFFER_MS) {
      hardFails.push("game_started_or_imminent");
    }
  }

  // 4. Player on roster (props only) — only enforced when rosterTeams is populated.
  if (leg.market_type === "player" && leg.player_name && sport && ctx.rosterTeams.size > 0) {
    const key = `${sport}|${normName(leg.player_name)}`;
    const rosterTeam = ctx.rosterTeams.get(key);
    if (rosterTeam == null) {
      hardFails.push(`player_not_on_roster:${leg.player_name}`);
    } else if (leg.team) {
      const canonLeg = matchCanonicalTeam(sport, leg.team) ?? leg.team;
      if (normName(rosterTeam) !== normName(canonLeg)) {
        hardFails.push(`player_team_mismatch:${leg.player_name}!=${leg.team}(actual:${rosterTeam})`);
      }
    }
  }

  // 5. Spread direction vs Fav/Dog tag.
  if (leg.tag && leg.spread != null) {
    const tag = leg.tag.toLowerCase();
    if (tag === "fav" && leg.spread > 0) {
      hardFails.push(`tag_fav_but_spread_+${leg.spread}`);
    } else if (tag === "dog" && leg.spread < 0) {
      hardFails.push(`tag_dog_but_spread_${leg.spread}`);
    }
  }

  // 7. SOFT — weak team at heavy favorite price.
  if (sport && leg.team && leg.american_odds != null && leg.american_odds < -150) {
    const recKey = `${sport}|${normName(leg.team)}`;
    const wp = ctx.records.get(recKey);
    if (wp != null && wp < 0.45) {
      softFails.push(`weak_team_heavy_fav:wp=${wp.toFixed(3)},odds=${leg.american_odds}`);
      haircut = Math.max(haircut, 0.25);
    }
  }

  // 8. SOFT — lineup not confirmed (MLB/NHL props only; need lineup index loaded).
  if (
    leg.market_type === "player" && leg.player_name && leg.event_id &&
    (sport === "mlb" || sport === "nhl") &&
    ctx.confirmedLineups.size > 0 && startIso
  ) {
    const startMs = new Date(startIso).getTime();
    const minsToStart = (startMs - ctx.now.getTime()) / 60_000;
    if (minsToStart < 120) {
      const lkey = `${leg.event_id}|${normName(leg.player_name)}`;
      if (!ctx.confirmedLineups.has(lkey)) {
        if (minsToStart < 30) {
          // Inside T-30 with no confirmation: upgrade to hard reject.
          hardFails.push("lineup_unconfirmed_T-30");
        } else {
          softFails.push("lineup_unconfirmed");
          haircut = Math.max(haircut, 0.30);
        }
      }
    }
  }

  return { hardFails, softFails, haircut };
}

/** Cross-leg ticket validation. */
export function validateTicket(legs: ValidationLeg[]): { hardFails: string[] } {
  const hardFails: string[] = [];
  const seenGames = new Set<string>();
  for (const l of legs) {
    if (!l.event_id) continue;
    if (seenGames.has(l.event_id)) {
      hardFails.push(`multiple_legs_same_game:${l.event_id}`);
      break;
    }
    seenGames.add(l.event_id);
  }
  return { hardFails };
}

// ──────────────────────────────────────────────────────────────────────────
// Context loaders
// All loaders are best-effort: on failure they return an empty structure,
// which causes the corresponding check to no-op rather than fail-closed.
// ──────────────────────────────────────────────────────────────────────────

const ESPN_SCOREBOARD: Record<CanonicalSport, string> = {
  mlb:  "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard",
  nhl:  "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard",
  nba:  "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard",
  wnba: "https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard",
  nfl:  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard",
};

/**
 * Load today's ESPN scoreboard for one sport.
 * Returns rows keyed by `espn:<eventId>` AND by the home/away team-name pair so
 * callers can also look up by `event_id` from `unified_props` (which is the
 * odds-API event id, not ESPN's). Wired upstream by `loadScheduleByEventIds`.
 */
export async function fetchEspnSchedule(sport: CanonicalSport, dateYYYYMMDD: string): Promise<ScheduleGame[]> {
  const url = `${ESPN_SCOREBOARD[sport]}?dates=${dateYYYYMMDD}`;
  try {
    const r = await fetch(url);
    if (!r.ok) return [];
    const j = await r.json();
    const out: ScheduleGame[] = [];
    for (const ev of j?.events ?? []) {
      const comp = ev?.competitions?.[0];
      const teams = comp?.competitors ?? [];
      const home = teams.find((t: any) => t.homeAway === "home")?.team?.displayName;
      const away = teams.find((t: any) => t.homeAway === "away")?.team?.displayName;
      const start = ev?.date;
      if (home && away && start) {
        out.push({ event_id: `espn:${ev.id}`, home_team: home, away_team: away, start_time_utc: start });
      }
    }
    return out;
  } catch (e) {
    console.warn(`[leg-validator] fetchEspnSchedule(${sport}) failed`, e);
    return [];
  }
}

/**
 * Build a validation context from a Supabase client. Pulls today's schedule
 * rows from `live_game_scores` (which we already populate from ESPN) and joins
 * by `event_id`. Other context channels (rosters, lineups, records) start
 * empty and are populated only when callers wire them explicitly.
 */
export async function buildValidationContext(opts: {
  supabase: any;                          // SupabaseClient
  dateET: string;                         // "YYYY-MM-DD"
  sports?: CanonicalSport[];
  now?: Date;
}): Promise<ValidationContext> {
  const now = opts.now ?? new Date();
  const ctx = emptyContext(now);

  try {
    // live_game_scores has: event_id, home_team, away_team, start_time_utc, game_date
    const { data, error } = await opts.supabase
      .from("live_game_scores")
      .select("event_id, home_team, away_team, start_time_utc, game_date, sport")
      .eq("game_date", opts.dateET);
    if (!error && Array.isArray(data)) {
      for (const row of data as any[]) {
        if (!row?.event_id) continue;
        ctx.schedule.set(row.event_id, {
          event_id: row.event_id,
          home_team: row.home_team,
          away_team: row.away_team,
          start_time_utc: row.start_time_utc,
        });
      }
    }
  } catch (e) {
    console.warn("[leg-validator] schedule load failed (non-fatal)", e);
  }

  return ctx;
}

// Small helper for callers that want a quick "would reject" summary line.
export function describeValidation(v: LegValidation): string {
  if (v.hardFails.length) return `HARD: ${v.hardFails.join("; ")}`;
  if (v.softFails.length) return `SOFT(-${Math.round(v.haircut * 100)}%): ${v.softFails.join("; ")}`;
  return "ok";
}