import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * ncaab-referee-scraper
 * 
 * Scrapes NCAAB referee assignment and tendency data using Firecrawl.
 * Sources: ESPN game pages for assignments, barttorvik for tendencies.
 * Updates ncaab_referee_data and ncaab_game_referees tables.
 */

function getEasternDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
  const supabase = createClient(supabaseUrl, supabaseKey);

  if (!firecrawlKey) {
    return new Response(JSON.stringify({ error: 'FIRECRAWL_API_KEY not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const today = getEasternDate();
    console.log(`[Referee Scraper] Starting for ${today}...`);

    // Step 1: Search for today's NCAAB referee assignments
    const searchResp = await fetchWithTimeout('https://api.firecrawl.dev/v1/search', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${firecrawlKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `NCAA basketball referee assignments ${today}`,
        limit: 5,
        scrapeOptions: { formats: ['markdown'] },
      }),
    });

    const searchData = await searchResp.json();
    const searchResults = searchData?.data || [];
    console.log(`[Referee Scraper] Found ${searchResults.length} search results`);

    // Step 2: Try to scrape barttorvik referee page for tendency data
    const bartResp = await fetchWithTimeout('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${firecrawlKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: 'https://barttorvik.com/refs.php',
        formats: ['markdown'],
        onlyMainContent: true,
        waitFor: 3000,
      }),
    });

    const bartData = await bartResp.json();
    const bartMarkdown = bartData?.data?.markdown || bartData?.markdown || '';
    console.log(`[Referee Scraper] Barttorvik markdown: ${bartMarkdown.length} chars`);

    // Parse referee tendency data from barttorvik
    const referees: Array<{
      name: string;
      games: number;
      avgFouls: number;
      avgTotal: number;
      overRate: number;
      underRate: number;
      pace: string;
    }> = [];

    if (bartMarkdown.length > 200) {
      const lines = bartMarkdown.split('\n');
      for (const line of lines) {
        // Try table format: | Name | Games | Fouls/G | Avg Total | O% | U% |
        const pipeMatch = line.match(/\|\s*([A-Za-z\s.'-]+?)\s*\|\s*(\d+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)%?\s*\|\s*([\d.]+)%?\s*\|/);
        if (pipeMatch) {
          const name = pipeMatch[1].trim();
          const games = parseInt(pipeMatch[2]);
          const avgFouls = parseFloat(pipeMatch[3]);
          const avgTotal = parseFloat(pipeMatch[4]);
          let overRate = parseFloat(pipeMatch[5]);
          let underRate = parseFloat(pipeMatch[6]);
          
          // Normalize to 0-1 if given as percentage
          if (overRate > 1) overRate /= 100;
          if (underRate > 1) underRate /= 100;

          if (name.length > 3 && games >= 5 && !isNaN(avgFouls)) {
            const pace = avgFouls > 38 ? 'fast' : avgFouls < 34 ? 'slow' : 'neutral';
            referees.push({ name, games, avgFouls, avgTotal, overRate, underRate, pace });
          }
        }
      }
    }

    console.log(`[Referee Scraper] Parsed ${referees.length} referees from barttorvik`);

    // Upsert referee data
    let refUpserted = 0;
    for (const ref of referees) {
      const { error } = await supabase
        .from('ncaab_referee_data')
        .upsert({
          referee_name: ref.name,
          games_officiated: ref.games,
          avg_fouls_per_game: ref.avgFouls,
          avg_total_points: ref.avgTotal,
          over_rate: ref.overRate,
          under_rate: ref.underRate,
          pace_tendency: ref.pace,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'referee_name' });

      if (!error) refUpserted++;
    }

    // Step 3: Try to extract game-referee assignments from search results
    let gameRefsFound = 0;
    for (const result of searchResults) {
      const content = result?.markdown || '';
      if (content.length < 100) continue;

      // Look for patterns like "Team A vs Team B ... Officials: Name1, Name2, Name3"
      const gameRefPattern = /([A-Z][a-zA-Z\s.']+?)\s+(?:vs\.?|at|@)\s+([A-Z][a-zA-Z\s.']+?)[\s\S]*?(?:Officials?|Referees?|Refs?):\s*([^\n]+)/gi;
      let match;
      while ((match = gameRefPattern.exec(content)) !== null) {
        const awayTeam = match[1].trim();
        const homeTeam = match[2].trim();
        const refNames = match[3].split(/[,;]/).map(n => n.trim()).filter(n => n.length > 3);

        if (refNames.length > 0) {
          // Calculate expected impact from known referee tendencies
          let totalAdjustment = 0;
          let refCount = 0;
          
          for (const refName of refNames) {
            const known = referees.find(r => r.name.toLowerCase() === refName.toLowerCase());
            if (known) {
              // League avg fouls ~36 per game
              const foulDelta = known.avgFouls - 36;
              totalAdjustment += foulDelta * 0.5; // Each extra foul ~ 0.5 pts
              refCount++;
            }
          }

          const avgAdj = refCount > 0 ? totalAdjustment / refCount : 0;

          await supabase.from('ncaab_game_referees').upsert({
            game_date: today,
            home_team: homeTeam,
            away_team: awayTeam,
            referee_names: refNames,
            expected_pace_impact: avgAdj > 0 ? 1 : avgAdj < 0 ? -1 : 0,
            expected_total_adjustment: Math.round(avgAdj * 10) / 10,
          }, { onConflict: 'game_date,home_team,away_team' }).then(() => gameRefsFound++);
        }
      }
    }

    const summary = {
      success: true,
      date: today,
      referees_parsed: referees.length,
      referees_upserted: refUpserted,
      game_assignments_found: gameRefsFound,
      top_refs: referees.slice(0, 5).map(r => `${r.name} (${r.games}G, ${r.avgFouls} F/G, ${r.pace})`),
    };

    console.log('[Referee Scraper] Complete:', summary);

    await supabase.from('cron_job_history').insert({
      job_name: 'ncaab-referee-scraper',
      status: 'completed',
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      result: summary,
    });

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Referee Scraper] Error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
