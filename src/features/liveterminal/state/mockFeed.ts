import type { LiveGameState } from "@/features/live3d/types";
import type { NextPlay, PlayerState, TerminalPlayer, Trajectory, Side } from "../types";
import type { PropEdgeRow } from "../hooks/useTerminalFeed";

// Deterministic PRNG so the view is stable per game_id
function hash(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STATES: PlayerState[] = [
  "over_pace",
  "over_pace",
  "neutral",
  "neutral",
  "under_pace",
  "usage_spike",
  "sharp_action",
  "volatility",
];

const POSITIONS: Record<string, string[]> = {
  BASKETBALL: ["PG", "SG", "SF", "PF", "C"],
  FOOTBALL: ["QB", "RB", "WR", "WR", "TE", "LT", "LG", "C", "RG", "RT", "WR"],
  BASEBALL: ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"],
  HOCKEY: ["C", "LW", "RW", "LD", "RD", "G"],
  SOCCER: ["GK", "LB", "CB", "CB", "RB", "CM", "CM", "CAM", "LW", "ST", "RW"],
};

function sportKind(sport: string): keyof typeof POSITIONS {
  const s = sport.toUpperCase();
  if (s === "NBA" || s === "WNBA" || s === "NCAAB") return "BASKETBALL";
  if (s === "NFL" || s === "NCAAF") return "FOOTBALL";
  if (s === "MLB") return "BASEBALL";
  if (s === "NHL") return "HOCKEY";
  return "SOCCER";
}

// Formations per kind in normalized 0..1 viewBox (x left→right, y top→bottom)
function formation(kind: keyof typeof POSITIONS): Array<[number, number]>[] {
  switch (kind) {
    case "BASKETBALL":
      return [
        // home (attacking right)
        [[0.55, 0.5], [0.62, 0.3], [0.62, 0.7], [0.75, 0.4], [0.78, 0.6]],
        // away (attacking left)
        [[0.45, 0.5], [0.38, 0.3], [0.38, 0.7], [0.25, 0.4], [0.22, 0.6]],
      ];
    case "FOOTBALL":
      return [
        // offense around 50yd line
        [
          [0.55, 0.5], [0.52, 0.5], [0.5, 0.3], [0.5, 0.7], [0.5, 0.42],
          [0.5, 0.46], [0.5, 0.5], [0.5, 0.54], [0.5, 0.58], [0.5, 0.22], [0.5, 0.78],
        ],
        // defense
        [
          [0.45, 0.5], [0.45, 0.4], [0.45, 0.6], [0.42, 0.3], [0.42, 0.7],
          [0.4, 0.45], [0.4, 0.55], [0.36, 0.5], [0.3, 0.3], [0.3, 0.7], [0.25, 0.5],
        ],
      ];
    case "BASEBALL":
      return [
        [
          [0.5, 0.55], [0.5, 0.78], [0.65, 0.55], [0.58, 0.42],
          [0.35, 0.55], [0.42, 0.42], [0.22, 0.28], [0.5, 0.18], [0.78, 0.28],
        ],
        [[0.5, 0.78]], // batter (away)
      ];
    case "HOCKEY":
      return [
        [[0.6, 0.5], [0.65, 0.32], [0.65, 0.68], [0.78, 0.38], [0.78, 0.62], [0.93, 0.5]],
        [[0.4, 0.5], [0.35, 0.32], [0.35, 0.68], [0.22, 0.38], [0.22, 0.62], [0.07, 0.5]],
      ];
    case "SOCCER":
    default:
      return [
        [
          [0.93, 0.5], [0.78, 0.22], [0.78, 0.4], [0.78, 0.6], [0.78, 0.78],
          [0.62, 0.35], [0.62, 0.65], [0.55, 0.5], [0.45, 0.25], [0.45, 0.5], [0.45, 0.75],
        ],
        [
          [0.07, 0.5], [0.22, 0.22], [0.22, 0.4], [0.22, 0.6], [0.22, 0.78],
          [0.38, 0.35], [0.38, 0.65], [0.45, 0.5], [0.55, 0.25], [0.55, 0.5], [0.55, 0.75],
        ],
      ];
  }
}

const PROPS: Record<string, string[]> = {
  BASKETBALL: ["Points", "Rebounds", "Assists", "3-Pointers"],
  FOOTBALL: ["Pass Yds", "Rush Yds", "Receptions", "Anytime TD"],
  BASEBALL: ["Hits", "Total Bases", "Home Run", "Strikeouts"],
  HOCKEY: ["Shots On Goal", "Goals", "Assists", "Saves"],
  SOCCER: ["Shots On Target", "Goals", "Assists", "Tackles"],
};

function buildTrail(rand: () => number, x: number, y: number) {
  const out: Array<{ x: number; y: number }> = [];
  let cx = x - (rand() - 0.5) * 0.08;
  let cy = y - (rand() - 0.5) * 0.08;
  for (let i = 0; i < 8; i++) {
    cx += (x - cx) * 0.18 + (rand() - 0.5) * 0.01;
    cy += (y - cy) * 0.18 + (rand() - 0.5) * 0.01;
    out.push({ x: cx, y: cy });
  }
  return out;
}

const HOME_COLOR = "#3aa8ff";
const AWAY_COLOR = "#ff4d4d";

export type BuildOpts = {
  /** Map of real-player-name → derived state from market_signals */
  playerStates?: Record<string, PlayerState>;
  /** Real edge rows so player tokens reflect the top live edges per side */
  edgeRows?: PropEdgeRow[];
};

export function buildMockTerminal(state: LiveGameState, opts: BuildOpts = {}) {
  const kind = sportKind(state.sport);
  const [home, away] = formation(kind);
  const rand = mulberry32(hash(state.game_id));
  const positions = POSITIONS[kind];
  const props = PROPS[kind];

  // Partition real edges into home/away buckets. We don't know team affiliation
  // from quotes, so we round-robin assign by appearance order while preserving
  // the strongest edges first.
  const sortedEdges = [...(opts.edgeRows ?? [])].sort(
    (a, b) => Math.abs(b.edgePct) - Math.abs(a.edgePct),
  );
  const homeEdges: PropEdgeRow[] = [];
  const awayEdges: PropEdgeRow[] = [];
  sortedEdges.forEach((e, i) => (i % 2 === 0 ? homeEdges : awayEdges).push(e));

  function realStateFor(name: string | undefined): PlayerState | undefined {
    if (!name || !opts.playerStates) return undefined;
    return opts.playerStates[name];
  }

  function makeSide(
    coords: Array<[number, number]>,
    side: Side,
    name: string,
    color: string,
    startNum: number,
    realEdges: PropEdgeRow[],
  ): TerminalPlayer[] {
    return coords.map(([x, y], i) => {
      const realEdge = realEdges[i];
      const fallbackState = STATES[Math.floor(rand() * STATES.length)];
      const realState = realEdge ? realStateFor(realEdge.player_name) : undefined;
      const ghostDx = (side === "home" ? 0.04 : -0.04) + (rand() - 0.5) * 0.02;
      const ghostDy = (rand() - 0.5) * 0.05;
      const fallbackLine = Math.round((10 + rand() * 25) * 2) / 2;
      const fallbackProj = +(fallbackLine + (rand() - 0.4) * 6).toFixed(1);
      const fallbackEdgePct = +(((fallbackProj - fallbackLine) / Math.max(fallbackLine, 1)) * 100).toFixed(1);
      const displayName = realEdge?.player_name ?? `${name.split(/\s+/).pop() ?? name} ${i + 1}`;
      const lastName = displayName.split(/\s+/).pop() ?? displayName;
      const tokenState: PlayerState =
        realState ??
        (realEdge
          ? realEdge.edgePct >= 3
            ? "over_pace"
            : realEdge.edgePct <= -3
              ? "under_pace"
              : "neutral"
          : fallbackState);
      return {
        id: `${side}-${i}`,
        side,
        name: `${positions[i % positions.length]} · ${displayName}`,
        initials: (lastName[0] ?? "P") + String(i + 1),
        number: startNum + i,
        position: positions[i % positions.length],
        x,
        y,
        trail: buildTrail(rand, x, y),
        ghost: { x: Math.max(0.03, Math.min(0.97, x + ghostDx)), y: Math.max(0.05, Math.min(0.95, y + ghostDy)) },
        state: tokenState,
        isBallCarrier: false,
        teamColor: color,
        edge: realEdge
          ? {
              propType: realEdge.prop_label,
              line: realEdge.line,
              projection: +realEdge.modelLine.toFixed(2),
              edgePct: realEdge.edgePct,
              book: realEdge.refBook,
            }
          : {
              propType: props[i % props.length],
              line: fallbackLine,
              projection: fallbackProj,
              edgePct: fallbackEdgePct,
              book: ["FanDuel", "DraftKings", "BetMGM"][Math.floor(rand() * 3)],
            },
        involvementPct: Math.round(8 + rand() * 32),
      };
    });
  }

  const homePlayers = makeSide(home, "home", state.home_team, HOME_COLOR, 1, homeEdges);
  const awayPlayers = makeSide(away, "away", state.away_team, AWAY_COLOR, 21, awayEdges);

  // assign ball carrier based on possession
  const possSide: Side | null =
    state.possession === state.home_team ? "home" : state.possession === state.away_team ? "away" : null;
  if (possSide === "home" && homePlayers[0]) homePlayers[0].isBallCarrier = true;
  if (possSide === "away" && awayPlayers[0]) awayPlayers[0].isBallCarrier = true;

  const all = [...homePlayers, ...awayPlayers];

  // trajectories — 2 representative arcs
  const trajectories: Trajectory[] = [];
  if (kind === "BASKETBALL") {
    const carrier = all.find((p) => p.isBallCarrier) ?? all[0];
    trajectories.push({ from: { x: carrier.x, y: carrier.y }, to: { x: carrier.side === "home" ? 0.96 : 0.04, y: 0.5 }, kind: "shot" });
  } else if (kind === "FOOTBALL") {
    const qb = homePlayers[0];
    [0.2, 0.35, 0.65, 0.82].forEach((y) => {
      trajectories.push({ from: { x: qb.x, y: qb.y }, to: { x: 0.85, y }, kind: "route" });
    });
  } else if (kind === "SOCCER" || kind === "HOCKEY") {
    const carrier = all.find((p) => p.isBallCarrier) ?? homePlayers[5] ?? homePlayers[0];
    trajectories.push({ from: { x: carrier.x, y: carrier.y }, to: { x: carrier.side === "home" ? 0.95 : 0.05, y: 0.5 }, kind: "pass" });
  }

  const nextPlays: NextPlay[] = nextPlaysFor(kind, rand);

  return { players: all, trajectories, nextPlays };
}

function nextPlaysFor(kind: keyof typeof POSITIONS, rand: () => number): NextPlay[] {
  const pools: Record<string, string[]> = {
    BASKETBALL: ["Pick & roll right", "Iso top of key", "Corner 3 kick-out", "Drive & dish", "Post-up left block"],
    FOOTBALL: ["Slant left", "Play-action deep", "RB screen right", "Inside zone run", "Quick out to TE"],
    BASEBALL: ["Fastball away", "Slider low", "Curveball back-foot", "Changeup down", "Sinker inside"],
    HOCKEY: ["Cycle low", "Point shot", "Cross-crease pass", "Drop pass at blue line", "Wrap-around"],
    SOCCER: ["Build through midfield", "Cross from right", "Quick counter", "Set piece routine", "Switch to weak side"],
  };
  const pool = [...pools[kind]];
  const out: NextPlay[] = [];
  let remaining = 1;
  for (let i = 0; i < 4 && pool.length; i++) {
    const idx = Math.floor(rand() * pool.length);
    const label = pool.splice(idx, 1)[0];
    const p = i === 3 ? remaining : +(remaining * (0.35 + rand() * 0.35)).toFixed(2);
    remaining = Math.max(0, +(remaining - p).toFixed(2));
    out.push({ label, probability: p });
  }
  return out.sort((a, b) => b.probability - a.probability);
}