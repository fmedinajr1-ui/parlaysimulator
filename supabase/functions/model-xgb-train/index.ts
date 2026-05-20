// model-xgb-train
// Trains a tiny gradient-boosted-stumps model per (sport, prop_type) from
// prop_results_archive. Features: line, edge, confidence_score, side(num).
// v1 uses lightweight stumps (see _shared/model-helpers.ts trainGbm). Pure Deno.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { trainGbm } from "../_shared/model-helpers.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MIN_SAMPLES = 60;
const SPORTS = ["nba", "mlb", "nhl"];

function toFeatures(row: any): number[] | null {
  const line = Number(row.line);
  const edge = Number(row.edge ?? 0);
  const conf = Number(row.confidence_score ?? 0);
  const side = String(row.side ?? "").toLowerCase().startsWith("o") ? 1 : 0;
  if (!Number.isFinite(line)) return null;
  return [line, edge, conf, side];
}

function toLabel(row: any): number | null {
  const o = String(row.outcome ?? "").toLowerCase();
  if (o === "win" || o === "hit") return 1;
  if (o === "loss" || o === "miss") return 0;
  return null;
}

async function trainOne(supabase: any, sport: string, prop_type: string) {
  const { data, error } = await supabase
    .from("prop_results_archive")
    .select("line, edge, confidence_score, side, outcome")
    .eq("sport", sport).eq("prop_type", prop_type)
    .in("outcome", ["win", "loss", "hit", "miss"])
    .limit(4000);
  if (error) return { sport, prop_type, sample_size: 0, skipped: "fetch_error" };

  const X: number[][] = []; const y: number[] = [];
  for (const row of data ?? []) {
    const f = toFeatures(row); const lbl = toLabel(row);
    if (!f || lbl === null) continue;
    X.push(f); y.push(lbl);
  }
  if (X.length < MIN_SAMPLES) return { sport, prop_type, sample_size: X.length, skipped: "insufficient_samples" };

  const featureNames = ["line", "edge", "confidence_score", "side_over"];
  const model = trainGbm(X, y, featureNames, 30, 0.1);

  const baseRate = y.reduce((a, b) => a + b, 0) / y.length;
  const calibration = { base_rate: baseRate, n: y.length };

  const { error: upErr } = await supabase
    .from("model_prop_artifacts")
    .upsert([{
      sport, prop_type,
      model_blob: model,
      feature_spec: { features: featureNames },
      calibration,
      sample_size: y.length,
      trained_at: new Date().toISOString(),
    }], { onConflict: "sport,prop_type" });
  if (upErr) return { sport, prop_type, sample_size: y.length, skipped: `upsert: ${upErr.message}` };

  return { sport, prop_type, sample_size: y.length, trained: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    // discover (sport, prop_type) pairs with enough data
    const { data: pairs, error } = await supabase
      .from("prop_results_archive")
      .select("sport, prop_type")
      .in("sport", SPORTS)
      .in("outcome", ["win", "loss", "hit", "miss"])
      .limit(20000);
    if (error) throw new Error(`pairs: ${error.message}`);

    const seen = new Map<string, { sport: string; prop_type: string }>();
    for (const r of pairs ?? []) {
      if (!r.sport || !r.prop_type) continue;
      const key = `${r.sport}::${r.prop_type}`;
      if (!seen.has(key)) seen.set(key, { sport: r.sport, prop_type: r.prop_type });
    }

    const results = [];
    for (const p of seen.values()) {
      try { results.push(await trainOne(supabase, p.sport, p.prop_type)); }
      catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        results.push({ ...p, skipped: `error: ${msg}` });
      }
    }

    return new Response(JSON.stringify({
      success: true,
      total_pairs: seen.size,
      trained: results.filter((r: any) => r.trained).length,
      results,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[model-xgb-train] fatal", msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});