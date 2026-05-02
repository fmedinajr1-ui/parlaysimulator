/**
 * mlb-pitcher-k-analyzer
 *
 * Replaces the retired team No-HR model. Generates Pitcher Strikeouts
 * OVER picks ("Ace Edge") for today's MLB slate.
 *
 * Pipeline:
 *  1. Pull today's scheduled MLB games via the_odds_api (h2h endpoint).
 *  2. Identify each team's most recent SP from mlb_player_game_logs.
 *  3. Compute K9 (L5 + season Bayesian blend), expected IP (L10 avg).
 *  4. Compute opponent team K-rate (season-to-date) from batter game logs.
 *  5. Pull posted strikeout line from unified_props (prop_type pitcher_strikeouts).
 *  6. Run modelPitcherKOver. Tier S/A → recommend.
 *  7. Upsert mlb_pitcher_k_analysis. Top 3 → category_sweet_spots
 *     (category=MLB_PITCHER_K_OVER) and Telegram broadcast.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { modelPitcherKOver } from "../_shared/mlb-pitcher-k-model.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function getEasternDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

const MAX_BROADCAST = 3;
const LEAGUE_AVG_K_RATE = 0.225;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const log = (m: string) => console.log(`[pitcher-k] ${m}`);

  try {
    const today = getEasternDate();
    log(`Run for ${today}`);

    const oddsKey = Deno.env.get("THE_ODDS_API_KEY");
    if (!oddsKey) throw new Error("THE_ODDS_API_KEY not configured");

    const gamesResp = await fetch(
      `https://api.the-odds-api.com/v4/sports/baseball_mlb/odds/?apiKey=${oddsKey}&regions=us&markets=h2h`,
    );
    if (!gamesResp.ok) {
      log(`No MLB games (status ${gamesResp.status})`);
      return new Response(
        JSON.stringify({ success: true, picks: 0, reason: "no_games" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const games = await gamesResp.json();
    log(`Found ${games.length} MLB games`);

    // Pre-load 180 days of game logs (covers L5 starts + season K-rate)
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 180);
    const cutStr = cutoff.toISOString().split("T")[0];

    let allLogs: any[] = [];
    const pageSize = 1000;
    let from = 0;
    while (true) {
      const { data: page, error: pErr } = await supabase
        .from("mlb_player_game_logs")
        .select(
          "player_name, team, opponent, game_date, at_bats, strikeouts, pitcher_strikeouts, innings_pitched",
        )
        .gte("game_date", cutStr)
        .range(from, from + pageSize - 1);
      if (pErr) { log(`page err: ${pErr.message}`); break; }
      if (!page || page.length === 0) break;
      allLogs = allLogs.concat(page);
      if (page.length < pageSize) break;
      from += pageSize;
      if (from > 200000) break;
    }
    log(`Loaded ${allLogs.length} game logs`);

    // Build pitcher index: name -> sorted [{date, K, IP}, ...]
    const pitcherIdx = new Map<string, { date: string; k: number; ip: number; team: string }[]>();
    // Build team K-rate index: team -> {strikeouts, atBats}
    const teamKRate = new Map<string, { k: number; ab: number }>();

    for (const r of allLogs) {
      const ip = Number(r.innings_pitched ?? 0);
      if (ip > 0) {
        const name = (r.player_name || "").trim();
        if (!name) continue;
        const arr = pitcherIdx.get(name) ?? [];
        arr.push({
          date: r.game_date,
          k: Number(r.pitcher_strikeouts ?? 0),
          ip,
          team: r.team || "",
        });
        pitcherIdx.set(name, arr);
      } else {
        // batter row — feed team K-rate
        const team = r.team || "";
        if (!team) continue;
        const ab = Number(r.at_bats ?? 0);
        const k = Number(r.strikeouts ?? 0);
        if (ab > 0) {
          const cur = teamKRate.get(team) ?? { k: 0, ab: 0 };
          cur.k += k; cur.ab += ab;
          teamKRate.set(team, cur);
        }
      }
    }

    // Sort pitcher rows desc by date
    for (const arr of pitcherIdx.values()) arr.sort((a, b) => a.date < b.date ? 1 : -1);

    function pitcherStats(name: string) {
      const rows = pitcherIdx.get(name) ?? [];
      if (rows.length === 0) return null;
      const startsSeason = rows.length;
      const seasonIp = rows.reduce((s, r) => s + r.ip, 0);
      const seasonK = rows.reduce((s, r) => s + r.k, 0);
      const k9Season = seasonIp > 0 ? (seasonK * 9) / seasonIp : null;
      const l5 = rows.slice(0, 5);
      const l5Ip = l5.reduce((s, r) => s + r.ip, 0);
      const l5K = l5.reduce((s, r) => s + r.k, 0);
      const k9L5 = l5Ip > 0 ? (l5K * 9) / l5Ip : null;
      const l10 = rows.slice(0, 10);
      const expectedIp = l10.length > 0
        ? l10.reduce((s, r) => s + r.ip, 0) / l10.length
        : 0;
      return { startsSeason, k9Season, k9L5, expectedIp, team: rows[0].team };
    }

    function teamKRateValue(team: string): number | null {
      const t = teamKRate.get(team);
      if (!t || t.ab < 200) return null;
      return t.k / t.ab;
    }

    // Pre-fetch posted K lines for today
    const { data: lines } = await supabase
      .from("unified_props")
      .select("player_name, current_line, sport, prop_type")
      .eq("sport", "baseball_mlb")
      .eq("prop_type", "pitcher_strikeouts")
      .eq("is_active", true);
    const lineMap = new Map<string, number>();
    for (const l of (lines || [])) {
      const k = (l.player_name || "").trim().toLowerCase();
      if (k && l.current_line != null) lineMap.set(k, Number(l.current_line));
    }
    log(`Loaded ${lineMap.size} pitcher K lines from unified_props`);

    // Fallback: if unified_props is dry, fetch K lines directly from the_odds_api
    // event-odds endpoint (one call per game, market=pitcher_strikeouts).
    if (lineMap.size === 0) {
      log(`unified_props empty — falling back to the_odds_api pitcher_strikeouts market`);
      let fetched = 0;
      for (const g of games) {
        try {
          const evResp = await fetch(
            `https://api.the-odds-api.com/v4/sports/baseball_mlb/events/${g.id}/odds/?apiKey=${oddsKey}&regions=us&markets=pitcher_strikeouts&oddsFormat=american`,
          );
          if (!evResp.ok) continue;
          const ev = await evResp.json();
          for (const bk of (ev.bookmakers || [])) {
            for (const mk of (bk.markets || [])) {
              if (mk.key !== "pitcher_strikeouts") continue;
              for (const oc of (mk.outcomes || [])) {
                // Outcomes look like: { name: 'Over', description: 'Spencer Strider', point: 7.5, price: -115 }
                if (oc.name !== "Over") continue;
                const name = (oc.description || "").trim().toLowerCase();
                if (name && oc.point != null && !lineMap.has(name)) {
                  lineMap.set(name, Number(oc.point));
                  fetched++;
                }
              }
            }
          }
        } catch (e) {
          log(`event-odds err for ${g.id}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      log(`Fallback added ${fetched} K lines`);
    }

    // Score each game
    const rows: any[] = [];
    const broadcastable: any[] = [];

    for (const g of games) {
      const home = g.home_team;
      const away = g.away_team;
      const startTime = g.commence_time;

      for (const side of [
        { team: home, opp: away, isHome: true },
        { team: away, opp: home, isHome: false },
      ]) {
        // Find side's most recent SP (pitcher row from this team in last 7 days, IP>=4)
        const recent = allLogs
          .filter((r) =>
            r.team === side.team && Number(r.innings_pitched ?? 0) >= 4
          )
          .sort((a, b) => a.game_date < b.game_date ? 1 : -1)[0];
        const pitcherName = recent?.player_name ?? null;
        if (!pitcherName) continue;

        const stats = pitcherStats(pitcherName);
        if (!stats) continue;

        const oppKRate = teamKRateValue(side.opp);
        const line = lineMap.get(pitcherName.toLowerCase()) ?? null;

        const result = modelPitcherKOver({
          pitcherName,
          team: side.team,
          opponent: side.opp,
          homeTeam: home,
          line,
          pitcherK9L5: stats.k9L5,
          pitcherK9Season: stats.k9Season,
          pitcherStartsSeason: stats.startsSeason,
          expectedIP: stats.expectedIp,
          oppKRateSeason: oppKRate,
        });

        const row = {
          pitcher_name: pitcherName,
          team: side.team,
          opponent: side.opp,
          home_team: home,
          game_date: today,
          line,
          pitcher_k9_blended: result.k9Blended,
          pitcher_k9_sample_starts: stats.startsSeason,
          expected_ip: Math.round(stats.expectedIp * 100) / 100,
          opp_k_rate_mult: result.oppKRateMult,
          park_k_mult: result.parkKMult,
          expected_k: result.expectedK,
          p_over: result.pOver,
          edge: result.edge,
          confidence_score: result.confidenceScore,
          tier: result.tier,
          block_reason: result.blockReason,
          recommend: result.tier === "S" || result.tier === "A",
        };
        rows.push(row);
        if (row.recommend) broadcastable.push({ ...row, _start: startTime });
      }
    }

    if (rows.length > 0) {
      const seen = new Set<string>();
      const dedup = rows.filter((r) => {
        const k = `${r.pitcher_name}|${r.game_date}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      const { error: upErr } = await supabase
        .from("mlb_pitcher_k_analysis")
        .upsert(dedup, { onConflict: "pitcher_name,game_date" });
      if (upErr) log(`upsert err: ${upErr.message}`);
      else log(`upserted ${dedup.length} rows`);
    }

    // Broadcast top 3 (S first, then A)
    const seenB = new Set<string>();
    const dedupedBcast = broadcastable.filter((r) => {
      if (seenB.has(r.pitcher_name)) return false;
      seenB.add(r.pitcher_name);
      return true;
    });
    dedupedBcast.sort((a, b) => {
      const tA = a.tier === "S" ? 0 : 1;
      const tB = b.tier === "S" ? 0 : 1;
      if (tA !== tB) return tA - tB;
      return b.p_over - a.p_over;
    });
    const top = dedupedBcast.slice(0, MAX_BROADCAST);
    let broadcastDelivered = 0;

    if (top.length > 0) {
      const sweetRows = top.map((r) => ({
        category: "MLB_PITCHER_K_OVER",
        player_name: r.pitcher_name,
        prop_type: "pitcher_strikeouts",
        recommended_line: r.line,
        recommended_side: "OVER",
        l10_hit_rate: r.p_over,
        confidence_score: r.confidence_score,
        analysis_date: today,
        is_active: true,
        archetype: r.tier,
        risk_level: r.tier === "S" ? "low" : "medium",
        recommendation: `${r.pitcher_name} (${r.team}) vs ${r.opponent} — Over ${r.line} K · p ${(r.p_over * 100).toFixed(0)}%`,
        projected_value: r.expected_k,
      }));

      const { error: ssErr } = await supabase
        .from("category_sweet_spots")
        .upsert(sweetRows, { onConflict: "player_name,prop_type,analysis_date" });
      if (ssErr) log(`sweet_spots err: ${ssErr.message}`);

      const lines = [
        `⚾ *Pitcher Strikeouts — Ace Edge*`,
        `_Standalone Overs · S+A tier · max ${MAX_BROADCAST}/day_`,
        ``,
        ...top.map((r) => {
          const e = r.tier === "S" ? "🟢" : "🔵";
          const edgePct = (r.edge * 100).toFixed(1);
          return `${e} *${r.pitcher_name}* (${r.team}) vs ${r.opponent}\n   Over *${r.line}* K · p ${(r.p_over * 100).toFixed(0)}% · edge +${edgePct}% · ${r.tier}\n   K/9 ${r.pitcher_k9_blended} · xK ${r.expected_k} · IP ${r.expected_ip}`;
        }),
      ];

      try {
        const { data: tgData, error: tgErr } = await supabase.functions.invoke(
          "bot-send-telegram",
          { body: { message: lines.join("\n"), parse_mode: "Markdown", admin_only: true } },
        );
        if (tgErr) log(`telegram err: ${tgErr.message ?? String(tgErr)}`);
        else if (tgData && (tgData.success === false || tgData.skipped === true)) {
          log(`telegram skipped: ${JSON.stringify(tgData)}`);
        } else {
          broadcastDelivered = top.length;
          const names = top.map((r) => r.pitcher_name);
          const { error: stampErr } = await supabase
            .from("mlb_pitcher_k_analysis")
            .update({ broadcast_sent_at: new Date().toISOString() })
            .eq("game_date", today)
            .in("pitcher_name", names);
          if (stampErr) log(`stamp err: ${stampErr.message}`);
        }
      } catch (e) {
        log(`telegram err: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    log(`Done — ${rows.length} analyzed, ${broadcastable.length} recommendable, ${top.length} broadcast`);

    await supabase.from("cron_job_history").insert({
      job_name: "mlb-pitcher-k-analyzer",
      status: "completed",
      result: {
        analyzed: rows.length,
        recommendable: broadcastable.length,
        broadcast_attempted: top.length,
        broadcast_delivered: broadcastDelivered,
      },
    });

    return new Response(JSON.stringify({
      success: true,
      analyzed: rows.length,
      recommendable: broadcastable.length,
      broadcast_attempted: top.length,
      broadcast_delivered: broadcastDelivered,
      top: top.map((r) => ({
        pitcher: r.pitcher_name, opp: r.opponent, line: r.line,
        p_over: r.p_over, edge: r.edge, tier: r.tier,
      })),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`ERROR: ${msg}`);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});