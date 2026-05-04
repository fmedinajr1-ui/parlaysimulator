// Court.Edge — runtime-tunable knobs loaded from public.court_edge_config.
// All fields are optional on the override side; callers fall back to compile-time defaults.

export interface CourtEdgeConfig {
  shrink_k: number;
  blowout_cutoff_bo3: number;
  blowout_cutoff_bo5: number;
  blowout_penalty: number;
  sanity_sigmas: number;
  spread_v2_max_penalty: number;     // absolute value of the negative cap, e.g. 3.0 → adj ≥ -3.0
  spread_v2_coinflip_bias: number;   // games added when implied spread is < threshold
  spread_v2_coinflip_threshold: number;
  spread_v2_max_bias: number;        // upper cap on positive bias
  edge_hard_cap_pp: number;
  strong_pp: number;
  lean_pp: number;
  line_band_sigmas: number;
  near_prior_band_sigmas: number;   // if |line - prior.mu| within this, treat market as anchored
  near_prior_clamp_sigmas: number;  // clamp projection to within this many σ of the line
}

export const DEFAULT_COURT_EDGE_CONFIG: CourtEdgeConfig = {
  shrink_k: 4,
  blowout_cutoff_bo3: 14,
  blowout_cutoff_bo5: 22,
  blowout_penalty: 0.5,
  sanity_sigmas: 3,
  spread_v2_max_penalty: 3.0,
  spread_v2_coinflip_bias: 0.6,
  spread_v2_coinflip_threshold: 0.10,
  spread_v2_max_bias: 0.8,
  edge_hard_cap_pp: 0.12,
  strong_pp: 0.04,
  lean_pp: 0.02,
  line_band_sigmas: 2.5,
  near_prior_band_sigmas: 0.75,
  near_prior_clamp_sigmas: 1.0,
};

function num(v: unknown, fallback: number): number {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : fallback;
}

export function mergeConfig(row: Partial<Record<keyof CourtEdgeConfig, unknown>> | null | undefined): CourtEdgeConfig {
  const d = DEFAULT_COURT_EDGE_CONFIG;
  if (!row) return { ...d };
  return {
    shrink_k: num(row.shrink_k, d.shrink_k),
    blowout_cutoff_bo3: num(row.blowout_cutoff_bo3, d.blowout_cutoff_bo3),
    blowout_cutoff_bo5: num(row.blowout_cutoff_bo5, d.blowout_cutoff_bo5),
    blowout_penalty: num(row.blowout_penalty, d.blowout_penalty),
    sanity_sigmas: num(row.sanity_sigmas, d.sanity_sigmas),
    spread_v2_max_penalty: num(row.spread_v2_max_penalty, d.spread_v2_max_penalty),
    spread_v2_coinflip_bias: num(row.spread_v2_coinflip_bias, d.spread_v2_coinflip_bias),
    spread_v2_coinflip_threshold: num(row.spread_v2_coinflip_threshold, d.spread_v2_coinflip_threshold),
    spread_v2_max_bias: num(row.spread_v2_max_bias, d.spread_v2_max_bias),
    edge_hard_cap_pp: num(row.edge_hard_cap_pp, d.edge_hard_cap_pp),
    strong_pp: num(row.strong_pp, d.strong_pp),
    lean_pp: num(row.lean_pp, d.lean_pp),
    line_band_sigmas: num(row.line_band_sigmas, d.line_band_sigmas),
    near_prior_band_sigmas: num(row.near_prior_band_sigmas, d.near_prior_band_sigmas),
    near_prior_clamp_sigmas: num(row.near_prior_clamp_sigmas, d.near_prior_clamp_sigmas),
  };
}

// deno-lint-ignore no-explicit-any
export async function loadCourtEdgeConfig(supabase: any): Promise<CourtEdgeConfig> {
  try {
    const { data, error } = await supabase
      .from("court_edge_config")
      .select("*")
      .eq("id", "default")
      .maybeSingle();
    if (error) return { ...DEFAULT_COURT_EDGE_CONFIG };
    return mergeConfig(data);
  } catch (_e) {
    return { ...DEFAULT_COURT_EDGE_CONFIG };
  }
}