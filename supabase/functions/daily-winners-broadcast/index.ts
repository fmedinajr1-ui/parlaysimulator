/**
 * daily-winners-broadcast
 * 
 * Pulls yesterday's winning parlays from bot_daily_parlays,
 * formats a customer-friendly recap, and broadcasts via Telegram.
 * Accepts optional { date: "YYYY-MM-DD" } to run for a specific date.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function getEasternDate(daysAgo = 0): string {
  const now = new Date();
  now.setDate(now.getDate() - daysAgo);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function formatDisplayDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getDayRating(winnerCount: number, totalProfit: number): string {
  if (winnerCount >= 6 || totalProfit >= 3000) return 'Excellent Day';
  if (winnerCount >= 4 || totalProfit >= 1500) return 'Solid Day';
  if (winnerCount >= 2 || totalProfit >= 500) return 'Decent Day';
  return 'Quiet Day';
}

function formatOdds(odds: number): string {
  return odds > 0 ? `+${odds}` : `${odds}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    let targetDate: string;
    try {
      const body = await req.json();
      targetDate = body.date || getEasternDate(1);
    } catch {
      targetDate = getEasternDate(1);
    }

    console.log(`[DailyWinnersBroadcast] Fetching winners for ${targetDate}`);

    const { data: winners, error } = await supabase
      .from('bot_daily_parlays')
      .select('strategy_name, tier, expected_odds, profit_loss, legs, simulated_stake, legs_hit, legs_missed, legs_voided')
      .eq('parlay_date', targetDate)
      .eq('outcome', 'won')
      .order('profit_loss', { ascending: false });

    // Helper for payout calculation
    function calculatePayout(odds: number, stake: number): number {
      const decimalOdds = odds > 0 ? (odds / 100) + 1 : (100 / Math.abs(odds)) + 1;
      return Math.round(stake * decimalOdds);
    }

    if (error) throw error;

    if (!winners || winners.length === 0) {
      console.log(`[DailyWinnersBroadcast] No winners for ${targetDate}, skipping broadcast`);
      return new Response(JSON.stringify({ 
        success: true, 
        skipped: true, 
        reason: 'no_winners',
        date: targetDate 
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const totalProfit = winners.reduce((sum, w) => sum + (w.profit_loss || 0), 0);
    const displayDate = formatDisplayDate(targetDate);
    const rating = getDayRating(winners.length, totalProfit);

    // Build structured data for the formatter
    const winnersData = winners.slice(0, 10).map((w, idx) => {
      const legs = Array.isArray(w.legs) ? w.legs : [];
      const tierLabel = (w.tier || 'exploration').charAt(0).toUpperCase() + (w.tier || 'exploration').slice(1);
      const isLottery = w.strategy_name === 'mega_lottery_scanner';
      const odds = Math.round(w.expected_odds || 0);
      const stake = Math.round(w.simulated_stake || 0);
      const payout = calculatePayout(odds, stake);
      
      return {
        rank: idx + 1,
        tier: tierLabel,
        odds: formatOdds(odds),
        profit: Math.round(w.profit_loss || 0),
        isLottery,
        stake,
        payout,
        legs: legs.map((leg: any) => ({
          player: leg.player_name || leg.player || 'Unknown',
          prop: (leg.prop_type || '').toUpperCase().replace('PLAYER_', '').replace(/_/g, ' '),
          side: (leg.side || 'over').toUpperCase().charAt(0),
          line: leg.line || 0,
          actual: leg.actual_value,
          outcome: leg.outcome || 'hit',
        })),
      };
    });

    // Separate lottery winners for dedicated highlight section
    const lotteryWinners = winnersData.filter(w => w.isLottery);

    // Extract key players (most frequent across winners)
    const playerCounts: Record<string, { count: number; prop: string }> = {};
    for (const w of winnersData) {
      for (const leg of w.legs) {
        const key = leg.player;
        if (!playerCounts[key]) playerCounts[key] = { count: 0, prop: leg.prop };
        playerCounts[key].count++;
      }
    }
    const keyPlayers = Object.entries(playerCounts)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 3)
      .map(([name, { prop }]) => `${name.split(' ').pop()} (${prop})`);

    // Send to bot-send-telegram
    const telegramPayload = {
      type: 'daily_winners_recap',
      data: {
        date: displayDate,
        rating,
        winnerCount: winners.length,
        totalProfit: Math.round(totalProfit),
        winners: winnersData,
        lotteryWinners,
        keyPlayers,
      },
    };

    console.log(`[DailyWinnersBroadcast] Sending ${winners.length} winners to Telegram`);

    const telegramResp = await fetch(`${supabaseUrl}/functions/v1/bot-send-telegram`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(telegramPayload),
    });

    const telegramResult = await telegramResp.json();

    console.log(`[DailyWinnersBroadcast] Telegram response:`, telegramResult);

    return new Response(JSON.stringify({
      success: true,
      date: targetDate,
      winnerCount: winners.length,
      totalProfit: Math.round(totalProfit),
      telegramSent: telegramResult.success,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('[DailyWinnersBroadcast] Error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
