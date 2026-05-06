// Nuke Parlay Scout Phase 2 — daily roster sync from ESPN.
// Iterates active sports and refreshes the public.rosters table. Tennis is
// a no-op (ESPN has no tennis rosters). Each sport is non-fatal.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { RosterClient } from "../_shared/rosters.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_SPORTS = ["nba", "mlb", "soccer"];

function easternDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const client = new RosterClient(supabase);

  const body = await req.json().catch(() => ({}));
  const sports: string[] = Array.isArray(body.sports) && body.sports.length ? body.sports : DEFAULT_SPORTS;
  const errors: unknown[] = [];
  const counts: Record<string, number> = {};

  for (const sport of sports) {
    try {
      const { count } = await client.sync(sport);
      counts[sport] = count;
    } catch (e) {
      errors.push({ sport, message: String(e) });
      counts[sport] = 0;
    }
  }

  try {
    await supabase.from("nuke_run_log").insert({
      game_date: easternDate(),
      phase: "sync_rosters",
      games_scanned: 0,
      errors,
      notes: `synced sports: ${JSON.stringify(counts)}`,
    });
  } catch (e) {
    console.error("nuke-sync-rosters run_log error", e);
  }

  return new Response(JSON.stringify({ ok: true, counts, errors }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});