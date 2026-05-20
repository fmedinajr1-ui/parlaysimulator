// model-predict-daily
// Score today's slate using Elo (H2H), Poisson (totals), and trained prop GBMs.
// Writes to model_predictions. has_real_line=true only when current_line is present.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { eloExpected, poissonOverProb, americanToProb, predictGbm } from "../_shared/model-helpers.ts";
import { etDateKey } from "../_shared/date-et.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const HOME_ADV: Record<string, number> = { nba: 65, mlb: 25, nhl: 35 };
const MIN_EDGE_PCT = 2; // only persist >=2% edge picks

async function predictH2HSpread(supabase: any, dateKey: string): Promise<number> {
  // Use nuke_historical_games as a "today" slate when unsettled rows exist.
  // Pulls upcoming games where settled=false for today's ET date.
  const { data: games } = await supabase
    .from("nuke_historical_games")
    .select("sport, external_id, home, away, ml_home, ml_away, spread, total, game_date")
    .in("sport", ["nba", "mlb", "nhl"])
    .eq("settled", false)
    .limit(500);

  if (!games?.length) return 0;

  const { data: elos } = await supabase
    .from("model_team_elo")
    .select("sport, team, rating");

  const eloMap = new Map<string, number>();
  for (const r of elos ?? []) eloMap.set(`${r.sport}::${r.team}`, Number(r.rating));

  const rows: any[] = [];
  for (const g of games) {
    const sport = g.sport as string;
    const homeR = eloMap.get(`${sport}::${g.home}`);
    const awayR = eloMap.get(`${sport}::${g.away}`);
    if (homeR === undefined || awayR === undefined) continue;

    const pHome = eloExpected(homeR, awayR, HOME_ADV[sport] ?? 35);
    const pAway = 1 - pHome;

    for (const [side, prob, ml] of [
      ["home", pHome, g.ml_home] as const,
      ["away", pAway, g.ml_away] as const,
    ]) {
      const market = americanToProb(ml);
      if (market === null) continue;
      const edgePct = (prob - market) * 100;
      if (edgePct < MIN_EDGE_PCT) continue;
      rows.push({
        sport, game_date_et: dateKey, event_id: g.external_id,
        model: "elo", market_type: "h2h", side,
        current_line: ml ?? null,
        prob: Math.round(prob * 10000) / 10000,
        edge_pct: Math.round(edgePct * 100) / 100,
        game_description: `${g.away} @ ${g.home}`,
        has_real_line: ml !== null && ml !== undefined,
      });
    }
  }

  if (rows.length) await supabase.from("model_predictions").insert(rows);
  return rows.length;
}

async function predictTotals(supabase: any, dateKey: string): Promise<number> {
  const { data: games } = await supabase
    .from("nuke_historical_games")
    .select("sport, external_id, home, away, total, game_date")
    .in("sport", ["mlb", "nhl"])
    .eq("settled", false)
    .not("total", "is", null)
    .limit(500);
  if (!games?.length) return 0;

  const { data: params } = await supabase
    .from("model_totals_params")
    .select("sport, team, attack, defense, home_adv");

  const pMap = new Map<string, any>();
  for (const r of params ?? []) pMap.set(`${r.sport}::${r.team}`, r);

  // league average (approx) per sport
  const leagueAvg: Record<string, number> = { mlb: 4.5, nhl: 3.0 };

  const rows: any[] = [];
  for (const g of games) {
    const sport = g.sport as string;
    const ph = pMap.get(`${sport}::${g.home}`);
    const pa = pMap.get(`${sport}::${g.away}`);
    if (!ph || !pa) continue;
    const base = leagueAvg[sport] ?? 4;
    const lamHome = base * Number(ph.attack) * Number(pa.defense) * (1 + Number(ph.home_adv));
    const lamAway = base * Number(pa.attack) * Number(ph.defense);
    const line = Number(g.total);
    if (!Number.isFinite(line)) continue;
    const pOver = poissonOverProb(lamHome, lamAway, line);
    const market = 0.5; // book offers ~-110/-110; treat as ~52.4% with vig
    for (const [side, prob] of [["over", pOver], ["under", 1 - pOver]] as const) {
      const edgePct = (prob - market) * 100;
      if (edgePct < MIN_EDGE_PCT) continue;
      rows.push({
        sport, game_date_et: dateKey, event_id: g.external_id,
        model: "poisson", market_type: "total", side,
        current_line: line,
        prob: Math.round(prob * 10000) / 10000,
        edge_pct: Math.round(edgePct * 100) / 100,
        game_description: `${g.away} @ ${g.home}`,
        has_real_line: true,
      });
    }
  }

  if (rows.length) await supabase.from("model_predictions").insert(rows);
  return rows.length;
}

async function predictProps(supabase: any, dateKey: string): Promise<number> {
  const { data: props } = await supabase
    .from("unified_props")
    .select("event_id, sport, game_description, player_name, prop_type, current_line, over_price, under_price, hit_rate_score, recommended_side")
    .eq("is_active", true)
    .not("current_line", "is", null)
    .in("sport", ["nba", "mlb", "nhl"])
    .limit(2000);
  if (!props?.length) return 0;

  const { data: artifacts } = await supabase
    .from("model_prop_artifacts")
    .select("sport, prop_type, model_blob, calibration");

  const aMap = new Map<string, any>();
  for (const a of artifacts ?? []) aMap.set(`${a.sport}::${a.prop_type}`, a);

  const rows: any[] = [];
  for (const p of props) {
    const art = aMap.get(`${p.sport}::${p.prop_type}`);
    if (!art) continue;
    const recSide = String(p.recommended_side ?? "over").toLowerCase().startsWith("u") ? "under" : "over";
    const sideNum = recSide === "over" ? 1 : 0;
    const x = [Number(p.current_line), 0, Number(p.hit_rate_score ?? 0), sideNum];
    if (x.some((v) => !Number.isFinite(v))) continue;
    const prob = predictGbm(art.model_blob, x);
    const market = americanToProb(recSide === "over" ? p.over_price : p.under_price) ?? 0.5;
    const edgePct = (prob - market) * 100;
    if (edgePct < MIN_EDGE_PCT) continue;
    rows.push({
      sport: p.sport, game_date_et: dateKey, event_id: p.event_id,
      player_name: p.player_name, prop_type: p.prop_type,
      model: "xgb_prop", market_type: "player_prop", side: recSide,
      current_line: p.current_line,
      prob: Math.round(prob * 10000) / 10000,
      edge_pct: Math.round(edgePct * 100) / 100,
      game_description: p.game_description,
      has_real_line: true,
    });
  }

  if (rows.length) {
    // chunk inserts to avoid payload limits
    for (let i = 0; i < rows.length; i += 500) {
      await supabase.from("model_predictions").insert(rows.slice(i, i + 500));
    }
  }
  return rows.length;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const dateKey = etDateKey();

    // clear today's slate before re-scoring
    await supabase.from("model_predictions").delete().eq("game_date_et", dateKey);

    const out = {
      date_et: dateKey,
      elo: 0, poisson: 0, xgb_prop: 0,
    };
    try { out.elo = await predictH2HSpread(supabase, dateKey); } catch (e) { console.error("[predict-daily] elo", e); }
    try { out.poisson = await predictTotals(supabase, dateKey); } catch (e) { console.error("[predict-daily] poisson", e); }
    try { out.xgb_prop = await predictProps(supabase, dateKey); } catch (e) { console.error("[predict-daily] xgb", e); }

    return new Response(JSON.stringify({ success: true, ...out }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[model-predict-daily] fatal", msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});