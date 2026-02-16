import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );

  try {
    // Get daily P&L from activation status (public aggregate data)
    const { data: dailyData } = await supabase
      .from('bot_activation_status')
      .select('check_date, daily_profit_loss, parlays_won, parlays_lost, parlays_generated, is_profitable_day, simulated_bankroll')
      .order('check_date', { ascending: true });

    if (!dailyData || dailyData.length === 0) {
      return new Response(JSON.stringify({ days: [], totals: {} }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Calculate totals
    let totalProfit = 0;
    let totalWins = 0;
    let totalLosses = 0;
    let profitableDays = 0;
    let losingDays = 0;
    let bestDay = { date: '', profit: -Infinity };
    let currentStreak = 0;
    let streakType = '';

    const calendarDays = dailyData.map((day) => {
      const pnl = day.daily_profit_loss || 0;
      totalProfit += pnl;
      totalWins += day.parlays_won || 0;
      totalLosses += day.parlays_lost || 0;

      if (pnl > 0) {
        profitableDays++;
        if (streakType === 'win') currentStreak++;
        else { currentStreak = 1; streakType = 'win'; }
      } else if (pnl < 0) {
        losingDays++;
        if (streakType === 'loss') currentStreak++;
        else { currentStreak = 1; streakType = 'loss'; }
      }

      if (pnl > bestDay.profit) bestDay = { date: day.check_date, profit: pnl };

      return {
        date: day.check_date,
        profitLoss: pnl,
        won: day.parlays_won || 0,
        lost: day.parlays_lost || 0,
        generated: day.parlays_generated || 0,
        isProfitable: pnl > 0,
      };
    });

    const totalParlays = totalWins + totalLosses;
    const winRate = totalParlays > 0 ? ((totalWins / totalParlays) * 100).toFixed(1) : '0';
    const totalStaked = totalParlays * 100; // $100 per parlay
    const roi = totalStaked > 0 ? ((totalProfit / totalStaked) * 100).toFixed(1) : '0';

    return new Response(JSON.stringify({
      days: calendarDays,
      totals: {
        totalProfit: Math.round(totalProfit * 100) / 100,
        totalWins,
        totalLosses,
        winRate: parseFloat(winRate),
        roi: parseFloat(roi),
        daysActive: dailyData.length,
        profitableDays,
        losingDays,
        bestDay,
        currentStreak,
        streakType,
        currentBankroll: dailyData[dailyData.length - 1]?.simulated_bankroll || 0,
      },
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
