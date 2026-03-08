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
  if (n1 === n2) return 1;
  if (n1.includes(n2) || n2.includes(n1)) return 0.9;
  const last1 = n1.split(' ').pop() || '';
  const last2 = n2.split(' ').pop() || '';
  if (last1 === last2 && last1.length > 2) return 0.7;
  return 0;
}

interface SwapRecord {
  parlayId: string;
  parlayStrategy: string;
  originalLeg: any;
  newLeg: any;
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

    // Step 1: Fetch today's pending parlays
    // Fetch pending parlays (outcome is NULL or 'pending')
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
      return new Response(JSON.stringify({ success: true, message: 'No pending parlays', swaps: 0, voids: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[LegVerifier] Found ${parlays.length} pending parlays`);

    // Step 2: Fetch fresh injury/lineup data
    const { data: alerts } = await supabase
      .from('lineup_alerts')
      .select('*')
      .eq('game_date', today);

    const { data: lineups } = await supabase
      .from('starting_lineups')
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

    // Step 3: Check each parlay's legs
    const swaps: SwapRecord[] = [];
    const voids: VoidRecord[] = [];
    let totalSwapped = 0;
    let totalVoided = 0;

    for (const parlay of parlays) {
      const legs = Array.isArray(parlay.legs) ? parlay.legs : JSON.parse(parlay.legs || '[]');
      let swapCount = 0;
      const updatedLegs = [...legs];
      const swapAudit: any[] = [];

      for (let i = 0; i < legs.length; i++) {
        const leg = legs[i];
        const playerName = leg.player_name || leg.playerName || '';
        const normalizedPlayer = normalizeName(playerName);

        // Check if player is OUT/DOUBTFUL
        let matchedAlert: { alertType: string; injuryNote: string } | null = null;
        
        // Direct match
        if (outPlayers.has(normalizedPlayer)) {
          matchedAlert = outPlayers.get(normalizedPlayer)!;
        } else {
          // Fuzzy match
          for (const [alertName, alertData] of outPlayers) {
            if (nameSimilarity(normalizedPlayer, alertName) >= 0.7) {
              matchedAlert = alertData;
              break;
            }
          }
        }

        if (!matchedAlert) continue;

        console.log(`[LegVerifier] ⚠️ ${playerName} is ${matchedAlert.alertType} — seeking swap`);

        // Find swap alternative via the existing edge function
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
              minimumConfidence: 65,
            }),
          });

          const swapData = await swapResponse.json();

          if (swapData.success && swapData.alternatives && swapData.alternatives.length > 0) {
            // Pick best alternative (already sorted by confidence)
            const best = swapData.alternatives[0];
            
            // Only swap if it's an upgrade or strong_upgrade
            if (['strong_upgrade', 'upgrade', 'slight_upgrade'].includes(best.comparisonToOriginal?.recommendation)) {
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

              const swapRecord: SwapRecord = {
                parlayId: parlay.id,
                parlayStrategy: parlay.strategy_name,
                originalLeg: { player: playerName, prop: leg.prop_type, line: leg.line, side: leg.side },
                newLeg: { player: best.playerName, prop: best.propType, line: best.line, side: best.side, confidence: best.confidence },
                reason: `${matchedAlert.alertType}: ${matchedAlert.injuryNote}`,
              };
              swaps.push(swapRecord);
              swapAudit.push(swapRecord);

              console.log(`[LegVerifier] ✅ Swapped ${playerName} → ${best.playerName} (${best.confidence}% conf)`);
            }
          } else {
            console.log(`[LegVerifier] ❌ No suitable swap for ${playerName}`);
          }
        } catch (swapErr) {
          console.error(`[LegVerifier] Swap fetch error for ${playerName}:`, swapErr);
        }
      }

      // Update the parlay if any swaps were made
      if (swapCount > 0) {
        const existingMetadata = (parlay.metadata || {}) as Record<string, any>;
        
        const { error: updateError } = await supabase
          .from('bot_daily_parlays')
          .update({
            legs: updatedLegs,
            legs_swapped: swapCount,
            selection_rationale: `${parlay.selection_rationale || ''} | ${swapCount} leg(s) auto-swapped pre-game`,
          })
          .eq('id', parlay.id);

        if (updateError) {
          console.error(`[LegVerifier] Failed to update parlay ${parlay.id}:`, updateError);
        } else {
          totalSwapped += swapCount;
          console.log(`[LegVerifier] Updated parlay ${parlay.id} with ${swapCount} swaps`);
        }
      }

      // Check if too many legs are flagged with no swap — void the parlay
      const flaggedNoSwap = legs.filter((leg: any, idx: number) => {
        const name = normalizeName(leg.player_name || leg.playerName || '');
        const isOut = outPlayers.has(name) || [...outPlayers.keys()].some(k => nameSimilarity(name, k) >= 0.7);
        return isOut && updatedLegs[idx] === legs[idx]; // No swap was made
      });

      if (flaggedNoSwap.length > 0 && flaggedNoSwap.length >= Math.ceil(legs.length / 2)) {
        // Void the parlay — too many dead legs with no swaps
        await supabase
          .from('bot_daily_parlays')
          .update({
            outcome: 'void',
            lesson_learned: `Auto-voided: ${flaggedNoSwap.length}/${legs.length} legs have OUT/DOUBTFUL players with no viable swap`,
          })
          .eq('id', parlay.id);

        voids.push({
          parlayId: parlay.id,
          parlayStrategy: parlay.strategy_name,
          reason: `${flaggedNoSwap.length}/${legs.length} legs OUT with no swap available`,
        });
        totalVoided++;
        console.log(`[LegVerifier] 🚫 Voided parlay ${parlay.id} — ${flaggedNoSwap.length} dead legs`);
      }
    }

    // Step 4: Broadcast summary to Telegram if any changes were made
    if (swaps.length > 0 || voids.length > 0) {
      try {
        await fetch(`${supabaseUrl}/functions/v1/bot-send-telegram`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseKey}`,
          },
          body: JSON.stringify({
            type: 'leg_swap_report',
            data: { swaps, voids, totalParlaysChecked: parlays.length },
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
      message: `Verified ${parlays.length} parlays: ${totalSwapped} legs swapped, ${totalVoided} parlays voided`,
      severity: totalVoided > 0 ? 'warning' : 'info',
      metadata: {
        date: today,
        parlaysChecked: parlays.length,
        legsSwapped: totalSwapped,
        parlaysVoided: totalVoided,
        outPlayersFound: outPlayers.size,
        swapDetails: swaps,
        voidDetails: voids,
      },
    });

    console.log(`[LegVerifier] Complete: ${totalSwapped} swaps, ${totalVoided} voids across ${parlays.length} parlays`);

    return new Response(JSON.stringify({
      success: true,
      summary: {
        parlaysChecked: parlays.length,
        legsSwapped: totalSwapped,
        parlaysVoided: totalVoided,
        outPlayersDetected: outPlayers.size,
      },
      swaps,
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
