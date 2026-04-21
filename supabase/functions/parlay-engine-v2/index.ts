// ============================================================================
// parlay-engine-v2 — Phase A edge function
//
// On-demand parlay slate generation using the v2 engine. No cron, no Telegram.
// POST body: { dry_run?: boolean, date?: "YYYY-MM-DD" }
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { etDateKey } from "../_shared/date-et.ts";
import {
  CandidateLeg,
  ParlayEngine,
  combinedAmericanOdds,
  combinedDecimalOdds,
  combinedProbability,
  expectedValueUnits,
} from "../_shared/parlay-engine-v2/index.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ----- Signal source mapping (bot_daily_pick_pool.category → engine signal) ----
function normalizeSignalSource(category: string | null | undefined): string {
  if (!category) return "UNKNOWN";
  return category.trim().toUpperCase().replace(/\s+/g, "_");
}

// Parse "Lakers @ Warriors" / "Lakers vs Warriors" into [team, opponent].
// Player's team is unknown from pick_pool alone; we use the home/away teams
// joined from unified_props.game_description as a best-effort.
function parseTeams(gameDescription: string | null): { team: string; opponent: string } {
  if (!gameDescription) return { team: "UNK", opponent: "UNK" };
  const m = gameDescription.match(/^(.+?)\s*(?:@|vs\.?|v\.?)\s*(.+?)$/i);
  if (!m) return { team: gameDescription, opponent: "UNK" };
  return { team: m[1].trim(), opponent: m[2].trim() };
}

function inferSport(propType: string | null): string {
  if (!propType) return "NBA";
  const p = propType.toLowerCase();
  if (p.includes("pitcher") || p.includes("batter") || p.includes("hits") || p.includes("rbi")) return "MLB";
  if (p.includes("sog") || p.includes("saves") || p.includes("hockey")) return "NHL";
  return "NBA";
}

interface PoolRow {
  id: string;
  pick_date: string;
  player_name: string;
  prop_type: string | null;
  recommended_side: string | null;
  recommended_line: number | null;
  confidence_score: number | null;
  composite_score: number | null;
  projected_value: number | null;
  category: string | null;
  created_at: string;
}

interface PropRow {
  player_name: string | null;
  prop_type: string | null;
  current_line: number | null;
  over_price: number | null;
  under_price: number | null;
  is_active: boolean | null;
  sport: string | null;
  game_description: string | null;
  commence_time: string | null;
  updated_at: string | null;
}

function buildCandidates(
  pool: PoolRow[],
  props: PropRow[],
  now: Date,
): { candidates: CandidateLeg[]; mappingNotes: string[] } {
  const propIndex = new Map<string, PropRow>();
  for (const p of props) {
    if (!p.player_name || !p.prop_type) continue;
    propIndex.set(`${p.player_name.toLowerCase()}|${p.prop_type.toLowerCase()}`, p);
  }

  const notes: string[] = [];
  const candidates: CandidateLeg[] = [];

  for (const row of pool) {
    if (!row.prop_type || !row.recommended_side || row.recommended_line == null) continue;
    const side = row.recommended_side.toUpperCase();
    const matchedProp = propIndex.get(`${row.player_name.toLowerCase()}|${row.prop_type.toLowerCase()}`);

    const american =
      side === "OVER"  ? matchedProp?.over_price :
      side === "UNDER" ? matchedProp?.under_price :
      null;
    if (american == null) continue; // require live odds

    const sport = (matchedProp?.sport ?? inferSport(row.prop_type)).toUpperCase();
    const { team, opponent } = parseTeams(matchedProp?.game_description ?? null);
    const tipoff = matchedProp?.commence_time
      ? new Date(matchedProp.commence_time)
      : new Date(now.getTime() + 6 * 60 * 60 * 1000);
    const projectionUpdated = matchedProp?.updated_at
      ? new Date(matchedProp.updated_at)
      : new Date(row.created_at);

    const confidenceRaw = row.confidence_score ?? row.composite_score ?? 65;
    const confidence = Math.max(0, Math.min(1, confidenceRaw / 100));
    const projected = row.projected_value ?? row.recommended_line;
    const edge = projected - row.recommended_line;

    candidates.push({
      sport: sport === "BASKETBALL_NBA" ? "NBA" : sport,
      player_name: row.player_name,
      team,
      opponent,
      prop_type: row.prop_type,
      side,
      line: row.recommended_line,
      american_odds: Math.round(american),
      projected,
      confidence,
      edge,
      signal_source: normalizeSignalSource(row.category),
      tipoff,
      projection_updated_at: projectionUpdated,
      line_confirmed_on_book: !!(matchedProp?.is_active && american != null),
      player_active: true, // no injury feed yet
      defensive_context_updated_at: null, // gate skipped this phase
    });
  }

  notes.push("player_active: assumed true (no injury feed wired in Phase A)");
  notes.push("defensive_context gate: skipped (no canonical defense_updated_at)");

  return { candidates, mappingNotes: notes };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let body: { dry_run?: boolean; date?: string } = {};
    try { body = await req.json(); } catch { /* allow empty */ }
    const dryRun = body.dry_run !== false; // default to dry_run for safety
    const targetDate = body.date ?? etDateKey();

    // Load candidate pool
    const { data: pool, error: poolErr } = await sb
      .from("bot_daily_pick_pool")
      .select("id, pick_date, player_name, prop_type, recommended_side, recommended_line, confidence_score, composite_score, projected_value, category, created_at")
      .eq("pick_date", targetDate);
    if (poolErr) throw poolErr;

    // Load matching props for odds + game context
    const playerNames = Array.from(new Set((pool ?? []).map(p => p.player_name).filter(Boolean)));
    let props: PropRow[] = [];
    if (playerNames.length > 0) {
      const { data: propData, error: propErr } = await sb
        .from("unified_props")
        .select("player_name, prop_type, current_line, over_price, under_price, is_active, sport, game_description, commence_time, updated_at")
        .in("player_name", playerNames);
      if (propErr) throw propErr;
      props = propData ?? [];
    }

    const now = new Date();
    const { candidates, mappingNotes } = buildCandidates(pool ?? [], props, now);

    const engine = new ParlayEngine();
    const slate = engine.generateSlate(candidates, now);

    if (dryRun) {
      return new Response(JSON.stringify({
        success: true,
        dry_run: true,
        target_date: targetDate,
        candidates_in: candidates.length,
        mapping_notes: mappingNotes,
        report: slate.report,
        parlays_preview: slate.parlays.slice(0, 5).map(p => ({
          strategy: p.strategy,
          tier: p.tier,
          legs: p.legs.length,
          combined_american_odds: combinedAmericanOdds(p),
          stake_units: p.stake_units,
          rationale: p.rationale,
          legs_detail: p.legs.map(l => ({
            player: l.player_name,
            prop: l.prop_type,
            side: l.side,
            line: l.line,
            odds: l.american_odds,
            sport: l.sport,
            confidence: l.confidence,
            signal: l.signal_source,
          })),
        })),
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Live insert into bot_daily_parlays
    const rows = slate.parlays.map(p => ({
      strategy_name: p.strategy,
      tier: p.tier,
      legs: p.legs.map(l => ({
        player_name: l.player_name,
        prop_type: l.prop_type,
        line: l.line,
        side: l.side,
        american_odds: l.american_odds,
        sport: l.sport,
        confidence: l.confidence,
        signal_source: l.signal_source,
      })),
      leg_count: p.legs.length,
      combined_probability: combinedProbability(p),
      expected_odds: combinedAmericanOdds(p),
      simulated_stake: p.stake_units,
      simulated_edge: combinedProbability(p) / (1.0 / combinedDecimalOdds(p)) - 1.0,
      simulated_payout: p.stake_units * (combinedDecimalOdds(p) - 1.0),
      simulated_win_rate: combinedProbability(p),
      selection_rationale: p.rationale,
      outcome: "pending",
      is_simulated: true,
      parlay_date: targetDate,
      strategy_version: 2,
    }));

    let inserted = 0;
    if (rows.length > 0) {
      const { error: insErr, count } = await sb
        .from("bot_daily_parlays")
        .insert(rows, { count: "exact" });
      if (insErr) throw insErr;
      inserted = count ?? rows.length;
    }

    return new Response(JSON.stringify({
      success: true,
      dry_run: false,
      target_date: targetDate,
      inserted,
      report: slate.report,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[parlay-engine-v2] Error:", msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});