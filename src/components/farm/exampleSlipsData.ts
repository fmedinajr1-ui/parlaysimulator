export type VerdictTier = "lock" | "heat" | "coin_flip" | "risky" | "cooked";

export interface ExampleLeg {
  player: string;
  line: string;
  odds: string;
  status: "hit" | "lean" | "miss";
}

export interface ExampleSlip {
  id: string;
  sport: "NBA" | "MLB" | "NHL" | "NFL" | "Tennis";
  sportEmoji: string;
  tier: VerdictTier;
  grade: number;
  payout: string;
  legs: ExampleLeg[];
  killerLegIndex: number | null;
  verdict: string;
}

export const TIER_META: Record<
  VerdictTier,
  { label: string; emoji: string; color: string; glow: string }
> = {
  lock: {
    label: "LOCK",
    emoji: "💎",
    color: "hsl(var(--sharp-green))",
    glow: "hsl(var(--sharp-green) / 0.35)",
  },
  heat: {
    label: "HEAT",
    emoji: "🔥",
    color: "#ff8a3d",
    glow: "rgba(255, 138, 61, 0.35)",
  },
  coin_flip: {
    label: "COIN FLIP",
    emoji: "⚖️",
    color: "#f5c451",
    glow: "rgba(245, 196, 81, 0.3)",
  },
  risky: {
    label: "RISKY",
    emoji: "⚠️",
    color: "#ff6b3d",
    glow: "rgba(255, 107, 61, 0.3)",
  },
  cooked: {
    label: "COOKED",
    emoji: "💀",
    color: "#ff4d6d",
    glow: "rgba(255, 77, 109, 0.35)",
  },
};

export const EXAMPLE_SLIPS: ExampleSlip[] = [
  {
    id: "nba-lock",
    sport: "NBA",
    sportEmoji: "🏀",
    tier: "lock",
    grade: 92,
    payout: "+486",
    killerLegIndex: null,
    legs: [
      { player: "Jokic", line: "O 11.5 Ast", odds: "-118", status: "hit" },
      { player: "SGA", line: "O 29.5 Pts", odds: "-110", status: "hit" },
      { player: "Tatum", line: "O 7.5 Reb", odds: "-125", status: "hit" },
      { player: "Edwards", line: "O 4.5 3PM", odds: "+105", status: "lean" },
    ],
    verdict: "All 4 legs clear our floor. Jokic ast hits 78% vs this matchup.",
  },
  {
    id: "mlb-heat",
    sport: "MLB",
    sportEmoji: "⚾",
    tier: "heat",
    grade: 78,
    payout: "+312",
    killerLegIndex: null,
    legs: [
      { player: "Skubal", line: "O 7.5 Ks", odds: "-130", status: "hit" },
      { player: "Judge", line: "O 1.5 TB", odds: "-105", status: "lean" },
      { player: "Dodgers", line: "ML", odds: "-145", status: "hit" },
    ],
    verdict: "Strong stack. Judge TB is the lean — pitcher matchup favors over.",
  },
  {
    id: "nfl-cooked",
    sport: "NFL",
    sportEmoji: "🏈",
    tier: "cooked",
    grade: 31,
    payout: "+1240",
    killerLegIndex: 2,
    legs: [
      { player: "Mahomes", line: "O 274.5 Pass Yds", odds: "-115", status: "lean" },
      { player: "Hill", line: "O 78.5 Rec Yds", odds: "-110", status: "lean" },
      { player: "CMC", line: "O 119.5 Rush Yds", odds: "-110", status: "miss" },
      { player: "49ers", line: "-7.5", odds: "-110", status: "miss" },
      { player: "Kelce", line: "Anytime TD", odds: "+165", status: "miss" },
    ],
    verdict: "Leg 3 (CMC O119.5) misses 71% of sims. Swap to O89.5 for +18% EV.",
  },
  {
    id: "nhl-coinflip",
    sport: "NHL",
    sportEmoji: "🏒",
    tier: "coin_flip",
    grade: 54,
    payout: "+225",
    killerLegIndex: 1,
    legs: [
      { player: "McDavid", line: "O 1.5 Pts", odds: "-140", status: "hit" },
      { player: "Hellebuyck", line: "O 28.5 Sv", odds: "-115", status: "miss" },
      { player: "Oilers", line: "ML", odds: "-125", status: "lean" },
    ],
    verdict: "Goalie save line is a trap — projected 24 shots faced. Fade leg 2.",
  },
  {
    id: "tennis-risky",
    sport: "Tennis",
    sportEmoji: "🎾",
    tier: "risky",
    grade: 42,
    payout: "+390",
    killerLegIndex: 0,
    legs: [
      { player: "Alcaraz", line: "O 22.5 Games", odds: "-120", status: "miss" },
      { player: "Sabalenka", line: "ML", odds: "-180", status: "hit" },
      { player: "Sinner", line: "-3.5 Games", odds: "+105", status: "lean" },
    ],
    verdict: "Alcaraz total games line is bait — sub-22 in 6 of 8. Drop leg 1.",
  },
];
