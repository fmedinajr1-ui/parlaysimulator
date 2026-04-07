import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const apiKey = Deno.env.get('THE_ODDS_API_KEY');
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'No API key' }), { status: 500, headers: corsHeaders });
  }

  const sports = [
    { key: 'mma_mixed_martial_arts', label: 'MMA/UFC', markets: 'h2h' },
    { key: 'soccer_usa_mls', label: 'Soccer (MLS)', markets: 'h2h,spreads,totals' },
    { key: 'soccer_epl', label: 'Soccer (EPL)', markets: 'h2h,spreads,totals' },
    { key: 'lacrosse_pll', label: 'Lacrosse (PLL)', markets: 'h2h' },
    { key: 'lacrosse_ncaa', label: 'Lacrosse (NCAA)', markets: 'h2h' },
    { key: 'golf_pga_championship_winner', label: 'Golf (PGA)', markets: 'outrights' },
    { key: 'basketball_nba', label: 'NBA (control)', markets: 'h2h' },
  ];

  const results: any[] = [];

  for (const s of sports) {
    try {
      const url = `https://api.the-odds-api.com/v4/sports/${s.key}/odds?apiKey=${apiKey}&regions=us&markets=${s.markets}&oddsFormat=american`;
      const r = await fetch(url);
      if (r.ok) {
        const data = await r.json();
        const remaining = r.headers.get('x-requests-remaining');
        results.push({
          sport: s.label,
          key: s.key,
          events: data.length,
          api_remaining: remaining,
          sample: data.length > 0 ? {
            matchup: `${data[0].away_team} @ ${data[0].home_team}`,
            commence: data[0].commence_time,
            books: data[0].bookmakers?.length || 0,
          } : null,
        });
      } else {
        const txt = await r.text();
        results.push({ sport: s.label, key: s.key, error: `HTTP ${r.status}`, detail: txt.substring(0, 200) });
      }
    } catch (e) {
      results.push({ sport: s.label, key: s.key, error: e.message });
    }
  }

  return new Response(JSON.stringify({ results, timestamp: new Date().toISOString() }, null, 2), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
