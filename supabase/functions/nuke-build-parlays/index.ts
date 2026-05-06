// Nuke Parlay Scout — Phase 2: multi-sport parlay builder.
// For each STRONG/MEDIUM game in nuke_game_scores, calls the shared template
// engine in _shared/parlayBuilder.ts to assemble 5-leg parlays with combined
// odds in [+1000, +3000], persists them to nuke_parlays, and posts via
// bot-send-telegram. Active sports: NBA, MLB, soccer, tennis.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildParlays, fetchEspnInjuries, type ParlayLeg, type ScriptForBuilder, type SportKey, type PropForBuilder } from "../_shared/parlayBuilder.ts";
import { RosterClient, normalizeName } from "../_shared/rosters.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PREFERRED_BOOK = "fanduel";

function easternDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

const SPORT_TO_KEY: Record<string, SportKey> = {
  basketball_nba: "nba",
  baseball_mlb: "mlb",
};
function sportKeyFromDb(sport: string): SportKey | null {
  if (SPORT_TO_KEY[sport]) return SPORT_TO_KEY[sport];
  if (sport.startsWith("soccer_")) return "soccer";
  if (sport.startsWith("tennis_")) return "tennis";
  return null;
}
function injuryEspnSport(key: SportKey): string {
  // ESPN injuries supports nba/mlb/nhl/nfl. Soccer/tennis return empty.
  return key;
}

function formatTelegramMessage(game: any, parlays: Array<{ template: string; legs: ParlayLeg[]; combined: number }>): string {
  const lines: string[] = [];
  const dt = new Date(game.commence_time);
  const tip = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric", minute: "2-digit", hour12: true,
  }).format(dt);

  const sportLabel = ({
    basketball_nba: "NBA",
    baseball_mlb: "MLB",
  } as Record<string,string>)[game.sport] ?? (game.sport?.startsWith("soccer_") ? "Soccer" : game.sport?.startsWith("tennis_") ? "Tennis" : (game.sport ?? "").toUpperCase());
  lines.push(`🎯 *NUKE WATCH — ${sportLabel}*`);
  lines.push("");
  lines.push(`📊 *${game.away_team} @ ${game.home_team}*`);
  lines.push(`Start: ${tip} ET`);
  lines.push(`Script: *${game.script_tier.toUpperCase()}* (${game.script_score}/100)`);
  lines.push("");
  lines.push("Why this script fires:");
  if (game.home_spread != null) lines.push(`• Spread: ${game.home_spread}`);
  lines.push(`• Favorite ML: ${game.home_ml < game.away_ml ? game.home_ml : game.away_ml}`);
  if (game.gap_pts) lines.push(`• Implied gap: ${game.gap_pts} pts`);
  lines.push(`• Prop juice signals flagged: ${game.juice_signal_count}`);
  lines.push("");
  lines.push("────────────────");

  parlays.forEach((par, idx) => {
    const tmplName = par.template
      .split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
    lines.push("");
    lines.push(`🎲 *PARLAY ${idx + 1} — ${tmplName}*`);
    lines.push(`Combined: ${par.combined > 0 ? "+" : ""}${par.combined}`);
    lines.push("```");
    par.legs.forEach((l, i) => {
      const sideLabel = l.side === "over" ? "OVER" : "UNDER";
      lines.push(`${i + 1}. ${l.player_name} ${sideLabel} ${l.line} (${l.prop_label}) ${l.odds > 0 ? "+" : ""}${l.odds}`);
    });
    lines.push("```");
    lines.push("────────────────");
  });

  lines.push("");
  lines.push("⚠️ Sizing: 1 unit max per parlay. Script bet, not a lock.");
  lines.push("~5–8% historical hit rate at these prices.");
  return lines.join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  const rosterClient = new RosterClient(supabase);

  const body = await req.json().catch(() => ({}));
  const gameDate: string = body.game_date || easternDate();
  const dryRun: boolean = body.dryRun === true || body.dry_run === true;
  const forceLive: boolean = body.force_live === true;
  const errors: unknown[] = [];
  const lookupsFailedBySport: Record<string, number> = {};

  // ── Backtest evidence gate ────────────────────────────────────────────────
  // Live posting requires a recent backtest run with >=100 STRONG parlays
  // per sport at ROI >= -10%. Override with `force_live: true`.
  let cleared: Set<string> = new Set();
  if (!dryRun && !forceLive) {
    try {
      const { data: recent } = await supabase
        .from("nuke_backtest_runs")
        .select("summary, sports, created_at")
        .order("created_at", { ascending: false })
        .limit(5);
      for (const r of (recent ?? []) as any[]) {
        const groups = r?.summary?.groups ?? {};
        for (const sport of (r.sports ?? [])) {
          const g = groups[`sport_tier:${sport}/strong`];
          if (!g) continue;
          const settled = (g.won ?? 0) + (g.lost ?? 0);
          if (settled >= 100 && (g.roi_pct ?? -999) >= -10) cleared.add(sport);
        }
      }
    } catch (e) {
      errors.push({ stage: "backtest_gate", message: String(e) });
    }
  }

  // Pull qualifying games for the date
  let games: any[] = [];
  try {
    let q = supabase.from("nuke_game_scores").select("*").eq("game_date", gameDate)
      .in("script_tier", ["strong", "medium"]);
    if (Array.isArray(body.game_ids) && body.game_ids.length > 0) {
      q = q.in("game_id", body.game_ids);
    }
    const { data, error } = await q;
    if (error) throw error;
    games = data || [];
  } catch (e) {
    errors.push({ stage: "fetch_games", message: String(e) });
  }

  let built = 0, posted = 0;
  const dryPreview: any[] = [];
  // Per-sport ESPN injury cache (one fetch per sport per run).
  const injuryCache = new Map<SportKey, Set<string>>();
  async function getInjuries(key: SportKey): Promise<Set<string>> {
    if (injuryCache.has(key)) return injuryCache.get(key)!;
    const set = await fetchEspnInjuries(injuryEspnSport(key));
    injuryCache.set(key, set);
    return set;
  }

  for (const g of games) {
    const sportKey = sportKeyFromDb(g.sport);
    if (!sportKey) {
      errors.push({ stage: "unsupported_sport", game_id: g.game_id, sport: g.sport });
      continue;
    }

    // Pull props for this game (FanDuel only).
    let rawProps: any[] = [];
    try {
      const { data, error } = await supabase
        .from("unified_props")
        .select("player_name, prop_type, current_line, over_price, under_price, game_description, event_id")
        .eq("sport", g.sport)
        .eq("bookmaker", PREFERRED_BOOK)
        .eq("is_active", true)
        .ilike("game_description", `%${g.away_team}%${g.home_team}%`);
      if (error) throw error;
      rawProps = data || [];
    } catch (e) {
      errors.push({ stage: "fetch_props", game_id: g.game_id, message: String(e) });
      continue;
    }

    if (rawProps.length === 0) continue;

    // Resolve player→team via rosters when not present on the prop. Only NBA/MLB
    // use roster-based bucketing; soccer/tennis player→team mapping is by event.
    const possibleTeams = [g.home_team, g.away_team];
    const needsLookup = (sportKey === "nba" || sportKey === "mlb")
      ? rawProps.filter((p) => !p.team)
      : [];
    let teamMap = new Map<string, string | null>();
    if (needsLookup.length) {
      try {
        teamMap = await rosterClient.lookupTeamsBatch(
          sportKey,
          needsLookup.map((p) => ({ name: p.player_name, possibleTeams })),
        );
      } catch (e) {
        errors.push({ stage: "roster_lookup", game_id: g.game_id, message: String(e) });
      }
    }

    let lookupsFailed = 0;
    const props: PropForBuilder[] = [];
    for (const p of rawProps) {
      let team = (p as any).team ?? null;
      if (!team && (sportKey === "nba" || sportKey === "mlb")) {
        team = teamMap.get(p.player_name) ?? null;
        if (!team) { lookupsFailed++; continue; }
      }
      if (!team) {
        // For tennis/soccer, treat the player_name itself as the team key when the
        // player IS one side of the matchup (tennis singles); otherwise use ""
        // and let the template fall back to position by name.
        if (sportKey === "tennis") {
          if (normalizeName(p.player_name) === normalizeName(g.home_team)) team = g.home_team;
          else if (normalizeName(p.player_name) === normalizeName(g.away_team)) team = g.away_team;
          else team = "";
        } else {
          team = "";
        }
      }
      props.push({
        player_name: p.player_name,
        team,
        prop_type: p.prop_type,
        current_line: Number(p.current_line),
        over_price: p.over_price != null ? Number(p.over_price) : null,
        under_price: p.under_price != null ? Number(p.under_price) : null,
        event_id: p.event_id ?? undefined,
        event_description: p.game_description ?? undefined,
      });
    }
    if (lookupsFailed) lookupsFailedBySport[sportKey] = (lookupsFailedBySport[sportKey] ?? 0) + lookupsFailed;

    const injuries = await getInjuries(sportKey);

    const script: ScriptForBuilder = {
      game_id: g.game_id,
      sport: sportKey,
      tier: g.script_tier,
      home_team: g.home_team,
      away_team: g.away_team,
      favorite_team: g.favorite_team ?? g.home_team,
      dog_team: g.dog_team ?? g.away_team,
      fav_ml: Number(g.home_ml) <= Number(g.away_ml) ? Number(g.home_ml) : Number(g.away_ml),
      total: g.total != null ? Number(g.total) : null,
    };

    const builtParlays = buildParlays(script, props, { injuries });
    if (!builtParlays.length) {
      errors.push({ stage: "no_valid_parlay", game_id: g.game_id, sport: g.sport, props: props.length });
      continue;
    }

    // Backtest gate: block live posting per-sport unless cleared (or forced).
    if (!dryRun && !forceLive && !cleared.has(sportKey)) {
      errors.push({
        stage: "blocked_insufficient_backtest_evidence",
        game_id: g.game_id,
        sport: sportKey,
        note: "no nuke_backtest_runs row shows >=100 STRONG parlays at ROI >= -10% for this sport. Pass force_live:true to override.",
      });
      continue;
    }

    const successful: Array<{ template: string; legs: ParlayLeg[]; combined: number }> = [];
    if (dryRun) {
      dryPreview.push({
        game_id: g.game_id,
        sport: g.sport,
        matchup: `${g.away_team} @ ${g.home_team}`,
        tier: g.script_tier,
        score: g.script_score,
        spread: g.home_spread,
        fav_ml: script.fav_ml,
        gap: g.gap_pts,
        juice: g.juice_signal_count,
        props_in: rawProps.length,
        props_after_lookup: props.length,
        lookups_failed: lookupsFailed,
        parlays: builtParlays.map((p) => ({
          template: p.template,
          combined: p.combined_odds_american,
          in_window: p.combined_odds_american >= 1000 && p.combined_odds_american <= 3000,
          legs: p.legs.map((l) => `${l.player_name} ${l.side.toUpperCase()} ${l.line} ${l.prop_label} ${l.odds > 0 ? "+" : ""}${l.odds}`),
        })),
      });
      built += builtParlays.length;
      continue;
    }
    for (const par of builtParlays) {
      try {
        const { data: ins, error } = await supabase
          .from("nuke_parlays")
          .upsert({
            game_id: g.game_id,
            game_date: gameDate,
            sport: g.sport,
            script_tier: g.script_tier,
            template: par.template,
            legs: par.legs,
            combined_odds_american: par.combined_odds_american,
            combined_odds_decimal: par.combined_odds_decimal,
          }, { onConflict: "game_id,template,game_date" })
          .select()
          .single();
        if (error) throw error;
        built++;
        if (!ins.posted_to_telegram) {
          successful.push({ template: par.template, legs: par.legs, combined: par.combined_odds_american });
        }
      } catch (e) {
        errors.push({ stage: "insert_parlay", game_id: g.game_id, template: par.template, message: String(e) });
      }
    }

    if (successful.length === 0) continue;

    // Post one Telegram message per game with all parlays
    try {
      const message = formatTelegramMessage(g, successful);
      const tgResp = await fetch(
        `${Deno.env.get("SUPABASE_URL")}/functions/v1/bot-send-telegram`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
          body: JSON.stringify({
            message,
            parse_mode: "Markdown",
            type: "nuke_parlay",
            reference_key: `nuke-${g.game_id}-${gameDate}`,
          }),
        },
      );
      const tgJson = await tgResp.json().catch(() => ({}));
      const messageId = tgJson?.message_id ?? null;

      // Mark all of this game's just-built parlays as posted
      for (const s of successful) {
        await supabase
          .from("nuke_parlays")
          .update({ posted_to_telegram: true, telegram_message_id: messageId })
          .eq("game_id", g.game_id)
          .eq("game_date", gameDate)
          .eq("template", s.template);
        posted++;
      }
    } catch (e) {
      errors.push({ stage: "telegram", game_id: g.game_id, message: String(e) });
    }
  }

  try {
    await supabase.from("nuke_run_log").insert({
      game_date: gameDate,
      phase: "build",
      games_scanned: games.length,
      parlays_built: built,
      parlays_posted: posted,
      errors: [...errors, ...(Object.keys(lookupsFailedBySport).length
        ? [{ stage: "lookups_failed", by_sport: lookupsFailedBySport }] : [])],
    });
  } catch (e) {
    console.error("nuke-build run_log error", e);
  }

  return new Response(JSON.stringify({
    ok: true,
    game_date: gameDate,
    dryRun,
    dryPreview: dryRun ? dryPreview : undefined,
    games: games.length,
    parlays_built: built,
    parlays_posted: posted,
    lookups_failed: lookupsFailedBySport,
    errors,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});