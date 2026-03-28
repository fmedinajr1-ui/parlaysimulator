/**
 * engine-tracker-sync
 * 
 * Centralized function that pulls legs/picks from ALL engine output tables
 * and syncs them into engine_live_tracker for unified real-time display.
 * 
 * Sources:
 * 1. bot_daily_parlays → individual legs (parlay generator tiers)
 * 2. bot_straight_bets → straight bet picks (sweet spots)
 * 3. heat_parlays → heat engine 2-man parlays
 * 4. nba_risk_engine_picks → PVS/risk engine picks
 * 5. unified_props → unified prop feed (already synced via unified-live-feed)
 * 
 * Called by morning-prep-pipeline and refresh-l10-and-rebuild.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const log = (msg: string) => console.log(`[engine-tracker-sync] ${msg}`);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

  const stats = { parlayLegs: 0, straightBets: 0, heatLegs: 0, riskPicks: 0, errors: 0 };

  try {
    log(`=== Syncing all engines to tracker for ${today} ===`);

    // ── 1. Bot Daily Parlays → extract individual legs ──
    try {
      const { data: parlays } = await supabase
        .from('bot_daily_parlays')
        .select('id, strategy_name, tier, legs, outcome, created_at')
        .eq('parlay_date', today);

      if (parlays && parlays.length > 0) {
        const trackerRecords: any[] = [];

        for (const parlay of parlays) {
          const legs = (parlay.legs as any[]) || [];
          const tierLabel = parlay.tier || 'unknown';
          const strategyShort = parlay.strategy_name?.split('_').slice(0, 3).join('_') || 'bot';

          for (const leg of legs) {
            if (!leg.player_name) continue;

            const engineName = `Bot ${tierLabel.charAt(0).toUpperCase() + tierLabel.slice(1)}`;
            const pickDesc = `${leg.player_name} ${leg.prop_type || ''} ${leg.side || ''} ${leg.line || ''} (${strategyShort})`;

            trackerRecords.push({
              engine_name: engineName,
              sport: leg.sport || 'NBA',
              pick_description: pickDesc.trim(),
              player_name: leg.player_name,
              team_name: leg.team_name || null,
              prop_type: leg.prop_type || null,
              line: leg.line || null,
              side: leg.side || null,
              odds: leg.american_odds || null,
              confidence: leg.composite_score || leg.confidence_score || null,
              confidence_level: (leg.composite_score || 0) >= 70 ? 'high' : (leg.composite_score || 0) >= 55 ? 'medium' : 'low',
              signals: leg._gameContext ? [
                { type: 'matchup', value: leg._gameContext.defenseStrength },
                { type: 'env_cluster', value: leg._gameContext.envCluster },
                { type: 'pace', value: leg._gameContext.pace },
              ] : null,
              status: parlay.outcome === 'pending' ? 'pending' : parlay.outcome || 'pending',
              event_id: leg._gameContext?.gameKey || null,
              created_at: parlay.created_at,
            });
          }
        }

        if (trackerRecords.length > 0) {
          // Use upsert with a unique key to avoid duplicates
          const { error } = await supabase
            .from('engine_live_tracker')
            .upsert(trackerRecords, { onConflict: 'id' });

          if (error) {
            log(`⚠ Parlay legs sync error: ${error.message}`);
            stats.errors++;
          } else {
            stats.parlayLegs = trackerRecords.length;
            log(`✅ Synced ${trackerRecords.length} parlay legs`);
          }
        }
      }
    } catch (e) {
      log(`❌ Parlay legs error: ${e.message}`);
      stats.errors++;
    }

    // ── 2. Bot Straight Bets ──
    try {
      const { data: straightBets } = await supabase
        .from('bot_straight_bets')
        .select('*')
        .gte('created_at', `${today}T00:00:00`)
        .lte('created_at', `${today}T23:59:59`);

      if (straightBets && straightBets.length > 0) {
        const trackerRecords = straightBets.map(bet => ({
          engine_name: 'Sweet Spot',
          sport: 'NBA',
          pick_description: `${bet.player_name} ${bet.prop_type} ${bet.side} ${bet.line} (${bet.source || 'sweet_spot'})`,
          player_name: bet.player_name,
          prop_type: bet.prop_type,
          line: bet.line,
          side: bet.side,
          odds: bet.american_odds || null,
          confidence: bet.composite_score || null,
          confidence_level: (bet.composite_score || 0) >= 70 ? 'high' : (bet.composite_score || 0) >= 55 ? 'medium' : 'low',
          signals: [
            { type: 'l10_hit_rate', value: bet.l10_hit_rate },
            { type: 'l10_avg', value: bet.l10_avg },
            { type: 'bet_type', value: bet.bet_type },
          ],
          status: bet.outcome || 'pending',
          created_at: bet.created_at,
        }));

        const { error } = await supabase
          .from('engine_live_tracker')
          .upsert(trackerRecords, { onConflict: 'id' });

        if (error) {
          log(`⚠ Straight bets sync error: ${error.message}`);
          stats.errors++;
        } else {
          stats.straightBets = trackerRecords.length;
          log(`✅ Synced ${trackerRecords.length} straight bets`);
        }
      }
    } catch (e) {
      log(`❌ Straight bets error: ${e.message}`);
      stats.errors++;
    }

    // ── 3. Heat Parlays → extract legs ──
    try {
      const { data: heatParlays } = await supabase
        .from('heat_parlays')
        .select('*')
        .eq('parlay_date', today);

      if (heatParlays && heatParlays.length > 0) {
        const trackerRecords: any[] = [];

        for (const hp of heatParlays) {
          for (const legKey of ['leg_1', 'leg_2'] as const) {
            const leg = hp[legKey] as any;
            if (!leg?.player_name) continue;

            trackerRecords.push({
              engine_name: `Heat ${hp.parlay_type || 'CORE'}`,
              sport: leg.sport || 'NBA',
              pick_description: `${leg.player_name} ${leg.market_type || ''} ${leg.side || ''} ${leg.line || ''} [${leg.signal_label || ''}]`,
              player_name: leg.player_name,
              prop_type: leg.market_type || null,
              line: leg.line || null,
              side: leg.side || null,
              confidence: leg.final_score || null,
              confidence_level: (leg.final_score || 0) >= 70 ? 'high' : (leg.final_score || 0) >= 55 ? 'medium' : 'low',
              signals: [
                { type: 'signal_label', value: leg.signal_label },
                { type: 'reason', value: leg.reason },
              ],
              status: hp.outcome || 'pending',
              event_id: leg.event_id || null,
              created_at: hp.created_at,
            });
          }
        }

        if (trackerRecords.length > 0) {
          const { error } = await supabase
            .from('engine_live_tracker')
            .upsert(trackerRecords, { onConflict: 'id' });

          if (error) {
            log(`⚠ Heat parlays sync error: ${error.message}`);
            stats.errors++;
          } else {
            stats.heatLegs = trackerRecords.length;
            log(`✅ Synced ${trackerRecords.length} heat legs`);
          }
        }
      }
    } catch (e) {
      log(`❌ Heat parlays error: ${e.message}`);
      stats.errors++;
    }

    // ── 4. Risk Engine Picks (PVS/God Mode) ──
    try {
      const { data: riskPicks } = await supabase
        .from('nba_risk_engine_picks')
        .select('*')
        .eq('game_date', today)
        .is('rejection_reason', null)
        .limit(200);

      if (riskPicks && riskPicks.length > 0) {
        const trackerRecords = riskPicks.map(pick => {
          let engineName = 'God Mode';
          if (pick.is_sweet_spot) engineName = 'Sweet Spot PVS';
          else if (pick.sharp_alert) engineName = 'Sharp Alert';
          else if (pick.is_trap_line) engineName = 'Trap Detector';
          else if (pick.is_juiced) engineName = 'Juiced Props';

          return {
            engine_name: engineName,
            sport: 'NBA',
            pick_description: `${pick.player_name} ${pick.prop_type} ${pick.side} ${pick.line} vs ${pick.opponent || '?'}`,
            player_name: pick.player_name,
            team_name: pick.team_name,
            prop_type: pick.prop_type,
            line: pick.line,
            side: pick.side,
            odds: null,
            confidence: pick.confidence_score || null,
            confidence_level: pick.confidence_score >= 70 ? 'high' : pick.confidence_score >= 50 ? 'medium' : 'low',
            signals: [
              { type: 'edge', value: pick.edge },
              { type: 'archetype', value: pick.archetype },
              { type: 'sharp_alert', value: pick.sharp_alert_level },
              { type: 'h2h_hit_rate', value: pick.h2h_hit_rate },
              { type: 'l10_hit_rate', value: pick.l10_hit_rate },
            ].filter(s => s.value != null),
            status: pick.outcome || 'pending',
            event_id: pick.event_id || null,
            created_at: pick.created_at,
          };
        });

        const { error } = await supabase
          .from('engine_live_tracker')
          .upsert(trackerRecords, { onConflict: 'id' });

        if (error) {
          log(`⚠ Risk engine sync error: ${error.message}`);
          stats.errors++;
        } else {
          stats.riskPicks = trackerRecords.length;
          log(`✅ Synced ${trackerRecords.length} risk engine picks`);
        }
      }
    } catch (e) {
      log(`❌ Risk engine error: ${e.message}`);
      stats.errors++;
    }

    const totalSynced = stats.parlayLegs + stats.straightBets + stats.heatLegs + stats.riskPicks;
    log(`=== SYNC COMPLETE: ${totalSynced} total records (${stats.errors} errors) ===`);

    return new Response(JSON.stringify({
      success: true,
      date: today,
      stats,
      totalSynced,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    log(`Fatal: ${err.message}`);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
