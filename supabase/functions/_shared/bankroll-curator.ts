// _shared/bankroll-curator.ts
// The portfolio manager. Reads today's locked picks, ranks them, applies
// risk-of-ruin guards, and decides which to actually play (and at what stake).
//
// This is what turns the bot from "here are 25 picks" into
// "here are the 6 I'm putting real money on, and here's why."

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { Pick } from './constants.ts';

// ─── Tier definitions ─────────────────────────────────────────────────────
// Mirrors the DailyProfitProjector defaults so frontend math stays consistent.

export type StakeTier = 'execution' | 'validation' | 'exploration';

export interface TierConfig {
  label: StakeTier;
  baseStake: number;
  maxPerDay: number;
  minConfidence: number;
  minEdge: number;
}

export const TIERS: Record<StakeTier, TierConfig> = {
  execution:   { label: 'execution',   baseStake: 300, maxPerDay: 5,  minConfidence: 80, minEdge: 6 },
  validation:  { label: 'validation',  baseStake: 150, maxPerDay: 8,  minConfidence: 70, minEdge: 4 },
  exploration: { label: 'exploration', baseStake: 50,  maxPerDay: 10, minConfidence: 60, minEdge: 0 },
};

// ─── Bankroll state ───────────────────────────────────────────────────────

export interface BankrollState {
  current_bankroll: number;
  starting_bankroll: number;
  peak_bankroll: number;
  daily_max_exposure_pct: number;
  current_form: 'hot' | 'neutral' | 'cold' | 'ice_cold';
  form_streak: number;
  last_7d_pnl: number;
  last_7d_win_rate: number;
}

const FALLBACK_STATE: BankrollState = {
  current_bankroll: 5000,
  starting_bankroll: 5000,
  peak_bankroll: 5000,
  daily_max_exposure_pct: 20,
  current_form: 'neutral',
  form_streak: 0,
  last_7d_pnl: 0,
  last_7d_win_rate: 0,
};

export async function loadBankrollState(sb: SupabaseClient): Promise<BankrollState> {
  const { data } = await sb
    .from('bot_bankroll_state')
    .select('*')
    .eq('id', 1)
    .maybeSingle();
  if (!data) return FALLBACK_STATE;
  return {
    current_bankroll: Number(data.current_bankroll) || 5000,
    starting_bankroll: Number(data.starting_bankroll) || 5000,
    peak_bankroll: Number(data.peak_bankroll) || 5000,
    daily_max_exposure_pct: Number(data.daily_max_exposure_pct) || 20,
    current_form: (data.current_form as BankrollState['current_form']) || 'neutral',
    form_streak: Number(data.form_streak) || 0,
    last_7d_pnl: Number(data.last_7d_pnl) || 0,
    last_7d_win_rate: Number(data.last_7d_win_rate) || 0,
  };
}

// ─── Form detection ───────────────────────────────────────────────────────
// Reads last 7 days of settled parlays to determine bot's current form.

export async function recomputeForm(sb: SupabaseClient): Promise<{
  form: BankrollState['current_form'];
  streak: number;
  pnl_7d: number;
  win_rate_7d: number;
}> {
  const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const { data } = await sb
    .from('bot_daily_parlays')
    .select('outcome, profit_loss, settled_at, parlay_date')
    .gte('parlay_date', cutoff)
    .not('outcome', 'is', null)
    .order('settled_at', { ascending: false });

  if (!data?.length) {
    return { form: 'neutral', streak: 0, pnl_7d: 0, win_rate_7d: 0 };
  }

  const wins = data.filter(d => d.outcome === 'won').length;
  const total = data.length;
  const winRate = (wins / total) * 100;
  const pnl = data.reduce((s, d) => s + (Number(d.profit_loss) || 0), 0);

  // Streak: how many consecutive recent parlays have same outcome
  let streak = 0;
  const firstOutcome = data[0]?.outcome;
  for (const d of data) {
    if (d.outcome === firstOutcome) streak++;
    else break;
  }
  if (firstOutcome === 'lost') streak = -streak;

  let form: BankrollState['current_form'];
  if (winRate >= 60 && pnl > 0) form = 'hot';
  else if (winRate <= 25 || pnl < -500) form = 'ice_cold';
  else if (winRate < 40 || pnl < 0) form = 'cold';
  else form = 'neutral';

  return { form, streak, pnl_7d: pnl, win_rate_7d: winRate };
}

// ─── Form-based stake multiplier ──────────────────────────────────────────

export function formMultiplier(form: BankrollState['current_form']): number {
  switch (form) {
    case 'hot': return 1.15;       // press a little when running well
    case 'neutral': return 1.0;
    case 'cold': return 0.65;      // cool off
    case 'ice_cold': return 0.4;   // tiny stakes, just to stay engaged
  }
}

// ─── Tier classification ──────────────────────────────────────────────────

export function classifyStakeTier(pick: Pick): StakeTier | null {
  const conf = pick.confidence ?? 0;
  const edge = pick.edge_pct ?? 0;

  if (conf >= TIERS.execution.minConfidence && edge >= TIERS.execution.minEdge) {
    return 'execution';
  }
  if (conf >= TIERS.validation.minConfidence && edge >= TIERS.validation.minEdge) {
    return 'validation';
  }
  if (conf >= TIERS.exploration.minConfidence) {
    return 'exploration';
  }
  return null;
}

// ─── Correlation key ──────────────────────────────────────────────────────
// Two picks "correlate" if same player, or same game + same team.

function correlationKey(p: Pick): string[] {
  const keys: string[] = [`player:${p.player_name}`];
  if (p.game_id && p.team) keys.push(`game-team:${p.game_id}:${p.team}`);
  return keys;
}

// ─── The curator ──────────────────────────────────────────────────────────
// Pure function — takes raw picks, returns approved + passed lists.

export interface CurationResult {
  approved: Array<Pick & { stake_tier: StakeTier; stake_amount: number; bankroll_reason: string }>;
  passed: Array<Pick & { pass_reason: string }>;
  totalExposure: number;
  state: BankrollState;
  formContext: { form: BankrollState['current_form']; streak: number; pnl_7d: number; win_rate_7d: number };
  summary: string;
}

export interface CurateOptions {
  forceApproveAll?: boolean;
  pickDate?: string;
}

export async function curate(
  sb: SupabaseClient,
  opts: CurateOptions = {}
): Promise<CurationResult> {
  const today = opts.pickDate ?? new Date().toISOString().slice(0, 10);
  const state = await loadBankrollState(sb);
  const formContext = await recomputeForm(sb);

  // Pull all locked picks for today
  const { data: rawPicks } = await sb
    .from('bot_daily_picks')
    .select('*')
    .eq('pick_date', today)
    .eq('status', 'locked')
    .order('confidence', { ascending: false });

  const picks = (rawPicks ?? []) as Pick[];
  if (picks.length === 0) {
    return {
      approved: [],
      passed: [],
      totalExposure: 0,
      state,
      formContext,
      summary: 'No locked picks to curate.',
    };
  }

  const multiplier = formMultiplier(formContext.form);
  const maxExposure = state.current_bankroll * (state.daily_max_exposure_pct / 100);

  const approved: CurationResult['approved'] = [];
  const passed: CurationResult['passed'] = [];
  const usedKeys = new Set<string>();
  const tierCounts: Record<StakeTier, number> = { execution: 0, validation: 0, exploration: 0 };
  let runningExposure = 0;

  for (const pick of picks) {
    // 1. Tier classification
    const tier = opts.forceApproveAll
      ? (classifyStakeTier(pick) ?? 'exploration')
      : classifyStakeTier(pick);

    if (!tier) {
      passed.push({ ...pick, pass_reason: `Below exploration floor (${Math.round(pick.confidence)}% conf)` });
      continue;
    }

    // 2. Correlation check
    const keys = correlationKey(pick);
    const correlatedKey = keys.find(k => usedKeys.has(k));
    if (correlatedKey && !opts.forceApproveAll) {
      passed.push({ ...pick, pass_reason: `Correlated with earlier approved pick (${correlatedKey})` });
      continue;
    }

    // 3. Tier cap
    if (tierCounts[tier] >= TIERS[tier].maxPerDay && !opts.forceApproveAll) {
      passed.push({ ...pick, pass_reason: `${tier} tier full (${TIERS[tier].maxPerDay}/day)` });
      continue;
    }

    // 4. Compute stake
    const baseStake = TIERS[tier].baseStake;
    const stakeAmount = Math.round(baseStake * multiplier);

    // 5. Exposure guard
    if (runningExposure + stakeAmount > maxExposure && !opts.forceApproveAll) {
      passed.push({ ...pick, pass_reason: `Daily exposure cap reached ($${Math.round(maxExposure)})` });
      continue;
    }

    // Approved!
    let reason = `${tier} tier · ${Math.round(pick.confidence)}% conf`;
    if (pick.edge_pct) reason += ` · ${pick.edge_pct.toFixed(1)}% edge`;
    if (multiplier !== 1) reason += ` · ${formContext.form} form (${(multiplier * 100).toFixed(0)}% sizing)`;

    approved.push({ ...pick, stake_tier: tier, stake_amount: stakeAmount, bankroll_reason: reason });
    keys.forEach(k => usedKeys.add(k));
    tierCounts[tier]++;
    runningExposure += stakeAmount;
  }

  // Hard floor: if we have locked picks but approved zero, force the top one in at exploration size
  if (approved.length === 0 && picks.length > 0) {
    const top = picks[0];
    const fallbackStake = Math.round(TIERS.exploration.baseStake * multiplier);
    approved.push({
      ...top,
      stake_tier: 'exploration',
      stake_amount: fallbackStake,
      bankroll_reason: 'Hard-floor pick (curator was too aggressive — playing the top one minimum)',
    });
    runningExposure = fallbackStake;
    // remove it from passed if present
    const idx = passed.findIndex(p => p.id === top.id);
    if (idx >= 0) passed.splice(idx, 1);
  }

  const summary = `Approved ${approved.length} (exec:${tierCounts.execution} val:${tierCounts.validation} exp:${tierCounts.exploration}) · $${runningExposure} exposure · ${passed.length} passed · form: ${formContext.form}`;

  return { approved, passed, totalExposure: runningExposure, state, formContext, summary };
}

// ─── Persistence ──────────────────────────────────────────────────────────
// Writes curation result back to bot_daily_picks.

export async function persistCuration(
  sb: SupabaseClient,
  result: CurationResult
): Promise<void> {
  const now = new Date().toISOString();

  // Approved updates
  for (const p of result.approved) {
    await sb
      .from('bot_daily_picks')
      .update({
        status: 'approved',
        stake_tier: p.stake_tier,
        stake_amount: p.stake_amount,
        bankroll_reason: p.bankroll_reason,
        curated_at: now,
      })
      .eq('id', p.id);
  }

  // Passed updates
  for (const p of result.passed) {
    await sb
      .from('bot_daily_picks')
      .update({
        status: 'passed',
        pass_reason: p.pass_reason,
        curated_at: now,
      })
      .eq('id', p.id);
  }

  // Snapshot form back into state
  await sb
    .from('bot_bankroll_state')
    .update({
      current_form: result.formContext.form,
      form_streak: result.formContext.streak,
      last_7d_pnl: result.formContext.pnl_7d,
      last_7d_win_rate: result.formContext.win_rate_7d,
      last_updated: now,
    })
    .eq('id', 1);
}
