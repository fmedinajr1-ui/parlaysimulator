// Backfill court_edge_runs.diagnostics for historical runs by aggregating
// already-persisted court_edge_picks. Pure read+update, idempotent.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildRunDiagnostics, type DiagnosticsPick } from "../_shared/court-edge-diagnostics.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const body = await req.json().catch(() => ({}));
  const overwrite: boolean = !!body.overwrite;
  const limit: number = Number(body.limit ?? 500);

  let q = supabase
    .from("court_edge_runs")
    .select("id, errors, diagnostics")
    .order("ran_at", { ascending: false })
    .limit(limit);
  if (!overwrite) q = q.is("diagnostics", null);
  const { data: runs, error: rErr } = await q;
  if (rErr) {
    return new Response(JSON.stringify({ error: rErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let updated = 0;
  const perRun: Array<Record<string, unknown>> = [];
  for (const run of runs ?? []) {
    const { data: picks, error: pErr } = await supabase
      .from("court_edge_picks")
      .select("verdict, formula, weather, tournament")
      .eq("run_id", run.id);
    if (pErr) {
      perRun.push({ id: run.id, error: pErr.message });
      continue;
    }
    const list = (picks ?? []) as Array<{ verdict: string; formula: any; weather: any; tournament: string | null }>;
    const diagPicks: DiagnosticsPick[] = list.map((p) => ({
      verdict: p.verdict as DiagnosticsPick["verdict"],
      formula: p.formula ?? null,
    }));
    const weatherPresent = list.some((p) => p.weather != null);
    const tier = String((list[0]?.formula as any)?.tournament_tier ?? "unknown");
    const errs = Array.isArray(run.errors) ? run.errors : [];
    const errors_count = errs.length;
    const pp_blocked = errs.some((e: any) => /prizepicks/i.test(String(e?.step ?? "")));
    // Historical L3 coverage isn't stored on the run; mark unknown by setting total=0
    const diag = buildRunDiagnostics(diagPicks, {
      tier,
      baseline_sides_used: 0,
      l3_hits: 0,
      l3_total: 0,
      weather_present: weatherPresent,
      pp_blocked,
      errors_count,
    });
    const { error: uErr } = await supabase
      .from("court_edge_runs")
      .update({ diagnostics: { ...diag, backfilled: true } })
      .eq("id", run.id);
    if (uErr) {
      perRun.push({ id: run.id, error: uErr.message });
      continue;
    }
    updated += 1;
    perRun.push({ id: run.id, total: diag.total, warnings: diag.warnings });
  }

  return new Response(
    JSON.stringify({ scanned: runs?.length ?? 0, updated, runs: perRun }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});