import { generateParlayTickets } from "../_shared/parlay-engine-v2/index.ts";
import type { GeneratorInput } from "../_shared/parlay-engine-v2/index.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return Response.json({ error: "Use POST with { legs, stake?, bankroll?, pairLifts? }" }, { status: 405, headers: corsHeaders });
  }

  try {
    const body = await req.json() as GeneratorInput;
    const result = generateParlayTickets(body);
    return Response.json(result, { headers: corsHeaders });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400, headers: corsHeaders });
  }
});
