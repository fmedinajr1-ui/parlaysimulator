// ============================================================================
// velocity-spike-health-gate.ts
// Pre-broadcast sanity check for "Slate Outlier" (velocity_spike) alerts.
// Blocks (or soft-warns) cards where the player is injured or in a cold form
// streak that contradicts the prop. Batch-loads injury + recent MLB game logs
// once per engine run, then evaluates each candidate alert against a small set
// of house rules.
//
// Returns { block, reason, soft_warn } per candidate. Callers should:
//   • skip the alert when block === true
//   • render soft_warn as a "⚠️ Form check" line in the card body
// ============================================================================

// deno-lint-ignore no-explicit-any
type Sb = any;

export interface HealthGateInput {
  player_name: string;
  sport: string | null;
  prop_type: string | null;
  side: string | null;          // 'Over' | 'Under'
  line: number | null;
}

export interface HealthGateResult {
  block: boolean;
  reason: string | null;
  soft_warn: string | null;
}

export interface HealthGateBundle {
  injuries: Map<string, InjuryRow>;
  mlbForm: Map<string, MlbFormSummary>;
}

interface InjuryRow {
  status: string | null;
  injury_type: string | null;
  injury_detail: string | null;
  impact_score: number | null;
  updated_at: string | null;
}

interface MlbFormSummary {
  games: number;
  ab: number;
  hits: number;
  total_bases: number;
  hrs: number;
  k: number;
  ba: number;            // hits / ab
  l5_hits_per_game: number;
  l5_tb_per_game: number;
}

const BLOCKING_STATUSES = new Set(['OUT', 'DOUBTFUL', 'IL', 'IL-10', 'IL-15', 'IL-60', 'NA']);
const HIGH_IMPACT_INJURY_RE = /(hamstring|thumb|wrist|hand|oblique|shoulder|hip|quad|calf|groin)/i;
const CONTACT_PROP_RE = /(hits|singles|total[_ ]bases|tb|batting|rbi)/i;

function lc(s: string): string {
  return s.toLowerCase().trim();
}

/** Batch-load health + form data for all candidate alerts in a run. */
export async function loadHealthGateBundle(
  supabase: Sb,
  alerts: Array<{ player_name: string; sport: string | null }>,
): Promise<HealthGateBundle> {
  const out: HealthGateBundle = { injuries: new Map(), mlbForm: new Map() };
  const names = Array.from(new Set(alerts.map((a) => a.player_name).filter(Boolean)));
  if (names.length === 0) return out;

  const since7d = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const sinceForm = new Date(Date.now() - 21 * 24 * 3600 * 1000).toISOString().slice(0, 10);

  const [injRes, mlbRes] = await Promise.all([
    supabase
      .from('injury_reports')
      .select('player_name, status, injury_type, injury_detail, impact_score, updated_at')
      .in('player_name', names)
      .gte('updated_at', since7d)
      .order('updated_at', { ascending: false }),
    supabase
      .from('mlb_player_game_logs')
      .select('player_name, game_date, at_bats, hits, total_bases, home_runs, strikeouts')
      .in('player_name', names)
      .gte('game_date', sinceForm)
      .order('game_date', { ascending: false }),
  ]);

  for (const r of (injRes?.data ?? []) as InjuryRow[] & Array<{ player_name: string }>) {
    const k = lc(r.player_name);
    if (!out.injuries.has(k)) out.injuries.set(k, r); // latest wins (ordered desc)
  }

  const grouped = new Map<string, Array<Record<string, any>>>();
  for (const row of (mlbRes?.data ?? []) as Array<Record<string, any>>) {
    const k = lc(row.player_name);
    const list = grouped.get(k) ?? [];
    if (list.length < 5) list.push(row);
    grouped.set(k, list);
  }
  for (const [k, rows] of grouped) {
    const ab = rows.reduce((s, r) => s + Number(r.at_bats ?? 0), 0);
    const hits = rows.reduce((s, r) => s + Number(r.hits ?? 0), 0);
    const tb = rows.reduce((s, r) => s + Number(r.total_bases ?? 0), 0);
    const hrs = rows.reduce((s, r) => s + Number(r.home_runs ?? 0), 0);
    const k_ = rows.reduce((s, r) => s + Number(r.strikeouts ?? 0), 0);
    out.mlbForm.set(k, {
      games: rows.length,
      ab, hits, total_bases: tb, hrs, k: k_,
      ba: ab > 0 ? hits / ab : 0,
      l5_hits_per_game: rows.length > 0 ? hits / rows.length : 0,
      l5_tb_per_game: rows.length > 0 ? tb / rows.length : 0,
    });
  }

  return out;
}

/**
 * Evaluate one alert against the bundle. Pure, easy to unit-test.
 */
export function evaluateHealthGate(
  input: HealthGateInput,
  bundle: HealthGateBundle,
): HealthGateResult {
  const key = lc(input.player_name);
  const injury = bundle.injuries.get(key);
  const form = bundle.mlbForm.get(key);
  const isOver = (input.side ?? '').toLowerCase().includes('over');
  const propLc = lc(input.prop_type ?? '');
  const contactProp = CONTACT_PROP_RE.test(propLc);
  const sport = lc(input.sport ?? '');

  // ─── Hard injury blocks ────────────────────────────────────────────────
  if (injury) {
    const status = (injury.status ?? '').toUpperCase().trim();
    if (BLOCKING_STATUSES.has(status)) {
      return {
        block: true,
        reason: `injury_out · ${input.player_name} listed ${status}${injury.injury_detail ? ` (${injury.injury_detail})` : ''}`,
        soft_warn: null,
      };
    }
    const impact = Number(injury.impact_score ?? 0);
    const detail = injury.injury_detail ?? injury.injury_type ?? '';
    const highImpactType = HIGH_IMPACT_INJURY_RE.test(detail);
    if (highImpactType && contactProp && isOver) {
      return {
        block: true,
        reason: `injury_contact_risk · ${detail} — contact prop Over not safe`,
        soft_warn: null,
      };
    }
    if (impact >= 6 || status === 'GTD' || status === 'QUESTIONABLE') {
      // Don't block, but surface
      return {
        block: false,
        reason: null,
        soft_warn: `${status || 'GTD'}${detail ? ` (${detail})` : ''} — managing minutes/at-bats`,
      };
    }
  }

  // ─── MLB cold form on contact-prop Overs ───────────────────────────────
  if (sport === 'mlb' && form && contactProp && isOver) {
    const isHitsProp = /\bhits\b|singles/.test(propLc);
    const isTbProp = /total[_ ]bases|\btb\b/.test(propLc);

    if (form.games >= 3) {
      if (form.ba > 0 && form.ba < 0.200) {
        return {
          block: true,
          reason: `cold_form · L${form.games} BA ${form.ba.toFixed(3)} (${form.hits}-for-${form.ab}) on contact Over`,
          soft_warn: null,
        };
      }
      if (isHitsProp && input.line != null && form.l5_hits_per_game < Number(input.line) * 0.6) {
        return {
          block: true,
          reason: `cold_form · L${form.games} ${form.l5_hits_per_game.toFixed(2)} H/g vs ${input.line} line`,
          soft_warn: null,
        };
      }
      if (isTbProp && input.line != null && form.l5_tb_per_game < Number(input.line) * 0.6) {
        return {
          block: true,
          reason: `cold_form · L${form.games} ${form.l5_tb_per_game.toFixed(2)} TB/g vs ${input.line} line`,
          soft_warn: null,
        };
      }
      // High K-rate soft warn (≥30% K rate over last 5)
      const krate = form.ab > 0 ? form.k / form.ab : 0;
      if (krate >= 0.30) {
        return {
          block: false,
          reason: null,
          soft_warn: `L${form.games} K-rate ${(krate * 100).toFixed(0)}% — contact risk`,
        };
      }
    }
  }

  return { block: false, reason: null, soft_warn: null };
}

/** Books where American odds are meaningless. */
export function isFixedPayoutBook(bookmaker: string | null | undefined): boolean {
  const b = (bookmaker ?? '').toLowerCase();
  return b === 'prizepicks' || b === 'underdog' || b === 'sleeper' || b === 'dabble' || b === 'pick6';
}