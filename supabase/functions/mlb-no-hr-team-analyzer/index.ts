/**
 * mlb-no-hr-team-analyzer
 *
 * Generates "No Home Run" picks at the TEAM level for today's MLB slate.
 * Mirrors the DraftKings "1st Home Run Type — No" market.
 *
 * Pipeline:
 *  1. Pull today's scheduled MLB games (the_odds_api).
 *  2. For each team in each game:
 *     - Compute team HR/game L30 + season from mlb_player_game_logs
 *     - Resolve opposing starter HR/9 from mlb_player_game_logs (pitcher rows)
 *     - Look up park HR factor by HOME team
 *  3. Run modelTeamNoHR (Poisson p_no_hr).
 *  4. Upsert into mlb_no_hr_team_analysis.
 *  5. For S+A tiers, also upsert into category_sweet_spots
 *     (category=MLB_NO_HR_TEAM) so existing telegram digest +
 *     mlb-over-tracker settlement pick it up automatically.
 *  6. Cap broadcast at top 3 picks/day.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { modelTeamNoHR } from "../_shared/mlb-no-hr-team-model.ts";
import { getParkHRFactor } from "../_shared/mlb-park-factors.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function getEasternDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const MAX_BROADCAST = 3;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const log = (m: string) => console.log(`[no-hr-team] ${m}`);

  try {
    const today = getEasternDate();
    log(`Run for ${today}`);

    // 1) Today's MLB games + announced starters via the_odds_api
    const oddsKey = Deno.env.get("THE_ODDS_API_KEY");
    if (!oddsKey) throw new Error("THE_ODDS_API_KEY not configured");

    const gamesResp = await fetch(
      `https://api.the-odds-api.com/v4/sports/baseball_mlb/odds/?apiKey=${oddsKey}&regions=us&markets=h2h`,
    );
    if (!gamesResp.ok) {
      log(`No MLB games available (status ${gamesResp.status})`);
      return new Response(
        JSON.stringify({ success: true, picks: 0, reason: "no_games" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const games = await gamesResp.json();
    log(`Found ${games.length} MLB games`);

    // 2) Pre-load 60 days of game logs for stat math
    const sixtyAgo = new Date();
    sixtyAgo.setDate(sixtyAgo.getDate() - 60);
    const sixtyStr = sixtyAgo.toISOString().split("T")[0];

    // Always paginate — Supabase hard-caps responses at 1000 rows
    let allLogs: any[] = [];
    const pageSize = 1000;
    let from = 0;
    while (true) {
      const { data: page, error: pErr } = await supabase
        .from("mlb_player_game_logs")
        .select(
          "player_name, team, opponent, game_date, home_runs, innings_pitched, earned_runs, pitcher_strikeouts, pitcher_hits_allowed",
        )
        .gte("game_date", sixtyStr)
        .range(from, from + pageSize - 1);
      if (pErr) { log(`page err: ${pErr.message}`); break; }
      if (!page || page.length === 0) break;
      allLogs = allLogs.concat(page);
      if (page.length < pageSize) break;
      from += pageSize;
      if (from > 100000) break;
    }
    log(`Loaded ${allLogs.length} game logs`);

    // Index logs by team -> [date, hr] and by player -> pitcher HR/9
    const teamHRByDate = new Map<string, Map<string, number>>();
    const pitcherHR = new Map<
      string,
      { ip: number; hr: number }
    >();

    // Track HR allowed by pitcher: requires per-game HR allowed; we approximate
    // using the BATTER side of game logs (sum HR by opponent on that date).
    const oppHRAllowed = new Map<string, Map<string, number>>(); // pitcher_team -> date -> hr_allowed

    for (const r of allLogs) {
      const team = r.team || "";
      const date = r.game_date;
      const hr = r.home_runs ?? 0;
      if (!teamHRByDate.has(team)) teamHRByDate.set(team, new Map());
      const cur = teamHRByDate.get(team)!.get(date) ?? 0;
      teamHRByDate.get(team)!.set(date, cur + hr);

      // Opposing pitcher's team accumulates HR allowed
      const opp = r.opponent || "";
      if (opp) {
        if (!oppHRAllowed.has(opp)) oppHRAllowed.set(opp, new Map());
        const cur2 = oppHRAllowed.get(opp)!.get(date) ?? 0;
        oppHRAllowed.get(opp)!.set(date, cur2 + hr);
      }

      // Pitcher HR/9 from rows where IP > 0
      if ((r.innings_pitched ?? 0) > 0) {
        const key = (r.player_name || "").trim();
        if (!key) continue;
        const cur3 = pitcherHR.get(key) ?? { ip: 0, hr: 0 };
        cur3.ip += Number(r.innings_pitched);
        // We don't have HR allowed on pitcher row; will fall back to team-allowed/start estimate.
        pitcherHR.set(key, cur3);
      }
    }

    // Helper: compute team HR/g over window
    function teamHRPerGame(team: string, days: number) {
      const m = teamHRByDate.get(team);
      if (!m) return { hrPerG: 0, games: 0 };
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      const cutStr = cutoff.toISOString().split("T")[0];
      let g = 0, hr = 0;
      for (const [d, h] of m.entries()) {
        if (d >= cutStr) {
          g += 1;
          hr += h;
        }
      }
      return { hrPerG: g > 0 ? hr / g : 0, games: g };
    }

    // Helper: pitcher HR/9 — approximate from team HR allowed over 30d window.
    // True per-pitcher HR allowed isn't on game-log rows, so we use the
    // pitcher's TEAM HR-allowed rate across his appearance dates as a proxy.
    function pitcherHR9(name: string, pitcherTeam: string) {
      const stats = pitcherHR.get(name);
      if (!stats || stats.ip < 10) return { hr9: null as number | null, ip: stats?.ip ?? 0 };
      // Use opp HR allowed map keyed by pitcher team
      const allowed = oppHRAllowed.get(pitcherTeam);
      if (!allowed) return { hr9: null, ip: stats.ip };
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 30);
      const cutStr = cutoff.toISOString().split("T")[0];
      let games = 0, hr = 0;
      for (const [d, h] of allowed.entries()) {
        if (d >= cutStr) { games += 1; hr += h; }
      }
      // assume ~9 IP per game allocated to staff; pitcher-specific share approximated by IP/total
      // hr9 = team_hr_allowed_per_game (best estimate without play-by-play)
      const hr9 = games > 0 ? hr / games : null;
      return { hr9, ip: stats.ip };
    }

    // 3) Score each team in each game
    const rows: any[] = [];
    const broadcastable: any[] = [];

    for (const g of games) {
      const home = g.home_team;
      const away = g.away_team;
      const startTime = g.commence_time;

      // For each side, the OPPONENT pitcher matters
      for (const side of [
        { team: home, opp: away, isHome: true },
        { team: away, opp: home, isHome: false },
      ]) {
        const l30 = teamHRPerGame(side.team, 30);
        const season = teamHRPerGame(side.team, 180);
        const l7 = teamHRPerGame(side.team, 7);

        // Find opp's most-recent SP (a pitcher row in opp team in last 5 days)
        const oppPitcherRow = allLogs
          .filter((r) =>
            r.team === side.opp && (r.innings_pitched ?? 0) >= 4
          )
          .sort((a, b) => (a.game_date < b.game_date ? 1 : -1))[0];
        const pitcherName = oppPitcherRow?.player_name ?? null;

        const ph = pitcherName
          ? pitcherHR9(pitcherName, side.opp)
          : { hr9: null as number | null, ip: 0 };

        const result = modelTeamNoHR({
          team: side.team,
          opponent: side.opp,
          homeTeam: home,
          teamHRPerGameL30: l30.hrPerG,
          teamGamesL30: l30.games,
          teamHRPerGameSeason: season.hrPerG || l30.hrPerG || 0.95,
          pitcherHR9: ph.hr9,
          pitcherSampleIP: ph.ip,
          teamL7HRPerGame: l7.hrPerG,
        });

        const row = {
          team: side.team,
          opponent: side.opp,
          home_team: home,
          game_date: today,
          opposing_pitcher: pitcherName,
          pitcher_hr9: ph.hr9,
          pitcher_sample_ip: ph.ip,
          park_hr_factor: result.parkFactor,
          weather_mult: 1.0,
          team_hr_per_game_l30: l30.hrPerG,
          team_games_l30: l30.games,
          team_hr_per_game_season: season.hrPerG,
          blended_hr_per_game: result.blendedHRPerGame,
          lambda: result.lambda,
          p_no_hr: result.pNoHR,
          confidence_score: result.confidenceScore,
          tier: result.tier,
          block_reason: result.blockReason,
          recommend: result.tier === "S" || result.tier === "A",
        };
        rows.push(row);
        if (row.recommend) broadcastable.push({ ...row, _start: startTime });
      }
    }

    // 4) Upsert analysis rows
    if (rows.length > 0) {
      // Dedupe by (team, game_date) in case of double-headers / dup game entries
      const seen = new Set<string>();
      const dedupedRows = rows.filter((r) => {
        const k = `${r.team}|${r.game_date}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      const { error: upErr } = await supabase
        .from("mlb_no_hr_team_analysis")
        .upsert(dedupedRows, { onConflict: "team,game_date" });
      if (upErr) log(`upsert analysis err: ${upErr.message}`);
      else log(`upserted ${dedupedRows.length} rows (${rows.length - dedupedRows.length} dupes removed)`);
    }

    // 5) Cap broadcast at 3 best (S first, then A) and push into category_sweet_spots
    // Dedupe broadcast list by team (doubleheaders create dupes)
    const seenBcast = new Set<string>();
    const dedupedBroadcastable = broadcastable.filter((r) => {
      if (seenBcast.has(r.team)) return false;
      seenBcast.add(r.team);
      return true;
    });
    dedupedBroadcastable.sort((a, b) => {
      const tA = a.tier === "S" ? 0 : 1;
      const tB = b.tier === "S" ? 0 : 1;
      if (tA !== tB) return tA - tB;
      return b.p_no_hr - a.p_no_hr;
    });
    const top = dedupedBroadcastable.slice(0, MAX_BROADCAST);

    if (top.length > 0) {
      const sweetRows = top.map((r) => ({
        category: "MLB_NO_HR_TEAM",
        // category_sweet_spots is player-keyed; use team as the "player_name" surrogate
        player_name: r.team,
        prop_type: "team_no_home_run",
        recommended_line: 0.5,
        recommended_side: "under",
        l10_hit_rate: r.p_no_hr,
        confidence_score: r.confidence_score,
        analysis_date: today,
        is_active: true,
        archetype: r.tier,
        risk_level: r.tier === "S" ? "low" : "medium",
        recommendation: `${r.team} vs ${r.opposing_pitcher ?? "TBD"} (${r.opponent}) — p(No HR) ${(r.p_no_hr * 100).toFixed(0)}%`,
      }));

      const { error: ssErr } = await supabase
        .from("category_sweet_spots")
        .upsert(sweetRows, { onConflict: "player_name,prop_type,analysis_date" });
      if (ssErr) log(`sweet_spots upsert err: ${ssErr.message}`);

      // 6) Telegram digest for top S+A picks
      const lines = [
        `🚫 *No Home Run — Team Locks*`,
        `_Standalone bets only · S+A tier · max ${MAX_BROADCAST}/day_`,
        ``,
        ...top.map((r) => {
          const tierEmoji = r.tier === "S" ? "🟢" : "🔵";
          const pct = (r.p_no_hr * 100).toFixed(0);
          const pitcher = r.opposing_pitcher
            ? `vs ${r.opposing_pitcher} (${r.opponent})`
            : `vs ${r.opponent}`;
          const detail = `Team L30 ${r.team_hr_per_game_l30.toFixed(2)} HR/g · Park ${r.park_hr_factor.toFixed(2)} · Pitcher HR/9 ${
            r.pitcher_hr9 != null ? Number(r.pitcher_hr9).toFixed(2) : "n/a"
          }`;
          return `${tierEmoji} *${r.team}* ${pitcher} — p(No HR) *${pct}%* · ${r.tier}\n   ${detail}`;
        }),
      ];
      let broadcastDelivered = 0;
      try {
        const { data: tgData, error: tgErr } = await supabase.functions.invoke(
          "bot-send-telegram",
          {
            body: {
              message: lines.join("\n"),
              parse_mode: "Markdown",
              admin_only: true,
            },
          },
        );
        if (tgErr) {
          log(`telegram broadcast err: ${tgErr.message ?? String(tgErr)}`);
        } else if (tgData && (tgData.success === false || tgData.skipped === true)) {
          log(`telegram broadcast skipped: ${JSON.stringify(tgData)}`);
        } else {
          broadcastDelivered = top.length;
          const teams = top.map((r) => r.team);
          const { error: stampErr } = await supabase
            .from("mlb_no_hr_team_analysis")
            .update({ broadcast_sent_at: new Date().toISOString() })
            .eq("game_date", today)
            .in("team", teams);
          if (stampErr) log(`broadcast_sent_at stamp err: ${stampErr.message}`);
        }
      } catch (tgErr) {
        log(`telegram broadcast err: ${tgErr instanceof Error ? tgErr.message : String(tgErr)}`);
      }
      (globalThis as any).__noHrBroadcastDelivered = broadcastDelivered;
    }

    log(
      `Done — analyzed ${rows.length} sides, ${broadcastable.length} recommendable, ${top.length} broadcast`,
    );

    await supabase.from("cron_job_history").insert({
      job_name: "mlb-no-hr-team-analyzer",
      status: "completed",
      result: {
        analyzed: rows.length,
        recommendable: broadcastable.length,
        broadcast_attempted: top.length,
        broadcast_delivered: (globalThis as any).__noHrBroadcastDelivered ?? 0,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        analyzed: rows.length,
        recommendable: broadcastable.length,
        broadcast_attempted: top.length,
        broadcast_delivered: (globalThis as any).__noHrBroadcastDelivered ?? 0,
        top: top.map((r) => ({
          team: r.team,
          opp: r.opponent,
          tier: r.tier,
          p_no_hr: r.p_no_hr,
        })),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`ERROR: ${msg}`);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});