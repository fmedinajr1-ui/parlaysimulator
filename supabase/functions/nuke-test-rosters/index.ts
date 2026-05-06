import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { RosterClient } from "../_shared/rosters.ts";
import { fetchEspnInjuries } from "../_shared/parlayBuilder.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const out: Record<string, unknown> = {};
  try {
    const client = new RosterClient(supabase);
    const sync = await client.sync("nba");
    out.sync = sync;
    const team = await client.lookupTeam("nba", "LeBron James", ["Los Angeles Lakers", "Boston Celtics"]);
    out.lookupTeam = team;
    const injuries = await fetchEspnInjuries("nba");
    out.injuriesSize = injuries.size;
    out.injuriesSample = [...injuries].slice(0, 5);
  } catch (e) {
    out.error = String(e);
  }
  return new Response(JSON.stringify(out, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});