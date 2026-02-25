import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get today's date in Eastern Time
    const now = new Date();
    const todayET = now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

    const legs = [
      { player_name: 'Jaylen Wells', prop_type: 'assists', side: 'over', line: 0.5, edge_note: '280% edge | L10 Avg 1.9 | Ultra-safe 0.5 line' },
      { player_name: 'Cade Cunningham', prop_type: 'blocks', side: 'over', line: 0.5, edge_note: '163% edge | L10 Avg 1.4 | Star floor' },
      { player_name: 'Ausar Thompson', prop_type: 'steals', side: 'over', line: 1.5, edge_note: '63% edge | L10 Avg 2.6 | Strong volume' },
      { player_name: 'Daniss Jenkins', prop_type: 'rebounds', side: 'over', line: 1.5, edge_note: '62% edge | L10 Avg 2.5 | Consistent floor' },
      { player_name: 'Cason Wallace', prop_type: 'steals', side: 'over', line: 1.5, edge_note: '59% edge | L10 Avg 2.3 | High volume defender' },
      { player_name: 'Duncan Robinson', prop_type: 'threes', side: 'over', line: 2.5, edge_note: '35% edge | L10 Avg 3.6 | Sharpshooter odds multiplier' },
    ];

    // Insert into bot_daily_parlays
    const { data: parlay, error: insertError } = await supabase
      .from('bot_daily_parlays')
      .insert({
        strategy_name: 'explore_longshot',
        tier: 'exploration',
        leg_count: 6,
        parlay_date: todayET,
        expected_odds: 4700,
        simulated_stake: 100,
        combined_probability: 0.02,
        outcome: 'pending',
        legs,
        selection_rationale: 'V2 — All high-floor OVERS only. No contrarian unders (lesson from Feb 24 miss). 60%+ mispriced edge on 5/6 legs. Every L10 avg comfortably clears line.',
      })
      .select()
      .single();

    if (insertError) {
      console.error('[Longshot] Insert error:', insertError);
      return new Response(JSON.stringify({ success: false, error: insertError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('[Longshot] Parlay inserted:', parlay.id);

    // Trigger Telegram broadcast
    const telegramResp = await fetch(`${supabaseUrl}/functions/v1/bot-send-telegram`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({
        type: 'longshot_announcement',
        data: {
          legs,
          expected_odds: 4700,
          parlay_id: parlay.id,
        },
      }),
    });

    const telegramResult = await telegramResp.json();
    console.log('[Longshot] Telegram broadcast result:', telegramResult);

    return new Response(
      JSON.stringify({ success: true, parlay_id: parlay.id, telegram: telegramResult }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[Longshot] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
