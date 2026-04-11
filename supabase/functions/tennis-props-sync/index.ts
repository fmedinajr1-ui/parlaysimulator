/**
 * tennis-props-sync
 * 
 * Bridges tennis total-games data from game_bets into unified_props
 * so that the tennis-games-analyzer can read it.
 * 
 * The whale-odds-scraper writes tennis totals to game_bets (team markets),
 * but the tennis analyzer reads from unified_props. This sync creates
 * synthetic unified_props rows from game_bets totals for tennis.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function getEasternDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);
  const log = (msg: string) => console.log(`[tennis-props-sync] ${msg}`);
  const today = getEasternDate();

  try {
    // Fetch active tennis totals from game_bets
    const { data: tennisBets, error: fetchErr } = await supabase
      .from('game_bets')
      .select('*')
      .in('sport', ['tennis_atp', 'tennis_wta'])
      .eq('bet_type', 'totals')
      .eq('is_active', true)
      .gte('commence_time', `${today}T00:00:00`);

    if (fetchErr) throw new Error(`game_bets fetch: ${fetchErr.message}`);

    const bets = tennisBets || [];
    log(`Found ${bets.length} active tennis totals in game_bets`);

    if (bets.length === 0) {
      return new Response(JSON.stringify({ success: true, synced: 0, message: 'No tennis totals today' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Deduplicate by game_id + bookmaker (keep latest)
    const seen = new Map<string, typeof bets[0]>();
    for (const b of bets) {
      const key = `${b.game_id}|${b.bookmaker}`;
      seen.set(key, b);
    }
    const unique = [...seen.values()];

    // Build unified_props rows — use home_team vs away_team as "player_name" 
    // (the tennis analyzer expects player names in the match description)
    const rows = unique.map(b => ({
      event_id: b.game_id,
      sport: b.sport,
      game_description: `${b.away_team} vs ${b.home_team}`,
      event_description: `${b.away_team} vs ${b.home_team}`,
      commence_time: b.commence_time,
      player_name: `${b.away_team} vs ${b.home_team}`,
      prop_type: 'total_games',
      bookmaker: b.bookmaker || 'fanduel',
      current_line: b.line,
      line: b.line,
      fanduel_line: b.bookmaker === 'fanduel' ? b.line : null,
      over_price: b.over_odds ? Number(b.over_odds) : -110,
      under_price: b.under_odds ? Number(b.under_odds) : -110,
      is_active: true,
      updated_at: new Date().toISOString(),
    }));

    // Upsert into unified_props
    const { error: upsertErr } = await supabase
      .from('unified_props')
      .upsert(rows, { onConflict: 'event_id,player_name,prop_type,bookmaker' });

    if (upsertErr) {
      log(`Upsert error: ${JSON.stringify(upsertErr)}`);
      throw new Error(`unified_props upsert: ${upsertErr.message}`);
    }

    log(`✅ Synced ${rows.length} tennis totals to unified_props`);

    return new Response(JSON.stringify({
      success: true,
      synced: rows.length,
      sports: { atp: rows.filter(r => r.sport === 'tennis_atp').length, wta: rows.filter(r => r.sport === 'tennis_wta').length },
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    log(`Fatal: ${error}`);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
