// Nuke Parlay Scout — Phase 1: NBA parlay builder
// For each STRONG/MEDIUM game in nuke_game_scores, build 5-leg parlays from
// templates (role_player_over_carnage, mixed_chaos, star_under_squad), enforce
// odds band [+1000, +3000], persist, and post via bot-send-telegram.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SPORT = "basketball_nba";
const PREFERRED_BOOK = "fanduel";
const MIN_COMBINED = 1000;
const MAX_COMBINED = 3000;
const MAX_JUICE = -140; // worse than this on the picked side → reject leg
const SCORING_PROPS = new Set(["player_points", "player_points_rebounds_assists"]);

function americanToDecimal(o: number): number {
  return o > 0 ? 1 + o / 100 : 1 + 100 / Math.abs(o);
}
function decimalToAmerican(d: number): number {
  if (d >= 2) return Math.round((d - 1) * 100);
  return Math.round(-100 / (d - 1));
}

function easternDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function prettyPropType(t: string): string {
  switch (t) {
    case "player_points": return "Points";
    case "player_rebounds": return "Rebounds";
    case "player_assists": return "Assists";
    case "player_threes": return "Three-Pointers Made";
    case "player_blocks": return "Blocks";
    case "player_steals": return "Steals";
    case "player_points_rebounds": return "Points + Rebounds";
    case "player_points_assists": return "Points + Assists";
    case "player_rebounds_assists": return "Rebounds + Assists";
    case "player_points_rebounds_assists": return "Points + Rebounds + Assists";
    default: return t;
  }
}

type Prop = {
  player_name: string;
  prop_type: string;
  current_line: number;
  over_price: number | null;
  under_price: number | null;
};

type Leg = {
  player: string;
  prop_type: string;
  prop_label: string;
  line: number;
  side: "over" | "under";
  odds: number;
};

function legOk(odds: number | null): boolean {
  if (odds == null) return false;
  // -140 is more negative than -120 (worse). Reject anything WORSE than -140.
  // Worse for the bettor means more negative on a negative line. So reject if odds < -140.
  return odds > MAX_JUICE;
}

function combine(legs: Leg[]): { american: number; decimal: number } {
  const dec = legs.reduce((acc, l) => acc * americanToDecimal(l.odds), 1);
  return { american: decimalToAmerican(dec), decimal: dec };
}

function inBand(american: number): boolean {
  return american >= MIN_COMBINED && american <= MAX_COMBINED;
}

function legFromProp(p: Prop, side: "over" | "under"): Leg | null {
  const odds = side === "over" ? p.over_price : p.under_price;
  if (!legOk(odds)) return null;
  return {
    player: p.player_name,
    prop_type: p.prop_type,
    prop_label: prettyPropType(p.prop_type),
    line: Number(p.current_line),
    side,
    odds: Number(odds),
  };
}

/** Try to assemble exactly 5 legs from a candidate pool, no duplicate players,
 * combined odds in band. Greedy + minor backtracking. */
function assemble(pool: Leg[]): Leg[] | null {
  // Sort by absolute odds — start with shorter legs, swap longer ones in if too-short.
  const byOdds = [...pool].sort((a, b) => Math.abs(americanToDecimal(a.odds) - 1) - Math.abs(americanToDecimal(b.odds) - 1));
  // Try multiple seed strategies
  for (let seed = 0; seed < Math.min(byOdds.length, 12); seed++) {
    const used = new Set<string>();
    const picked: Leg[] = [];
    const order = [...byOdds.slice(seed), ...byOdds.slice(0, seed)];
    for (const l of order) {
      if (picked.length === 5) break;
      if (used.has(l.player)) continue;
      picked.push(l);
      used.add(l.player);
    }
    if (picked.length < 5) continue;
    let { american } = combine(picked);
    if (inBand(american)) return picked;

    // If too short, try swapping in longer legs
    if (american < MIN_COMBINED) {
      const longer = [...pool].sort((a, b) => americanToDecimal(b.odds) - americanToDecimal(a.odds));
      for (const cand of longer) {
        if (used.has(cand.player)) continue;
        for (let i = 0; i < 5; i++) {
          const swapped = [...picked];
          used.delete(swapped[i].player);
          swapped[i] = cand;
          used.add(cand.player);
          const c = combine(swapped).american;
          if (inBand(c)) return swapped;
          used.delete(cand.player);
          used.add(picked[i].player);
        }
      }
    }
    // If too long, try swapping in shorter legs
    if (american > MAX_COMBINED) {
      const shorter = [...pool].sort((a, b) => americanToDecimal(a.odds) - americanToDecimal(b.odds));
      for (const cand of shorter) {
        if (used.has(cand.player)) continue;
        for (let i = 0; i < 5; i++) {
          const swapped = [...picked];
          used.delete(swapped[i].player);
          swapped[i] = cand;
          used.add(cand.player);
          const c = combine(swapped).american;
          if (inBand(c)) return swapped;
          used.delete(cand.player);
          used.add(picked[i].player);
        }
      }
    }
  }
  return null;
}

function buildRolePlayerOverCarnage(props: Prop[]): Leg[] | null {
  const pool: Leg[] = [];
  for (const p of props) {
    if (!SCORING_PROPS.has(p.prop_type)) continue;
    const line = Number(p.current_line);
    if (line < 17.5 || line > 28.5) continue;
    const leg = legFromProp(p, "over");
    if (leg) pool.push(leg);
  }
  return assemble(pool);
}

function buildMixedChaos(props: Prop[], favorite: string, dog: string, teamOf: Map<string, string>): Leg[] | null {
  // 1 fav star UNDER, 1 dog top scorer OVER, 1 dog #2 UNDER, 1 fav role OVER, 1 dog role OVER
  const scoring = props.filter((p) => SCORING_PROPS.has(p.prop_type));
  const sorted = [...scoring].sort((a, b) => Number(b.current_line) - Number(a.current_line));

  const favScoring = sorted.filter((p) => teamOf.get(p.player_name) === favorite);
  const dogScoring = sorted.filter((p) => teamOf.get(p.player_name) === dog);

  const favStars = favScoring.slice(0, 2);
  const dogStars = dogScoring.slice(0, 2);

  const favRoles = favScoring.filter((p) => Number(p.current_line) >= 17.5 && Number(p.current_line) <= 28.5);
  const dogRoles = dogScoring.filter((p) => Number(p.current_line) >= 17.5 && Number(p.current_line) <= 28.5);

  const candidates: Array<Leg | null> = [
    favStars[0] ? legFromProp(favStars[0], "under") : null,
    dogStars[0] ? legFromProp(dogStars[0], "over") : null,
    dogStars[1] ? legFromProp(dogStars[1], "under") : null,
    favRoles.find((p) => !favStars.includes(p)) ? legFromProp(favRoles.find((p) => !favStars.includes(p))!, "over") : null,
    dogRoles.find((p) => !dogStars.includes(p)) ? legFromProp(dogRoles.find((p) => !dogStars.includes(p))!, "over") : null,
  ];

  // Build a wider pool so assemble() can backfill if a candidate is missing.
  const pool: Leg[] = candidates.filter((l): l is Leg => !!l);
  if (pool.length < 5) {
    // Backfill from role pool both sides
    for (const p of [...favRoles, ...dogRoles]) {
      if (pool.some((l) => l.player === p.player_name)) continue;
      const l = legFromProp(p, "over");
      if (l) pool.push(l);
      if (pool.length >= 8) break;
    }
  }
  return assemble(pool);
}

function buildStarUnderSquad(props: Prop[], favorite: string, teamOf: Map<string, string>): Leg[] | null {
  const favScoring = props
    .filter((p) => SCORING_PROPS.has(p.prop_type) && teamOf.get(p.player_name) === favorite)
    .sort((a, b) => Number(b.current_line) - Number(a.current_line));
  const pool: Leg[] = [];
  for (const p of favScoring) {
    const leg = legFromProp(p, "under");
    if (leg) pool.push(leg);
    if (pool.length >= 10) break;
  }
  return assemble(pool);
}

function formatTelegramMessage(game: any, parlays: Array<{ template: string; legs: Leg[]; combined: number }>): string {
  const lines: string[] = [];
  const dt = new Date(game.commence_time);
  const tip = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric", minute: "2-digit", hour12: true,
  }).format(dt);

  lines.push(`🎯 *NUKE WATCH — NBA*`);
  lines.push("");
  lines.push(`📊 *${game.away_team} @ ${game.home_team}*`);
  lines.push(`Tip: ${tip} ET`);
  lines.push(`Script: *${game.script_tier.toUpperCase()}* (${game.script_score}/100)`);
  lines.push("");
  lines.push("Why this script fires:");
  lines.push(`• Spread: ${game.home_spread}`);
  lines.push(`• Favorite ML: ${game.home_ml < game.away_ml ? game.home_ml : game.away_ml}`);
  lines.push(`• Implied gap: ${game.gap_pts} pts`);
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
      lines.push(`${i + 1}. ${l.player} ${sideLabel} ${l.line} (${l.prop_label}) ${l.odds > 0 ? "+" : ""}${l.odds}`);
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

  const body = await req.json().catch(() => ({}));
  const gameDate: string = body.game_date || easternDate();
  const errors: unknown[] = [];

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

  for (const g of games) {
    // Pull props for this game (FanDuel only).
    let props: Prop[] = [];
    try {
      const { data, error } = await supabase
        .from("unified_props")
        .select("player_name, prop_type, current_line, over_price, under_price, game_description")
        .eq("sport", SPORT)
        .eq("bookmaker", PREFERRED_BOOK)
        .eq("is_active", true)
        .ilike("game_description", `%${g.away_team}%${g.home_team}%`);
      if (error) throw error;
      props = (data || []).map((p) => ({
        player_name: p.player_name,
        prop_type: p.prop_type,
        current_line: Number(p.current_line),
        over_price: p.over_price != null ? Number(p.over_price) : null,
        under_price: p.under_price != null ? Number(p.under_price) : null,
      }));
    } catch (e) {
      errors.push({ stage: "fetch_props", game_id: g.game_id, message: String(e) });
      continue;
    }

    if (props.length === 0) continue;

    // Best-effort player→team mapping by alternating top scorers per team.
    // We don't have authoritative roster mapping in unified_props; for Mixed Chaos
    // we approximate: top 2 scoring lines per team is fine for the role split,
    // but team attribution per player isn't available. We skip Mixed Chaos / Star
    // Under Squad if we can't reliably split, and stick to Role Player OVER Carnage.
    // To attempt a split, we look at heuristic — call player from favorite if they
    // appear in props rows whose game_description names favorite first or similar.
    // For Phase 1 simplicity: only fire Role Player OVER Carnage (which doesn't need team split).
    const teamOf = new Map<string, string>(); // empty — skips templates that need it

    const templatesToBuild: Array<{ name: string; legs: Leg[] | null }> = [];

    if (g.script_tier === "strong") {
      templatesToBuild.push({ name: "role_player_over_carnage", legs: buildRolePlayerOverCarnage(props) });
      // Mixed chaos / star under require team mapping → skipped in Phase 1.
    } else if (g.script_tier === "medium") {
      templatesToBuild.push({ name: "role_player_over_carnage", legs: buildRolePlayerOverCarnage(props) });
    }

    const successful: Array<{ template: string; legs: Leg[]; combined: number }> = [];

    for (const t of templatesToBuild) {
      if (!t.legs) {
        errors.push({ stage: "assemble", game_id: g.game_id, template: t.name, reason: "no_valid_combo_in_band" });
        continue;
      }
      const { american, decimal } = combine(t.legs);
      try {
        const { data: ins, error } = await supabase
          .from("nuke_parlays")
          .upsert({
            game_id: g.game_id,
            game_date: gameDate,
            script_tier: g.script_tier,
            template: t.name,
            legs: t.legs,
            combined_odds_american: american,
            combined_odds_decimal: decimal,
          }, { onConflict: "game_id,template,game_date" })
          .select()
          .single();
        if (error) throw error;
        built++;
        if (!ins.posted_to_telegram) {
          successful.push({ template: t.name, legs: t.legs, combined: american });
        }
      } catch (e) {
        errors.push({ stage: "insert_parlay", game_id: g.game_id, template: t.name, message: String(e) });
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
      errors,
    });
  } catch (e) {
    console.error("nuke-build run_log error", e);
  }

  return new Response(JSON.stringify({
    ok: true,
    game_date: gameDate,
    games: games.length,
    parlays_built: built,
    parlays_posted: posted,
    errors,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});