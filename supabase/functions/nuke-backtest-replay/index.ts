// Nuke Backtest Phase 2 — replays historical slates through the LIVE
// scoreGame() + buildParlays() code, grades every parlay leg-by-leg, and
// writes results to nuke_backtest_runs / nuke_backtest_parlays.
//
// POST { mode: "replay" | "report" | "both",
//        date_start: "YYYY-MM-DD", date_end: "YYYY-MM-DD",
//        sports?: ("nba"|"mlb"|"soccer"|"tennis")[], run_name?: string }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  buildParlays,
  PropForBuilder,
  ScriptForBuilder,
  SportKey,
  ScriptTier,
  americanToDecimal,
} from "../_shared/parlayBuilder.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function notifyTelegram(text: string): Promise<{ ok: boolean; error?: string }> {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const chatId = Deno.env.get("TELEGRAM_CHAT_ID");
  if (!token || !chatId) return { ok: false, error: "telegram secrets missing" };
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    if (!r.ok) return { ok: false, error: `tg ${r.status}: ${await r.text()}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

function fmtBacktestReport(runName: string, dateStart: string, dateEnd: string, report: any, stats: Record<string, any>): string {
  const lines: string[] = [];
  lines.push(`<b>🧪 Backtest: ${runName}</b>`);
  lines.push(`<i>${dateStart} → ${dateEnd}</i>`);
  lines.push(`Total parlays: <b>${report.total_parlays}</b>`);
  lines.push(`Max drawdown: <b>${report.max_drawdown_units}u</b>  •  Longest losing streak: <b>${report.longest_losing_streak}</b>`);
  const overall = report.groups?.overall;
  if (overall) {
    lines.push(`\n<b>Overall</b>: ${overall.won}-${overall.lost} (DNP ${overall.dnp})  •  Hit ${overall.hit_rate ?? "—"}  •  ROI <b>${overall.roi_pct ?? "—"}%</b>`);
  }
  lines.push(`\n<b>By sport / tier</b>`);
  for (const [k, g] of Object.entries(report.groups ?? {}) as [string, any][]) {
    if (!k.startsWith("sport_tier:")) continue;
    const verdict = g.roi_pct == null ? "—" : g.roi_pct >= 0 ? "✅" : g.roi_pct >= -10 ? "⚠️" : "❌";
    lines.push(`${verdict} <code>${k.replace("sport_tier:", "")}</code>: n=${g.n}, ${g.won}-${g.lost}, hit ${g.hit_rate ?? "—"}, ROI ${g.roi_pct ?? "—"}%`);
  }
  lines.push(`\n<b>Per-sport replay</b>`);
  for (const [sport, s] of Object.entries(stats)) {
    const ss = s as any;
    lines.push(`• ${sport}: games ${ss.games}, parlays ${ss.parlays}, profit ${ss.profit.toFixed(2)}u`);
  }
  return lines.join("\n");
}

// ── Inline copy of the scoring rubric from nuke-score-games (we don't import
// because that file ships an HTTP handler, not a pure scorer).
function spreadPts(s: number) { return s>=14?40:s>=10?35:s>=7.5?25:s>=5?10:0; }
function mlPts(m: number) { const v=Math.abs(m); if(m>=-150)return 0; return v>=700?30:v>=400?25:v>=250?20:v>=150?10:0; }
function gapPts(g: number) { return g>=15?20:g>=12?15:g>=8?10:g>=5?5:0; }
function juicePts(c: number) { return c>=4?10:c>=2?5:0; }
interface TierThresholds {
  strong_score: number; strong_spread: number; strong_fav_ml: number; strong_gap: number;
  medium_score: number; weak_score: number;
}
const DEFAULT_THRESHOLDS: TierThresholds = {
  // Loosened defaults — old values were 80/10/-400/12 (too strict, only 2 STRONG / 30 days NBA)
  strong_score: 70, strong_spread: 8, strong_fav_ml: -275, strong_gap: 8,
  medium_score: 50, weak_score: 35,
};
function tierForT(score: number, abs: number, fav: number, gap: number, t: TierThresholds): ScriptTier {
  if (score>=t.strong_score && abs>=t.strong_spread && fav<=t.strong_fav_ml && gap>=t.strong_gap) return "strong";
  if (score>=t.medium_score) return "medium";
  if (score>=t.weak_score) return "weak";
  return "skip";
}

function combinedAmerican(legOdds: number[]): number {
  if (!legOdds.length) return 0;
  const dec = legOdds.map(americanToDecimal).reduce((a,b)=>a*b, 1);
  if (dec >= 2) return Math.round((dec - 1) * 100);
  return Math.round(-100 / (dec - 1));
}

interface HistGame {
  id: string; sport: string; game_date: string;
  home: string; away: string;
  spread: number | null; total: number | null;
  ml_home: number | null; ml_away: number | null;
  actual_home_score: number | null; actual_away_score: number | null;
  settled: boolean;
}

interface HistProp {
  id: string; game_id: string; player: string; prop_type: string;
  side: string; line: number; price: number;
  actual_value: number | null; result: string | null;
}

function gradeLeg(line: number, side: "over"|"under", actual: number | null): "won"|"lost"|"push"|"dnp" {
  if (actual == null || isNaN(actual)) return "dnp";
  if (actual === line) return "push";
  if (side === "over")  return actual > line ? "won" : "lost";
  return actual < line ? "won" : "lost";
}

function profitUnits(combinedAmerican: number, outcome: "won"|"lost"|"push"|"dnp"): number {
  if (outcome === "lost") return -1;
  if (outcome === "won") {
    return combinedAmerican > 0 ? combinedAmerican / 100 : 100 / Math.abs(combinedAmerican);
  }
  return 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const body = await req.json().catch(() => ({}));
  const mode: string = body.mode ?? "both";
  const dateStart: string = body.date_start;
  const dateEnd: string = body.date_end;
  const sports: SportKey[] = (body.sports ?? ["nba","mlb","soccer","tennis"]) as SportKey[];
  const runName: string = body.run_name ?? `replay_${dateStart}_${dateEnd}`;
  const notifyAdmin: boolean = body.notify_admin !== false; // default true
  const thresholds: TierThresholds = { ...DEFAULT_THRESHOLDS, ...(body.thresholds ?? {}) };
  const minOdds: number = body.min_odds ?? 1000;
  const maxOdds: number = body.max_odds ?? 3000;
  const relaxJuice: boolean = body.relax_juice !== false; // default true for backtest
  const debug: boolean = body.debug === true;
  const debugRows: any[] = [];

  if (!dateStart || !dateEnd) {
    return new Response(JSON.stringify({ ok: false, error: "date_start and date_end required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Create the run row up front so parlays can attach.
  const { data: runRow, error: runErr } = await sb
    .from("nuke_backtest_runs")
    .insert({ run_name: runName, window_start: dateStart, window_end: dateEnd, sports })
    .select("id").single();
  if (runErr || !runRow) {
    return new Response(JSON.stringify({ ok: false, error: String(runErr) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const runId = runRow.id;

  let parlaysWritten = 0;
  const stats: Record<string, any> = {};

  if (mode === "replay" || mode === "both") {
    // Pull historical games in window for requested sports.
    const { data: games, error: gErr } = await sb
      .from("nuke_historical_games")
      .select("*")
      .gte("game_date", dateStart).lte("game_date", dateEnd)
      .in("sport", sports);
    if (gErr) {
      return new Response(JSON.stringify({ ok: false, error: String(gErr), stage: "fetch_games" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const allGames = (games ?? []) as HistGame[];

    // Pull props for those games in one shot.
    const ids = allGames.map(g => g.id);
    let propsByGame = new Map<string, HistProp[]>();
    if (ids.length) {
      // chunk to stay under URL length
      for (let i = 0; i < ids.length; i += 200) {
        const chunk = ids.slice(i, i + 200);
        const { data: pr, error: pErr } = await sb
          .from("nuke_historical_props").select("*").in("game_id", chunk);
        if (pErr) continue;
        for (const p of (pr ?? []) as HistProp[]) {
          if (!propsByGame.has(p.game_id)) propsByGame.set(p.game_id, []);
          propsByGame.get(p.game_id)!.push(p);
        }
      }
    }

    // Fill prop actual_value from prop_results_archive lookup if missing.
    const need = (Array.from(propsByGame.values()).flat()).filter(p => p.actual_value == null);
    if (need.length) {
      // Load by sport+date+player batches.
      const byKey = new Map<string, HistProp[]>();
      const gameById = new Map(allGames.map(g => [g.id, g]));
      for (const p of need) {
        const g = gameById.get(p.game_id); if (!g) continue;
        const k = `${g.sport}|${g.game_date}`;
        if (!byKey.has(k)) byKey.set(k, []);
        byKey.get(k)!.push(p);
      }
      for (const [k, plist] of byKey.entries()) {
        const [sport, date] = k.split("|");
        const players = Array.from(new Set(plist.map(p => p.player)));
        const { data: pr } = await sb
          .from("prop_results_archive")
          .select("player_name, prop_type, actual_value")
          .eq("sport", sport).eq("game_date", date)
          .in("player_name", players);
        const lookup = new Map<string, number>();
        for (const r of (pr ?? []) as any[]) {
          lookup.set(`${(r.player_name ?? "").toLowerCase()}|${r.prop_type}`, Number(r.actual_value));
        }
        for (const p of plist) {
          const v = lookup.get(`${p.player.toLowerCase()}|${p.prop_type}`);
          if (v != null && !isNaN(v)) p.actual_value = v;
        }
      }
    }

    // Per game: build script, score, run buildParlays, grade.
    for (const g of allGames) {
      const sport = g.sport as SportKey;
      const props = propsByGame.get(g.id) ?? [];
      if (g.spread == null || g.ml_home == null || g.ml_away == null) continue;

      const homeSpread = Number(g.spread);
      const absSpread = Math.abs(homeSpread);
      const favorite = homeSpread <= 0 ? g.home : g.away;
      const dog = favorite === g.home ? g.away : g.home;
      const favML = favorite === g.home ? g.ml_home : g.ml_away;
      const total = g.total;
      const gap = total != null ? absSpread : 0;

      // Juice signal count (NBA-style — for non-NBA we still compute, contributes 0 mostly)
      let juiceCount = 0;
      const scoringPool = props.filter(p => ["player_points","player_points_rebounds_assists"].includes(p.prop_type));
      const sorted = [...scoringPool].sort((a,b)=>b.line-a.line).slice(0,4);
      for (const s of sorted) {
        if (s.side === "under" && s.price >= -120 && s.price <= -100) juiceCount++;
      }
      const roles = scoringPool.filter(p => p.line >= 17.5 && p.line <= 28.5);
      for (const r of roles) {
        if (r.side === "over" && r.price >= -120 && r.price <= -100) juiceCount++;
      }

      const score = spreadPts(absSpread) + mlPts(favML) + gapPts(gap) + juicePts(juiceCount);
      const tier = tierForT(score, absSpread, favML, gap, thresholds);
      if (tier !== "strong" && tier !== "medium") continue;

      // Pivot props: combine over/under rows into one PropForBuilder per (player,prop_type,line)
      const propMap = new Map<string, PropForBuilder>();
      for (const p of props) {
        const k = `${p.player}|${p.prop_type}|${p.line}`;
        const existing = propMap.get(k);
        if (existing) {
          if (p.side === "over") existing.over_price = p.price;
          else existing.under_price = p.price;
        } else {
          propMap.set(k, {
            player_name: p.player,
            team: null, // we don't have team-per-player in historical props; templates that need team will skip
            prop_type: p.prop_type,
            current_line: p.line,
            over_price: p.side === "over" ? p.price : null,
            under_price: p.side === "under" ? p.price : null,
          });
        }
      }
      const builderProps = Array.from(propMap.values());

      // Best-effort team attribution from prop_results_archive
      const players = Array.from(new Set(builderProps.map(p => p.player_name)));
      if (players.length) {
        const { data: teamRows } = await sb
          .from("prop_results_archive")
          .select("player_name, team_name")
          .eq("sport", sport).eq("game_date", g.game_date)
          .in("player_name", players);
        const teamMap = new Map<string, string>();
        for (const r of (teamRows ?? []) as any[]) {
          if (r.team_name) teamMap.set((r.player_name ?? "").toLowerCase(), r.team_name);
        }
        for (const bp of builderProps) {
          const t = teamMap.get(bp.player_name.toLowerCase());
          if (t) bp.team = t;
        }
      }

      const script: ScriptForBuilder = {
        game_id: g.id,
        sport,
        tier,
        home_team: g.home, away_team: g.away,
        favorite_team: favorite, dog_team: dog,
        fav_ml: favML, total: total ?? null,
      };

      const built = buildParlays(script, builderProps, { minOdds, maxOdds, relaxJuice });
      if (debug) {
        debugRows.push({
          game: `${g.away}@${g.home}`, date: g.game_date, sport,
          tier, score, absSpread, favML, gap,
          builder_props: builderProps.length,
          parlays_built: built.length,
          parlay_odds: built.map(b => b.combined_odds_american),
        });
      }

      const sStat = stats[sport] ??= { games: 0, parlays: 0, won: 0, lost: 0, dnp: 0, profit: 0 };
      sStat.games++;

      // Grade each parlay
      const propActual = new Map<string, number>();
      for (const p of props) if (p.actual_value != null) propActual.set(`${p.player.toLowerCase()}|${p.prop_type}`, p.actual_value);

      for (const parlay of built) {
        let won = 0, lost = 0, dnp = 0, push = 0;
        for (const leg of parlay.legs) {
          const a = propActual.get(`${leg.player_name.toLowerCase()}|${leg.prop_type}`);
          const r = gradeLeg(leg.line, leg.side, a ?? null);
          if (r === "won") won++; else if (r === "lost") lost++; else if (r === "push") push++; else dnp++;
        }
        let outcome: "won"|"lost"|"push"|"dnp";
        if (lost > 0) outcome = "lost";
        else if (dnp > 0) outcome = "dnp";
        else if (won + push === parlay.legs.length) outcome = "won";
        else outcome = "dnp";

        const profit = profitUnits(parlay.combined_odds_american, outcome);
        sStat.parlays++;
        if (outcome === "won") sStat.won++;
        else if (outcome === "lost") sStat.lost++;
        else sStat.dnp++;
        sStat.profit += profit;

        const inWindow = parlay.combined_odds_american >= 1000 && parlay.combined_odds_american <= 3000;
        await sb.from("nuke_backtest_parlays").insert({
          run_id: runId,
          parlay_date: g.game_date,
          sport,
          game_ref: `${g.away}@${g.home}`,
          tier,
          template: parlay.template,
          legs: parlay.legs as unknown as object,
          combined_odds: parlay.combined_odds_american,
          in_window: inWindow,
          outcome,
          profit_units: profit,
        });
        parlaysWritten++;
      }
    }
  }

  // ── Report aggregation ────────────────────────────────────────────────────
  let report: any = null;
  if (mode === "report" || mode === "both") {
    const { data: rows } = await sb
      .from("nuke_backtest_parlays")
      .select("sport, tier, template, outcome, combined_odds, profit_units, in_window")
      .eq("run_id", runId);

    const all = (rows ?? []) as any[];
    const groups: Record<string, any> = {};
    function bump(key: string, r: any) {
      const g = groups[key] ??= { n: 0, won: 0, lost: 0, dnp: 0, staked: 0, profit: 0, in_window: 0 };
      g.n++;
      if (r.outcome === "won") g.won++;
      else if (r.outcome === "lost") g.lost++;
      else g.dnp++;
      if (r.outcome === "won" || r.outcome === "lost") { g.staked += 1; g.profit += Number(r.profit_units); }
      if (r.in_window) g.in_window++;
    }
    for (const r of all) {
      bump(`overall`, r);
      bump(`sport:${r.sport}`, r);
      bump(`tier:${r.tier}`, r);
      bump(`sport_tier:${r.sport}/${r.tier}`, r);
      bump(`template:${r.template}`, r);
    }
    function finalize(g: any) {
      const settled = g.won + g.lost;
      g.hit_rate = settled ? +(g.won / settled).toFixed(3) : null;
      g.roi_pct = g.staked ? +((g.profit / g.staked) * 100).toFixed(2) : null;
      g.in_window_pct = g.n ? +((g.in_window / g.n) * 100).toFixed(1) : 0;
      return g;
    }
    Object.values(groups).forEach(finalize);

    // Max drawdown across all parlays in chronological order
    const sorted = [...all].sort(() => 0); // already inserted in order
    let peak = 0, running = 0, maxDD = 0, longestLossStreak = 0, currentLoss = 0;
    for (const r of sorted) {
      if (r.outcome === "won" || r.outcome === "lost") {
        running += Number(r.profit_units);
        if (running > peak) peak = running;
        if (peak - running > maxDD) maxDD = peak - running;
      }
      if (r.outcome === "lost") { currentLoss++; if (currentLoss > longestLossStreak) longestLossStreak = currentLoss; }
      else if (r.outcome === "won") currentLoss = 0;
    }

    report = {
      total_parlays: all.length,
      max_drawdown_units: +maxDD.toFixed(2),
      longest_losing_streak: longestLossStreak,
      groups,
    };

    await sb.from("nuke_backtest_runs").update({ summary: report }).eq("id", runId);
  }

  let telegram: { ok: boolean; error?: string } | null = null;
  if (notifyAdmin && report) {
    telegram = await notifyTelegram(fmtBacktestReport(runName, dateStart, dateEnd, report, stats));
  }

  return new Response(JSON.stringify({
    ok: true,
    run_id: runId,
    run_name: runName,
    parlays_written: parlaysWritten,
    per_sport_replay: stats,
    thresholds,
    min_odds: minOdds, max_odds: maxOdds,
    debug: debug ? debugRows.slice(0, 50) : undefined,
    report,
    telegram,
  }, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});