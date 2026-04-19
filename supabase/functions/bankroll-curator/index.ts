// supabase/functions/bankroll-curator/index.ts
//
// THE CURATOR.
//
// Runs after generators have produced their `locked` picks for the day.
// Reads all of them, decides which to actually approve for play (with a
// dollar stake), and which to pass on. Writes status back to bot_daily_picks.
//
// This is what turns the bot from a pick-spammer into a portfolio manager.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { curate, persistCuration } from '../_shared/bankroll-curator.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const sb = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({}));
    const forceApproveAll = body.force_approve_all === true;
    const pickDate: string | undefined = body.pick_date;
    const dryRun = body.dry_run === true;

    const result = await curate(sb, { forceApproveAll, pickDate });

    if (!dryRun) {
      await persistCuration(sb, result);
    }

    return new Response(JSON.stringify({
      success: true,
      dry_run: dryRun,
      summary: result.summary,
      approved_count: result.approved.length,
      passed_count: result.passed.length,
      total_exposure: result.totalExposure,
      bankroll: result.state.current_bankroll,
      form: result.formContext.form,
      streak: result.formContext.streak,
      pnl_7d: result.formContext.pnl_7d,
      win_rate_7d: result.formContext.win_rate_7d,
      tier_breakdown: {
        execution: result.approved.filter(p => p.stake_tier === 'execution').length,
        validation: result.approved.filter(p => p.stake_tier === 'validation').length,
        exploration: result.approved.filter(p => p.stake_tier === 'exploration').length,
      },
      approved: result.approved.map(p => ({
        id: p.id, player: p.player_name, side: p.side, line: p.line,
        prop: p.prop_type, conf: p.confidence, edge: p.edge_pct,
        tier: p.stake_tier, stake: p.stake_amount, reason: p.bankroll_reason,
      })),
      passed: result.passed.map(p => ({
        id: p.id, player: p.player_name, conf: p.confidence, reason: p.pass_reason,
      })),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (e: any) {
    console.error('[bankroll-curator] Error:', e);
    return new Response(JSON.stringify({ success: false, error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
