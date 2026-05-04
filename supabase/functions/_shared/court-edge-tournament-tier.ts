// Court.Edge — tournament tier classifier.
// Pure lookup, no I/O. Maps sport_key / event name fragments to a tier so that
// edge-tier thresholds and quarantine rules can vary by event quality.

export type TournamentTier =
  | "grand_slam"
  | "masters_1000"
  | "atp_500"
  | "wta_1000"
  | "wta_500"
  | "atp_250"
  | "wta_250"
  | "challenger"
  | "itf"
  | "unknown";

const RULES: Array<{ test: RegExp; tier: TournamentTier }> = [
  // Grand slams — highest priority so they win over generic "open" matches.
  { test: /australian[_\s]?open|aus[_\s]?open|melbourne|roland[_\s]?garros|french[_\s]?open|wimbledon|us[_\s]?open|flushing/i, tier: "grand_slam" },
  // Masters 1000 / WTA 1000 — same-city events, classify by name.
  { test: /madrid|miami|indian[_\s]?wells|cincinnati|cincy|rome|italian[_\s]?open|monte[_\s]?carlo|shanghai|paris[_\s]?(masters|bercy)|bercy|toronto|montreal|canadian[_\s]?open|masters[_\s]?1000|wta[_\s]?1000/i, tier: "masters_1000" },
  // 500-level
  { test: /atp[_\s]?500|wta[_\s]?500|dubai|barcelona|vienna|erste[_\s]?bank|basel|rotterdam|queens|halle|hamburg|tokyo|beijing|china[_\s]?open|doha|qatar/i, tier: "atp_500" },
  // ITF / W-and-M tour numbers (e.g. M15, W25)
  { test: /\bitf\b|\bm15\b|\bm25\b|\bw15\b|\bw25\b|\bw35\b|\bw50\b|\bw60\b|\bw75\b|\bw80\b|\bw100\b/i, tier: "itf" },
  // Challenger tour
  { test: /challenger|chall\b|atp[_\s]?125|atp[_\s]?100|atp[_\s]?75|atp[_\s]?50/i, tier: "challenger" },
  // 250-level (last so it doesn't swallow higher tiers)
  { test: /atp[_\s]?250|wta[_\s]?250|atp[_\s]?tour|wta[_\s]?tour/i, tier: "atp_250" },
];

export function tournamentTier(...inputs: Array<string | undefined | null>): TournamentTier {
  const haystack = inputs.filter(Boolean).join(" | ");
  if (!haystack) return "unknown";
  for (const r of RULES) {
    if (r.test.test(haystack)) return r.tier;
  }
  return "unknown";
}

// Calibrated edge-pp thresholds by tier. STRONG/LEAN are absolute probability points.
// `auto_quarantine: true` means we never produce a STRONG/LEAN regardless of edge magnitude.
export interface TierThresholds {
  strong_pp: number;
  lean_pp: number;
  auto_quarantine?: boolean;
}

const TIER_THRESHOLDS: Record<TournamentTier, TierThresholds> = {
  grand_slam:    { strong_pp: 0.04, lean_pp: 0.025 },
  masters_1000:  { strong_pp: 0.04, lean_pp: 0.025 },
  atp_500:       { strong_pp: 0.04, lean_pp: 0.025 },
  wta_1000:      { strong_pp: 0.04, lean_pp: 0.025 },
  wta_500:       { strong_pp: 0.04, lean_pp: 0.025 },
  // 250s and "unknown" share the strictest tour-level bar.
  atp_250:       { strong_pp: 0.05, lean_pp: 0.030 },
  wta_250:       { strong_pp: 0.05, lean_pp: 0.030 },
  unknown:       { strong_pp: 0.05, lean_pp: 0.030 },
  challenger:    { strong_pp: 0.06, lean_pp: 0.040 },
  // ITF = data quality too poor; never produce actionable picks.
  itf:           { strong_pp: 1.00, lean_pp: 1.00, auto_quarantine: true },
};

export function thresholdsFor(tier: TournamentTier): TierThresholds {
  return TIER_THRESHOLDS[tier] ?? TIER_THRESHOLDS.unknown;
}