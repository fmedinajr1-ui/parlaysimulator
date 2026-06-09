// sharp-tracker-auto-ingest
//
// Automates the NBA Sharp Money playbook across MLB, WNBA, tennis, soccer.
// For each active row in unified_props:
//   1. Upsert a sharp_line_tracker row (opening snapshot on first sight,
//      current_line/prices on every subsequent run).
//   2. Detect "sharp action" — vig-free price-edge ≥ per-sport floor OR
//      line/price movement against the public side since opening.
//   3. Mirror qualifying rows into engine_live_tracker with
//      engine_name='Sharp Money' so the standard settlers grade them.
//
// Designed to be safely re-runnable every 10 min. Never overwrites manual
// (input_method='manual') sharp tracker rows.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SPORT_EDGE_FLOOR: Record<string, number> = {
  baseball_mlb: 0.03, basketball_wnba: 0.04, basketball_nba: 0.03,
  icehockey_nhl: 0.04, americanfootball_nfl: 0.03, americanfootball_ncaaf: 0.04,
  mma_mixed_martial_arts: 0.05, tennis_atp: 0.04, tennis_wta: 0.04,
  soccer_epl: 0.04, soccer_mls: 0.05, soccer_ucl: 0.04, soccer_laliga: 0.04,
};
const DEFAULT_FLOOR = 0.05;

const TRACKED_SPORT_PREFIXES = ["baseball_mlb", "basketball_wnba", "tennis_", "soccer_"];
const SKIP_PROP_TYPES = new Set(["h2h", "spreads", "outright", "outright_winner", "winner"]);
const SKIP_SPORTS = ["soccer_fifa_world_cup_winner", "golf"];

function americanToProb(odds: number | null): number | null {
  if (odds == null || !Number.isFinite(odds) || odds === 0) return null;
  return odds > 0 ? 100 / (odds + 100) : -odds / (-odds + 100);
}
function num(v: any): number | null {
  const n = Number(v); return v == null || !Number.isFinite(n) ? null : n;
}

interface Pick { side: "over" | "under" | null; reason: string; confidence: number; edge_pp: number; }

function pickSide(sport: string, overPrice: number | null, underPrice: number | null): Pick {
  const pO = americanToProb(overPrice);
  const pU = americanToProb(underPrice);
  if (pO == null || pU == null || (pO + pU) <= 0) return { side: null, reason: "no_prices", confidence: 0, edge_pp: 0 };
  const vigFreeOver = pO / (pO + pU);
  const edge = vigFreeOver - 0.5;
  const floor = SPORT_EDGE_FLOOR[sport.toLowerCase()] ?? DEFAULT_FLOOR;
  if (Math.abs(edge) < floor) return { side: null, reason: "below_floor", confidence: 0, edge_pp: edge * 100 };
  return {
    side: edge > 0 ? "over" : "under",
    reason: `price_edge_${(Math.abs(edge) * 100).toFixed(1)}pp`,
    confidence: Math.min(0.9, 0.5 + Math.abs(edge) * 2),
    edge_pp: edge * 100,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({} as any));
  const dryRun: boolean = body?.dry_run === true;
  const log = (m: string) => console.log(`[sharp-auto] ${m}`);

  try {
    // Fetch active props in tracked sports
    const { data: props, error } = await supabase
      .from("unified_props")
      .select("id, sport, player_name, prop_type, current_line, over_price, under_price, event_id, game_description, commence_time, bookmaker, updated_at")
      .eq("is_active", true)
      .not("current_line", "is", null)
      .gte("commence_time", new Date(Date.now() - 6 * 3600 * 1000).toISOString())
      .lte("commence_time", new Date(Date.now() + 72 * 3600 * 1000).toISOString())
      .limit(5000);
    if (error) throw new Error(`unified_props: ${error.message}`);

    const trackable = (props ?? []).filter((p) => {
      const s = String(p.sport ?? "").toLowerCase();
      const pt = String(p.prop_type ?? "").toLowerCase();
      if (SKIP_SPORTS.some((x) => s.startsWith(x))) return false;
      if (SKIP_PROP_TYPES.has(pt)) return false;
      return TRACKED_SPORT_PREFIXES.some((x) => s.startsWith(x));
    });
    log(`scanned ${props?.length ?? 0}, trackable ${trackable.length}`);

    // Pull existing sharp_line_tracker rows in scope for upsert logic
    const playerKeys = [...new Set(trackable.map((p) => p.player_name))].slice(0, 1500);
    const { data: existing } = await supabase
      .from("sharp_line_tracker")
      .select("id, sport, player_name, prop_type, opening_line, current_line, current_over_price, current_under_price, input_method, status, ai_direction")
      .in("player_name", playerKeys.length ? playerKeys : ["__none__"]);
    const existingMap = new Map<string, any>();
    for (const r of existing ?? []) {
      existingMap.set(`${r.sport}|${r.player_name}|${r.prop_type}`, r);
    }

    // engine_live_tracker dedupe (avoid duplicate pending rows)
    const { data: pending } = await supabase
      .from("engine_live_tracker")
      .select("sport, player_name, prop_type, line, side, status")
      .eq("engine_name", "Sharp Money")
      .eq("status", "pending");
    const pendingSet = new Set((pending ?? []).map((p) =>
      `${p.sport}|${p.player_name}|${p.prop_type}|${p.line}|${p.side}`));

    const inserts: any[] = [];
    const updates: any[] = [];
    const trackerInserts: any[] = [];
    let signalFired = 0, skippedManual = 0, skippedBelowFloor = 0;
    const bySport: Record<string, { tracked: number; signals: number }> = {};

    for (const p of trackable) {
      const sport = String(p.sport);
      bySport[sport] ??= { tracked: 0, signals: 0 };
      bySport[sport].tracked++;
      const k = `${sport}|${p.player_name}|${p.prop_type}`;
      const prev = existingMap.get(k);
      const overP = num(p.over_price);
      const underP = num(p.under_price);
      const line = num(p.current_line);
      if (line == null || overP == null || underP == null) continue;
      const pick = pickSide(sport, overP, underP);

      // Sharp_line_tracker insert/update
      if (!prev) {
        inserts.push({
          event_id: p.event_id, sport, game_description: p.game_description ?? "unknown",
          player_name: p.player_name, prop_type: p.prop_type,
          bookmaker: p.bookmaker ?? "consensus",
          opening_line: line, opening_over_price: overP, opening_under_price: underP,
          current_line: line, current_over_price: overP, current_under_price: underP,
          last_updated: new Date().toISOString(),
          commence_time: p.commence_time,
          ai_direction: pick.side, ai_confidence: pick.confidence,
          ai_reasoning: pick.reason, input_method: "auto",
          ai_signals: { sharp: pick.side ? [{ reason: pick.reason, edge_pp: pick.edge_pp }] : [], trap: [] },
        });
      } else if (prev.input_method !== "manual") {
        const lineMoved = Math.abs((num(prev.current_line) ?? line) - line) >= 0.5;
        const priceMoved = Math.abs((num(prev.current_over_price) ?? overP) - overP) >= 15
                        || Math.abs((num(prev.current_under_price) ?? underP) - underP) >= 15;
        if (lineMoved || priceMoved || prev.ai_direction !== pick.side) {
          updates.push({
            id: prev.id, current_line: line, current_over_price: overP, current_under_price: underP,
            last_updated: new Date().toISOString(),
            ai_direction: pick.side, ai_confidence: pick.confidence, ai_reasoning: pick.reason,
            ai_signals: { sharp: pick.side ? [{ reason: pick.reason, edge_pp: pick.edge_pp, line_moved: lineMoved, price_moved: priceMoved }] : [], trap: [] },
          });
        }
      } else {
        skippedManual++;
      }

      // Mirror into engine_live_tracker only when a real signal fires
      if (pick.side) {
        signalFired++;
        bySport[sport].signals++;
        const k2 = `${sport}|${p.player_name}|${p.prop_type}|${line}|${pick.side}`;
        if (!pendingSet.has(k2)) {
          trackerInserts.push({
            engine_name: "Sharp Money",
            sport, pick_description: `${p.player_name} ${pick.side.toUpperCase()} ${line} ${p.prop_type}`,
            player_name: p.player_name, prop_type: p.prop_type,
            line, side: pick.side,
            odds: pick.side === "over" ? overP : underP,
            confidence: pick.confidence,
            confidence_level: pick.confidence >= 0.7 ? "high" : pick.confidence >= 0.6 ? "medium" : "low",
            signals: [{ type: "vig_free_price_edge", reason: pick.reason, edge_pp: pick.edge_pp, sport_floor: SPORT_EDGE_FLOOR[sport.toLowerCase()] ?? DEFAULT_FLOOR }],
            status: "pending", event_id: p.event_id, game_time: p.commence_time,
          });
          pendingSet.add(k2);
        }
      } else if (pick.reason === "below_floor") {
        skippedBelowFloor++;
      }
    }

    let trackerOpened = 0, trackerUpdated = 0, mirrored = 0;
    if (!dryRun) {
      if (inserts.length) {
        for (let i = 0; i < inserts.length; i += 200) {
          const b = inserts.slice(i, i + 200);
          const { error: e } = await supabase.from("sharp_line_tracker").insert(b);
          if (!e) trackerOpened += b.length; else log(`tracker insert err: ${e.message}`);
        }
      }
      if (updates.length) {
        await Promise.all(updates.map((u) => {
          const { id, ...rest } = u;
          return supabase.from("sharp_line_tracker").update(rest).eq("id", id);
        }));
        trackerUpdated = updates.length;
      }
      if (trackerInserts.length) {
        for (let i = 0; i < trackerInserts.length; i += 200) {
          const b = trackerInserts.slice(i, i + 200);
          const { error: e } = await supabase.from("engine_live_tracker").insert(b);
          if (!e) mirrored += b.length; else log(`engine insert err: ${e.message}`);
        }
      }
    }

    return new Response(JSON.stringify({
      success: true, scanned: props?.length ?? 0, trackable: trackable.length,
      tracker_opened: trackerOpened, tracker_updated: trackerUpdated,
      signals_fired: signalFired, mirrored_to_engine: mirrored,
      skipped_manual: skippedManual, skipped_below_floor: skippedBelowFloor,
      by_sport: bySport, dry_run: dryRun,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[sharp-auto] fatal", msg);
    return new Response(JSON.stringify({ success: false, error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});