/**
 * mlb-rbi-under-analyzer
 *
 * Rebuilt RBI Unders scanner. Scores each likely-starting batter on
 * today's slate against four parallel variants (A/B/C/D) and persists
 * one row per (player × variant-passed) for an honest accuracy bake-off.
 *
 * Pipeline:
 *  1. Pull today's MLB games from the_odds_api (h2h).
 *  2. Identify each team's likely starters from mlb_player_game_logs
 *     (last 14 days, AB>=1, top 9 by appearances).
 *  3. Compute season + L15 RBI/PA, L3 RBIs, L10 RBI/PA.
 *  4. Pull batter_rbis Under lines from unified_props (fallback to odds API).
 *  5. Run modelRbiUnder; insert one row per (batter × variant passed).
 *  6. Variant **C** only feeds category_sweet_spots + Telegram broadcast
 *     during the bake-off; A/B/D shadow-track for accuracy comparison.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { modelRbiUnder, RbiVariant } from "../_shared/mlb-rbi-under-model.ts";

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
const PROMOTION_VARIANT: RbiVariant = "C"; // promote variant C to broadcasts during bake-off

// crude park RBI factors (>1.0 inflates run env, <1.0 suppresses)
const PARK_RBI_MULT: Record<string, number> = {
  "Coors Field": 1.20,
  "Great American Ball Park": 1.08,
  "Yankee Stadium": 1.05,
  "Fenway Park": 1.04,
  "Oracle Park": 0.92,
  "Petco Park": 0.93,
  "T-Mobile Park": 0.92,
  "loanDepot park": 0.93,
};

// home-team -> ballpark
const HOME_TEAM_PARK: Record<string, string> = {
  "Colorado Rockies": "Coors Field",
  "Cincinnati Reds": "Great American Ball Park",
  "New York Yankees": "Yankee Stadium",
  "Boston Red Sox": "Fenway Park",
  "San Francisco Giants": "Oracle Park",
  "San Diego Padres": "Petco Park",
  "Seattle Mariners": "T-Mobile Park",
  "Miami Marlins": "loanDepot park",
};

function normName(n: string): string {
  return (n || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\bjr\.?\b|\bsr\.?\b|\bii+\b/g, "")
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const log = (m: string) => console.log(`[rbi-under] ${m}`);

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

    // 180-day batter logs (covers L3, L15, season)
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
          "player_name, team, opponent, game_date, at_bats, walks, rbis, innings_pitched",
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

    // batter index: name -> sorted [{date, rbis, pa, team}]
    const batterIdx = new Map<string, { date: string; rbis: number; pa: number; team: string }[]>();
    for (const r of allLogs) {
      const ip = Number(r.innings_pitched ?? 0);
      if (ip > 0) continue; // skip pitcher rows
      const ab = Number(r.at_bats ?? 0);
      const bb = Number(r.walks ?? 0);
      const pa = ab + bb;
      if (pa <= 0) continue;
      const name = (r.player_name || "").trim();
      if (!name) continue;
      const arr = batterIdx.get(name) ?? [];
      arr.push({
        date: r.game_date,
        rbis: Number(r.rbis ?? 0),
        pa,
        team: r.team || "",
      });
      batterIdx.set(name, arr);
    }
    for (const arr of batterIdx.values()) {
      arr.sort((a, b) => a.date < b.date ? 1 : -1);
    }

    function batterStats(name: string) {
      const rows = batterIdx.get(name) ?? [];
      if (rows.length < 5) return null;
      const seasonPa = rows.reduce((s, r) => s + r.pa, 0);
      const seasonRbi = rows.reduce((s, r) => s + r.rbis, 0);
      const rbiPerPaSeason = seasonPa > 0 ? seasonRbi / seasonPa : null;

      const l15 = rows.slice(0, 15);
      const l15Pa = l15.reduce((s, r) => s + r.pa, 0);
      const l15Rbi = l15.reduce((s, r) => s + r.rbis, 0);
      const rbiPerPaL15 = l15Pa > 0 ? l15Rbi / l15Pa : null;

      const l10 = rows.slice(0, 10);
      const l10Pa = l10.reduce((s, r) => s + r.pa, 0);
      const l10Rbi = l10.reduce((s, r) => s + r.rbis, 0);
      const l10RbiPerPa = l10Pa > 0 ? l10Rbi / l10Pa : null;

      const l3 = rows.slice(0, 3);
      const l3Pa = l3.reduce((s, r) => s + r.pa, 0);
      const l3Rbis = l3.reduce((s, r) => s + r.rbis, 0);

      return {
        seasonPa, rbiPerPaSeason, rbiPerPaL15, l10RbiPerPa,
        l3Rbis, l3Pa, team: rows[0].team,
      };
    }

    // pitcher ERA/K9 lookup (most recent SP per team)
    const pitcherIdx = new Map<string, { date: string; ip: number; er: number; k: number; team: string }[]>();
    for (const r of allLogs) {
      const ip = Number(r.innings_pitched ?? 0);
      if (ip <= 0) continue;
      const name = (r.player_name || "").trim();
      if (!name) continue;
      const arr = pitcherIdx.get(name) ?? [];
      arr.push({
        date: r.game_date,
        ip,
        er: Number((r as any).earned_runs ?? 0),
        k: Number(r.pitcher_strikeouts ?? 0),
        team: r.team || "",
      });
      pitcherIdx.set(name, arr);
    }
    for (const arr of pitcherIdx.values()) {
      arr.sort((a, b) => a.date < b.date ? 1 : -1);
    }

    function teamLikelyPitcher(team: string): { name: string; era: number | null; k9: number | null } | null {
      // Most recent IP>=4 from this team's pitchers (any starter)
      const candidates = allLogs
        .filter((r) => r.team === team && Number(r.innings_pitched ?? 0) >= 4)
        .sort((a, b) => a.game_date < b.game_date ? 1 : -1);
      const recent = candidates[0];
      if (!recent) return null;
      const rows = pitcherIdx.get(recent.player_name) ?? [];
      const ip = rows.reduce((s, r) => s + r.ip, 0);
      const er = rows.reduce((s, r) => s + r.er, 0);
      const k = rows.reduce((s, r) => s + r.k, 0);
      const era = ip > 0 ? (er * 9) / ip : null;
      const k9 = ip > 0 ? (k * 9) / ip : null;
      return { name: recent.player_name, era, k9 };
    }

    // Pre-fetch RBI Under lines from unified_props
    const { data: lines } = await supabase
      .from("unified_props")
      .select("player_name, current_line, sport, prop_type")
      .eq("sport", "baseball_mlb")
      .eq("prop_type", "batter_rbis")
      .eq("is_active", true);
    const lineMap = new Map<string, number>();
    for (const l of (lines || [])) {
      const k = normName(l.player_name || "");
      if (k && l.current_line != null) lineMap.set(k, Number(l.current_line));
    }
    log(`Loaded ${lineMap.size} RBI lines from unified_props`);

    // Fallback: odds API event-odds endpoint, market=batter_rbis
    if (lineMap.size === 0) {
      log(`unified_props empty — falling back to the_odds_api batter_rbis market`);
      let fetched = 0;
      for (const g of games) {
        try {
          const evResp = await fetch(
            `https://api.the-odds-api.com/v4/sports/baseball_mlb/events/${g.id}/odds/?apiKey=${oddsKey}&regions=us&markets=batter_rbis&oddsFormat=american`,
          );
          if (!evResp.ok) continue;
          const ev = await evResp.json();
          for (const bk of (ev.bookmakers || [])) {
            for (const mk of (bk.markets || [])) {
              if (mk.key !== "batter_rbis") continue;
              for (const oc of (mk.outcomes || [])) {
                if (oc.name !== "Under") continue;
                const nname = normName(oc.description || "");
                if (!nname || oc.point == null) continue;
                const pt = Number(oc.point);
                // Reject alt lines outright — main RBI line is 0.5 (occasionally 1.5 for elite power bats).
                if (pt > 1.5) continue;
                // Only keep the lowest (main) line per player; ignore alt lines (1.5/2.5)
                const cur = lineMap.get(nname);
                if (cur == null || pt < cur) {
                  lineMap.set(nname, pt);
                  fetched++;
                }
              }
            }
          }
        } catch (e) {
          log(`event-odds err for ${g.id}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      log(`Fallback added ${fetched} RBI lines`);
    }

    // Likely starters per team (top 9 by recent appearances within last 14 days)
    const recentCutoff = new Date();
    recentCutoff.setDate(recentCutoff.getDate() - 14);
    const recentStr = recentCutoff.toISOString().split("T")[0];
    const teamStarters = new Map<string, string[]>();
    const teamCount = new Map<string, Map<string, number>>();
    for (const r of allLogs) {
      if (Number(r.innings_pitched ?? 0) > 0) continue;
      if (r.game_date < recentStr) continue;
      if (Number(r.at_bats ?? 0) < 1) continue;
      const t = r.team || "";
      if (!t) continue;
      const m = teamCount.get(t) ?? new Map<string, number>();
      m.set(r.player_name, (m.get(r.player_name) ?? 0) + 1);
      teamCount.set(t, m);
    }
    for (const [team, m] of teamCount.entries()) {
      const sorted = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 9);
      teamStarters.set(team, sorted.map((x) => x[0]));
    }

    const rows: any[] = [];
    const broadcastable: any[] = [];

    for (const g of games) {
      const home = g.home_team;
      const away = g.away_team;
      const startTime = g.commence_time;
      const park = HOME_TEAM_PARK[home] ?? "";
      const parkRbiMult = PARK_RBI_MULT[park] ?? 1.0;

      for (const side of [
        { team: home, opp: away },
        { team: away, opp: home },
      ]) {
        const oppPitcher = teamLikelyPitcher(side.opp);
        const starters = teamStarters.get(side.team) ?? [];
        if (starters.length === 0) continue;

        starters.forEach((batterName, idx) => {
          const stats = batterStats(batterName);
          if (!stats) return;
          const lineupSpot = idx + 1; // approx — order = appearance count rank
          const line = lineMap.get(normName(batterName)) ?? null;

          const result = modelRbiUnder({
            playerName: batterName,
            team: side.team,
            opponent: side.opp,
            homeTeam: home,
            park,
            line,
            rbiPerPaL15: stats.rbiPerPaL15,
            rbiPerPaSeason: stats.rbiPerPaSeason,
            paSeason: stats.seasonPa,
            l3Rbis: stats.l3Rbis,
            l3Pa: stats.l3Pa,
            l10RbiPerPa: stats.l10RbiPerPa,
            lineupSpot,
            pitcherEra: oppPitcher?.era ?? null,
            pitcherK9: oppPitcher?.k9 ?? null,
            parkRbiMult,
          });

          // Persist one row per variant the batter passed
          for (const variant of result.variantsPassed) {
            const tier = result.tierByVariant[variant];
            const row = {
              player_name: batterName,
              team: side.team,
              opponent: side.opp,
              opposing_pitcher: oppPitcher?.name ?? "",
              pitcher_era: oppPitcher?.era ?? null,
              pitcher_k_rate: oppPitcher?.k9 ?? null,
              l10_rbis: 0, // legacy column kept for compat; semantic moved to l3/l15
              l10_hit_rate: stats.l10RbiPerPa ?? 0,
              score: result.confidenceScore,
              tier,
              analysis_date: today,
              variant,
              line,
              p_under: result.pUnder,
              edge: result.edge,
              expected_rbi: result.expectedRbi,
              l3_rbis: stats.l3Rbis,
              l3_rbis_per_pa: result.l3RbisPerPa,
              lineup_spot: lineupSpot,
              park,
              reason: `pUnder ${(result.pUnder * 100).toFixed(0)}% · edge ${(result.edge * 100).toFixed(1)}% · xRBI ${result.expectedRbi.toFixed(2)}`,
              result: "PENDING",
            };
            rows.push(row);
            if (variant === PROMOTION_VARIANT) {
              broadcastable.push({ ...row, _start: startTime });
            }
          }
        });
      }
    }

    if (rows.length > 0) {
      // Dedupe: same player can appear via both home- and away-side iterations
      const seenIns = new Set<string>();
      const dedupRows = rows.filter((r) => {
        const key = `${r.player_name}|${r.analysis_date}|${r.variant}`;
        if (seenIns.has(key)) return false;
        seenIns.add(key);
        return true;
      });
      const { error: insErr } = await supabase
        .from("mlb_rbi_under_analysis")
        .upsert(dedupRows, { onConflict: "player_name,analysis_date,variant" });
      if (insErr) log(`upsert err: ${insErr.message}`);
      else log(`upserted ${dedupRows.length} variant-tagged rows (from ${rows.length} pre-dedupe)`);
    }

    // Broadcast top N from variant C
    const seenB = new Set<string>();
    const dedupedBcast = broadcastable.filter((r) => {
      if (seenB.has(r.player_name)) return false;
      seenB.add(r.player_name);
      return true;
    });
    dedupedBcast.sort((a, b) => {
      const tA = a.tier === "S" ? 0 : 1;
      const tB = b.tier === "S" ? 0 : 1;
      if (tA !== tB) return tA - tB;
      return b.p_under - a.p_under;
    });
    const top = dedupedBcast.slice(0, MAX_BROADCAST);
    let broadcastDelivered = 0;

    if (top.length > 0) {
      const sweetRows = top.map((r) => ({
        category: "MLB_BATTER_RBI_UNDER",
        player_name: r.player_name,
        prop_type: "batter_rbis",
        recommended_line: r.line,
        recommended_side: "UNDER",
        l10_hit_rate: r.p_under,
        confidence_score: r.score,
        analysis_date: today,
        is_active: true,
        archetype: r.tier,
        risk_level: r.tier === "S" ? "low" : "medium",
        recommendation: `${r.player_name} (${r.team}) vs ${r.opponent} — Under ${r.line} RBIs · p ${(r.p_under * 100).toFixed(0)}%`,
        projected_value: r.expected_rbi,
      }));

      const { error: ssErr } = await supabase
        .from("category_sweet_spots")
        .upsert(sweetRows, { onConflict: "player_name,prop_type,analysis_date" });
      if (ssErr) log(`sweet_spots err: ${ssErr.message}`);

      const tgLines = [
        `⚾ *RBI Unders — Quiet Bats*`,
        `_Variant C (Bayesian) · S+A tier · max ${MAX_BROADCAST}/day_`,
        ``,
        ...top.map((r) => {
          const e = r.tier === "S" ? "🟢" : "🔵";
          const edgePct = (r.edge * 100).toFixed(1);
          return `${e} *${r.player_name}* (${r.team}) vs ${r.opponent}\n   Under *${r.line}* RBIs · p ${(r.p_under * 100).toFixed(0)}% · edge +${edgePct}% · ${r.tier}\n   xRBI ${r.expected_rbi.toFixed(2)} · L3 RBIs ${r.l3_rbis} · vs ${r.opposing_pitcher}`;
        }),
      ];

      try {
        const { data: tgData, error: tgErr } = await supabase.functions.invoke(
          "bot-send-telegram",
          { body: { message: tgLines.join("\n"), parse_mode: "Markdown", admin_only: true } },
        );
        if (tgErr) log(`telegram err: ${tgErr.message ?? String(tgErr)}`);
        else if (tgData && (tgData.success === false || tgData.skipped === true)) {
          log(`telegram skipped: ${JSON.stringify(tgData)}`);
        } else {
          broadcastDelivered = top.length;
        }
      } catch (e) {
        log(`telegram err: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    const variantSummary: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };
    for (const r of rows) variantSummary[r.variant] = (variantSummary[r.variant] ?? 0) + 1;

    log(`Done — ${rows.length} variant rows · A=${variantSummary.A} B=${variantSummary.B} C=${variantSummary.C} D=${variantSummary.D} · broadcast ${top.length}`);

    await supabase.from("cron_job_history").insert({
      job_name: "mlb-rbi-under-analyzer",
      status: "completed",
      result: {
        variant_rows: rows.length,
        per_variant: variantSummary,
        broadcast_attempted: top.length,
        broadcast_delivered: broadcastDelivered,
      },
    });

    return new Response(JSON.stringify({
      success: true,
      analyzed_variant_rows: rows.length,
      per_variant: variantSummary,
      broadcast_attempted: top.length,
      broadcast_delivered: broadcastDelivered,
      top: top.map((r) => ({
        player: r.player_name, opp: r.opponent, line: r.line,
        p_under: r.p_under, edge: r.edge, tier: r.tier,
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