// Nuke Parlay Scout — Phase 1: NBA scorer
// Reads game_bets (spread/total/h2h) + unified_props for today's NBA slate,
// computes blowout-script score, upserts nuke_game_scores, then triggers builder.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SPORT = "basketball_nba";
const PREFERRED_BOOK = "fanduel";
const FALLBACK_BOOKS = ["draftkings", "betmgm", "caesars"];

function easternDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function easternDateRangeUTC(dateET: string): { startUTC: string; endUTC: string } {
  // ET day spans roughly 04:00Z (current day) → 04:00Z (next day) for EST.
  // Use 00:00 ET → 24:00 ET converted via Date math.
  const [y, m, d] = dateET.split("-").map(Number);
  // Local midnight in ET expressed in UTC. ET = UTC-5 (EST) or UTC-4 (EDT).
  // Compute offset by formatting a probe date.
  const probe = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "shortOffset",
  }).format(probe);
  const offsetMatch = fmt.match(/GMT([+-]\d+)/);
  const offsetHours = offsetMatch ? parseInt(offsetMatch[1], 10) : -5;
  const startUTC = new Date(Date.UTC(y, m - 1, d, -offsetHours, 0, 0)).toISOString();
  const endUTC = new Date(Date.UTC(y, m - 1, d + 1, -offsetHours, 0, 0)).toISOString();
  return { startUTC, endUTC };
}

function pickBook<T extends { bookmaker: string }>(rows: T[]): T | null {
  if (rows.length === 0) return null;
  const fd = rows.find((r) => r.bookmaker === PREFERRED_BOOK);
  if (fd) return fd;
  for (const b of FALLBACK_BOOKS) {
    const r = rows.find((x) => x.bookmaker === b);
    if (r) return r;
  }
  return rows[0];
}

function spreadPts(absSpread: number): number {
  if (absSpread >= 14) return 40;
  if (absSpread >= 10) return 35;
  if (absSpread >= 7.5) return 25;
  if (absSpread >= 5) return 10;
  return 0;
}

function mlPts(favML: number): number {
  // favML is negative (e.g. -450)
  const v = Math.abs(favML);
  if (favML >= -150) return 0; // weaker than -150
  if (v >= 700) return 30;
  if (v >= 400) return 25;
  if (v >= 250) return 20;
  if (v >= 150) return 10;
  return 0;
}

function gapPts(gap: number): number {
  if (gap >= 15) return 20;
  if (gap >= 12) return 15;
  if (gap >= 8) return 10;
  if (gap >= 5) return 5;
  return 0;
}

function juicePts(count: number): number {
  if (count >= 4) return 10;
  if (count >= 2) return 5;
  return 0;
}

function tierFor(score: number, absSpread: number, favML: number, gap: number): string {
  if (score >= 80 && absSpread >= 10 && favML <= -400 && gap >= 12) return "strong";
  if (score >= 60) return "medium";
  if (score >= 40) return "weak";
  return "skip";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const body = await req.json().catch(() => ({}));
  const gameDate: string = body.game_date || easternDate();
  const dryRun: boolean = body.dryRun === true || body.dry_run === true;
  const { startUTC, endUTC } = easternDateRangeUTC(gameDate);
  const errors: unknown[] = [];

  // Pull NBA market lines for today (commence between ET 00:00 and 24:00).
  let bets: any[] = [];
  try {
    const { data, error } = await supabase
      .from("game_bets")
      .select("game_id, bet_type, line, home_odds, away_odds, over_odds, under_odds, bookmaker, commence_time, home_team, away_team")
      .eq("sport", SPORT)
      .eq("is_active", true)
      .gte("commence_time", startUTC)
      .lt("commence_time", endUTC);
    if (error) throw error;
    bets = data || [];
  } catch (e) {
    errors.push({ stage: "fetch_game_bets", message: String(e) });
  }

  // Group by game_id
  const byGame = new Map<string, any[]>();
  for (const b of bets) {
    if (!byGame.has(b.game_id)) byGame.set(b.game_id, []);
    byGame.get(b.game_id)!.push(b);
  }

  let strong = 0, medium = 0, weak = 0;
  const triggerGames: string[] = [];

  for (const [gameId, rows] of byGame.entries()) {
    const home = rows[0].home_team;
    const away = rows[0].away_team;
    const commence = rows[0].commence_time;

    const spreadRow = pickBook(rows.filter((r) => r.bet_type === "spread"));
    const totalRow = pickBook(rows.filter((r) => r.bet_type === "total"));
    const h2hRow = pickBook(rows.filter((r) => r.bet_type === "h2h"));

    if (!spreadRow || !h2hRow) continue;

    // game_bets `spread` row: line is HOME spread; away_spread = -line
    const homeSpread = Number(spreadRow.line);
    const awaySpread = -homeSpread;
    const total = totalRow ? Number(totalRow.line) : null;
    const homeML = h2hRow.home_odds != null ? Math.round(Number(h2hRow.home_odds)) : null;
    const awayML = h2hRow.away_odds != null ? Math.round(Number(h2hRow.away_odds)) : null;

    if (homeML == null || awayML == null) continue;

    // Favorite = the side with negative spread; tiebreak by ML
    let favorite: string, dog: string, favML: number, absSpread: number;
    if (homeSpread < 0) {
      favorite = home; dog = away; favML = homeML; absSpread = Math.abs(homeSpread);
    } else if (homeSpread > 0) {
      favorite = away; dog = home; favML = awayML; absSpread = Math.abs(homeSpread);
    } else {
      favorite = homeML < awayML ? home : away;
      dog = favorite === home ? away : home;
      favML = favorite === home ? homeML : awayML;
      absSpread = 0;
    }

    // Implied team-total gap: (total/2 + spread/2) - (total/2 - spread/2) = |spread|
    const gap = total != null ? absSpread : 0;

    // Juice signal: pull props for this event from unified_props (FanDuel only).
    let juiceCount = 0;
    try {
      const { data: props, error: pe } = await supabase
        .from("unified_props")
        .select("player_name, prop_type, current_line, over_price, under_price, game_description")
        .eq("sport", SPORT)
        .eq("bookmaker", PREFERRED_BOOK)
        .eq("is_active", true)
        .ilike("game_description", `%${away}%${home}%`);
      if (pe) throw pe;
      const propRows = props || [];

      // Star = top 2 lines per team in points/PRA pool. Role = lines 17.5–28.5.
      const scoringPool = propRows.filter((p) =>
        ["player_points", "player_points_rebounds_assists"].includes(p.prop_type)
      );
      // Sort all by line desc; top 4 overall ≈ top 2 per team for star approximation.
      const sorted = [...scoringPool].sort((a, b) => Number(b.current_line) - Number(a.current_line));
      const stars = sorted.slice(0, 4);
      for (const s of stars) {
        if (s.under_price != null && Number(s.under_price) >= -120 && Number(s.under_price) <= -100) {
          juiceCount++;
        }
      }
      const roles = scoringPool.filter((p) => Number(p.current_line) >= 17.5 && Number(p.current_line) <= 28.5);
      for (const r of roles) {
        if (r.over_price != null && Number(r.over_price) >= -120 && Number(r.over_price) <= -100) {
          juiceCount++;
        }
      }
    } catch (e) {
      errors.push({ stage: "juice_count", game_id: gameId, message: String(e) });
    }

    const sPts = spreadPts(absSpread);
    const mPts = mlPts(favML);
    const gPts = gapPts(gap);
    const jPts = juicePts(juiceCount);
    const score = sPts + mPts + gPts + jPts;
    const tier = tierFor(score, absSpread, favML, gap);

    if (tier === "strong") strong++;
    else if (tier === "medium") medium++;
    else if (tier === "weak") weak++;

    try {
      const { error: ue } = await supabase
        .from("nuke_game_scores")
        .upsert({
          game_id: gameId,
          game_date: gameDate,
          sport: SPORT,
          home_team: home,
          away_team: away,
          commence_time: commence,
          home_spread: homeSpread,
          away_spread: awaySpread,
          total,
          home_ml: homeML,
          away_ml: awayML,
          favorite_team: favorite,
          dog_team: dog,
          spread_pts: sPts,
          ml_pts: mPts,
          gap_pts: gPts,
          juice_pts: jPts,
          juice_signal_count: juiceCount,
          script_score: score,
          script_tier: tier,
          computed_at: new Date().toISOString(),
        }, { onConflict: "game_id,game_date" });
      if (ue) throw ue;
    } catch (e) {
      errors.push({ stage: "upsert_score", game_id: gameId, message: String(e) });
    }

    if (tier === "strong" || tier === "medium") triggerGames.push(gameId);
  }

  // Trigger builder for qualifying games.
  let buildResp: any = null;
  if (triggerGames.length > 0) {
    try {
      const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/nuke-build-parlays`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({ game_date: gameDate, game_ids: triggerGames }),
      });
      buildResp = await r.json().catch(() => ({ ok: r.ok }));
    } catch (e) {
      errors.push({ stage: "invoke_builder", message: String(e) });
    }
  }

  // Run log
  try {
    await supabase.from("nuke_run_log").insert({
      game_date: gameDate,
      phase: "score",
      games_scanned: byGame.size,
      strong_count: strong,
      medium_count: medium,
      weak_count: weak,
      errors,
      notes: `triggered builder for ${triggerGames.length} games`,
    });
  } catch (e) {
    console.error("nuke-score-games run_log error", e);
  }

  return new Response(JSON.stringify({
    ok: true,
    game_date: gameDate,
    games_scanned: byGame.size,
    strong, medium, weak,
    triggered: triggerGames.length,
    build: buildResp,
    errors,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});