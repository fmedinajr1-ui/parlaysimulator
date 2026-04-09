/**
 * signal-classifier
 * 
 * Clean signal classification engine with DB-driven kill gates.
 * Reads is_blocked from bot_category_weights instead of hardcoded lists.
 * Explicitly tracks contrarian flips for accurate post-hoc analysis.
 * 
 * Called by signal detection engines to classify and gate signals
 * before they're written to fanduel_prediction_alerts.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── Velocity gates (minimum velocity to qualify as a signal) ──
const VELOCITY_GATES: Record<string, number> = {
  player_points: 1.0,
  player_rebounds: 0.5,
  player_assists: 0.5,
  player_threes: 0.5,
  player_blocks: 0.5,
  player_steals: 0.5,
  player_turnovers: 0.5,
  batter_rbis: 0.3,
  batter_hits: 0.3,
  batter_home_runs: 0.3,
  batter_stolen_bases: 0.3,
  pitcher_strikeouts: 0.5,
  spread: 1.0,
  moneyline: 0.5,
  total: 1.0,
};

// ── Contrarian props (FD moves line UP → recommend UNDER) ──
const CONTRARIAN_PROPS = new Set([
  'player_points',
  'player_rebounds',
  'player_assists',
  'player_threes',
  'player_points_rebounds_assists',
]);

type SignalSide = 'over' | 'under' | 'home' | 'away';

interface ClassifyRequest {
  prop_type: string;
  market: string;
  sportsbook: string;
  direction: 'up' | 'down';
  velocity: number;
  books_moved: string[];
  player_name: string;
  event_id: string;
  game_date: string;
  line_at_signal: number;
  sport?: string;
}

interface ClassifiedSignal {
  signal_type: string;
  prop_type: string;
  player_name: string;
  event_id: string;
  game_date: string;
  recommended_side: SignalSide;
  line_at_signal: number;
  confidence: 'high' | 'medium' | 'low';
  contrarian_flip_applied: boolean;
  velocity: number;
  books_moved: string[];
  kill_gate_passed: boolean;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const log = (msg: string) => console.log(`[signal-classifier] ${msg}`);

  try {
    const body: ClassifyRequest = await req.json();

    // 1. Kill gate check — read from DB (includes is_force_blocked)
    const signalType = body.books_moved.length >= 3 ? 'cascade' : 'velocity_spike';
    const categoryKey = `${signalType}_${body.prop_type}`.toUpperCase();

    // Check both standard and force-blocked kill gates
    const { data: killGates } = await supabase
      .from('bot_category_weights')
      .select('category, side, is_blocked, is_force_blocked, block_reason')
      .or('is_blocked.eq.true,is_force_blocked.eq.true');

    const blockedCategories = new Set(
      (killGates || []).map((g: any) => g.category)
    );

    if (blockedCategories.has(categoryKey)) {
      const gate = (killGates || []).find((g: any) => g.category === categoryKey);
      log(`Kill gate blocked: ${categoryKey} (force=${gate?.is_force_blocked || false})`);
      return new Response(JSON.stringify({
        classified: false,
        reason: `Kill gate: ${categoryKey} is blocked${gate?.is_force_blocked ? ' (force-blocked)' : ''}`,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Velocity gate
    const minVelocity = VELOCITY_GATES[body.prop_type] ?? 0.5;
    if (body.velocity < minVelocity) {
      log(`Velocity gate: ${body.velocity} < ${minVelocity} for ${body.prop_type}`);
      return new Response(JSON.stringify({
        classified: false,
        reason: `Velocity ${body.velocity} below threshold ${minVelocity}`,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 3. Determine signal type
    const isCascade = body.books_moved.length >= 3;

    // 4. Contrarian flip — explicit, tracked
    const isContrarian = CONTRARIAN_PROPS.has(body.prop_type);
    let recommendedSide: SignalSide;
    
    if (isContrarian) {
      recommendedSide = body.direction === 'up' ? 'under' : 'over';
    } else {
      recommendedSide = body.direction === 'up' ? 'over' : 'under';
    }

    // 5. Confidence calculation
    let confidence: 'high' | 'medium' | 'low';
    if (isCascade && body.velocity >= minVelocity * 2) {
      confidence = 'high';
    } else if (isCascade || body.velocity >= minVelocity * 1.5) {
      confidence = 'medium';
    } else {
      confidence = 'low';
    }

    // 6. Check historical accuracy for this category from materialized view
    const { data: accuracy } = await supabase
      .from('signal_accuracy')
      .select('win_rate, settled_n')
      .eq('signal_type', isCascade ? 'cascade' : 'velocity_spike')
      .eq('prop_type', body.prop_type)
      .eq('contrarian_flip_applied', isContrarian)
      .maybeSingle();

    // Downgrade confidence if historical accuracy is poor
    if (accuracy && accuracy.settled_n >= 20 && accuracy.win_rate < 0.45) {
      confidence = 'low';
      log(`Downgraded confidence: ${body.prop_type} has ${(accuracy.win_rate * 100).toFixed(1)}% win rate`);
    }

    const classified: ClassifiedSignal = {
      signal_type: isCascade ? 'cascade' : 'velocity_spike',
      prop_type: body.prop_type,
      player_name: body.player_name,
      event_id: body.event_id,
      game_date: body.game_date,
      recommended_side: recommendedSide,
      line_at_signal: body.line_at_signal,
      confidence,
      contrarian_flip_applied: isContrarian,
      velocity: body.velocity,
      books_moved: body.books_moved,
      kill_gate_passed: true,
    };

    log(`Classified: ${body.player_name} ${body.prop_type} → ${recommendedSide} (${isCascade ? 'cascade' : 'velocity_spike'}, confidence=${confidence}, contrarian=${isContrarian})`);

    return new Response(JSON.stringify({
      classified: true,
      signal: classified,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    log(`Error: ${err.message}`);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
