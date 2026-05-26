import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// Heuristic "game closed" cutoff: fired ≥ 4h ago and no snapshot in last 90 min for that game.
const FIRED_MIN_AGE_MS = 4 * 60 * 60 * 1000;
const SNAPSHOT_QUIET_MS = 90 * 60 * 1000;
const BATCH = 500;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const cutoff = new Date(Date.now() - FIRED_MIN_AGE_MS).toISOString();

  // Candidate edges: fired, closing_line missing, fired_at old enough
  const { data: edges, error } = await supabase
    .from("lag_edges")
    .select("id, game_id, edge_type, source_snapshot_id, actual_move, fired_at, status")
    .is("closing_line", null)
    .not("fired_at", "is", null)
    .lt("fired_at", cutoff)
    .neq("status", "void")
    .limit(BATCH);

  if (error) return json({ error: error.message }, 500);

  let resolved = 0;
  let skipped = 0;

  // Group by game_id for snapshot-quiet check
  const byGame = new Map<string, typeof edges>();
  for (const e of edges ?? []) {
    const arr = byGame.get(e.game_id) ?? [];
    arr.push(e);
    byGame.set(e.game_id, arr);
  }

  for (const [gameId, gameEdges] of byGame) {
    // Confirm market is quiet (game over) before closing
    const { data: lastSnap } = await supabase
      .from("market_snapshot")
      .select("captured_at")
      .eq("game_id", gameId)
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!lastSnap) { skipped += gameEdges.length; continue; }
    const lastAge = Date.now() - Date.parse(lastSnap.captured_at);
    if (lastAge < SNAPSHOT_QUIET_MS) { skipped += gameEdges.length; continue; }

    for (const edge of gameEdges) {
      try {
        const { data: closing } = await supabase
          .from("market_snapshot")
          .select("line")
          .eq("game_id", gameId)
          .eq("market_type", edge.edge_type)
          .order("captured_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const closingLine = closing?.line == null ? null : Number(closing.line);

        let actualMove = edge.actual_move == null ? null : Number(edge.actual_move);
        if (actualMove == null && edge.source_snapshot_id && closingLine != null) {
          const { data: origin } = await supabase
            .from("market_snapshot")
            .select("line")
            .eq("id", edge.source_snapshot_id)
            .maybeSingle();
          const origLine = origin?.line == null ? null : Number(origin.line);
          if (origLine != null) actualMove = closingLine - origLine;
        }

        const patch: Record<string, unknown> = { closing_line: closingLine };
        if (actualMove != null) patch.actual_move = actualMove;
        if (edge.status === "active") patch.status = "expired";

        const { error: upErr } = await supabase.from("lag_edges").update(patch).eq("id", edge.id);
        if (upErr) { console.error("[closing-line-resolver] update failed", edge.id, upErr); continue; }
        resolved++;
      } catch (e) {
        console.error("[closing-line-resolver] error", edge.id, e);
      }
    }
  }

  return json({ ok: true, candidates: edges?.length ?? 0, resolved, skipped });
});