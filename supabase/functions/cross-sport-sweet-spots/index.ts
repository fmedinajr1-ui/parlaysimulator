import { scoreLeg } from "../_shared/parlay-engine-v2/index.ts";
import type { LegInput } from "../_shared/parlay-engine-v2/index.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return Response.json({ error: "Use POST with { legs: LegInput[] }" }, { status: 405, headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const legs = (body.legs ?? []) as LegInput[];
    const scored = legs.map(scoreLeg).sort((a, b) => b.safety * b.legQuality - a.safety * a.legQuality);
    return Response.json({
      legs: scored,
      locks: scored.filter((leg) => leg.safetyTier === "lock"),
      strong: scored.filter((leg) => leg.safetyTier === "strong"),
      leans: scored.filter((leg) => leg.safetyTier === "lean"),
      drops: scored.filter((leg) => leg.safetyTier === "drop"),
    }, { headers: corsHeaders });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400, headers: corsHeaders });
  }
});
