/**
 * hrb-nrfi-scanner
 * 
 * Scans Hard Rock Bet for MLB first-inning totals (NRFI = Under 0.5).
 * Cross-references pitcher K lines from unified_props as a proxy for starter quality.
 * Writes qualifying picks to category_sweet_spots and sends Telegram alert.
 * 
 * Filters:
 *  - Under 0.5 odds ≥ -130 (value territory), OR
 *  - Both starters have K lines ≥ 5.5 (elite pitcher matchup)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SPORT = 'baseball_mlb';
const BOOKMAKER = 'hardrockbet';
const MARKET = 'totals_1st_1_innings';

function getEasternDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

async function fetchWithTimeout(url: string, timeoutMs = 10000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { signal: controller.signal }); }
  finally { clearTimeout(id); }
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
  const log = (msg: string) => console.log(`[hrb-nrfi] ${msg}`);
  const today = getEasternDate();

  try {
    // Step 1: Fetch MLB events from HRB
    const eventsUrl = `https://api.the-odds-api.com/v4/sports/${SPORT}/odds?apiKey=${apiKey}&regions=us&markets=h2h&oddsFormat=american&bookmakers=${BOOKMAKER}`;
    const eventsRes = await fetchWithTimeout(eventsUrl);
    if (!eventsRes.ok) throw new Error(`Events API ${eventsRes.status}: ${await eventsRes.text()}`);
    const events: any[] = await eventsRes.json();

    // Filter to today's games (within 24h)
    const now = new Date();
    const cutoff = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const upcoming = events.filter(e => {
      const ct = new Date(e.commence_time);
      return ct > now && ct < cutoff;
    });
    log(`${upcoming.length} MLB games within 24h`);

    // Step 2: Load pitcher K lines from unified_props for quality proxy
    const { data: pitcherProps } = await supabase
      .from('unified_props')
      .select('player_name, line, event_description')
      .eq('sport', SPORT)
      .eq('prop_type', 'pitcher_strikeouts')
      .eq('is_active', true)
      .gte('commence_time', `${today}T00:00:00`);

    // Build pitcher K line lookup: matchup_key -> { home_k, away_k, home_pitcher, away_pitcher }
    const pitcherByGame = new Map<string, { pitcher: string; kLine: number }[]>();
    for (const p of (pitcherProps || [])) {
      const desc = p.event_description || '';
      if (!pitcherByGame.has(desc)) pitcherByGame.set(desc, []);
      pitcherByGame.get(desc)!.push({ pitcher: p.player_name, kLine: Number(p.line) });
    }

    // Step 3: Fetch first-inning totals per event
    const nrfiPicks: any[] = [];

    for (const event of upcoming) {
      const gameLabel = `${event.away_team} @ ${event.home_team}`;
      const url = `https://api.the-odds-api.com/v4/sports/${SPORT}/events/${event.id}/odds?apiKey=${apiKey}&regions=us&markets=${MARKET}&oddsFormat=american&bookmakers=${BOOKMAKER}`;

      try {
        const res = await fetchWithTimeout(url, 8000);
        if (!res.ok) { log(`Skip ${event.id}: HTTP ${res.status}`); continue; }
        const data = await res.json();

        for (const bm of (data.bookmakers || [])) {
          if (bm.key !== BOOKMAKER) continue;
          for (const market of (bm.markets || [])) {
            if (market.key !== MARKET) continue;

            const overOutcome = market.outcomes?.find((o: any) => o.name === 'Over');
            const underOutcome = market.outcomes?.find((o: any) => o.name === 'Under');
            if (!underOutcome) continue;

            const underLine = underOutcome.point ?? 0.5;
            const underOdds = underOutcome.price;
            const overOdds = overOutcome?.price ?? null;

            // Look up pitcher K lines for this game
            const pitchers = pitcherByGame.get(gameLabel) || [];
            const sortedPitchers = pitchers.sort((a, b) => b.kLine - a.kLine);
            const hasElitePitchers = sortedPitchers.length >= 2 && sortedPitchers[0].kLine >= 5.5 && sortedPitchers[1].kLine >= 5.5;
            const hasValueOdds = underOdds >= -130;

            // Filter: value odds OR elite pitcher matchup
            if (!hasValueOdds && !hasElitePitchers) {
              log(`Skip ${gameLabel}: Under @ ${underOdds}, pitchers don't qualify`);
              continue;
            }

            const reason = hasElitePitchers
              ? `Elite pitchers (${sortedPitchers[0].pitcher} K${sortedPitchers[0].kLine}, ${sortedPitchers[1].pitcher} K${sortedPitchers[1].kLine})`
              : `Value odds Under 0.5 @ ${underOdds}`;

            const confidence = hasElitePitchers && hasValueOdds ? 78
              : hasElitePitchers ? 72
              : 65;

            nrfiPicks.push({
              event_id: event.id,
              game_label: gameLabel,
              under_line: underLine,
              under_odds: underOdds,
              over_odds: overOdds,
              pitchers: sortedPitchers.slice(0, 2),
              has_elite_pitchers: hasElitePitchers,
              has_value_odds: hasValueOdds,
              reason,
              confidence,
              commence_time: event.commence_time,
            });
          }
        }
      } catch (err) {
        log(`Error ${event.id}: ${err}`);
      }
    }

    log(`${nrfiPicks.length} NRFI picks found`);

    // Step 4: Write to category_sweet_spots
    if (nrfiPicks.length > 0) {
      // Clear today's old NRFI picks
      await supabase
        .from('category_sweet_spots')
        .delete()
        .eq('category', 'MLB_NRFI')
        .gte('created_at', `${today}T00:00:00`);

      const rows = nrfiPicks.map(p => ({
        category: 'MLB_NRFI',
        side: 'under',
        player_name: p.game_label,
        prop_type: 'first_inning_total',
        line: p.under_line,
        confidence_score: p.confidence,
        edge_value: p.has_value_odds ? Math.abs(p.under_odds + 110) / 100 : 0.05,
        reasoning: p.reason,
        sport: 'baseball_mlb',
        source_engine: 'hrb-nrfi-scanner',
        is_active: true,
      }));

      const { error: insertErr } = await supabase.from('category_sweet_spots').insert(rows);
      if (insertErr) log(`Insert error: ${JSON.stringify(insertErr)}`);
      else log(`Inserted ${rows.length} NRFI sweet spots`);
    }

    // Step 5: Telegram alert
    if (nrfiPicks.length > 0) {
      const lines = nrfiPicks.map((p, i) => {
        const pitcherInfo = p.pitchers.length >= 2
          ? `🧊 ${p.pitchers[0].pitcher} (K line ${p.pitchers[0].kLine}) vs ${p.pitchers[1].pitcher} (K line ${p.pitchers[1].kLine})`
          : p.pitchers.length === 1
            ? `🧊 ${p.pitchers[0].pitcher} (K line ${p.pitchers[0].kLine})`
            : '🧊 Pitcher data unavailable';

        const narrative = p.has_elite_pitchers
          ? 'Both elite starters — 1st inning shutout likely'
          : 'Value odds in NRFI territory';

        return [
          `${i + 1}️⃣ ${p.game_label} — NO RUN 1st INNING`,
          `   ${pitcherInfo}`,
          `   ${narrative}`,
          `   💰 Under ${p.under_line} @ ${p.under_odds > 0 ? '+' : ''}${p.under_odds} (HRB)`,
        ].join('\n');
      });

      const msg = [
        `⚾ *MLB NRFI Scanner* — ${nrfiPicks.length} pick${nrfiPicks.length > 1 ? 's' : ''}`,
        '',
        ...lines,
        '',
        `📅 ${today}`,
      ].join('\n');

      try {
        await supabase.functions.invoke('bot-send-telegram', {
          body: { message: msg, parse_mode: 'Markdown', admin_only: true },
        });
      } catch (_) { /* ignore */ }
    }

    return new Response(JSON.stringify({
      success: true,
      picks: nrfiPicks.length,
      games_scanned: upcoming.length,
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
