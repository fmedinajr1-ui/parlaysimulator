import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
    const sb = createClient(supabaseUrl, supabaseKey);

    const today = getEasternDate();
    console.log(`[broadcast-sweet-spots] Querying picks for ${today}`);

    const { data: picks, error } = await sb
      .from('category_sweet_spots')
      .select('player_name, prop_type, category, recommended_side, recommended_line, confidence_score, l10_hit_rate, l10_avg, l3_avg, quality_tier')
      .eq('analysis_date', today)
      .eq('is_active', true)
      .gte('confidence_score', 70)
      .order('confidence_score', { ascending: false })
      .limit(25);

    if (error) {
      console.error('[broadcast-sweet-spots] Query error:', error);
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
    }

    if (!picks || picks.length === 0) {
      console.log('[broadcast-sweet-spots] No qualifying picks found');
      return new Response(JSON.stringify({ success: true, skipped: true, reason: 'no_picks' }), { headers: corsHeaders });
    }

    // Cap at 20
    const topPicks = picks.slice(0, 20);

    console.log(`[broadcast-sweet-spots] Sending ${topPicks.length} picks to Telegram`);

    const resp = await fetch(`${supabaseUrl}/functions/v1/bot-send-telegram`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'sweet_spots_broadcast',
        admin_only: true,
        data: {
          picks: topPicks,
          date: today,
          total_found: picks.length,
        },
      }),
    });

    const result = await resp.json();
    console.log(`[broadcast-sweet-spots] Telegram result:`, result);

    return new Response(JSON.stringify({
      success: true,
      picks_sent: topPicks.length,
      total_qualifying: picks.length,
      telegram: result,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    console.error('[broadcast-sweet-spots] Error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
