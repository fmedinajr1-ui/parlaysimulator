/**
 * manual-parlay-broadcast
 * 
 * Inserts curated parlay tickets into bot_daily_parlays and broadcasts
 * them to all customers via Telegram using mega_lottery_v2 format.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function americanToDecimal(odds: number): number {
  if (odds > 0) return (odds / 100) + 1;
  return (100 / Math.abs(odds)) + 1;
}

function decimalToAmerican(decimal: number): number {
  if (decimal >= 2) return Math.round((decimal - 1) * 100);
  return Math.round(-100 / (decimal - 1));
}

function getEasternDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { tickets } = await req.json();
    const today = getEasternDate();

    console.log(`[ManualBroadcast] Inserting ${tickets.length} tickets for ${today}`);

    // Insert all tickets into bot_daily_parlays
    const insertRows = tickets.map((ticket: any) => {
      const legs = ticket.legs.map((leg: any, idx: number) => ({
        leg_number: idx + 1,
        player_name: leg.player,
        prop_type: leg.prop,
        side: leg.side,
        line: leg.line,
        odds: leg.odds,
        outcome: 'pending',
      }));

      // Calculate combined decimal odds
      const combinedDecimal = legs.reduce((acc: number, leg: any) => {
        return acc * americanToDecimal(leg.odds);
      }, 1);

      const combinedAmerican = decimalToAmerican(combinedDecimal);
      const stake = ticket.stake || 10;
      const payout = Math.round(stake * combinedDecimal);

      return {
        parlay_date: today,
        strategy_name: 'manual_curated',
        tier: ticket.tier,
        leg_count: legs.length,
        legs,
        expected_odds: combinedAmerican,
        combined_probability: 1 / combinedDecimal,
        simulated_stake: stake,
        simulated_payout: payout,
        profit_loss: null,
        outcome: 'pending',
        approval_status: 'approved',
        is_simulated: true,
        selection_rationale: 'Manually curated by admin — engine-validated picks',
      };
    });

    const { data: inserted, error: insertError } = await supabase
      .from('bot_daily_parlays')
      .insert(insertRows)
      .select('id, tier, expected_odds, leg_count, simulated_stake, simulated_payout, legs');

    if (insertError) throw insertError;

    console.log(`[ManualBroadcast] Inserted ${inserted.length} tickets`);

    // Build telegram payload in mega_lottery_v2 format
    const telegramTickets = inserted.map((row: any) => {
      const legs = Array.isArray(row.legs) ? row.legs : [];
      return {
        tier: row.tier,
        combinedOdds: Math.abs(row.expected_odds),
        stake: row.simulated_stake,
        payout: row.simulated_payout,
        legs: legs.map((leg: any, idx: number) => ({
          leg: idx + 1,
          player: leg.player_name,
          side: (leg.side || 'over').toUpperCase().charAt(0),
          line: leg.line,
          prop: (leg.prop_type || '').replace('player_', ''),
          odds: leg.odds > 0 ? `+${leg.odds}` : `${leg.odds}`,
          market_type: 'player_prop',
        })),
      };
    });

    const telegramPayload = {
      type: 'mega_lottery_v2',
      data: {
        date: today,
        ticketCount: inserted.length,
        scanned: '13 curated',
        events: 'multi-game',
        exoticProps: 0,
        teamBets: 0,
        tickets: telegramTickets,
      },
    };

    console.log(`[ManualBroadcast] Broadcasting ${inserted.length} tickets via Telegram`);

    const telegramResp = await fetch(`${supabaseUrl}/functions/v1/bot-send-telegram`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(telegramPayload),
    });

    const telegramResult = await telegramResp.json();
    console.log(`[ManualBroadcast] Telegram result:`, telegramResult);

    return new Response(JSON.stringify({
      success: true,
      date: today,
      ticketsInserted: inserted.length,
      tickets: inserted.map((r: any) => ({
        id: r.id,
        tier: r.tier,
        odds: r.expected_odds,
        legs: r.leg_count,
        stake: r.simulated_stake,
        payout: r.simulated_payout,
      })),
      telegramSent: telegramResult.success,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('[ManualBroadcast] Error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
