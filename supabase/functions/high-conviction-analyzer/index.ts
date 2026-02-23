import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function getEasternDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function normalizePropType(raw: string): string {
  return raw.replace(/^(player_|batter_|pitcher_)/, '').toLowerCase().trim();
}

interface EnginePick {
  player_name: string;
  prop_type: string;
  side: string;
  confidence?: number;
  engine: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);
  const today = getEasternDate();

  try {
    console.log(`[HighConviction] Starting analysis for ${today}`);

    // Fetch all data in parallel
    const [mispricedResult, riskResult, propV2Result, sharpResult, heatResult, mlbCrossRefResult, botParlayResult] = await Promise.all([
      supabase.from('mispriced_lines')
        .select('player_name, prop_type, signal, edge_pct, confidence_tier, book_line, player_avg_l10, sport')
        .eq('analysis_date', today),
      supabase.from('nba_risk_engine_picks')
        .select('player_name, prop_type, line, side, confidence_score')
        .eq('game_date', today),
      supabase.from('prop_engine_v2_picks')
        .select('player_name, prop_type, line, side, ses_score, decision')
        .eq('game_date', today),
      supabase.from('sharp_ai_parlays')
        .select('leg_1, leg_2, parlay_type')
        .eq('parlay_date', today),
      supabase.from('heat_parlays')
        .select('legs, parlay_type')
        .eq('parlay_date', today),
      supabase.from('mlb_engine_picks')
        .select('player_name, prop_type, line, side, confidence_score')
        .eq('game_date', today),
      supabase.from('bot_daily_parlays')
        .select('legs')
        .eq('parlay_date', today),
    ]);

    const mispricedLines = mispricedResult.data || [];
    if (riskResult.error) console.error(`[HighConviction] Risk query error:`, riskResult.error);
    if (mispricedResult.error) console.error(`[HighConviction] Mispriced query error:`, mispricedResult.error);
    if (botParlayResult.error) console.error(`[HighConviction] BotParlay query error:`, botParlayResult.error);
    console.log(`[HighConviction] Date: ${today}, Mispriced: ${mispricedLines.length}, Risk: ${riskResult.data?.length || 0}, PropV2: ${propV2Result.data?.length || 0}, Sharp: ${sharpResult.data?.length || 0}, Heat: ${heatResult.data?.length || 0}, MLB-CrossRef: ${mlbCrossRefResult.data?.length || 0}, BotParlays: ${botParlayResult.data?.length || 0}`);

    // Build engine picks map
    const engineMap = new Map<string, EnginePick[]>();
    const addPick = (pick: EnginePick) => {
      if (!pick.player_name || !pick.prop_type) return;
      const key = `${pick.player_name.toLowerCase()}|${normalizePropType(pick.prop_type)}`;
      if (!engineMap.has(key)) engineMap.set(key, []);
      engineMap.get(key)!.push(pick);
    };

    for (const p of riskResult.data || []) {
      addPick({ player_name: p.player_name, prop_type: p.prop_type, side: p.side || 'over', confidence: p.confidence_score, engine: 'risk' });
    }
    for (const p of propV2Result.data || []) {
      addPick({ player_name: p.player_name, prop_type: p.prop_type, side: p.side || 'over', confidence: p.ses_score, engine: 'propv2' });
    }
    for (const parlay of sharpResult.data || []) {
      for (const legKey of ['leg_1', 'leg_2']) {
        const leg = parlay[legKey];
        if (leg && typeof leg === 'object') {
          addPick({ player_name: leg.player_name || '', prop_type: leg.prop_type || leg.stat_type || '', side: leg.side || 'over', engine: 'sharp' });
        }
      }
    }
    for (const parlay of heatResult.data || []) {
      if (Array.isArray(parlay.legs)) {
        for (const leg of parlay.legs) {
          if (leg && typeof leg === 'object') {
            addPick({ player_name: leg.player_name || '', prop_type: leg.prop_type || leg.stat_type || '', side: leg.side || 'over', engine: 'heat' });
          }
        }
      }
    }
    // MLB Cross-Reference engine
    for (const p of mlbCrossRefResult.data || []) {
      addPick({ player_name: p.player_name, prop_type: p.prop_type, side: p.side || 'over', confidence: p.confidence_score, engine: 'mlb_cross_ref' });
    }
    // Bot Daily Parlays as engine source (feedback loop)
    for (const parlay of botParlayResult.data || []) {
      const legs = Array.isArray(parlay.legs) ? parlay.legs : (typeof parlay.legs === 'string' ? JSON.parse(parlay.legs) : []);
      for (const leg of legs) {
        if (leg && typeof leg === 'object' && leg.player_name && leg.prop_type) {
          addPick({ player_name: leg.player_name, prop_type: leg.prop_type, side: leg.side || 'over', engine: 'bot_parlay' });
        }
      }
    }

    // Cross-reference
    const plays: any[] = [];
    for (const ml of mispricedLines) {
      const key = `${ml.player_name.toLowerCase()}|${normalizePropType(ml.prop_type)}`;
      const matches = engineMap.get(key);
      if (!matches || matches.length === 0) continue;

      const mispricedSide = ml.signal.toLowerCase();
      const sideAgreement = matches.every(m => m.side.toLowerCase() === mispricedSide);

      const edgeScore = Math.min(Math.abs(ml.edge_pct) / 10, 10);
      const tierBonus = ml.confidence_tier === 'ELITE' ? 3 : ml.confidence_tier === 'HIGH' ? 2 : 1;
      const engineCountBonus = matches.length * 2;
      const agreementBonus = sideAgreement ? 3 : 0;
      const sameDirectionEngines = matches.filter(m => m.side.toLowerCase() === mispricedSide).length;
      const directionBonus = sameDirectionEngines * 1.5;
      const riskConfidence = matches.find(m => m.engine === 'risk')?.confidence || 0;
      const riskBonus = riskConfidence > 0 ? riskConfidence / 20 : 0;
      const convictionScore = edgeScore + tierBonus + engineCountBonus + agreementBonus + directionBonus + riskBonus;

      plays.push({
        player_name: ml.player_name,
        prop_type: normalizePropType(ml.prop_type),
        displayPropType: ml.prop_type,
        signal: ml.signal,
        edge_pct: ml.edge_pct,
        confidence_tier: ml.confidence_tier,
        current_line: ml.book_line,
        player_avg: ml.player_avg_l10,
        sport: ml.sport,
        engines: matches.map(m => ({ engine: m.engine, side: m.side, confidence: m.confidence })),
        sideAgreement,
        convictionScore,
      });
    }

    plays.sort((a, b) => b.convictionScore - a.convictionScore);

    const engineCounts: Record<string, number> = {};
    for (const p of plays) {
      for (const e of p.engines) {
        engineCounts[e.engine] = (engineCounts[e.engine] || 0) + 1;
      }
    }

    const stats = {
      total: plays.length,
      allAgree: plays.filter(p => p.sideAgreement).length,
      engineCounts,
    };

    console.log(`[HighConviction] Found ${plays.length} overlaps, ${stats.allAgree} with full agreement`);

    // Persist results to high_conviction_results table
    if (plays.length > 0) {
      // Delete old results for today first
      await supabase.from('high_conviction_results').delete().eq('analysis_date', today);

      const rows = plays.map(p => ({
        analysis_date: today,
        player_name: p.player_name,
        prop_type: p.prop_type,
        display_prop_type: p.displayPropType,
        signal: p.signal,
        edge_pct: p.edge_pct,
        confidence_tier: p.confidence_tier,
        current_line: p.current_line,
        player_avg: p.player_avg,
        sport: p.sport,
        engines: p.engines,
        side_agreement: p.sideAgreement,
        conviction_score: p.convictionScore,
      }));

      const { error: insertError } = await supabase.from('high_conviction_results').insert(rows);
      if (insertError) {
        console.error(`[HighConviction] Failed to persist results:`, insertError);
      } else {
        console.log(`[HighConviction] Persisted ${rows.length} results to high_conviction_results`);
      }
    }

    // Send to Telegram
    const top15 = plays.slice(0, 15);
    try {
      const teleResp = await fetch(`${supabaseUrl}/functions/v1/bot-send-telegram`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'high_conviction_report',
          data: { plays: top15, stats },
        }),
      });
      const teleResult = await teleResp.json();
      console.log(`[HighConviction] Telegram sent:`, teleResult.success);
    } catch (teleErr) {
      console.error(`[HighConviction] Telegram failed:`, teleErr);
    }

    return new Response(JSON.stringify({
      success: true,
      total_overlaps: plays.length,
      side_agreement: stats.allAgree,
      engine_counts: engineCounts,
      top_plays: top15,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[HighConviction] Error:`, msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
