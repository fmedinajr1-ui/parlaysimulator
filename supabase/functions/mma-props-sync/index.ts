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

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const today = getEasternDate();
  const log = (msg: string) => console.log(`[mma-props-sync] ${msg}`);

  try {
    log(`Syncing MMA totals from game_bets → unified_props for ${today}`);

    // Fetch MMA total bets from game_bets
    const { data: mmaBets, error: fetchErr } = await supabase
      .from('game_bets')
      .select('*')
      .ilike('sport', '%mma%')
      .eq('bet_type', 'total')
      .gte('commence_time', `${today}T00:00:00`);

    if (fetchErr) throw new Error(`game_bets fetch: ${fetchErr.message}`);

    const bets = mmaBets || [];
    log(`Found ${bets.length} MMA total bets in game_bets`);

    if (bets.length === 0) {
      // Try broader sport match
      const { data: allMma } = await supabase
        .from('game_bets')
        .select('sport, bet_type, home_team, away_team')
        .or('sport.ilike.%mma%,sport.ilike.%ufc%,sport.ilike.%martial%')
        .gte('commence_time', `${today}T00:00:00`)
        .limit(20);

      log(`Broader MMA search found ${allMma?.length || 0} rows: ${JSON.stringify(allMma?.map(r => ({ sport: r.sport, type: r.bet_type, matchup: `${r.away_team} vs ${r.home_team}` })))}`);

      return new Response(JSON.stringify({
        success: true, synced: 0,
        message: 'No MMA totals found today',
        broader_search: allMma?.length || 0,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Deduplicate by game_id + bookmaker (keep latest)
    const seen = new Map<string, typeof bets[0]>();
    for (const b of bets) {
      const key = `${b.game_id}|${b.bookmaker}`;
      if (!seen.has(key)) seen.set(key, b);
    }
    const unique = [...seen.values()];
    log(`${unique.length} unique fight+bookmaker combos`);

    // Build unified_props rows
    const rows = unique.map(b => ({
      event_id: b.game_id || `mma_${b.home_team}_${b.away_team}_${today}`,
      sport: 'mma_mixed_martial_arts',
      game_description: `${b.away_team} vs ${b.home_team}`,
      commence_time: b.commence_time,
      player_name: `${b.away_team} vs ${b.home_team}`,
      prop_type: 'total_rounds',
      bookmaker: b.bookmaker || 'consensus',
      current_line: b.line,
      over_price: b.over_odds || -110,
      under_price: b.under_odds || -110,
      is_active: true,
      updated_at: new Date().toISOString(),
    }));

    const { error: upsertErr } = await supabase
      .from('unified_props')
      .upsert(rows, { onConflict: 'event_id,player_name,prop_type,bookmaker' });

    if (upsertErr) throw new Error(`unified_props upsert: ${upsertErr.message}`);

    log(`✅ Synced ${rows.length} MMA fights to unified_props`);

    // Bookmaker breakdown
    const byBook: Record<string, number> = {};
    for (const r of rows) byBook[r.bookmaker] = (byBook[r.bookmaker] || 0) + 1;

    return new Response(JSON.stringify({
      success: true,
      synced: rows.length,
      bookmaker_breakdown: byBook,
      sample: rows.slice(0, 5).map(r => ({
        fight: r.player_name,
        line: r.current_line,
        book: r.bookmaker,
      })),
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`❌ Error: ${msg}`);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
