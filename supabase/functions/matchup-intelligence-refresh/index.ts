// matchup-intelligence-refresh
// Builds/refreshes public.matchup_intelligence rows for today + tomorrow (ET)
// from active unified_props + team_defensive_ratings + game_environment +
// bdl_player_cache. Idempotent upsert keyed by (player, prop_type, side, line, game_date).
//
// Defense coverage is currently NBA-only (basketball stats: points, rebounds,
// assists, threes). Non-NBA player props are skipped — the cross-reference
// gracefully no-ops on the consumer side when no row exists.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function etDateKey(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(at);
}

// Map prop_type → team_defensive_ratings.stat_type
function propToStatType(prop: string): string | null {
  const p = prop.toLowerCase();
  if (p === "points") return "points";
  if (p === "rebounds") return "rebounds";
  if (p === "assists") return "assists";
  if (p === "threes" || p === "3-pt made" || p === "3pt made" || p === "threes made") return "threes";
  if (p === "pts+rebs+asts" || p === "pts+rebs" || p === "pts+asts" || p === "rebs+asts") return "points";
  return null;
}

function parseTeams(gameDescription: string | null): { home: string; away: string } {
  if (!gameDescription) return { home: "", away: "" };
  const m = /^(.+?)\s+@\s+(.+?)$/.exec(gameDescription.trim());
  if (!m) return { home: "", away: "" };
  return { away: m[1].trim(), home: m[2].trim() };
}

/** Returns matchup_score on the OVER side for a given defensive rank.
 *  Rank 1 = best defense (bad for Over). Rank 30 = worst defense (good for Over).
 *  Output range approx -5..+5. */
function defenseRankToScore(rank: number | null | undefined): number {
  if (rank == null || !Number.isFinite(rank)) return 0;
  return Math.max(-5, Math.min(5, (rank - 15.5) / 3));
}

function blowoutFromSpread(spread: number | null | undefined): number {
  if (spread == null) return 0;
  const a = Math.abs(Number(spread));
  if (a >= 14) return 0.85;
  if (a >= 10) return 0.6;
  if (a >= 7)  return 0.4;
  return 0.15;
}

function gameScript(spread: number | null | undefined): string {
  if (spread == null) return "COMPETITIVE";
  const a = Math.abs(Number(spread));
  if (a >= 10) return "BLOWOUT_RISK";
  if (a >= 6) return "MODERATE";
  return "COMPETITIVE";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startedAt = Date.now();
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let body: { dry_run?: boolean; dates?: string[] } = {};
    try { body = await req.json(); } catch { /* allow empty */ }
    const dry = body.dry_run === true;

    const today = etDateKey();
    const tomorrow = etDateKey(new Date(Date.now() + 24 * 3600_000));
    const dates = body.dates && body.dates.length ? body.dates : [today, tomorrow];

    // 1) Active NBA player props in the next 48h
    const { data: props, error: propsErr } = await supabase
      .from("unified_props")
      .select("player_name, prop_type, current_line, sport, game_description, commence_time, market_type")
      .eq("is_active", true)
      .eq("sport", "basketball_nba")
      .gt("commence_time", new Date(Date.now() - 30 * 60_000).toISOString())
      .lt("commence_time", new Date(Date.now() + 48 * 3600_000).toISOString());
    if (propsErr) throw new Error(`unified_props: ${propsErr.message}`);

    // 2) Player→team
    const { data: playerRows } = await supabase
      .from("bdl_player_cache")
      .select("player_name, team_name");
    const playerTeam = new Map<string, string>();
    for (const p of (playerRows ?? [])) {
      if (p.player_name && p.team_name) playerTeam.set(String(p.player_name).toLowerCase(), String(p.team_name));
    }

    // 3) Defensive ratings (NBA)
    const { data: defRows } = await supabase
      .from("team_defensive_ratings")
      .select("team_name, stat_type, defensive_rank, stat_allowed_per_game, position_group");
    // Key by team|stat (all positions) — fallback when no position-specific row.
    const defByTeamStat = new Map<string, { rank: number; allowed: number | null; position_group: string | null }>();
    for (const d of (defRows ?? [])) {
      if (!d.team_name || !d.stat_type || d.defensive_rank == null) continue;
      const k = `${String(d.team_name).toLowerCase()}|${String(d.stat_type).toLowerCase()}`;
      // Prefer position_group = 'all' when multiple rows exist.
      const prev = defByTeamStat.get(k);
      if (!prev || (d.position_group ?? "") === "all") {
        defByTeamStat.set(k, { rank: Number(d.defensive_rank), allowed: d.stat_allowed_per_game != null ? Number(d.stat_allowed_per_game) : null, position_group: d.position_group ?? null });
      }
    }

    // 4) Game environment (vegas total / spread / blowout)
    const { data: gameRows } = await supabase
      .from("game_environment")
      .select("home_team, away_team, vegas_total, vegas_spread, blowout_probability, game_date")
      .in("game_date", dates);
    const envByMatchup = new Map<string, { total: number | null; spread: number | null; blowout: number | null }>();
    for (const g of (gameRows ?? [])) {
      if (!g.home_team || !g.away_team) continue;
      const k = `${String(g.away_team).toLowerCase()}@${String(g.home_team).toLowerCase()}`;
      envByMatchup.set(k, {
        total: g.vegas_total != null ? Number(g.vegas_total) : null,
        spread: g.vegas_spread != null ? Number(g.vegas_spread) : null,
        blowout: g.blowout_probability != null ? Number(g.blowout_probability) : null,
      });
    }

    // 5) Build rows for both OVER and UNDER per active player prop.
    type UpRow = {
      player_name: string;
      opponent_team: string;
      prop_type: string;
      side: string;
      line: number;
      game_date: string;
      opponent_defensive_rank: number | null;
      opponent_stat_allowed: number | null;
      matchup_score: number;
      vegas_total: number | null;
      vegas_spread: number | null;
      implied_team_total: number | null;
      blowout_risk: number;
      is_blocked: boolean;
      block_reason: string | null;
      risk_flags: string[];
      confidence_adjustment: number;
      game_script: string;
    };

    const upserts: UpRow[] = [];
    let skippedNoTeam = 0, skippedNoStat = 0, skippedNoDefense = 0, skippedNoPlayer = 0;

    for (const p of (props ?? [])) {
      if ((p.market_type ?? "player") !== "player") continue;
      const player = String(p.player_name ?? "");
      const prop = String(p.prop_type ?? "");
      const line = p.current_line != null ? Number(p.current_line) : null;
      if (!player || !prop || line == null) continue;

      const statType = propToStatType(prop);
      if (!statType) { skippedNoStat++; continue; }

      const team = playerTeam.get(player.toLowerCase());
      if (!team) { skippedNoPlayer++; continue; }

      const { home, away } = parseTeams(p.game_description ?? null);
      if (!home || !away) { skippedNoTeam++; continue; }
      const opponent = team.toLowerCase() === home.toLowerCase() ? away
                     : team.toLowerCase() === away.toLowerCase() ? home
                     : (home.toLowerCase().includes(team.toLowerCase()) ? away : home);

      const def = defByTeamStat.get(`${opponent.toLowerCase()}|${statType}`);
      if (!def) { skippedNoDefense++; continue; }

      const overScore = defenseRankToScore(def.rank);
      const envKey = `${away.toLowerCase()}@${home.toLowerCase()}`;
      const env = envByMatchup.get(envKey);
      const spread = env?.spread ?? null;
      const blowout = env?.blowout ?? blowoutFromSpread(spread);
      const script = gameScript(spread);
      const gameDate = (p.commence_time ?? "").slice(0, 10) || today;

      for (const side of ["OVER", "UNDER"] as const) {
        const matchup_score = side === "OVER" ? overScore : -overScore;
        const risk_flags: string[] = [];
        if (blowout >= 0.7 && side === "OVER") risk_flags.push("BLOWOUT");
        if (def.rank != null && def.rank <= 5 && side === "OVER") risk_flags.push("TOP5_D");
        if (def.rank != null && def.rank >= 26 && side === "UNDER") risk_flags.push("BOTTOM5_D");
        // Hard block: top-3 defense vs Over, OR severe blowout risk on Over.
        const is_blocked = (def.rank != null && def.rank <= 3 && side === "OVER") || (blowout >= 0.85 && side === "OVER");
        const block_reason = is_blocked
          ? (blowout >= 0.85 ? `Severe blowout risk (${(blowout * 100).toFixed(0)}%)` : `Elite defense vs ${statType} (rank ${def.rank})`)
          : null;
        const confidence_adjustment = Math.max(-0.05, Math.min(0.05, matchup_score / 100));

        upserts.push({
          player_name: player,
          opponent_team: opponent,
          prop_type: prop,
          side,
          line,
          game_date: gameDate,
          opponent_defensive_rank: def.rank,
          opponent_stat_allowed: def.allowed,
          matchup_score,
          vegas_total: env?.total ?? null,
          vegas_spread: spread,
          implied_team_total: null,
          blowout_risk: blowout,
          is_blocked,
          block_reason,
          risk_flags,
          confidence_adjustment,
          game_script: script,
        });
      }
    }

    const skipped = { noStat: skippedNoStat, noPlayer: skippedNoPlayer, noTeam: skippedNoTeam, noDefense: skippedNoDefense };
    console.log(`[matchup-refresh] built ${upserts.length} rows; skipped`, skipped);

    let upserted = 0;
    if (!dry && upserts.length > 0) {
      // Chunk to keep payloads small.
      const chunkSize = 500;
      for (let i = 0; i < upserts.length; i += chunkSize) {
        const chunk = upserts.slice(i, i + chunkSize);
        const { error } = await supabase
          .from("matchup_intelligence")
          .upsert(chunk, { onConflict: "player_name,prop_type,side,line,game_date" });
        if (error) {
          // Fallback: try without onConflict (table may lack unique idx) — delete-then-insert per date.
          console.warn("[matchup-refresh] upsert error, falling back to delete+insert:", error.message);
          const datesInChunk = Array.from(new Set(chunk.map(r => r.game_date)));
          await supabase.from("matchup_intelligence").delete().in("game_date", datesInChunk);
          const { error: insErr } = await supabase.from("matchup_intelligence").insert(chunk);
          if (insErr) throw new Error(`insert fallback failed: ${insErr.message}`);
        }
        upserted += chunk.length;
      }
    }

    return new Response(JSON.stringify({
      success: true,
      dry_run: dry,
      dates,
      props_scanned: props?.length ?? 0,
      rows_built: upserts.length,
      rows_upserted: upserted,
      skipped,
      duration_ms: Date.now() - startedAt,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[matchup-refresh] error:", msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});