import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SPORT_KEYS = [
  'basketball_nba',
  'baseball_mlb',
  'icehockey_nhl',
  'americanfootball_nfl',
  'basketball_ncaab',
];

function americanToImpliedProb(odds: number): number {
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const apiKey = Deno.env.get('THE_ODDS_API_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());

  let totalRows = 0;
  const errors: string[] = [];

  for (const sport of SPORT_KEYS) {
    try {
      const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${apiKey}&regions=us&markets=h2h&oddsFormat=american`;
      const resp = await fetch(url);
      if (!resp.ok) {
        const body = await resp.text();
        errors.push(`${sport}: HTTP ${resp.status} - ${body}`);
        continue;
      }

      const events = await resp.json();
      const rows: any[] = [];

      for (const event of events) {
        for (const bookmaker of event.bookmakers || []) {
          const h2hMarket = bookmaker.markets?.find((m: any) => m.key === 'h2h');
          if (!h2hMarket) continue;

          const homeOutcome = h2hMarket.outcomes?.find((o: any) => o.name === event.home_team);
          const awayOutcome = h2hMarket.outcomes?.find((o: any) => o.name === event.away_team);
          if (!homeOutcome || !awayOutcome) continue;

          rows.push({
            sport,
            event_id: event.id,
            home_team: event.home_team,
            away_team: event.away_team,
            home_odds: homeOutcome.price,
            away_odds: awayOutcome.price,
            bookmaker: bookmaker.key,
            commence_time: event.commence_time,
            implied_home_prob: Math.round(americanToImpliedProb(homeOutcome.price) * 1000) / 1000,
            implied_away_prob: Math.round(americanToImpliedProb(awayOutcome.price) * 1000) / 1000,
            analysis_date: today,
          });
        }
      }

      if (rows.length > 0) {
        for (let i = 0; i < rows.length; i += 50) {
          const chunk = rows.slice(i, i + 50);
          const { error } = await supabase
            .from('team_moneyline_odds')
            .upsert(chunk, { onConflict: 'event_id,bookmaker,analysis_date' });
          if (error) errors.push(`${sport} upsert: ${error.message}`);
        }
        totalRows += rows.length;
      }

      console.log(`[Moneylines] ${sport}: ${events.length} events, ${rows.length} odds rows`);
    } catch (err) {
      errors.push(`${sport}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  await supabase.from('cron_job_history').insert({
    job_name: 'fetch-team-moneylines',
    status: errors.length > 0 ? 'partial' : 'completed',
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    result: { totalRows, errors },
  });

  return new Response(JSON.stringify({ success: true, totalRows, errors }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
