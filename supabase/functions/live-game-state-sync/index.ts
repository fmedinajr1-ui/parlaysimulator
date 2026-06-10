// Sync live scores from The Odds API into public.live_game_state.
// Honest v1: pulls /scores per sport for any in-progress / recently-started game.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ODDS_BASE = "https://api.the-odds-api.com/v4/sports";

// Sport key -> human sport label stored on the row
const SPORTS: Record<string, string> = {
  basketball_nba: "NBA",
  basketball_wnba: "WNBA",
  basketball_ncaab: "NCAAB",
  americanfootball_nfl: "NFL",
  americanfootball_ncaaf: "NCAAF",
  baseball_mlb: "MLB",
  icehockey_nhl: "NHL",
  soccer_epl: "Soccer",
  soccer_uefa_champs_league: "Soccer",
  soccer_usa_mls: "Soccer",
  soccer_brazil_campeonato: "Soccer",
  soccer_conmebol_copa_libertadores: "Soccer",
  soccer_conmebol_copa_sudamericana: "Soccer",
};

type ScoreRow = {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  completed: boolean;
  home_team: string;
  away_team: string;
  scores: Array<{ name: string; score: string }> | null;
  last_update?: string | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const apiKey = Deno.env.get("THE_ODDS_API_KEY");
  if (!apiKey) {
    return json({ success: false, error: "THE_ODDS_API_KEY not set" }, 500);
  }
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const summary: Record<string, { fetched: number; live: number; written: number; error?: string }> = {};
  let totalWritten = 0;

  for (const [sportKey, sportLabel] of Object.entries(SPORTS)) {
    const stat = { fetched: 0, live: 0, written: 0 } as { fetched: number; live: number; written: number; error?: string };
    try {
      const url = `${ODDS_BASE}/${sportKey}/scores/?daysFrom=1&apiKey=${apiKey}`;
      const res = await fetch(url);
      if (!res.ok) {
        stat.error = `HTTP ${res.status}`;
        summary[sportKey] = stat;
        continue;
      }
      const rows = (await res.json()) as ScoreRow[];
      stat.fetched = rows.length;

      const now = Date.now();
      const upserts = rows
        .filter((r) => {
          if (r.completed) return true; // we still record final
          const t = new Date(r.commence_time).getTime();
          return now >= t - 30 * 60_000; // window: started or within 30m of start
        })
        .map((r) => {
          const home = r.scores?.find((s) => s.name === r.home_team)?.score;
          const away = r.scores?.find((s) => s.name === r.away_team)?.score;
          const status = r.completed
            ? "final"
            : Date.now() >= new Date(r.commence_time).getTime()
              ? "in_progress"
              : "scheduled";
          if (status === "in_progress") stat.live += 1;
          return {
            game_id: r.id,
            sport: sportLabel,
            league: r.sport_title,
            home_team: r.home_team,
            away_team: r.away_team,
            home_score: home ? Number(home) : 0,
            away_score: away ? Number(away) : 0,
            status,
            commence_time: r.commence_time,
            situation: {},
            updated_at: new Date().toISOString(),
          };
        });

      if (upserts.length) {
        const { error, count } = await supabase
          .from("live_game_state")
          .upsert(upserts, { onConflict: "game_id", count: "exact" });
        if (error) {
          stat.error = error.message;
        } else {
          stat.written = count ?? upserts.length;
          totalWritten += stat.written;
        }
      }
    } catch (e) {
      stat.error = String((e as Error).message ?? e);
    }
    summary[sportKey] = stat;
  }

  return json({ success: true, total_written: totalWritten, summary });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}