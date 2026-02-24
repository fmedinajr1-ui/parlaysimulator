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
      { player_name: 'Carlton Carrington', prop_type: 'threes', side: 'over', line: 1.5, edge_note: '80.3% edge | Avg 2.6' },
      { player_name: 'Joel Embiid', prop_type: 'assists', side: 'over', line: 3.5, edge_note: 'High floor | Avg 5.8' },
      { player_name: 'Jarrett Allen', prop_type: 'rebounds', side: 'over', line: 8.5, edge_note: '25% edge | Avg 11.3' },
      { player_name: 'Andrew Nembhard', prop_type: 'assists', side: 'over', line: 6.5, edge_note: 'Volume play | Avg 8.4' },
      { player_name: 'Kyshawn George', prop_type: 'assists', side: 'over', line: 2.5, edge_note: 'Low line | Avg 3.2' },
      { player_name: 'Kam Jones', prop_type: 'points', side: 'under', line: 8.5, edge_note: 'Contrarian | Avg 5.2' },
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
        selection_rationale: 'Modeled after Feb 9 +4741 winner. Low-line volume plays + star floors + contrarian under.',
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
