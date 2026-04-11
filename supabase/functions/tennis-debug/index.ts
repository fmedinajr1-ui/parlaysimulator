import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const apiKey = Deno.env.get("THE_ODDS_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "No API key" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // 1. List all tennis sports
    const sportsRes = await fetch(`https://api.the-odds-api.com/v4/sports?apiKey=${apiKey}`);
    const sports = await sportsRes.json();
    const tennisSports = sports.filter((s: any) =>
      s.key?.toLowerCase().includes("tennis") || s.group?.toLowerCase().includes("tennis")
    );

    // 2. For each active tennis sport, get events
    const results: any[] = [];
    for (const sport of tennisSports) {
      if (!sport.active) {
        results.push({ key: sport.key, title: sport.title, active: false, events: 0 });
        continue;
      }
      const eventsRes = await fetch(`https://api.the-odds-api.com/v4/sports/${sport.key}/events?apiKey=${apiKey}`);
      if (!eventsRes.ok) {
        const txt = await eventsRes.text();
        results.push({ key: sport.key, title: sport.title, active: true, error: `${eventsRes.status}: ${txt.slice(0, 100)}` });
        continue;
      }
      const events = await eventsRes.json();
      
      // Check today's events
      const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/New_York",
        year: "numeric", month: "2-digit", day: "2-digit",
      }).format(new Date());
      
      const todayEvents = events.filter((e: any) => {
        const etDate = new Intl.DateTimeFormat("en-CA", {
          timeZone: "America/New_York",
          year: "numeric", month: "2-digit", day: "2-digit",
        }).format(new Date(e.commence_time));
        return etDate === today;
      });

      results.push({
        key: sport.key,
        title: sport.title,
        active: true,
        total_events: events.length,
        today_events: todayEvents.length,
        sample_today: todayEvents.slice(0, 3).map((e: any) => `${e.away_team} vs ${e.home_team}`),
      });
    }

    // 3. Check remaining API quota
    const remaining = sportsRes.headers.get("x-requests-remaining");
    const used = sportsRes.headers.get("x-requests-used");

    return new Response(JSON.stringify({
      tennis_sports: results,
      api_quota: { remaining, used },
    }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
