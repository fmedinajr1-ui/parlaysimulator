/**
 * bot-daily-winners
 * 
 * Returns yesterday's verified winning picks from category_sweet_spots
 * with valid actual_line values. Used by landing page showcase and Telegram reports.
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Allow specifying a date, default to yesterday
    let targetDate: string;
    try {
      const body = await req.json();
      targetDate = body.date || getEasternDate(1);
    } catch {
      targetDate = getEasternDate(1);
    }

    console.log(`[DailyWinners] Fetching winners for ${targetDate}`);

    // Get all settled picks for target date with valid lines
    const { data: allPicks, error } = await supabase
      .from('category_sweet_spots')
      .select('player_name, prop_type, recommended_side, actual_line, recommended_line, actual_value, outcome, confidence_score, l10_hit_rate')
      .eq('analysis_date', targetDate)
      .not('actual_line', 'is', null)
      .in('outcome', ['hit', 'miss', 'push']);

    if (error) throw error;

    if (!allPicks || allPicks.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        date: targetDate,
        winners: [],
        totalHits: 0,
        totalPicks: 0,
        hitRate: 0,
        propBreakdown: {},
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const winners = allPicks
      .filter(p => p.outcome === 'hit')
      .map(p => ({
        playerName: p.player_name,
        propType: p.prop_type,
        side: p.recommended_side || 'over',
        line: p.actual_line ?? p.recommended_line,
        actualValue: p.actual_value,
        confidence: p.confidence_score,
        hitRate: p.l10_hit_rate,
      }));

    const totalHits = winners.length;
    const totalPicks = allPicks.length;
    const hitRate = totalPicks > 0 ? Math.round((totalHits / totalPicks) * 100) : 0;

    // Prop type breakdown
    const propBreakdown: Record<string, { hits: number; total: number; rate: number }> = {};
    for (const pick of allPicks) {
      const prop = (pick.prop_type || 'other').toUpperCase();
      if (!propBreakdown[prop]) propBreakdown[prop] = { hits: 0, total: 0, rate: 0 };
      propBreakdown[prop].total++;
      if (pick.outcome === 'hit') propBreakdown[prop].hits++;
    }
    for (const key of Object.keys(propBreakdown)) {
      propBreakdown[key].rate = Math.round((propBreakdown[key].hits / propBreakdown[key].total) * 100);
    }

    console.log(`[DailyWinners] ${totalHits}/${totalPicks} hits (${hitRate}%) for ${targetDate}`);

    return new Response(JSON.stringify({
      success: true,
      date: targetDate,
      winners,
      totalHits,
      totalPicks,
      hitRate,
      propBreakdown,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('[DailyWinners] Error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
