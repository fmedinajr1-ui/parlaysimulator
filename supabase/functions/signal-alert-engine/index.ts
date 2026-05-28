import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildPlayerReasoning, buildGroupReasoning, type PlayerReasoning } from '../_shared/alert-explainer.ts';
import { loadRoleContexts, dangerBandCheck, type PlayerRoleContext } from '../_shared/player-role-context.ts';
import { loadHardRockLines, checkHrbLine, type HardRockLine } from '../_shared/hardrock-lines.ts';
import {
  loadVelocitySpikeStrength,
  scoreVelocitySpike,
  type StrengthVerdict,
} from '../_shared/velocity-spike-strength.ts';
import {
  resolvePrice,
  evaluate as evaluatePriceAware,
  HARD_CONFIDENCE_CAP,
} from '../_shared/price-aware-confidence.ts';

// Feature flag for Module C (BACK/LEAN/FADE verdict override). Modules A + B
// (de-vig + line guard) always run; Module C only swaps the broadcast
// confidence + verdict when explicitly enabled.
const PRICE_AWARE_VERDICT_ENABLED =
  (Deno.env.get('PRICE_AWARE_VERDICT_ENABLED') ?? 'false').toLowerCase() === 'true';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MIN_CONFIDENCE = 60;            // global accuracy floor (matches parlay engine)
const CASCADE_MIN_PLAYERS = 3;        // ≥3 same-event same-direction picks = cascade
const DEDUPE_TTL_MIN = 120;           // 2-hour cross-run dedupe per Telegram rule
const MIN_JUICE_GAP = 15;             // min American-odds gap to consider a directional signal

// "Movement-free" detector tuning — used because unified_props is repriced
// once daily, so true intraday flips/velocity can't be measured. These two
// detectors instead surface (a) the steepest juice gap per game and
// (b) the rarest-priced props on the slate.
const TAKE_IT_NOW_MIN_GAP = 30;       // American odds gap that screams "book is hammering one side"
// Relaxed 2026-05-28 so the strength meter has data to learn the fade/play
// split. Old values (5% / 70 / 20) gated everything out. New values let the
// top of each cohort surface; the strength meter then auto-routes play vs fade.
const VELOCITY_TOP_PERCENTILE = 0.15; // top 15% of derived confidence per (sport, prop_type)
const VELOCITY_MIN_CONFIDENCE = 65;   // floor for "rare on slate"
const VELOCITY_MIN_GROUP_SIZE = 10;   // smaller cohorts still qualify (e.g. MLB Hits)

// ─── POISON-SIGNAL BLACKLIST (Phase 1 kill switch) ───────────────────────────
// Last 21d audit: batter_walks Over @ 28.5%, batter_stolen_bases Over @ ~0%.
// We hard-suppress these directions and auto-flip the strongest gaps to Under
// candidates via the accuracy_flip signal type.
const BLACKLISTED_OVER_PROPS: ReadonlySet<string> = new Set([
  'batter_walks',
  'batter_stolen_bases',
]);

// Slate-blowout guard: if a (sport, prop_type, side) cohort has the same
// direction firing on >= this fraction of the slate's distinct players, kill
// the whole batch and log a signal_blowout row.
const SLATE_BLOWOUT_THRESHOLD = 0.20; // 20% of distinct players
const SLATE_BLOWOUT_MIN_PLAYERS = 8;  // need a real sample first
const ACCURACY_FLIP_TOP_N = 5;        // per-prop_type Under candidates we emit

function isBlacklistedDirection(propType: string | null, side: 'Over' | 'Under'): boolean {
  if (!propType || side !== 'Over') return false;
  return BLACKLISTED_OVER_PROPS.has(propType);
}

type UnifiedProp = {
  id: string;
  event_id: string;
  sport: string | null;
  game_description: string | null;
  commence_time: string | null;
  player_name: string | null;
  prop_type: string | null;
  bookmaker: string | null;
  current_line: number | null;
  over_price: number | null;
  under_price: number | null;
  composite_score: number | null;
  confidence: number | null;
  recommendation: string | null;
  recommended_side: string | null;
  pvs_tier: string | null;
  updated_at: string;
};

type ScoredProp = UnifiedProp & {
  derived_side: 'Over' | 'Under';
  derived_confidence: number;
  derived_score: number; // 0-100 magnitude (used for velocity baseline)
};

type Snapshot = {
  unified_prop_id: string;
  recommended_side: string | null;
  composite_score: number | null;
  confidence: number | null;
  snapshot_at: string;
};

function normaliseSport(s: string | null): string {
  if (!s) return 'UNKNOWN';
  const m: Record<string, string> = {
    basketball_nba: 'NBA',
    baseball_mlb: 'MLB',
    icehockey_nhl: 'NHL',
    americanfootball_nfl: 'NFL',
  };
  return m[s] || s.toUpperCase();
}

// Tiny in-run cache so multiple props from the same player+event don't re-query.
function reasoningCache() {
  const map = new Map<string, Promise<PlayerReasoning>>();
  return {
    get(key: string) { return map.get(key); },
    set(key: string, p: Promise<PlayerReasoning>) { map.set(key, p); },
  };
}

function dedupeKey(parts: Array<string | null | undefined>): string {
  return parts.map((p) => (p ?? '').toString().toLowerCase().trim()).join('|');
}

// Derive direction + confidence from raw American odds.
// Logic: the "better" priced side (less negative / more positive) is the implied edge for the bettor.
// Confidence scales with the magnitude of the juice gap, mapped to a 60-90 range when the gap clears MIN_JUICE_GAP.
function scoreFromPrices(over: number | null, under: number | null): { side: 'Over' | 'Under'; confidence: number; score: number } | null {
  if (over == null || under == null) return null;
  const gap = Math.abs(over - under);
  if (gap < MIN_JUICE_GAP) return null;

  // The side that pays MORE has the implied edge (sharps don't need to juice it).
  const side: 'Over' | 'Under' = over > under ? 'Over' : 'Under';

  // Map gap -> confidence: 15 -> 60, 50+ -> 90
  const confidence = Math.min(90, Math.max(60, 60 + Math.round((gap - MIN_JUICE_GAP) * 0.85)));
  // 0..100 magnitude for velocity baseline
  const score = Math.min(100, gap);
  return { side, confidence, score };
}
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  const stats = { snapshots: 0, cascades: 0, take_it_now: 0, velocity_spike: 0, deduped: 0, errors: 0, dropped_no_hrb: 0 };
  let dropped_legs_total = 0;
  // Phase 1 telemetry
  const phase1 = { poison_suppressed: 0, slate_blowout_suppressed: 0, accuracy_flip_emitted: 0 };
  const slateBlowoutCohorts = new Set<string>(); // `${sport}|${propType}|${side}`
  const explainerCache = reasoningCache();

  // Load Hard Rock prop lines once per run. Empty map = HRB has no coverage,
  // in which case we skip broadcasting (better silent than untradable).
  const hrbLines = await loadHardRockLines();
  const hrbAvailable = hrbLines.size > 0;
  if (!hrbAvailable) {
    console.warn('[signal-alert-engine] HRB lines unavailable — all NBA alerts will be suppressed this run');
  }

  // Load combined outcome+CLV strength stats for velocity_spike once per run.
  const velocityStrength = await loadVelocitySpikeStrength(supabase);

  // Build (or reuse) a per-player reasoning block. Failures are non-fatal —
  // the alert still fires, just without the engine_reasoning attached.
  const explain = async (p: ScoredProp, juiceGap: number | null, signal_type?: string): Promise<PlayerReasoning | null> => {
    if (!p.player_name || !p.prop_type || !p.event_id) return null;
    const key = `${p.event_id}|${p.player_name}|${p.prop_type}|${p.derived_side}|${p.current_line}|${signal_type ?? ''}`;
    let pending = explainerCache.get(key);
    if (!pending) {
      pending = buildPlayerReasoning(supabase, {
        player_name: p.player_name,
        prop_type: p.prop_type,
        side: p.derived_side,
        line: Number(p.current_line ?? 0),
        event_id: p.event_id,
        sport: normaliseSport(p.sport),
        juice_gap: juiceGap,
        signal_type,
      }).catch((err) => {
        console.error('[signal-alert-engine] explainer failed for', p.player_name, err);
        return null as unknown as PlayerReasoning;
      });
      explainerCache.set(key, pending);
    }
    const r = await pending;
    return r ?? null;
  };

  try {
    // 1) Pull active props (only fresh ones with both prices). We derive direction from prices,
    //    not from `recommended_side`, because the upstream scorer is currently silent.
    const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(); // last 6 hours (upstream sync cadence is loose)
    const { data: props, error: pErr } = await supabase
      .from('unified_props')
      .select('id,event_id,sport,game_description,commence_time,player_name,prop_type,bookmaker,current_line,over_price,under_price,composite_score,confidence,recommendation,recommended_side,pvs_tier,updated_at')
      .eq('is_active', true)
      .gte('updated_at', since)
      .not('over_price', 'is', null)
      .not('under_price', 'is', null);

    if (pErr) throw pErr;
    const rawProps = (props ?? []) as UnifiedProp[];

    // 2) Score each prop from raw prices
    const activeProps: ScoredProp[] = [];
    for (const p of rawProps) {
      const scored = scoreFromPrices(Number(p.over_price), Number(p.under_price));
      if (!scored) continue;
      if (scored.confidence < MIN_CONFIDENCE) continue;
      activeProps.push({
        ...p,
        derived_side: scored.side,
        derived_confidence: scored.confidence,
        derived_score: scored.score,
      });
    }
    console.log(`[signal-alert-engine] active props: ${rawProps.length} raw, ${activeProps.length} after scoring`);

    // 2.5) SLATE-BLOWOUT GUARD ─ detect cohorts where the whole roster fires same side.
    //      If so, the cohort is flagged; downstream detectors skip it and we emit a
    //      capped accuracy_flip Under batch instead.
    {
      type CohortKey = string;
      const cohortPlayers = new Map<CohortKey, Set<string>>();
      const slatePlayersBySport = new Map<string, Set<string>>(); // (sport|propType) → all distinct players seen
      for (const p of activeProps) {
        if (!p.player_name || !p.prop_type) continue;
        const sport = normaliseSport(p.sport);
        const slateKey = `${sport}|${p.prop_type}`;
        const slateSet = slatePlayersBySport.get(slateKey) ?? new Set<string>();
        slateSet.add(p.player_name);
        slatePlayersBySport.set(slateKey, slateSet);

        const cohortKey = `${slateKey}|${p.derived_side}`;
        const cohortSet = cohortPlayers.get(cohortKey) ?? new Set<string>();
        cohortSet.add(p.player_name);
        cohortPlayers.set(cohortKey, cohortSet);
      }
      for (const [cohortKey, players] of cohortPlayers) {
        const [sport, propType] = cohortKey.split('|');
        const slateKey = `${sport}|${propType}`;
        const totalPlayers = slatePlayersBySport.get(slateKey)?.size ?? 0;
        if (totalPlayers < SLATE_BLOWOUT_MIN_PLAYERS) continue;
        const ratio = players.size / totalPlayers;
        if (ratio >= SLATE_BLOWOUT_THRESHOLD) {
          slateBlowoutCohorts.add(cohortKey);
          console.warn(`[signal-alert-engine] SLATE BLOWOUT — ${cohortKey} fires on ${players.size}/${totalPlayers} (${Math.round(ratio*100)}%) — suppressing`);
        }
      }
      if (slateBlowoutCohorts.size > 0) {
        // Best-effort telemetry write — non-fatal if table missing.
        try {
          const rows = Array.from(slateBlowoutCohorts).map((cohortKey) => {
            const [sport, propType, side] = cohortKey.split('|');
            return {
              engine_name: 'signal-alert-engine',
              sport,
              pick_description: `SIGNAL BLOWOUT: ${propType} ${side} firing on ≥${Math.round(SLATE_BLOWOUT_THRESHOLD*100)}% of slate`,
              prop_type: propType,
              side,
              status: 'suppressed',
              signals: [{
                type: 'signal_blowout',
                threshold: SLATE_BLOWOUT_THRESHOLD,
                detected_at: new Date().toISOString(),
              }],
            };
          });
          await supabase.from('engine_live_tracker').insert(rows);
        } catch (e) {
          console.warn('[signal-alert-engine] engine_live_tracker insert failed (non-fatal):', e);
        }
      }
    }
    const isBlowoutOrPoison = (p: ScoredProp): boolean => {
      if (isBlacklistedDirection(p.prop_type, p.derived_side)) return true;
      const sport = normaliseSport(p.sport);
      const cohortKey = `${sport}|${p.prop_type}|${p.derived_side}`;
      return slateBlowoutCohorts.has(cohortKey);
    };

    // 3) Snapshot every active prop (for future change detection)
    if (activeProps.length > 0) {
      const snapRows = activeProps.map((p) => ({
        unified_prop_id: p.id,
        event_id: p.event_id,
        sport: p.sport,
        player_name: p.player_name,
        prop_type: p.prop_type,
        current_line: p.current_line,
        over_price: p.over_price,
        under_price: p.under_price,
        composite_score: p.derived_score,
        confidence: p.derived_confidence,
        recommendation: p.recommendation,
        recommended_side: p.derived_side,
        pvs_tier: p.pvs_tier,
      }));
      const { error: snapErr } = await supabase.from('unified_props_snapshot').insert(snapRows);
      if (snapErr) console.error('[signal-alert-engine] snapshot insert failed:', snapErr);
      else stats.snapshots = snapRows.length;
    }

    // 3) Clean expired dedupe entries
    await supabase.from('signal_alert_dedupe').delete().lt('expires_at', new Date().toISOString());

    // Helper: try to claim a dedupe key
    const claimKey = async (key: string, signalType: string): Promise<boolean> => {
      const expires = new Date(Date.now() + DEDUPE_TTL_MIN * 60 * 1000).toISOString();
      const { error } = await supabase
        .from('signal_alert_dedupe')
        .insert({ dedupe_key: key, signal_type: signalType, expires_at: expires });
      if (error) {
        // unique violation = already alerted recently
        stats.deduped += 1;
        return false;
      }
      return true;
    };

    // 4) CASCADE detector — group by (event_id, prop_type, derived_side)
    const groups = new Map<string, ScoredProp[]>();
    for (const p of activeProps) {
      if (!p.event_id || !p.prop_type || !p.player_name) continue;
      const key = `${p.event_id}|${p.prop_type}|${p.derived_side.toLowerCase()}`;
      const arr = groups.get(key) ?? [];
      arr.push(p);
      groups.set(key, arr);
    }

    for (const [groupKey, members] of groups) {
      // Phase 1: suppress poison/blowout cohorts
      const sampleMember = members[0];
      if (sampleMember && isBlowoutOrPoison(sampleMember)) {
        phase1.poison_suppressed += 1;
        continue;
      }
      const initialDistinct = Array.from(new Set(members.map((m) => m.player_name)));
      if (initialDistinct.length < CASCADE_MIN_PLAYERS) continue;

      // Miss-by-1 suppression — only relevant for NBA player props (others don't carry std/L10 baselines yet).
      const isNbaProp = normaliseSport(members[0].sport) === 'NBA';
      const dropped: Array<{ player: string; reason: string }> = [];
      let filteredMembers = members;
      let roleCtxMap: Map<string, PlayerRoleContext> = new Map();

      if (isNbaProp) {
        roleCtxMap = await loadRoleContexts(
          supabase,
          members.map((m) => ({ player_name: m.player_name ?? '', prop_type: m.prop_type })),
        );

        filteredMembers = members.filter((m) => {
          if (!m.player_name) return true;
          const ctx = roleCtxMap.get(m.player_name.toLowerCase());
          if (!ctx) return true;
          const check = dangerBandCheck({
            side: m.derived_side,
            line: Number(m.current_line ?? 0),
            ctx,
          });
          if (check.drop) {
            dropped.push({ player: m.player_name, reason: check.reason ?? 'danger_band' });
            return false;
          }
          return true;
        });
      }

      const distinctPlayers = Array.from(new Set(filteredMembers.map((m) => m.player_name)));
      if (distinctPlayers.length < CASCADE_MIN_PLAYERS) {
        const dedupedSkip = Array.from(
          new Map(dropped.map((d) => [d.player, d])).values(),
        );
        dropped_legs_total += dedupedSkip.length;
        if (dedupedSkip.length > 0) {
          console.log(`[signal-alert-engine] cascade suppressed (${groupKey}) — ${dedupedSkip.length} legs dropped, only ${distinctPlayers.length} remain`);
        }
        continue;
      }
      const dedupedDropped = Array.from(
        new Map(dropped.map((d) => [d.player, d])).values(),
      );
      dropped_legs_total += dedupedDropped.length;
      const cascadeMembers = filteredMembers;

      const first = cascadeMembers[0];

      // Hard Rock gate — drop legs that aren't tradable on HRB at the alerted line.
      let hrbFilteredMembers = cascadeMembers;
      const hrbDropped: Array<{ player: string; reason: string }> = [];
      const hrbByPlayer = new Map<string, HardRockLine>();
      if (normaliseSport(first.sport) === 'NBA') {
        if (!hrbAvailable) {
          stats.dropped_no_hrb += 1;
          continue;
        }
        hrbFilteredMembers = cascadeMembers.filter((m) => {
          if (!m.player_name || !m.prop_type || !m.event_id) return false;
          const r = checkHrbLine(hrbLines, {
            event_id: m.event_id,
            player: m.player_name,
            prop_type: m.prop_type,
            side: m.derived_side,
            line: Number(m.current_line ?? 0),
          });
          if (!r.ok) {
            hrbDropped.push({ player: m.player_name, reason: r.reason ?? 'hrb_reject' });
            return false;
          }
          if (r.hrb && m.player_name) hrbByPlayer.set(m.player_name.toLowerCase(), r.hrb);
          return true;
        });
        const hrbDistinct = Array.from(new Set(hrbFilteredMembers.map((m) => m.player_name)));
        if (hrbDistinct.length < CASCADE_MIN_PLAYERS) {
          stats.dropped_no_hrb += 1;
          console.log(`[signal-alert-engine] cascade suppressed by HRB gate (${groupKey}) — ${hrbDropped.length} legs dropped`);
          continue;
        }
      }

      const avgConfidence = Math.round(
        hrbFilteredMembers.reduce((sum, m) => sum + m.derived_confidence, 0) / hrbFilteredMembers.length,
      );
      if (avgConfidence < MIN_CONFIDENCE) continue;

      const dKey = dedupeKey(['cascade', groupKey]);
      if (!(await claimKey(dKey, 'cascade'))) continue;

      // Build per-player reasoning in parallel (≤8 players typically)
      const reasonings = await Promise.all(
        hrbFilteredMembers.map((m) => {
          const overP = Number(m.over_price ?? NaN);
          const underP = Number(m.under_price ?? NaN);
          const gap = Number.isFinite(overP) && Number.isFinite(underP) ? Math.abs(overP - underP) : null;
          return explain(m, gap, 'cascade');
        }),
      );

      const playerBreakdownRaw = hrbFilteredMembers.map((m, i) => {
        const ctx = m.player_name ? roleCtxMap.get(m.player_name.toLowerCase()) ?? null : null;
        const hrb = m.player_name ? hrbByPlayer.get(m.player_name.toLowerCase()) ?? null : null;
        const hrbPriceForSide = hrb ? (m.derived_side === 'Over' ? hrb.over_price : hrb.under_price) : null;
        return {
          player: m.player_name,
          confidence: m.derived_confidence,
          composite: m.derived_score,
          // Prefer the actual HRB line when available so the alert shows what the user can book.
          line: hrb ? hrb.line : Number(m.current_line ?? 0),
          side: m.derived_side,
          pvs_tier: m.pvs_tier,
          hrb_line: hrb ? hrb.line : null,
          hrb_price: hrbPriceForSide,
          book: hrb ? 'hardrockbet' : (m.bookmaker ?? null),
          role_context: ctx
            ? {
                archetype: ctx.archetype,
                role_tier: ctx.role_tier,
                avg_minutes: ctx.avg_minutes,
                baseline_mean: ctx.baseline_mean,
                baseline_std: ctx.baseline_std,
                baseline_source: ctx.baseline_source,
              }
            : null,
          engine_reasoning: reasonings[i] ?? null,
        };
      });

      // Dedupe on (player + side + line) — same player can appear via multiple
      // book/snapshot rows. Keep highest-confidence copy. Fixes "Josh Hart x2".
      const dedupeMap = new Map<string, typeof playerBreakdownRaw[number]>();
      for (const p of playerBreakdownRaw) {
        const key = `${(p.player ?? '').toLowerCase()}|${p.side}|${p.line}`;
        const existing = dedupeMap.get(key);
        if (!existing || Number(p.confidence ?? 0) > Number(existing.confidence ?? 0)) {
          dedupeMap.set(key, p);
        }
      }
      const playerBreakdown = Array.from(dedupeMap.values());

      const validReasonings = reasonings.filter((r): r is PlayerReasoning => !!r);
      const groupReasoning = validReasonings.length > 0
        ? buildGroupReasoning(validReasonings, first.derived_side, first.prop_type ?? '')
        : null;

      // Verdict roll-up so we can audit which cascades are "real"
      const verdictCounts = { strong: 0, lean: 0, neutral: 0, weak: 0 };
      for (const r of validReasonings) {
        const k = r.verdict.toLowerCase() as 'strong'|'lean'|'neutral'|'weak';
        if (k in verdictCounts) verdictCounts[k] += 1;
      }

      const firstHrb = first.player_name ? hrbByPlayer.get(first.player_name.toLowerCase()) ?? null : null;
      const { error: insErr } = await supabase.from('fanduel_prediction_alerts').insert({
        player_name: `TEAM CASCADE (${distinctPlayers.slice(0, 3).join(', ')}${distinctPlayers.length > 3 ? '…' : ''})`,
        event_id: first.event_id,
        signal_type: 'cascade',
        prediction: first.derived_side,
        confidence: avgConfidence,
        prop_type: first.prop_type,
        sport: normaliseSport(first.sport),
        bookmaker: hrbByPlayer.size > 0 ? 'hardrockbet' : (first.bookmaker ?? 'unknown'),
        event_description: first.game_description,
        commence_time: first.commence_time,
        metadata: {
          players_involved: distinctPlayers.length,
          direction: first.derived_side,
          line: firstHrb ? firstHrb.line : first.current_line,
          alignment: 100,
          player_breakdown: playerBreakdown,
          group_reasoning: groupReasoning,
          verdict_counts: verdictCounts,
          dropped_legs: dedupedDropped,
          hrb_dropped_legs: hrbDropped,
          danger_band_filtered: dedupedDropped.length,
          explainer_version: 'v1',
          source: 'unified_props_price_derived',
          source_book: hrbByPlayer.size > 0 ? 'hardrockbet' : null,
          hrb_verified: hrbByPlayer.size > 0,
        },
      });
      if (insErr) {
        console.error('[signal-alert-engine] cascade insert failed:', insErr);
        stats.errors += 1;
      } else stats.cascades += 1;
    }

    // 5) TAKE-IT-NOW — "Sharpest Side Asymmetry"
    //    Logic: a prop with juice gap >= TAKE_IT_NOW_MIN_GAP (e.g. -105 / -135 → gap 30)
    //    AND it is the steepest juice gap in its game. The book is openly hammering one side.
    //    Movement-free: works on a single snapshot, no history required.
    {
      const gapByGame = new Map<string, number>(); // event_id → max gap seen
      const propGap = new Map<string, number>();   // prop.id → its gap
      for (const p of activeProps) {
        const over = Number(p.over_price ?? NaN);
        const under = Number(p.under_price ?? NaN);
        if (!Number.isFinite(over) || !Number.isFinite(under) || !p.event_id) continue;
        const gap = Math.abs(over - under);
        propGap.set(p.id, gap);
        const cur = gapByGame.get(p.event_id) ?? 0;
        if (gap > cur) gapByGame.set(p.event_id, gap);
      }

      for (const p of activeProps) {
        const gap = propGap.get(p.id) ?? 0;
        if (gap < TAKE_IT_NOW_MIN_GAP) continue;
        if (!p.event_id) continue;
        const top = gapByGame.get(p.event_id) ?? 0;
        if (gap < top) continue; // only the steepest gap in the game

        const conf = p.derived_confidence;
        if (conf < MIN_CONFIDENCE) continue;

        // Profitability gate (7d audit 2026-05-22):
        //   take_it_now overall = 24.9% (185/744). Only the under-snapback on
        //   hits / hits+runs+rbis is profitable (~42–59%). Block everything else.
        {
          const pt = (p.prop_type ?? '').toLowerCase();
          const side = (p.derived_side ?? '').toLowerCase();
          const profitablePair =
            side === 'under' && (pt === 'batter_hits' || pt === 'batter_hits_runs_rbis');
          if (!profitablePair) continue;
        }

        // Phase 1: suppress poison/blowout
        if (isBlowoutOrPoison(p)) {
          phase1.poison_suppressed += 1;
          continue;
        }

        // HRB gate (NBA only — other sports not yet covered by HRB feed here)
        let hrbInfo: HardRockLine | null = null;
        if (normaliseSport(p.sport) === 'NBA') {
          if (!hrbAvailable) { stats.dropped_no_hrb += 1; continue; }
          if (!p.player_name || !p.prop_type) continue;
          const r = checkHrbLine(hrbLines, {
            event_id: p.event_id, player: p.player_name, prop_type: p.prop_type,
            side: p.derived_side, line: Number(p.current_line ?? 0),
          });
          if (!r.ok) { stats.dropped_no_hrb += 1; continue; }
          hrbInfo = r.hrb ?? null;
        }

        const dKey = dedupeKey(['take_it_now', p.event_id, p.player_name, p.prop_type, p.derived_side]);
        if (!(await claimKey(dKey, 'take_it_now'))) continue;

        const engine_reasoning = await explain(p, gap, 'take_it_now');

        const { error: insErr } = await supabase.from('fanduel_prediction_alerts').insert({
          player_name: p.player_name,
          event_id: p.event_id,
          signal_type: 'take_it_now',
          prediction: p.derived_side,
          confidence: Math.round(conf),
          prop_type: p.prop_type,
          sport: normaliseSport(p.sport),
          bookmaker: hrbInfo ? 'hardrockbet' : (p.bookmaker ?? 'unknown'),
          event_description: p.game_description,
          commence_time: p.commence_time,
          metadata: {
            detector: 'sharpest_juice_gap',
            juice_gap: gap,
            over_price: hrbInfo ? hrbInfo.over_price : p.over_price,
            under_price: hrbInfo ? hrbInfo.under_price : p.under_price,
            line: hrbInfo ? hrbInfo.line : p.current_line,
            source_book: hrbInfo ? 'hardrockbet' : null,
            hrb_verified: !!hrbInfo,
            pvs_tier: p.pvs_tier,
            engine_reasoning,
            explainer_version: 'v1',
            source: 'unified_props_price_derived',
          },
        });
        if (insErr) {
          console.error('[signal-alert-engine] take_it_now insert failed:', insErr);
          stats.errors += 1;
        } else stats.take_it_now += 1;
      }
    }

    // 6) VELOCITY SPIKE — "Slate Outlier"
    //    Logic: derived_confidence is in the top VELOCITY_TOP_PERCENTILE for its
    //    (sport, prop_type) cohort AND >= VELOCITY_MIN_CONFIDENCE. The slate is
    //    telling us this is a rare price. Movement-free, computed cross-sectionally.
    //
    //    FADE MODE (2026-05-27): historical accuracy on the natural side is 28.3%
    //    (91/321) — strong inverse edge. We now FLIP the prediction to the
    //    opposite side and emit it as a fade. Source side preserved in metadata.
    {
      const cohorts = new Map<string, ScoredProp[]>();
      for (const p of activeProps) {
        if (!p.prop_type) continue;
        const key = `${normaliseSport(p.sport)}|${p.prop_type}`;
        const arr = cohorts.get(key) ?? [];
        arr.push(p);
        cohorts.set(key, arr);
      }

      for (const [cohortKey, members] of cohorts) {
        if (members.length < VELOCITY_MIN_GROUP_SIZE) continue;
        const sorted = [...members].sort((a, b) => b.derived_confidence - a.derived_confidence);
        const cutoffIdx = Math.max(1, Math.floor(sorted.length * VELOCITY_TOP_PERCENTILE));
        const winners = sorted.slice(0, cutoffIdx);
        const cohortAvg = members.reduce((s, m) => s + m.derived_confidence, 0) / members.length;

        for (const p of winners) {
          if (p.derived_confidence < VELOCITY_MIN_CONFIDENCE) continue;
          if (!p.event_id || !p.player_name) continue;

          // Phase 1: suppress poison/blowout
          if (isBlowoutOrPoison(p)) {
            phase1.poison_suppressed += 1;
            continue;
          }

          // HRB gate
          let hrbInfo: HardRockLine | null = null;
          if (normaliseSport(p.sport) === 'NBA') {
            if (!hrbAvailable) { stats.dropped_no_hrb += 1; continue; }
            if (!p.prop_type) continue;
            const r = checkHrbLine(hrbLines, {
              event_id: p.event_id, player: p.player_name, prop_type: p.prop_type,
              side: p.derived_side, line: Number(p.current_line ?? 0),
            });
            if (!r.ok) { stats.dropped_no_hrb += 1; continue; }
            hrbInfo = r.hrb ?? null;
          }

          const dKey = dedupeKey(['velocity_spike', p.event_id, p.player_name, p.prop_type]);
          if (!(await claimKey(dKey, 'velocity_spike'))) continue;

          const overP = Number(p.over_price ?? NaN);
          const underP = Number(p.under_price ?? NaN);
          const gap = Number.isFinite(overP) && Number.isFinite(underP) ? Math.abs(overP - underP) : null;

          // ─── SIGNAL STRENGTH METER ────────────────────────────────────────
          // Combined outcome+CLV historical performance decides play vs fade
          // per (sport, prop_type). Falls back to sport, then global baseline.
          const originalSide = p.derived_side;
          const verdict: StrengthVerdict = scoreVelocitySpike(
            velocityStrength,
            normaliseSport(p.sport),
            p.prop_type,
          );
          const finalSide: 'Over' | 'Under' =
            verdict.recommendation === 'play'
              ? originalSide
              : (originalSide === 'Over' ? 'Under' : 'Over');

          // ─── PRICE-AWARE CONFIDENCE (Modules A + B always; C flagged) ─────
          // A: de-vig the posted prices.
          // B: line-guard — refuse to score when the priced row looks like an
          //    ALT line (extreme juice) or a side is missing (UNPRICED_MAIN).
          // C: cap model confidence at fair + 8pp + 0.85 hard cap, emit verdict.
          // Score against the FINAL side (post-fade-flip) so the cap and
          // verdict reflect what we're actually broadcasting.
          const priceRes = resolvePrice(
            Number.isFinite(overP) ? overP : null,
            Number.isFinite(underP) ? underP : null,
            p.updated_at ?? null,
          );
          let priceAware: ReturnType<typeof evaluatePriceAware> | null = null;
          let broadcastConfidence = Math.round(p.derived_confidence);
          if (priceRes.ok) {
            priceAware = evaluatePriceAware({
              side: finalSide,
              modelProb: Math.min(1, Math.max(0, p.derived_confidence / 100)),
              over: priceRes.over,
              under: priceRes.under,
            });
            if (PRICE_AWARE_VERDICT_ENABLED) {
              broadcastConfidence = Math.round(priceAware.capped_prob * 100);
            }
          }
          // Module B as a hard gate only when Module C is on (avoid losing
          // historical sample for the strength meter while we tune thresholds).
          if (PRICE_AWARE_VERDICT_ENABLED && !priceRes.ok) {
            console.log('[price-aware] skip velocity_spike', {
              player: p.player_name, prop: p.prop_type, reason: priceRes.reason,
            });
            continue;
          }

          // Suppress NEUTRAL with insufficient sample only when meter is razor-thin.
          // (We still fire — the fade default has +EV vs the natural side — but tag it.)
          const engine_reasoning = await explain(p, gap, 'velocity_spike');

          const { error: insErr } = await supabase.from('fanduel_prediction_alerts').insert({
            player_name: p.player_name,
            event_id: p.event_id,
            signal_type: 'velocity_spike',
            prediction: finalSide,
            confidence: broadcastConfidence,
            prop_type: p.prop_type,
            sport: normaliseSport(p.sport),
            bookmaker: hrbInfo ? 'hardrockbet' : (p.bookmaker ?? 'unknown'),
            event_description: p.game_description,
            commence_time: p.commence_time,
            metadata: {
              detector: verdict.recommendation === 'play' ? 'slate_outlier_play' : 'slate_outlier_fade',
              mode: verdict.recommendation,
              original_side: originalSide,
              strength: {
                label: verdict.label,
                meter: verdict.meter,
                combined_hit_rate: verdict.combined_hit_rate,
                outcome: { n: verdict.outcome_n, correct: verdict.outcome_correct },
                clv: { n: verdict.clv_n, correct: verdict.clv_correct },
                cohort: verdict.cohort,
                reason: verdict.reason,
              },
              price_aware: priceAware
                ? {
                    enabled_for_broadcast: PRICE_AWARE_VERDICT_ENABLED,
                    side_scored: finalSide,
                    fair_prob: Math.round(priceAware.fair_prob_side * 10000) / 10000,
                    implied_prob: Math.round(priceAware.implied_prob_side * 10000) / 10000,
                    capped_prob: Math.round(priceAware.capped_prob * 10000) / 10000,
                    raw_model_prob: Math.round((p.derived_confidence / 100) * 10000) / 10000,
                    edge_pp: Math.round(priceAware.edge_pp * 10000) / 10000,
                    is_plus_ev: priceAware.is_plus_ev,
                    verdict: priceAware.verdict,
                    hard_cap: HARD_CONFIDENCE_CAP,
                  }
                : { enabled_for_broadcast: PRICE_AWARE_VERDICT_ENABLED, line_guard: priceRes.ok ? 'ok' : priceRes.reason },
              cohort_key: cohortKey,
              cohort_size: members.length,
              cohort_avg_confidence: Math.round(cohortAvg * 10) / 10,
              percentile_rank: Math.round((1 - winners.indexOf(p) / sorted.length) * 1000) / 10,
              over_price: hrbInfo ? hrbInfo.over_price : p.over_price,
              under_price: hrbInfo ? hrbInfo.under_price : p.under_price,
              line: hrbInfo ? hrbInfo.line : p.current_line,
              source_book: hrbInfo ? 'hardrockbet' : null,
              hrb_verified: !!hrbInfo,
              engine_reasoning,
              explainer_version: 'v1',
              source: 'unified_props_price_derived',
            },
          });
          if (insErr) {
            console.error('[signal-alert-engine] velocity_spike insert failed:', insErr);
            stats.errors += 1;
          } else stats.velocity_spike += 1;
        }
      }
    }

    // 7) ACCURACY-FLIP — for blacklisted Over prop types, emit top-N Under candidates
    //    by widest juice gap. These are the props the book is hammering Over on; the
    //    inverse Under is the value side per 21d audit.
    {
      const flipCandidates = new Map<string, ScoredProp[]>(); // prop_type → props (Over-direction passes)
      for (const p of activeProps) {
        if (!p.prop_type || !p.player_name || !p.event_id) continue;
        if (!BLACKLISTED_OVER_PROPS.has(p.prop_type)) continue;
        if (p.derived_side !== 'Over') continue; // only flip the Over-juice side
        const arr = flipCandidates.get(p.prop_type) ?? [];
        arr.push(p);
        flipCandidates.set(p.prop_type, arr);
      }
      for (const [propType, props] of flipCandidates) {
        const ranked = [...props].sort((a, b) => {
          const ga = Math.abs(Number(a.over_price ?? 0) - Number(a.under_price ?? 0));
          const gb = Math.abs(Number(b.over_price ?? 0) - Number(b.under_price ?? 0));
          return gb - ga;
        }).slice(0, ACCURACY_FLIP_TOP_N);
        for (const p of ranked) {
          const dKey = dedupeKey(['accuracy_flip', p.event_id, p.player_name, p.prop_type, 'Under']);
          if (!(await claimKey(dKey, 'accuracy_flip'))) continue;
          const overP = Number(p.over_price ?? NaN);
          const underP = Number(p.under_price ?? NaN);
          const gap = Number.isFinite(overP) && Number.isFinite(underP) ? Math.abs(overP - underP) : null;
          const { error: insErr } = await supabase.from('fanduel_prediction_alerts').insert({
            player_name: p.player_name,
            event_id: p.event_id,
            signal_type: 'accuracy_flip',
            prediction: 'Under', // flipped
            confidence: Math.min(85, Math.max(MIN_CONFIDENCE, p.derived_confidence - 5)),
            prop_type: p.prop_type,
            sport: normaliseSport(p.sport),
            bookmaker: p.bookmaker ?? 'unknown',
            event_description: p.game_description,
            commence_time: p.commence_time,
            contrarian_flip_applied: true,
            metadata: {
              detector: 'phase1_accuracy_flip',
              flipped_from: 'Over',
              flip_reason: 'blacklisted_over_prop',
              audit_basis: '21d_hit_rate_below_breakeven',
              juice_gap: gap,
              original_over_price: p.over_price,
              original_under_price: p.under_price,
              line: p.current_line,
              source: 'unified_props_price_derived',
            },
          });
          if (insErr) {
            console.error('[signal-alert-engine] accuracy_flip insert failed:', insErr);
            stats.errors += 1;
          } else {
            phase1.accuracy_flip_emitted += 1;
          }
        }
      }
    }

    phase1.slate_blowout_suppressed = slateBlowoutCohorts.size;
    return new Response(JSON.stringify({ success: true, stats: { ...stats, dropped_legs_total, phase1 } }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[signal-alert-engine] fatal:', msg);
    return new Response(JSON.stringify({ success: false, error: msg, stats }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});