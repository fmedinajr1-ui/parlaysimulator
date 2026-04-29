// Court.Edge — orchestrator. Fetch odds + PrizePicks, scrape L3, fetch weather,
// project, rank, persist, push Telegram digest.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  project,
  edgeFor,
  type ProjectionInput,
  type Verdict,
} from "../_shared/court-edge-projection.ts";
import { detectTournament, type TournamentMeta } from "../_shared/court-edge-tournaments.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function easternDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

interface OddsEvent {
  event_id: string;
  sport_key: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  total_point: number | null;
  ml_home: number | null;
  ml_away: number | null;
  bookmaker: string | null;
}

interface PPProj {
  player: string;
  league: string;
  stat_type: string;
  line: number;
  start_at: string;
  description?: string;
}

interface L3Map {
  [playerName: string]: { ok: boolean; totals?: number[]; error?: string };
}

interface Pick {
  source: "odds_api" | "prizepicks";
  matchup: string | null;
  player: string | null;
  opponent: string | null;
  market: "match_total" | "player_total_games";
  line: number;
  projection: number;
  edge: number;
  edge_pct: number;
  verdict: Verdict;
  formula: Record<string, unknown>;
  tournament: string;
  surface: string;
  sets_format: string;
  indoor: boolean;
  weather: Record<string, unknown> | null;
  commence_at: string | null;
}

const VERDICT_ORDER: Verdict[] = ["STRONG_OVER", "STRONG_UNDER", "LEAN_OVER", "LEAN_UNDER", "PASS"];

function verdictHeader(v: Verdict) {
  switch (v) {
    case "STRONG_OVER": return "🟢 STRONG OVER";
    case "STRONG_UNDER": return "🔴 STRONG UNDER";
    case "LEAN_OVER": return "🟡 LEAN OVER";
    case "LEAN_UNDER": return "🟠 LEAN UNDER";
    default: return "⚪ PASS";
  }
}

function fmtPct(n: number) {
  const s = n >= 0 ? "+" : "";
  return `${s}${n.toFixed(1)}%`;
}

async function callFunction(name: string, body: Record<string, unknown> = {}): Promise<any> {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/${name}`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
    },
    body: JSON.stringify(body),
  });
  return r.json().catch(() => ({ ok: false, error: `non-json from ${name}` }));
}

function buildDigest(picks: Pick[], meta: { date: string; tournament: TournamentMeta; weather: any | null; sources: Record<string, string>; runId: string; errors: number }): string {
  const tHdr = `${meta.tournament.name} · ${meta.tournament.surface} · ${meta.tournament.sets_format} · ${meta.tournament.indoor ? "indoor" : "outdoor"}${meta.weather?.temp_f != null ? ` · ${Math.round(meta.weather.temp_f)}°F` : ""}`;
  const lines: string[] = [];
  lines.push(`🎾 *COURT.EDGE — ${meta.date}* (${tHdr})`);
  lines.push("");

  const grouped: Record<Verdict, Pick[]> = {
    STRONG_OVER: [], STRONG_UNDER: [], LEAN_OVER: [], LEAN_UNDER: [], PASS: [],
  };
  for (const p of picks) grouped[p.verdict].push(p);

  let printed = 0;
  for (const v of VERDICT_ORDER) {
    if (v === "PASS") continue;
    const list = grouped[v];
    if (list.length === 0) continue;
    lines.push(`*${verdictHeader(v)}*`);
    for (const p of list.slice(0, 8)) {
      const label = p.market === "match_total"
        ? `${p.matchup} — Match Total Games`
        : `${p.player} — Total Games Won`;
      const src = p.source === "odds_api" ? "OddsAPI" : "PrizePicks";
      lines.push(`• ${label}\n   line ${p.line}  proj ${p.projection.toFixed(2)}  edge ${fmtPct(p.edge_pct)}  [${src}]`);
      printed += 1;
    }
    lines.push("");
  }

  const leans = grouped.LEAN_OVER.length + grouped.LEAN_UNDER.length;
  const passes = grouped.PASS.length;
  if (printed === 0) lines.push("_No actionable edges right now. Try again after the next slate refresh._\n");
  lines.push(`Leans ${leans}  ·  Pass ${passes}`);
  lines.push(`Sources: Odds API ${meta.sources.odds}  ·  PrizePicks ${meta.sources.pp}  ·  TennisAbstract ${meta.sources.l3}  ·  Weather ${meta.sources.wx}`);
  lines.push(`Run \`${meta.runId.slice(0, 8)}\`  ·  picks ${picks.length}  ·  errors ${meta.errors}`);
  return lines.join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const startedAt = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const log: string[] = [];
  const errors: Array<{ step: string; error: string }> = [];
  const push = (m: string) => { console.log(`[court-edge-run] ${m}`); log.push(m); };

  let runId = "";
  try {
    const body = (await req.json().catch(() => ({}))) as { source?: string };
    const source = body.source === "cron" ? "cron" : "manual";
    push(`Court.Edge run start (source=${source})`);

    // Insert run row (we'll update later)
    const ins = await supabase
      .from("court_edge_runs")
      .insert({ source, log: [], picks_count: 0, errors: [] })
      .select("id")
      .single();
    if (ins.error) throw new Error(`run insert failed: ${ins.error.message}`);
    runId = ins.data.id;

    // 1. Fetch odds + prizepicks in parallel
    const [oddsRes, ppRes] = await Promise.all([
      callFunction("court-edge-fetch-odds").catch((e) => ({ ok: false, error: String(e) })),
      callFunction("court-edge-fetch-prizepicks").catch((e) => ({ ok: false, error: String(e) })),
    ]);

    const oddsEvents: OddsEvent[] = oddsRes?.ok ? (oddsRes.events || []) : [];
    const ppProjs: PPProj[] = ppRes?.ok ? (ppRes.projections || []) : [];
    if (!oddsRes?.ok) errors.push({ step: "odds", error: oddsRes?.error || "unknown" });
    if (!ppRes?.ok) errors.push({ step: "prizepicks", error: ppRes?.error || "unknown" });
    push(`Odds events: ${oddsEvents.length}  ·  PrizePicks projections: ${ppProjs.length}`);

    if (oddsEvents.length === 0 && ppProjs.length === 0) {
      throw new Error("no input props from any source");
    }

    // 2. Detect tournament from first event hints
    const hint = oddsEvents[0];
    const tournament = detectTournament(hint?.sport_key, hint?.home_team, hint?.away_team);
    push(`Tournament: ${tournament.name} (${tournament.surface}, ${tournament.sets_format}, ${tournament.indoor ? "indoor" : "outdoor"}, ${tournament.city})`);

    // 3. Weather
    const wxRes = await callFunction("court-edge-fetch-weather", { city: tournament.city }).catch((e) => ({ ok: false, error: String(e) }));
    const weather = wxRes?.ok ? wxRes.weather : null;
    if (!wxRes?.ok) errors.push({ step: "weather", error: wxRes?.error || "unknown" });
    push(`Weather: ${weather ? `${weather.temp_f}°F, ${weather.wind_mph}mph wind, ${weather.humidity}%RH` : "unavailable"}`);

    // 4. Player set for L3 scraping
    const playerSet = new Set<string>();
    for (const ev of oddsEvents) { playerSet.add(ev.home_team); playerSet.add(ev.away_team); }
    for (const p of ppProjs) playerSet.add(p.player);
    const players = [...playerSet].filter(Boolean);
    push(`Unique players: ${players.length}`);

    const l3Res = await callFunction("court-edge-scrape-l3", { players }).catch((e) => ({ ok: false, error: String(e) }));
    const l3: L3Map = l3Res?.ok ? l3Res.results : {};
    if (!l3Res?.ok) errors.push({ step: "l3", error: l3Res?.error || "unknown" });
    const l3Got = Object.values(l3).filter((r) => r?.ok).length;
    push(`L3 scraped: ${l3Got}/${players.length}`);

    // 5. Project picks
    const picks: Pick[] = [];

    const projectMatch = (homeTotals: number[], awayTotals: number[]): ProjectionInput => ({
      p1_l3: homeTotals,
      p2_l3: awayTotals,
      surface: tournament.surface,
      sets_format: tournament.sets_format,
      ml_home: null, ml_away: null,
      weather, indoor: tournament.indoor,
    });

    // 5a. Odds API match totals
    for (const ev of oddsEvents) {
      if (ev.total_point == null) continue;
      const h = l3[ev.home_team];
      const a = l3[ev.away_team];
      if (!h?.ok || !a?.ok || !h.totals?.length || !a.totals?.length) continue;
      const inp = projectMatch(h.totals, a.totals);
      inp.ml_home = ev.ml_home; inp.ml_away = ev.ml_away;
      const proj = project(inp);
      const e = edgeFor("match_total", proj.projection, ev.total_point);
      picks.push({
        source: "odds_api",
        matchup: `${ev.home_team} vs ${ev.away_team}`,
        player: null,
        opponent: null,
        market: "match_total",
        line: ev.total_point,
        projection: Number(proj.projection.toFixed(2)),
        edge: Number(e.edge.toFixed(3)),
        edge_pct: Number(e.edge_pct.toFixed(2)),
        verdict: e.verdict,
        formula: { ...proj, ml_home: ev.ml_home, ml_away: ev.ml_away, bookmaker: ev.bookmaker },
        tournament: tournament.name,
        surface: tournament.surface,
        sets_format: tournament.sets_format,
        indoor: tournament.indoor,
        weather,
        commence_at: ev.commence_time,
      });
    }

    // 5b. PrizePicks player totals — try to find opponent via odds events
    for (const pp of ppProjs) {
      const me = l3[pp.player];
      if (!me?.ok || !me.totals?.length) continue;
      // find an odds event containing this player
      const ev = oddsEvents.find((e) => e.home_team === pp.player || e.away_team === pp.player);
      const opp = ev ? (ev.home_team === pp.player ? ev.away_team : ev.home_team) : null;
      const oppRow = opp ? l3[opp] : null;
      const opponentTotals = oppRow?.ok && oppRow.totals?.length ? oppRow.totals : me.totals;

      const inp = projectMatch(me.totals, opponentTotals);
      if (ev) { inp.ml_home = ev.ml_home; inp.ml_away = ev.ml_away; }
      const proj = project(inp);
      const e = edgeFor("player_total_games", proj.projection, pp.line);
      picks.push({
        source: "prizepicks",
        matchup: opp ? `${pp.player} vs ${opp}` : pp.player,
        player: pp.player,
        opponent: opp,
        market: "player_total_games",
        line: pp.line,
        projection: Number(e.reference.toFixed(2)),
        edge: Number(e.edge.toFixed(3)),
        edge_pct: Number(e.edge_pct.toFixed(2)),
        verdict: e.verdict,
        formula: { ...proj, stat_type: pp.stat_type, ml_home: inp.ml_home, ml_away: inp.ml_away },
        tournament: tournament.name,
        surface: tournament.surface,
        sets_format: tournament.sets_format,
        indoor: tournament.indoor,
        weather,
        commence_at: pp.start_at || ev?.commence_time || null,
      });
    }

    // 6. Sort
    picks.sort((a, b) => Math.abs(b.edge_pct) - Math.abs(a.edge_pct));
    push(`Total picks: ${picks.length}`);

    // 7. Persist picks
    if (picks.length > 0) {
      try {
        const rows = picks.map((p) => ({ ...p, run_id: runId }));
        const { error: pErr } = await supabase.from("court_edge_picks").insert(rows);
        if (pErr) errors.push({ step: "persist_picks", error: pErr.message });
      } catch (e) {
        errors.push({ step: "persist_picks", error: e instanceof Error ? e.message : String(e) });
      }
    }

    // 8. Telegram digest
    const digest = buildDigest(picks, {
      date: easternDate(),
      tournament,
      weather,
      sources: {
        odds: oddsRes?.ok ? "✓" : "✗",
        pp: ppRes?.ok ? (ppRes.blocked ? "blocked" : "✓") : "✗",
        l3: `${l3Got}/${players.length}`,
        wx: weather ? "✓" : "✗",
      },
      runId,
      errors: errors.length,
    });

    let telegramSent = false;
    try {
      const tgRes = await callFunction("bot-send-telegram", { message: digest, parse_mode: "Markdown" });
      telegramSent = !!tgRes?.success;
      if (!telegramSent) errors.push({ step: "telegram", error: tgRes?.error || "send failed" });
    } catch (e) {
      errors.push({ step: "telegram", error: e instanceof Error ? e.message : String(e) });
    }

    // 9. Update run row
    try {
      await supabase.from("court_edge_runs").update({
        log,
        picks_count: picks.length,
        errors,
        duration_ms: Date.now() - startedAt,
        telegram_sent: telegramSent,
      }).eq("id", runId);
    } catch (e) {
      console.error("[court-edge-run] failed updating run row", e);
    }

    return new Response(JSON.stringify({
      ok: true,
      run_id: runId,
      picks_count: picks.length,
      telegram_sent: telegramSent,
      errors,
      duration_ms: Date.now() - startedAt,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    push(`FATAL: ${msg}`);
    if (runId) {
      try {
        await supabase.from("court_edge_runs").update({
          log, errors: [...errors, { step: "fatal", error: msg }],
          duration_ms: Date.now() - startedAt,
        }).eq("id", runId);
      } catch (_e) { /* ignore */ }
    }
    return new Response(JSON.stringify({ ok: false, error: msg, errors }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});