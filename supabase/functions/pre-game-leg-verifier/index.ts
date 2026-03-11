import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function getEasternDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
}

function nameSimilarity(name1: string, name2: string): number {
  const n1 = normalizeName(name1);
  const n2 = normalizeName(name2);
  if (!n1 || !n2 || n1.length < 2 || n2.length < 2) return 0;
  if (n1 === n2) return 1;
  if (n1.includes(n2) || n2.includes(n1)) return 0.9;
  const last1 = n1.split(' ').pop() || '';
  const last2 = n2.split(' ').pop() || '';
  if (last1 === last2 && last1.length > 2) return 0.7;
  return 0;
}

function americanToDecimal(american: number): number {
  if (american > 0) return (american / 100) + 1;
  return (100 / Math.abs(american)) + 1;
}

function decimalToAmerican(decimal: number): number {
  if (decimal >= 2) return Math.round((decimal - 1) * 100);
  return Math.round(-100 / (decimal - 1));
}

interface SwapRecord {
  parlayId: string;
  parlayStrategy: string;
  originalLeg: any;
  newLeg: any;
  reason: string;
}

interface DropRecord {
  parlayId: string;
  parlayStrategy: string;
  droppedPlayer: string;
  reason: string;
}

interface VoidRecord {
  parlayId: string;
  parlayStrategy: string;
  reason: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const today = getEasternDate();
    console.log(`[LegVerifier] Starting pre-game verification for ${today}`);

    // Fetch stake config for cap
    const { data: stakeConfig } = await supabase
      .from('bot_stake_config')
      .select('execution_stake')
      .limit(1)
      .single();

    const executionStakeCap = stakeConfig?.execution_stake || 250;
    console.log(`[LegVerifier] Execution stake cap: $${executionStakeCap}`);

    // Fetch today's pending parlays
    const { data: parlays, error: parlayError } = await supabase
      .from('bot_daily_parlays')
      .select('*')
      .eq('parlay_date', today)
      .or('outcome.is.null,outcome.eq.pending');

    if (parlayError) {
      throw new Error(`Failed to fetch parlays: ${parlayError.message}`);
    }

    if (!parlays || parlays.length === 0) {
      console.log('[LegVerifier] No pending parlays for today');
      return new Response(JSON.stringify({ success: true, message: 'No pending parlays', swaps: 0, voids: 0, drops: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[LegVerifier] Found ${parlays.length} pending parlays`);

    // Fetch fresh injury/lineup data
    const { data: alerts } = await supabase
      .from('lineup_alerts')
      .select('*')
      .eq('game_date', today);

    // Build sets of OUT/GTD players
    const outPlayers = new Map<string, { alertType: string; injuryNote: string }>();
    for (const alert of (alerts || [])) {
      const normalized = normalizeName(alert.player_name || '');
      if (['OUT', 'DOUBTFUL'].includes(alert.alert_type)) {
        outPlayers.set(normalized, {
          alertType: alert.alert_type,
          injuryNote: alert.injury_note || alert.details || 'Unknown injury',
        });
      }
    }

    console.log(`[LegVerifier] Found ${outPlayers.size} OUT/DOUBTFUL players`);

    // Process each parlay
    const swaps: SwapRecord[] = [];
    const drops: DropRecord[] = [];
    const voids: VoidRecord[] = [];
    let totalSwapped = 0;
    let totalDropped = 0;
    let totalVoided = 0;

    for (const parlay of parlays) {
      const legs = Array.isArray(parlay.legs) ? parlay.legs : JSON.parse(parlay.legs || '[]');
      let swapCount = 0;
      const updatedLegs = [...legs];
      const deadLegIndices: number[] = [];

      for (let i = 0; i < legs.length; i++) {
        const leg = legs[i];
        const playerName = leg.player_name || leg.playerName || leg.player || '';
        const normalizedPlayer = normalizeName(playerName);

        // Check if player is OUT/DOUBTFUL
        let matchedAlert: { alertType: string; injuryNote: string } | null = null;
        if (outPlayers.has(normalizedPlayer)) {
          matchedAlert = outPlayers.get(normalizedPlayer)!;
        } else {
          for (const [alertName, alertData] of outPlayers) {
            if (nameSimilarity(normalizedPlayer, alertName) >= 0.7) {
              matchedAlert = alertData;
              break;
            }
          }
        }

        if (!matchedAlert) continue;

        console.log(`[LegVerifier] ⚠️ ${playerName} is ${matchedAlert.alertType} — seeking swap`);

        // Try to find swap with STRICT criteria (minimumConfidence: 70)
        let swapped = false;
        try {
          const swapResponse = await fetch(`${supabaseUrl}/functions/v1/find-swap-alternatives`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseKey}`,
            },
            body: JSON.stringify({
              weakLeg: {
                description: `${playerName} ${leg.side || 'over'} ${leg.line} ${leg.prop_type}`,
                playerName,
                propType: leg.prop_type,
                line: leg.line,
                side: leg.side,
                sport: leg.sport || leg.category,
                currentOdds: leg.odds || leg.american_odds || -110,
              },
              minimumConfidence: 70,
            }),
          });

          const swapData = await swapResponse.json();

          if (swapData.success && swapData.alternatives && swapData.alternatives.length > 0) {
            const best = swapData.alternatives[0];

            // STRICT: only accept strong_upgrade or upgrade
            if (['strong_upgrade', 'upgrade'].includes(best.comparisonToOriginal?.recommendation)) {
              const newLeg = {
                ...leg,
                player_name: best.playerName,
                playerName: best.playerName,
                prop_type: best.propType,
                line: best.line,
                side: best.side,
                odds: best.estimatedOdds,
                american_odds: best.estimatedOdds,
                swap_source: best.source,
                swap_confidence: best.confidence,
                swapped_from: playerName,
                swap_reason: `${matchedAlert.alertType}: ${matchedAlert.injuryNote}`,
              };

              updatedLegs[i] = newLeg;
              swapCount++;
              swapped = true;

              swaps.push({
                parlayId: parlay.id,
                parlayStrategy: parlay.strategy_name,
                originalLeg: { player: playerName, prop: leg.prop_type, line: leg.line, side: leg.side },
                newLeg: { player: best.playerName, prop: best.propType, line: best.line, side: best.side, confidence: best.confidence },
                reason: `${matchedAlert.alertType}: ${matchedAlert.injuryNote}`,
              });

              console.log(`[LegVerifier] ✅ Swapped ${playerName} → ${best.playerName} (${best.confidence}% conf)`);
            }
          }
        } catch (swapErr) {
          console.error(`[LegVerifier] Swap fetch error for ${playerName}:`, swapErr);
        }

        // If no swap was made, mark this leg for dropping
        if (!swapped) {
          deadLegIndices.push(i);
          drops.push({
            parlayId: parlay.id,
            parlayStrategy: parlay.strategy_name,
            droppedPlayer: playerName,
            reason: `${matchedAlert.alertType}: ${matchedAlert.injuryNote}`,
          });
          console.log(`[LegVerifier] ❌ No viable swap for ${playerName} — marking for drop`);
        }
      }

      // Remove dead legs (iterate in reverse to preserve indices)
      const finalLegs = updatedLegs.filter((_, idx) => !deadLegIndices.includes(idx));
      const legsDropped = deadLegIndices.length;

      if (legsDropped > 0 || swapCount > 0) {
        if (finalLegs.length >= 2) {
          // Recalculate odds from remaining legs
          let combinedDecimalOdds = 1;
          for (const leg of finalLegs) {
            const legOdds = leg.odds || leg.american_odds || -110;
            combinedDecimalOdds *= americanToDecimal(legOdds);
          }
          const newExpectedOdds = decimalToAmerican(combinedDecimalOdds);

          // Raise stake: 1.5x for each dropped leg, capped at execution_stake
          const originalStake = parlay.simulated_stake || 50;
          const stakeMultiplier = 1 + (legsDropped * 0.5);
          const newStake = Math.min(Math.round(originalStake * stakeMultiplier), executionStakeCap);
          const newPayout = Math.round(newStake * combinedDecimalOdds * 100) / 100;

          const { error: updateError } = await supabase
            .from('bot_daily_parlays')
            .update({
              legs: finalLegs,
              leg_count: finalLegs.length,
              expected_odds: newExpectedOdds,
              legs_swapped: swapCount,
              simulated_stake: newStake,
              simulated_payout: newPayout,
              selection_rationale: `${parlay.selection_rationale || ''} | ${swapCount > 0 ? `${swapCount} swapped` : ''}${legsDropped > 0 ? ` ${legsDropped} dropped` : ''} pre-game → ${finalLegs.length}-leg @ $${newStake}`,
            })
            .eq('id', parlay.id);

          if (updateError) {
            console.error(`[LegVerifier] Failed to update parlay ${parlay.id}:`, updateError);
          } else {
            totalSwapped += swapCount;
            totalDropped += legsDropped;
            console.log(`[LegVerifier] Updated parlay ${parlay.id}: ${swapCount} swaps, ${legsDropped} drops → ${finalLegs.length}-leg @ $${newStake}`);
          }
        } else {
          // Fewer than 2 healthy legs — void
          await supabase
            .from('bot_daily_parlays')
            .update({
              outcome: 'void',
              lesson_learned: `Auto-voided: only ${finalLegs.length} healthy leg(s) remain after ${legsDropped} drops`,
            })
            .eq('id', parlay.id);

          voids.push({
            parlayId: parlay.id,
            parlayStrategy: parlay.strategy_name,
            reason: `Only ${finalLegs.length} healthy leg(s) remain — minimum 2 required`,
          });
          totalVoided++;
          console.log(`[LegVerifier] 🚫 Voided parlay ${parlay.id} — only ${finalLegs.length} healthy legs`);
        }
      }
    }

    // Broadcast summary to Telegram if any changes
    if (swaps.length > 0 || drops.length > 0 || voids.length > 0) {
      try {
        await fetch(`${supabaseUrl}/functions/v1/bot-send-telegram`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseKey}`,
          },
          body: JSON.stringify({
            type: 'leg_swap_report',
            data: { swaps, drops, voids, totalParlaysChecked: parlays.length },
          }),
        });
        console.log('[LegVerifier] Telegram swap report sent');
      } catch (tgErr) {
        console.error('[LegVerifier] Failed to send Telegram report:', tgErr);
      }
    }

    // Log the verification run
    await supabase.from('bot_activity_log').insert({
      event_type: 'pre_game_verification',
      message: `Verified ${parlays.length} parlays: ${totalSwapped} swapped, ${totalDropped} dropped, ${totalVoided} voided`,
      severity: totalVoided > 0 ? 'warning' : 'info',
      metadata: {
        date: today,
        parlaysChecked: parlays.length,
        legsSwapped: totalSwapped,
        legsDropped: totalDropped,
        parlaysVoided: totalVoided,
        outPlayersFound: outPlayers.size,
        swapDetails: swaps,
        dropDetails: drops,
        voidDetails: voids,
      },
    });

    console.log(`[LegVerifier] Complete: ${totalSwapped} swaps, ${totalDropped} drops, ${totalVoided} voids across ${parlays.length} parlays`);

    return new Response(JSON.stringify({
      success: true,
      summary: {
        parlaysChecked: parlays.length,
        legsSwapped: totalSwapped,
        legsDropped: totalDropped,
        parlaysVoided: totalVoided,
        outPlayersDetected: outPlayers.size,
      },
      swaps,
      drops,
      voids,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[LegVerifier] Error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
