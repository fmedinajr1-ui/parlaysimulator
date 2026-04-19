// supabase/functions/generator-template/index.ts
//
// REFERENCE GENERATOR.
//
// This is the pattern every analyzer / scanner / generator should follow.
// Rewrite your old generators to match this shape.
//
// Key rules:
//   1. A generator's job is to PRODUCE PICKS, not send messages.
//   2. Picks are written to bot_daily_picks with status='locked'.
//   3. The orchestrator decides when and how to tell the customer.
//   4. If the generator needs to signal something urgent (e.g. live scratch
//      invalidating a pick), it updates the pick row and fires an event —
//      but STILL does not render a Telegram message itself.
//
// This example generates a hypothetical "high-conviction NBA points unders"
// pick set. Swap in your actual analysis.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { Pick, PickReasoning } from '../_shared/constants.ts';
import { etDateKey } from '../_shared/date-et.ts';
import { hasMeaningfulEdge } from '../_shared/edge-calc.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ─── Main generator logic ─────────────────────────────────────────────────

async function generatePicks(sb: any): Promise<Pick[]> {
  const today = etDateKey();

  // 1. Pull candidates from the data pipeline (props, recency, matchups)
  const { data: candidates } = await sb
    .from('prop_candidates')
    .select(`
      player_id, player_name, team, opponent, sport,
      prop_type, line, american_odds_over, american_odds_under,
      l3_avg, l5_avg, l10_avg, l10_hit_rate_over, l10_hit_rate_under,
      h2h_avg, h2h_games,
      opponent_rank_vs_prop, opponent_defensive_rating,
      game_id, game_start_utc
    `)
    .eq('date', today)
    .eq('sport', 'basketball_nba');

  if (!candidates) return [];

  const picks: Pick[] = [];

  for (const c of candidates) {
    // 2. Run your analytical logic. This is where your edge comes from.
    //
    //    For a "points under" play, we want:
    //      - opponent is a top-10 defense vs this prop
    //      - L10 hit rate on under is >= 60%
    //      - L3 average trending down (cooling player)
    //      - favorable matchup history (H2H avg below current line)
    //
    const wantUnder =
      c.opponent_rank_vs_prop != null && c.opponent_rank_vs_prop <= 10 &&
      c.l10_hit_rate_under != null && c.l10_hit_rate_under >= 60 &&
      c.l10_avg != null && c.l3_avg != null && c.l3_avg < c.l10_avg &&
      c.h2h_avg != null && c.h2h_avg < c.line;

    if (!wantUnder) continue;

    // 3. Compute confidence from the drivers. Your formula goes here.
    const driverCount = [
      c.opponent_rank_vs_prop <= 5,
      c.l10_hit_rate_under >= 70,
      c.l3_avg < c.l10_avg * 0.9,
      c.h2h_avg < c.line * 0.95,
    ].filter(Boolean).length;
    const confidence = 55 + driverCount * 7; // 55-83

    // 4. Build a reasoning object in PLAIN ENGLISH.
    //    This is the most important part. The customer will read this.
    //    Be specific. Name numbers. Avoid "trending down" — say "averaging 22.8."
    const reasoning: PickReasoning = {
      headline: `${c.opponent} has been a fortress against ${c.prop_type.replace('player_', '')} this season, and ${c.player_name}'s recent form is cooling at the wrong time.`,
      drivers: [
        `${c.opponent} ranks #${c.opponent_rank_vs_prop} in defense vs ${c.prop_type.replace('player_', '')}`,
        `${c.player_name} averaging ${c.l3_avg.toFixed(1)} over L3 vs ${c.l10_avg.toFixed(1)} season avg — 🧊 cooling`,
        c.h2h_games >= 2
          ? `Head-to-head: averaged ${c.h2h_avg.toFixed(1)} in ${c.h2h_games} career matchups against ${c.opponent}`
          : `Line at ${c.line} is above his season average by ${((c.line - c.l10_avg) / c.l10_avg * 100).toFixed(0)}%`,
      ],
      risk_note: c.opponent_defensive_rating > 115
        ? `${c.opponent}'s overall defense has slipped recently — if pace is high and this goes shootout, the number is in play.`
        : `Foul trouble or blowout script could shorten his minutes and make this too easy, but we'd rather the other side of that equation.`,
      matchup: `${c.player_name} (${c.team}) vs ${c.opponent}`,
      sources: ['nba_defense_vs_prop', 'l10_recency', 'h2h_history'],
    };

    // 5. Build the Pick object.
    const pick: Pick = {
      id: `${c.player_id}_${c.prop_type}_${today}`,
      sport: c.sport,
      player_name: c.player_name,
      team: c.team,
      opponent: c.opponent,
      prop_type: c.prop_type,
      line: c.line,
      side: 'under',
      american_odds: c.american_odds_under,
      confidence,
      tier: confidence >= 80 ? 'elite' : confidence >= 70 ? 'high' : 'medium',
      reasoning,
      recency: {
        l3_avg: c.l3_avg,
        l5_avg: c.l5_avg,
        l10_avg: c.l10_avg,
        l10_hit_rate: c.l10_hit_rate_under,
        h2h_avg: c.h2h_avg,
        h2h_games: c.h2h_games,
      },
      generated_at: new Date().toISOString(),
      generator: 'nba_points_under_v2',
      game_start_utc: c.game_start_utc,
    };

    // 6. Sanity check: does this pick actually have edge against the posted odds?
    if (!hasMeaningfulEdge(pick)) continue;

    picks.push(pick);
  }

  return picks;
}

// ─── Persistence ──────────────────────────────────────────────────────────

async function savePicks(sb: any, picks: Pick[]): Promise<number> {
  if (picks.length === 0) return 0;

  // Upsert into bot_daily_picks with status='locked'.
  // The orchestrator will see these and release them via pick_drops phase.
  const rows = picks.map(p => ({
    id: p.id,
    pick_date: etDateKey(),
    player_name: p.player_name,
    team: p.team,
    opponent: p.opponent,
    sport: p.sport,
    prop_type: p.prop_type,
    line: p.line,
    side: p.side,
    american_odds: p.american_odds,
    confidence: p.confidence,
    edge_pct: p.edge_pct,
    tier: p.tier,
    reasoning: p.reasoning,
    recency: p.recency,
    generator: p.generator,
    game_id: (p as any).game_id,
    game_start_utc: p.game_start_utc,
    status: 'locked',
    generated_at: p.generated_at,
  }));

  const { error } = await sb
    .from('bot_daily_picks')
    .upsert(rows, { onConflict: 'id' });

  if (error) {
    console.error('[generator] Failed to save picks:', error);
    return 0;
  }

  return picks.length;
}

// ─── Handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const picks = await generatePicks(sb);
    const saved = await savePicks(sb, picks);

    // NOTE: We do NOT send to Telegram here. The orchestrator handles that.
    // If you need to force-release (e.g. a breaking late pick), hit:
    //   orchestrator-daily-narrative with { force_phase: 'pick_drops' }

    return new Response(JSON.stringify({
      success: true,
      generated: picks.length,
      saved,
      note: 'Picks saved. Orchestrator will release them per the narrative schedule.',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (e: any) {
    console.error('[generator] Error:', e);
    return new Response(JSON.stringify({ success: false, error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
