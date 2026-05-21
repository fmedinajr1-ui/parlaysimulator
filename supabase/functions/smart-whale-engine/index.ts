// ============================================================================
// smart-whale-engine
// Computes whale plays from unified_props + unified_props_snapshot.
// Four independent sub-scores → whale_score 0-100 → tier S/A/B.
// Tier S also gets a GPT-5 validation pass before persistence.
// Writes to public.whale_picks and public.whale_signals.
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ─── Tuning ──────────────────────────────────────────────────────────────────
const TIER_S_THRESHOLD = 80;
const TIER_A_THRESHOLD = 65;
const TIER_B_THRESHOLD = 55;
const EXPIRY_MIN_BEFORE_START = 5;       // expire 5 min before game start
const SNAPSHOT_LOOKBACK_HOURS = 24;      // use snapshots up to 24h old as "opening"
const MIN_JUICE_GAP = 15;                // baseline for any directional read
const POISON_PROPS: ReadonlySet<string> = new Set(['batter_walks', 'batter_stolen_bases']);
const SPORT_WEIGHTS: Record<string, number> = {
  MLB: 1.0,
  NBA: 1.0,
  NHL: 0.9,
  TENNIS: 0.95,
};
const PITCHER_PROPS = new Set(['pitcher_strikeouts', 'pitcher_outs', 'pitcher_hits_allowed', 'pitcher_walks']);

// ─── Types ───────────────────────────────────────────────────────────────────
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
  updated_at: string;
};

type Snapshot = {
  unified_prop_id: string;
  current_line: number | null;
  over_price: number | null;
  under_price: number | null;
  snapshot_at: string;
};

type SubScores = {
  line_gap: number;        // 0-30
  price_steam: number;     // 0-25
  cross_book: number;      // 0-25
  rlm: number;             // 0-20
};

type WhaleCandidate = {
  prop: UnifiedProp;
  side: 'Over' | 'Under';
  whale_score: number;
  sub_scores: SubScores;
  signal_types: string[];
  line_movement: number;
  opening_line: number | null;
  opening_over_price: number | null;
  opening_under_price: number | null;
  consensus_line: number | null;
  juice_gap: number;
};

function normaliseSport(s: string | null): string {
  if (!s) return 'UNKNOWN';
  const m: Record<string, string> = {
    basketball_nba: 'NBA',
    baseball_mlb: 'MLB',
    icehockey_nhl: 'NHL',
    americanfootball_nfl: 'NFL',
    tennis_atp: 'TENNIS',
    tennis_wta: 'TENNIS',
  };
  return m[s] || s.toUpperCase();
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// ─── Sub-score calculators ───────────────────────────────────────────────────
function scoreLineGap(current: number, opening: number | null, propType: string): { score: number; direction: 'Over' | 'Under' } {
  if (opening == null || !Number.isFinite(opening)) return { score: 0, direction: 'Over' };
  const delta = current - opening;
  if (Math.abs(delta) < 0.5) return { score: 0, direction: delta >= 0 ? 'Under' : 'Over' };
  // Line moved UP = book is reacting to Over money → sharp side was Over
  // Line moved DOWN = book is reacting to Under money → sharp side was Under
  const direction: 'Over' | 'Under' = delta > 0 ? 'Over' : 'Under';
  // Normalize delta per prop type (rough buckets)
  const norm = PITCHER_PROPS.has(propType) ? 1.0 : (propType.startsWith('batter_') ? 0.5 : 1.0);
  const magnitude = Math.abs(delta) / norm; // 1.0 unit ≈ a typical full step
  return { score: clamp(magnitude * 12, 0, 30), direction };
}

function scorePriceSteam(currentOver: number | null, currentUnder: number | null, openingOver: number | null, openingUnder: number | null): { score: number; direction: 'Over' | 'Under' } {
  if (currentOver == null || currentUnder == null || openingOver == null || openingUnder == null) {
    return { score: 0, direction: 'Over' };
  }
  const dOver = currentOver - openingOver;   // odds got worse for Over = money came in on Over
  const dUnder = currentUnder - openingUnder;
  // Side whose price got MORE negative is the side money hit
  const overSharper = dOver < dUnder;
  const direction: 'Over' | 'Under' = overSharper ? 'Over' : 'Under';
  const magnitude = Math.max(Math.abs(dOver), Math.abs(dUnder));
  return { score: clamp(magnitude / 3, 0, 25), direction };
}

function scoreCrossBook(fdLine: number, consensusLine: number | null): { score: number; direction: 'Over' | 'Under' } {
  if (consensusLine == null) return { score: 0, direction: 'Over' };
  const gap = consensusLine - fdLine;
  if (Math.abs(gap) < 0.5) return { score: 0, direction: gap >= 0 ? 'Over' : 'Under' };
  // Consensus higher than FD → other books raised but FD lagging → Over is value at FD
  const direction: 'Over' | 'Under' = gap > 0 ? 'Over' : 'Under';
  return { score: clamp(Math.abs(gap) * 10, 0, 25), direction };
}

function scoreRLM(
  current: number, opening: number | null,
  openingOver: number | null, openingUnder: number | null,
): { score: number; direction: 'Over' | 'Under' } {
  if (opening == null || openingOver == null || openingUnder == null) return { score: 0, direction: 'Over' };
  const lineMove = current - opening;
  if (Math.abs(lineMove) < 0.5) return { score: 0, direction: 'Over' };
  // Public bets the cheaper-priced side (more positive odds). If line moved
  // AWAY from where the public is, that's RLM.
  const publicSide: 'Over' | 'Under' = openingOver > openingUnder ? 'Over' : 'Under';
  const lineMovedToward: 'Over' | 'Under' = lineMove > 0 ? 'Over' : 'Under';
  if (publicSide === lineMovedToward) return { score: 0, direction: lineMovedToward };
  // RLM detected — sharp side = lineMovedToward (book moved despite public on other side)
  return { score: clamp(Math.abs(lineMove) * 15, 0, 20), direction: lineMovedToward };
}

function combineDirections(scores: Array<{ score: number; direction: 'Over' | 'Under' }>): { side: 'Over' | 'Under'; aligned: boolean } {
  let over = 0, under = 0;
  for (const s of scores) {
    if (s.direction === 'Over') over += s.score; else under += s.score;
  }
  const side: 'Over' | 'Under' = over >= under ? 'Over' : 'Under';
  const total = over + under;
  const aligned = total > 0 && (Math.max(over, under) / total) >= 0.7;
  return { side, aligned };
}

function tierFor(score: number): 'S' | 'A' | 'B' | null {
  if (score >= TIER_S_THRESHOLD) return 'S';
  if (score >= TIER_A_THRESHOLD) return 'A';
  if (score >= TIER_B_THRESHOLD) return 'B';
  return null;
}

function juiceGap(over: number | null, under: number | null): number {
  if (over == null || under == null) return 0;
  return Math.abs(over - under);
}

function signalTypesFor(subs: SubScores, gap: number): string[] {
  const types: string[] = [];
  if (subs.line_gap >= 12) types.push('whale_line_gap');
  if (subs.price_steam >= 10) types.push('whale_steam');
  if (subs.cross_book >= 10) types.push('whale_cross_book');
  if (subs.rlm >= 8) types.push('whale_rlm');
  if (gap >= 30) types.push('whale_juice_gap');
  return types;
}

// ─── GPT-5 validator (Tier S only) ───────────────────────────────────────────
async function gpt5ValidateBatch(candidates: WhaleCandidate[]): Promise<Set<string>> {
  const apiKey = Deno.env.get('LOVABLE_API_KEY');
  if (!apiKey) {
    console.warn('[smart-whale-engine] LOVABLE_API_KEY missing — skipping GPT-5 validation (passing all)');
    return new Set(candidates.map((c) => c.prop.id));
  }
  if (candidates.length === 0) return new Set();

  const payload = candidates.slice(0, 25).map((c) => ({
    id: c.prop.id,
    sport: normaliseSport(c.prop.sport),
    player: c.prop.player_name,
    prop: c.prop.prop_type,
    side: c.side,
    line: c.prop.current_line,
    opening_line: c.opening_line,
    line_move: c.line_movement,
    over: c.prop.over_price,
    under: c.prop.under_price,
    sub_scores: c.sub_scores,
    whale_score: c.whale_score,
    juice_gap: c.juice_gap,
    signal_types: c.signal_types,
  }));

  const sys = `You are a sharp-betting validator. Given Tier-S whale picks (already passed quantitative scoring), confirm which are real sharp signals vs noise. Reject any pick that looks like a stale line, a known poison pattern, or where the signals conflict. Return JSON only.`;
  const user = `Validate these picks. For each, decide pass=true if the signal looks real, false otherwise.\n\nPicks:\n${JSON.stringify(payload)}`;

  try {
    const resp = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'openai/gpt-5',
        reasoning: { effort: 'medium' },
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: user },
        ],
        tools: [{
          type: 'function',
          function: {
            name: 'submit_validation',
            description: 'Return pass/reject for each pick.',
            parameters: {
              type: 'object',
              properties: {
                results: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      pass: { type: 'boolean' },
                      reason: { type: 'string' },
                    },
                    required: ['id', 'pass'],
                  },
                },
              },
              required: ['results'],
            },
          },
        }],
        tool_choice: { type: 'function', function: { name: 'submit_validation' } },
      }),
    });
    if (!resp.ok) {
      const txt = await resp.text();
      console.warn(`[smart-whale-engine] GPT-5 validator http ${resp.status}: ${txt}`);
      return new Set(candidates.map((c) => c.prop.id)); // fail-open
    }
    const data = await resp.json();
    const toolCall = data?.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      return new Set(candidates.map((c) => c.prop.id));
    }
    const args = JSON.parse(toolCall.function.arguments);
    const passed = new Set<string>();
    for (const r of args.results ?? []) {
      if (r.pass) passed.add(r.id);
    }
    return passed;
  } catch (err) {
    console.warn('[smart-whale-engine] GPT-5 validator failed (fail-open):', err);
    return new Set(candidates.map((c) => c.prop.id));
  }
}

// ─── why_short via Gemini Flash (high volume, cheap) ─────────────────────────
async function generateWhyShort(c: WhaleCandidate): Promise<string> {
  const apiKey = Deno.env.get('LOVABLE_API_KEY');
  const parts: string[] = [];
  if (c.opening_line != null && Math.abs(c.line_movement) >= 0.5) {
    parts.push(`Line ${c.line_movement > 0 ? '↑' : '↓'} ${Math.abs(c.line_movement).toFixed(1)} (open ${c.opening_line} → ${c.prop.current_line})`);
  }
  if (c.sub_scores.cross_book >= 10 && c.consensus_line != null) {
    parts.push(`FD ${c.prop.current_line} vs consensus ${c.consensus_line}`);
  }
  if (c.sub_scores.rlm >= 8) parts.push('Reverse line movement');
  if (c.sub_scores.price_steam >= 10) parts.push(`Price steam on ${c.side}`);
  if (c.juice_gap >= 30) parts.push(`Sharp juice gap ${Math.round(c.juice_gap)}`);

  const fallback = parts.slice(0, 3).join(' • ') || `${c.side} value at ${c.prop.current_line}`;
  if (!apiKey || parts.length === 0) return fallback;

  try {
    const resp = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: 'Write a 1-line bettor-facing reason (max 90 chars). Be specific. No fluff.' },
          { role: 'user', content: `Player: ${c.prop.player_name}. Prop: ${c.prop.prop_type} ${c.side} ${c.prop.current_line}. Signals: ${parts.join(', ')}.` },
        ],
        max_tokens: 60,
      }),
    });
    if (!resp.ok) return fallback;
    const data = await resp.json();
    const text = data?.choices?.[0]?.message?.content?.trim();
    return text && text.length <= 120 ? text : fallback;
  } catch {
    return fallback;
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  const stats = {
    props_scanned: 0,
    snapshots_used: 0,
    candidates: 0,
    tier_s: 0, tier_a: 0, tier_b: 0,
    rejected_aligned: 0, rejected_poison: 0, rejected_gpt5: 0,
    written: 0, errors: 0,
  };

  try {
    // 1) Pull active props — paginate to bypass PostgREST 1000-row cap.
    //    We need FanDuel for scoring AND other books for consensus medians.
    const sinceProps = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const props: UnifiedProp[] = [];
    const PAGE = 1000;
    for (let offset = 0; ; offset += PAGE) {
      const { data: page, error: pErr } = await supabase
        .from('unified_props')
        .select('id,event_id,sport,game_description,commence_time,player_name,prop_type,bookmaker,current_line,over_price,under_price,updated_at')
        .eq('is_active', true)
        .gte('updated_at', sinceProps)
        .not('over_price', 'is', null)
        .not('under_price', 'is', null)
        .not('current_line', 'is', null)
        .order('id', { ascending: true })
        .range(offset, offset + PAGE - 1);
      if (pErr) throw pErr;
      const rows = (page ?? []) as UnifiedProp[];
      props.push(...rows);
      if (rows.length < PAGE) break;
      if (offset > 20000) break; // hard safety
    }
    stats.props_scanned = props.length;

    // 2) Pull recent snapshots — earliest-per-prop becomes our "opening"
    const sinceSnap = new Date(Date.now() - SNAPSHOT_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
    // Only need snapshots for FanDuel props (the ones we actually score)
    const propIds = props.filter((p) => (p.bookmaker ?? '').toLowerCase() === 'fanduel').map((p) => p.id);
    const openingByProp = new Map<string, Snapshot>();
    if (propIds.length > 0) {
      const chunkSize = 100;
      for (let i = 0; i < propIds.length; i += chunkSize) {
        const chunk = propIds.slice(i, i + chunkSize);
        const { data: snaps } = await supabase
          .from('unified_props_snapshot')
          .select('unified_prop_id,current_line,over_price,under_price,snapshot_at')
          .in('unified_prop_id', chunk)
          .gte('snapshot_at', sinceSnap)
          .order('snapshot_at', { ascending: true })
          .limit(5000);
        for (const s of (snaps ?? []) as Snapshot[]) {
          if (!openingByProp.has(s.unified_prop_id)) openingByProp.set(s.unified_prop_id, s);
        }
      }
    }
    stats.snapshots_used = openingByProp.size;

    // 3) Build a cross-book consensus map (player + prop_type + sport) → median line across bookmakers
    const consensusKey = (p: UnifiedProp) => `${normaliseSport(p.sport)}|${p.player_name}|${p.prop_type}`;
    const consensusBuckets = new Map<string, number[]>();
    for (const p of props) {
      if (p.current_line == null) continue;
      const arr = consensusBuckets.get(consensusKey(p)) ?? [];
      arr.push(Number(p.current_line));
      consensusBuckets.set(consensusKey(p), arr);
    }
    const consensusMedian = new Map<string, number>();
    for (const [k, arr] of consensusBuckets) {
      if (arr.length < 2) continue; // need ≥2 books for consensus
      const sorted = [...arr].sort((a, b) => a - b);
      consensusMedian.set(k, sorted[Math.floor(sorted.length / 2)]);
    }

    // 4) Score FanDuel props only (one source of truth per market)
    const candidates: WhaleCandidate[] = [];
    for (const p of props) {
      if ((p.bookmaker ?? '').toLowerCase() !== 'fanduel') continue;
      if (!p.prop_type || !p.player_name || p.current_line == null) continue;

      const opening = openingByProp.get(p.id) ?? null;
      const fdLine = Number(p.current_line);
      const consensus = consensusMedian.get(consensusKey(p)) ?? null;

      const lg = scoreLineGap(fdLine, opening?.current_line ?? null, p.prop_type);
      const ps = scorePriceSteam(p.over_price, p.under_price, opening?.over_price ?? null, opening?.under_price ?? null);
      const cb = scoreCrossBook(fdLine, consensus);
      const rl = scoreRLM(fdLine, opening?.current_line ?? null, opening?.over_price ?? null, opening?.under_price ?? null);

      const direction = combineDirections([lg, ps, cb, rl]);
      if (!direction.aligned) {
        // Skip when sub-scores point in conflicting directions
        stats.rejected_aligned += 1;
        continue;
      }

      const subTotal = lg.score + ps.score + cb.score + rl.score;
      const sportWeight = SPORT_WEIGHTS[normaliseSport(p.sport)] ?? 1.0;
      // MLB blacklist penalty (per audit) on batter walks/SB
      let typeWeight = 1.0;
      if (POISON_PROPS.has(p.prop_type) && direction.side === 'Over') {
        typeWeight = 0.3; // heavy penalty; almost never makes Tier B
      } else if (PITCHER_PROPS.has(p.prop_type)) {
        typeWeight = 1.3;
      } else if (p.prop_type.startsWith('batter_home_runs')) {
        typeWeight = 0.7;
      }
      const whaleScore = Math.round(clamp(subTotal * sportWeight * typeWeight, 0, 100));
      const tier = tierFor(whaleScore);
      if (!tier) continue;

      const subs: SubScores = {
        line_gap: Math.round(lg.score * 10) / 10,
        price_steam: Math.round(ps.score * 10) / 10,
        cross_book: Math.round(cb.score * 10) / 10,
        rlm: Math.round(rl.score * 10) / 10,
      };
      const gap = juiceGap(p.over_price, p.under_price);
      const sigTypes = signalTypesFor(subs, gap);
      if (sigTypes.length === 0) continue;

      candidates.push({
        prop: p,
        side: direction.side,
        whale_score: whaleScore,
        sub_scores: subs,
        signal_types: sigTypes,
        line_movement: opening?.current_line != null ? fdLine - Number(opening.current_line) : 0,
        opening_line: opening?.current_line ?? null,
        opening_over_price: opening?.over_price ?? null,
        opening_under_price: opening?.under_price ?? null,
        consensus_line: consensus,
        juice_gap: gap,
      });
    }
    stats.candidates = candidates.length;

    // 5) Tier-S GPT-5 validation pass
    const tierS = candidates.filter((c) => c.whale_score >= TIER_S_THRESHOLD);
    const tierOther = candidates.filter((c) => c.whale_score < TIER_S_THRESHOLD);
    const passedIds = tierS.length > 0 ? await gpt5ValidateBatch(tierS) : new Set<string>();
    const tierSPassed = tierS.filter((c) => passedIds.has(c.prop.id));
    stats.rejected_gpt5 = tierS.length - tierSPassed.length;
    const finalCandidates = [...tierSPassed, ...tierOther];

    // 6) Generate why_short + persist
    for (const c of finalCandidates) {
      const tier = tierFor(c.whale_score)!;
      if (tier === 'S') stats.tier_s += 1;
      else if (tier === 'A') stats.tier_a += 1;
      else stats.tier_b += 1;

      const why = await generateWhyShort(c);
      const start = c.prop.commence_time ? new Date(c.prop.commence_time).getTime() : Date.now() + 3 * 60 * 60 * 1000;
      const expiresAt = new Date(start - EXPIRY_MIN_BEFORE_START * 60 * 1000).toISOString();
      const marketKey = `${c.prop.event_id}|${c.prop.player_name}|${c.prop.prop_type}|${c.side}|${Date.now()}`;

      const row = {
        market_key: marketKey,
        event_id: c.prop.event_id,
        sport: normaliseSport(c.prop.sport),
        game_description: c.prop.game_description,
        player_name: c.prop.player_name,
        prop_type: c.prop.prop_type,
        side: c.side,
        pick_side: c.side === 'Over' ? 'OVER' : 'UNDER',
        stat_type: c.prop.prop_type,
        pp_line: c.prop.current_line,
        current_line: c.prop.current_line,
        opening_line: c.opening_line,
        current_over_price: c.prop.over_price,
        current_under_price: c.prop.under_price,
        bookmaker: 'fanduel',
        whale_score: c.whale_score,
        sharp_score: c.whale_score,
        tier,
        confidence: tier,
        confidence_grade: tier,
        sub_scores: c.sub_scores,
        divergence_pts: c.sub_scores.cross_book,
        move_speed_pts: c.sub_scores.line_gap,
        confirmation_pts: c.sub_scores.price_steam,
        board_behavior_pts: c.sub_scores.rlm,
        why_short_text: why,
        why_short: [why],
        signal_types: c.signal_types,
        signal_type: c.signal_types[0],
        commence_time: c.prop.commence_time,
        start_time: c.prop.commence_time,
        expires_at: expiresAt,
        recommended_side: c.side,
        metadata: {
          opening_over_price: c.opening_over_price,
          opening_under_price: c.opening_under_price,
          consensus_line: c.consensus_line,
          juice_gap: c.juice_gap,
          line_movement: c.line_movement,
          gpt5_validated: tier === 'S',
          engine: 'smart-whale-engine',
          version: 'v1',
        },
      };

      const { error: insErr } = await supabase.from('whale_picks').insert(row);
      if (insErr) {
        // Unique market_key conflict → just skip
        if (!/duplicate|unique/i.test(insErr.message)) {
          console.error('[smart-whale-engine] insert failed:', insErr.message);
          stats.errors += 1;
        }
        continue;
      }
      stats.written += 1;

      // Mirror into whale_signals for the legacy whale dashboard consumers
      try {
        await supabase.from('whale_signals').insert({
          market_key: marketKey,
          signal_type: c.signal_types[0],
          sharp_score: c.whale_score,
          divergence_score: Math.round(c.sub_scores.cross_book),
          move_speed_score: Math.round(c.sub_scores.line_gap),
          confirmation_score: Math.round(c.sub_scores.price_steam),
          board_behavior_score: Math.round(c.sub_scores.rlm),
          reasons_json: { why_short: why, signal_types: c.signal_types, side: c.side },
        });
      } catch (e) {
        console.warn('[smart-whale-engine] whale_signals mirror failed (non-fatal):', e);
      }
    }

    return new Response(JSON.stringify({ success: true, stats }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[smart-whale-engine] fatal:', msg);
    return new Response(JSON.stringify({ success: false, error: msg, stats }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});