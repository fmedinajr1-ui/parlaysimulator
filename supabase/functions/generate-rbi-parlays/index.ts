/**
 * generate-rbi-parlays
 * 
 * Builds 2-3 leg RBI parlays from the highest-accuracy signal clusters.
 * Only uses signal types with 60%+ historical accuracy.
 * Sends formatted parlay suggestions to Telegram.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RbiCandidate {
  id: string;
  player_name: string;
  prediction: string;
  signal_type: string;
  confidence: string;
  metadata: Record<string, any>;
  created_at: string;
}

interface SignalAccuracy {
  signal_type: string;
  settled: number;
  wins: number;
  win_rate: number;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const log = (msg: string) => console.log(`[rbi-parlays] ${msg}`);

  try {
    // Step 1: Get accuracy by signal type from settled RBI picks
    const { data: dashboardData, error: dashErr } = await supabase.rpc('get_rbi_accuracy_dashboard');
    if (dashErr) throw dashErr;

    const bySignal: SignalAccuracy[] = (dashboardData?.by_signal_type || []).filter(
      (s: SignalAccuracy) => s.settled >= 5 && s.win_rate >= 60
    );

    log(`Qualifying signal types (60%+ win rate, 5+ sample): ${bySignal.map(s => `${s.signal_type}=${s.win_rate}%`).join(', ') || 'NONE'}`);

    if (bySignal.length === 0) {
      log('No signal types meet the 60%+ accuracy threshold yet. Need more settled data.');
      return new Response(JSON.stringify({ 
        parlays: [], 
        message: 'No signal types meet 60%+ accuracy threshold yet' 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const qualifyingSignals = bySignal.map(s => s.signal_type);

    // Step 2: Get today's unsettled RBI alerts from qualifying signals
    const today = new Date().toISOString().split('T')[0];
    const { data: todayAlerts, error: alertErr } = await supabase
      .from('fanduel_prediction_alerts')
      .select('id, player_name, prediction, signal_type, confidence, metadata, created_at')
      .eq('prop_type', 'batter_rbis')
      .is('was_correct', null)
      .in('signal_type', qualifyingSignals)
      .gte('created_at', `${today}T00:00:00`)
      .order('created_at', { ascending: false })
      .limit(50);

    if (alertErr) throw alertErr;

    if (!todayAlerts || todayAlerts.length < 2) {
      log(`Only ${todayAlerts?.length || 0} qualifying alerts today. Need at least 2 for a parlay.`);
      return new Response(JSON.stringify({ 
        parlays: [], 
        message: `Only ${todayAlerts?.length || 0} qualifying alerts today` 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    log(`Found ${todayAlerts.length} qualifying RBI alerts for today`);

    // Step 2.5: Conflict Guard — deduplicate contradictory Over/Under for same player
    const playerSignalMap = new Map<string, typeof todayAlerts>();
    for (const alert of todayAlerts) {
      const key = alert.player_name;
      if (!playerSignalMap.has(key)) playerSignalMap.set(key, []);
      playerSignalMap.get(key)!.push(alert);
    }

    const deduped: typeof todayAlerts = [];
    for (const [player, alerts] of playerSignalMap) {
      if (alerts.length === 1) {
        deduped.push(alerts[0]);
        continue;
      }
      // Check for Over/Under conflict
      const hasOver = alerts.some(a => (a.prediction || '').toLowerCase().includes('over'));
      const hasUnder = alerts.some(a => (a.prediction || '').toLowerCase().includes('under'));
      if (hasOver && hasUnder) {
        // Keep the strongest signal: confidence + velocity*0.1
        const scored = alerts.map(a => ({
          ...a,
          conflictScore: (Number(a.confidence) || 0) + ((a.metadata?.velocity || 0) * 0.1),
        }));
        scored.sort((a, b) => b.conflictScore - a.conflictScore);
        deduped.push(scored[0]);
        log(`Conflict guard: ${player} had Over+Under — kept ${scored[0].prediction} (score=${scored[0].conflictScore.toFixed(1)})`);
      } else {
        // No conflict, keep all
        deduped.push(...alerts);
      }
    }

    if (deduped.length < 2) {
      log(`Only ${deduped.length} alerts after conflict dedup. Need at least 2.`);
      return new Response(JSON.stringify({ parlays: [], message: `Only ${deduped.length} after dedup` }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    log(`After conflict guard: ${deduped.length} alerts (was ${todayAlerts.length})`);

    // Step 3: Score and rank candidates
    const signalAccMap = new Map(bySignal.map(s => [s.signal_type, s]));
    
    const scored = todayAlerts.map(alert => {
      const signalAcc = signalAccMap.get(alert.signal_type);
      const accScore = signalAcc ? signalAcc.win_rate : 50;
      const confScore = (alert.confidence || 0) >= 80 ? 20 : 
                        (alert.confidence || 0) >= 60 ? 10 : 0;
      
      // L10 cross-reference bonus
      const l10HitRate = alert.metadata?.l10_hit_rate || 0.5;
      const predLower = (alert.prediction || '').toLowerCase();
      const isOver = predLower.includes('over');
      const l10Bonus = isOver ? (l10HitRate > 0.5 ? 15 : -10) : (l10HitRate < 0.3 ? 15 : -10);

      return {
        ...alert,
        composite_score: accScore + confScore + l10Bonus,
        signal_accuracy: accScore,
      };
    }).sort((a, b) => b.composite_score - a.composite_score);

    // Step 4: Build 2-3 leg parlays (diversified by player)
    const parlays: { legs: typeof scored; type: string }[] = [];
    const usedPlayers = new Set<string>();

    // Build primary 2-leg parlay
    const primary2Leg: typeof scored = [];
    for (const pick of scored) {
      if (usedPlayers.has(pick.player_name)) continue;
      if (primary2Leg.length >= 2) break;
      primary2Leg.push(pick);
      usedPlayers.add(pick.player_name);
    }
    if (primary2Leg.length === 2) {
      parlays.push({ legs: primary2Leg, type: '2-Leg RBI Lock' });
    }

    // Build 3-leg parlay if enough candidates
    if (scored.length >= 5) {
      const usedPlayers3 = new Set<string>();
      const threeleg: typeof scored = [];
      for (const pick of scored) {
        if (usedPlayers3.has(pick.player_name)) continue;
        if (threeleg.length >= 3) break;
        threeleg.push(pick);
        usedPlayers3.add(pick.player_name);
      }
      if (threeleg.length === 3) {
        parlays.push({ legs: threeleg, type: '3-Leg RBI Sniper' });
      }
    }

    if (parlays.length === 0) {
      log('Could not build any parlays with current candidates');
      return new Response(JSON.stringify({ parlays: [], message: 'Not enough diverse candidates' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Step 5: Format and send to Telegram
    const SIGNAL_DISPLAY: Record<string, string> = {
      velocity_spike: "Sharp Money Spike", cascade: "Sustained Line Move",
      line_about_to_move: "Early Line Signal", take_it_now: "Snapback Value",
      price_drift: "Steady Drift", trap_warning: "Trap Alert",
    };

    const parlayMessages: string[] = [];
    for (const parlay of parlays) {
      const legLines = parlay.legs.map((leg, i) => {
        const isOver = (leg.prediction || '').toUpperCase().includes('OVER');
        const sideEmoji = isOver ? '💪' : '🧊';
        const sideWord = isOver ? 'OVER' : 'UNDER';
        const line = leg.metadata?.line || 0.5;
        const l10Rate = leg.metadata?.l10_hit_rate;
        const l10Games = l10Rate != null ? Math.round(l10Rate * 10) : null;
        const pitcher = leg.metadata?.opposing_pitcher;
        const signalName = SIGNAL_DISPLAY[leg.signal_type] || leg.signal_type;

        // Build narrative
        let narrative = '';
        if (isOver && l10Games != null) {
          narrative = `${leg.player_name} has driven in a run in ${l10Games} of the last 10 games.`;
          if (leg.signal_type === 'price_drift') narrative += ' Line is drifting his way — books see it too.';
          else if (leg.signal_type === 'cascade') narrative += ' Sustained money pushing this over.';
        } else if (!isOver && l10Games != null) {
          const quietGames = 10 - (l10Games || 0);
          narrative = `${leg.player_name} has been quiet — 0 RBI in ${quietGames} of the last 10.`;
          if (pitcher) narrative += ` Facing ${pitcher} makes this even safer.`;
        } else {
          narrative = `${signalName} signal detected — ${leg.signal_accuracy}% historical accuracy on this pattern.`;
        }

        const l10Line = l10Games != null ? ` | L10: ${l10Games}/10 RBI games` : '';

        return [
          `${i === 0 ? '1️⃣' : i === 1 ? '2️⃣' : '3️⃣'} *${leg.player_name}* — ${sideWord} ${line} RBI`,
          `   ${sideEmoji} ${narrative}`,
          `   📊 ${leg.signal_accuracy}% signal accuracy${l10Line}`,
        ].join('\n');
      });

      parlayMessages.push(
        `⚾ *${parlay.type}*\n\n${legLines.join('\n\n')}`
      );
    }

    const telegramMsg = [
      `⚾ *RBI Parlay Picks*`,
      ``,
      ...parlayMessages,
      ``,
      `━━━━━━━━━━━━━━━`,
      `🎯 All legs backed by 60%+ proven signal types`,
      `_Based on ${dashboardData?.overall?.total_settled || 0} settled RBI picks_`,
    ].join('\n');

    try {
      await supabase.functions.invoke('bot-send-telegram', {
        body: { message: telegramMsg, parse_mode: 'Markdown', admin_only: true },
      });
      log('Telegram sent');
    } catch (_) {
      log('Telegram send failed (non-fatal)');
    }

    return new Response(JSON.stringify({ 
      parlays: parlays.map(p => ({
        type: p.type,
        legs: p.legs.map(l => ({
          player: l.player_name,
          prediction: l.prediction,
          signal: l.signal_type,
          accuracy: l.signal_accuracy,
          score: l.composite_score,
        }))
      })),
      qualifying_signals: bySignal,
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
