// MLB game-state model + deterministic Tier-1 transitions (HR / K / BB).
// Tier-2 (1B/2B/3B/IP_OUT) intentionally NOT implemented — those need a
// resolved-play signal, see mlb_fair_price_spec.md §3.

export enum BaseState {
  EMPTY = "EMPTY",
  B1 = "B1",
  B2 = "B2",
  B3 = "B3",
  B12 = "B12",
  B13 = "B13",
  B23 = "B23",
  LOADED = "LOADED",
}

export type Half = "top" | "bottom";
export type Team = "home" | "away";

export interface GameState {
  inning: number;          // 1..N
  half: Half;
  outs: 0 | 1 | 2;
  bases: BaseState;
  scoreDiff: number;       // home − away  (signed)
  battingTeam: Team;
  feedTs: number;          // monotonic ms at ingest
  batterId?: string | null;
  pitcherId?: string | null;
}

export type Tier1Event = "HOME_RUN" | "STRIKEOUT" | "WALK";

function runnersOn(bases: BaseState): number {
  switch (bases) {
    case BaseState.EMPTY: return 0;
    case BaseState.B1: case BaseState.B2: case BaseState.B3: return 1;
    case BaseState.B12: case BaseState.B13: case BaseState.B23: return 2;
    case BaseState.LOADED: return 3;
  }
}

function flipHalf(s: GameState): GameState {
  const nextHalf: Half = s.half === "top" ? "bottom" : "top";
  const nextInning = s.half === "bottom" ? s.inning + 1 : s.inning;
  const nextBatting: Team = s.battingTeam === "home" ? "away" : "home";
  return {
    ...s,
    half: nextHalf,
    inning: nextInning,
    outs: 0,
    bases: BaseState.EMPTY,
    battingTeam: nextBatting,
  };
}

function applyHomeRun(s: GameState): GameState {
  const runs = runnersOn(s.bases) + 1;
  const delta = s.battingTeam === "home" ? +runs : -runs;
  return {
    ...s,
    bases: BaseState.EMPTY,
    scoreDiff: s.scoreDiff + delta,
  };
}

function applyStrikeout(s: GameState): GameState {
  const nextOuts = s.outs + 1;
  if (nextOuts >= 3) return flipHalf(s);
  return { ...s, outs: nextOuts as 0 | 1 | 2 };
}

// Force-advance: only forced runners advance, batter→1B.
// Run scores only when bases were LOADED.
function applyWalk(s: GameState): GameState {
  let bases = s.bases;
  let delta = 0;
  switch (s.bases) {
    case BaseState.EMPTY: bases = BaseState.B1; break;
    case BaseState.B1: bases = BaseState.B12; break;
    case BaseState.B2: bases = BaseState.B12; break; // runner on 2nd not forced; batter→1
    case BaseState.B3: bases = BaseState.B13; break;
    case BaseState.B12: bases = BaseState.LOADED; break;
    case BaseState.B13: bases = BaseState.LOADED; break;
    case BaseState.B23: bases = BaseState.LOADED; break;
    case BaseState.LOADED: {
      bases = BaseState.LOADED;
      const runs = 1;
      delta = s.battingTeam === "home" ? +runs : -runs;
      break;
    }
  }
  return { ...s, bases, scoreDiff: s.scoreDiff + delta };
}

export function applyTransition(state: GameState, event: Tier1Event): GameState {
  switch (event) {
    case "HOME_RUN": return applyHomeRun(state);
    case "STRIKEOUT": return applyStrikeout(state);
    case "WALK": return applyWalk(state);
  }
}

export function basesFromBools(b1: boolean, b2: boolean, b3: boolean): BaseState {
  const k = (b1 ? 1 : 0) | (b2 ? 2 : 0) | (b3 ? 4 : 0);
  switch (k) {
    case 0: return BaseState.EMPTY;
    case 1: return BaseState.B1;
    case 2: return BaseState.B2;
    case 3: return BaseState.B12;
    case 4: return BaseState.B3;
    case 5: return BaseState.B13;
    case 6: return BaseState.B23;
    case 7: return BaseState.LOADED;
    default: return BaseState.EMPTY;
  }
}