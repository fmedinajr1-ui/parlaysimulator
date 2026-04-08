import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SPORT = 'baseball_mlb';
const MARKET = 'batter_rbis';
const BOOKMAKER = 'hardrockbet';

async function fetchWithTimeout(url: string, timeoutMs = 10000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const apiKey = Deno.env.get('THE_ODDS_API_KEY');
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'THE_ODDS_API_KEY not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const log = (msg: string) => console.log(`[hrb-rbi-scanner] ${msg}`);

  try {
    // Step 1: Fetch MLB events
    const eventsUrl = `https://api.the-odds-api.com/v4/sports/${SPORT}/odds?apiKey=${apiKey}&regions=us&markets=h2h&oddsFormat=american&bookmakers=${BOOKMAKER}`;
    const eventsRes = await fetchWithTimeout(eventsUrl);
    if (!eventsRes.ok) {
      const t = await eventsRes.text();
      throw new Error(`Events API error ${eventsRes.status}: ${t}`);
    }
    const events: any[] = await eventsRes.json();
    log(`Got ${events.length} MLB events`);

    // Filter to upcoming games only (within 24h)
    const now = new Date();
    const cutoff = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const upcomingEvents = events.filter(e => {
      const ct = new Date(e.commence_time);
      return ct > now && ct < cutoff;
    });
    log(`${upcomingEvents.length} upcoming events within 24h`);

    // Determine snapshot phase
    const currentHourET = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' })).getHours();
    const snapshotPhase = currentHourET < 12 ? 'morning_open' : currentHourET < 17 ? 'afternoon' : 'pre_game';

    // Step 2: Fetch RBI props per event
    const allSnapshots: any[] = [];

    for (const event of upcomingEvents) {
      const gameLabel = `${event.away_team} @ ${event.home_team}`;
      const propsUrl = `https://api.the-odds-api.com/v4/sports/${SPORT}/events/${event.id}/odds?apiKey=${apiKey}&regions=us&markets=${MARKET}&oddsFormat=american&bookmakers=${BOOKMAKER}`;

      try {
        const propsRes = await fetchWithTimeout(propsUrl, 8000);
        if (!propsRes.ok) {
          const t = await propsRes.text();
          log(`Props error for ${event.id}: ${propsRes.status} ${t}`);
          continue;
        }
        const propsData = await propsRes.json();

        for (const bm of (propsData.bookmakers || [])) {
          if (bm.key !== BOOKMAKER) continue;
          for (const market of (bm.markets || [])) {
            if (market.key !== MARKET) continue;

            // Group outcomes by player (description)
            const playerOutcomes: Record<string, any[]> = {};
            for (const outcome of (market.outcomes || [])) {
              const playerName = outcome.description || outcome.name;
              if (!playerOutcomes[playerName]) playerOutcomes[playerName] = [];
              playerOutcomes[playerName].push(outcome);
            }

            for (const [playerName, outcomes] of Object.entries(playerOutcomes)) {
              const overOutcome = outcomes.find((o: any) => o.name === 'Over');
              const underOutcome = outcomes.find((o: any) => o.name === 'Under');
              const line = overOutcome?.point ?? underOutcome?.point;
              if (line == null) continue;

              // Lookup opening line from earliest snapshot
              const { data: openSnap } = await supabase
                .from('hrb_rbi_line_timeline')
                .select('line, over_price, under_price')
                .eq('event_id', event.id)
                .eq('player_name', playerName)
                .order('snapshot_time', { ascending: true })
                .limit(1);

              const openingLine = openSnap?.[0]?.line ?? null;
              const openingOverPrice = openSnap?.[0]?.over_price ?? null;
              const openingUnderPrice = openSnap?.[0]?.under_price ?? null;
              const lineChange = openingLine != null ? line - Number(openingLine) : null;
              const overPrice = overOutcome?.price ?? null;
              const underPrice = underOutcome?.price ?? null;
              const priceChange = openingOverPrice != null && overPrice != null
                ? overPrice - Number(openingOverPrice) : null;

              // Compute drift velocity from last 2 snapshots
              let driftVelocity: number | null = null;
              const { data: recentSnaps } = await supabase
                .from('hrb_rbi_line_timeline')
                .select('line, snapshot_time')
                .eq('event_id', event.id)
                .eq('player_name', playerName)
                .order('snapshot_time', { ascending: false })
                .limit(2);

              if (recentSnaps && recentSnaps.length >= 1) {
                const lastSnap = recentSnaps[0];
                const timeDiffMin = (now.getTime() - new Date(lastSnap.snapshot_time).getTime()) / 60000;
                if (timeDiffMin > 0) {
                  driftVelocity = (line - Number(lastSnap.line)) / timeDiffMin;
                }
              }

              // Hours to tip
              const hoursToTip = (new Date(event.commence_time).getTime() - now.getTime()) / 3600000;

              allSnapshots.push({
                event_id: event.id,
                player_name: playerName,
                prop_type: MARKET,
                line,
                over_price: overPrice,
                under_price: underPrice,
                opening_line: openingLine ?? line,
                opening_over_price: openingOverPrice ?? overPrice,
                opening_under_price: openingUnderPrice ?? underPrice,
                line_change_from_open: lineChange ?? 0,
                price_change_from_open: priceChange ?? 0,
                drift_velocity: driftVelocity ?? 0,
                snapshot_phase: snapshotPhase,
                snapshot_time: now.toISOString(),
                hours_to_tip: Math.round(hoursToTip * 100) / 100,
                event_description: gameLabel,
                commence_time: event.commence_time,
                sport: 'MLB',
              });
            }
          }
        }
      } catch (err) {
        log(`Timeout/error for event ${event.id}: ${err}`);
      }
    }

    // Step 3: Insert snapshots
    if (allSnapshots.length > 0) {
      const { error: insertErr } = await supabase
        .from('hrb_rbi_line_timeline')
        .insert(allSnapshots);
      if (insertErr) {
        log(`Insert error: ${JSON.stringify(insertErr)}`);
      } else {
        log(`Inserted ${allSnapshots.length} RBI snapshots`);
      }
    }

    // Step 4: Cleanup old data (30 days)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { error: delErr } = await supabase
      .from('hrb_rbi_line_timeline')
      .delete()
      .lt('snapshot_time', thirtyDaysAgo);
    if (delErr) log(`Cleanup error: ${JSON.stringify(delErr)}`);

    return new Response(JSON.stringify({
      success: true,
      events_scanned: upcomingEvents.length,
      snapshots_inserted: allSnapshots.length,
      phase: snapshotPhase,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    log(`Fatal: ${error}`);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
