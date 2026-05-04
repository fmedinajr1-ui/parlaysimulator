// Court.Edge — orchestrator. Fetch odds + PrizePicks, scrape L3, fetch weather,
// project, rank, persist, push Telegram digest.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  project,
  edgeFor,
  type ProjectionInput,
  type Verdict,
  type ProjectionBreakdown,
} from "../_shared/court-edge-projection.ts";
import { detectTournament, type TournamentMeta } from "../_shared/court-edge-tournaments.ts";
import {
  roleAdjustment,
  inferRoleFromL3,
  heuristicRole,
  archetypeLabel,
  UNKNOWN_ROLE,
  type PlayerRole,
  type Archetype,
} from "../_shared/court-edge-roles.ts";
import { buildDrilldown } from "../_shared/court-edge-drilldown.ts";
import { playerSlug } from "../_shared/court-edge-slug.ts";
import { baselineL3, baselineFor, type Surface, type SetsFormat } from "../_shared/court-edge-baseline.ts";
import { pickSigma, type Tour } from "../_shared/court-edge-edge.ts";

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
  total_over_price?: number | null;
  total_under_price?: number | null;
  books_count?: number;
  book_lines?: Array<{ book: string; point: number; over_price: number | null; under_price: number | null }>;
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
  [playerName: string]: { ok: boolean; totals?: number[]; raw?: string[]; error?: string };
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
  role_home?: string | null;
  role_away?: string | null;
  role_adj_home?: number | null;
  role_adj_away?: number | null;
  role_reasons?: { home: string | null; away: string | null } | null;
  drilldown_text?: string | null;
  // Phase 1 — devigged probability edge fields:
  model_prob?: number | null;
  vig_free_implied?: number | null;
  edge_pp?: number | null;
  edge_side?: "over" | "under" | "none" | null;
  quarantine_reason?: string | null;
  books_count?: number | null;
  book_lines?: unknown;
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
    STRONG_OVER: [], STRONG_UNDER: [], LEAN_OVER: [], LEAN_UNDER: [], PASS: [], QUARANTINE: [],
  };
  for (const p of picks) {
    // QUARANTINE picks never appear in the user-facing digest; they're persisted for audit only.
    if (p.verdict === "QUARANTINE") { grouped.QUARANTINE.push(p); continue; }
    grouped[p.verdict].push(p);
  }

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
      const ePp = (p.edge_pct ?? 0); // edge_pct now means probability points × 100
      const sign = ePp >= 0 ? "+" : "";
      lines.push(`• ${label}\n   line ${p.line}  proj ${p.projection.toFixed(2)}  edge ${sign}${ePp.toFixed(1)}pp  [${src}]`);
      printed += 1;
    }
    lines.push("");
  }

  const leans = grouped.LEAN_OVER.length + grouped.LEAN_UNDER.length;
  const passes = grouped.PASS.length;
  const quarantined = grouped.QUARANTINE.length;
  if (printed === 0) lines.push("_No actionable edges right now. Try again after the next slate refresh._\n");
  lines.push(`Leans ${leans}  ·  Pass ${passes}  ·  Quarantine ${quarantined}`);
  lines.push(`Sources: Odds API ${meta.sources.odds}  ·  PrizePicks ${meta.sources.pp}  ·  TennisAbstract ${meta.sources.l3}  ·  Weather ${meta.sources.wx}`);
  lines.push(`Run \`${meta.runId.slice(0, 8)}\`  ·  picks ${picks.length}  ·  errors ${meta.errors}`);
  // "Why empty?" diagnostic footer — only when nothing actionable went out.
  if (printed === 0 && (meta as any).diagnostics) {
    lines.push(`Why empty? ${(meta as any).diagnostics}`);
  }
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

    // 4b. Roles — DB seed table + heuristic fallback
    const roleMap: Record<string, PlayerRole> = {};
    try {
      const slugs = players.map((p) => playerSlug(p)).filter(Boolean);
      if (slugs.length > 0) {
        const { data: rows } = await supabase
          .from("court_edge_player_roles")
          .select("player_slug,player_name,archetype,serve_tier,clay_score,grass_score,hard_score,notes")
          .in("player_slug", slugs);
        for (const r of rows || []) {
          roleMap[r.player_name] = {
            player_slug: r.player_slug,
            player_name: r.player_name,
            archetype: r.archetype as Archetype,
            serve_tier: r.serve_tier,
            clay_score: Number(r.clay_score),
            grass_score: Number(r.grass_score),
            hard_score: Number(r.hard_score),
            notes: r.notes,
            source: "db",
          };
        }
      }
    } catch (e) {
      errors.push({ step: "roles_db", error: e instanceof Error ? e.message : String(e) });
    }
    // Heuristic fallback for any player still missing a role
    for (const name of players) {
      if (roleMap[name]) continue;
      const slug = playerSlug(name);
      const raw = (l3[name] as any)?.raw as string[] | undefined;
      const inferred = inferRoleFromL3(raw, tournament.surface);
      roleMap[name] = inferred === "unknown"
        ? { ...UNKNOWN_ROLE, player_slug: slug, player_name: name }
        : heuristicRole(name, slug, inferred);
    }
    const roleSeedHits = Object.values(roleMap).filter((r) => r.source === "db").length;
    push(`Roles: ${roleSeedHits} from seed · ${players.length - roleSeedHits} heuristic`);

    // 5. Project picks
    const picks: Pick[] = [];

    const projectMatch = (
      homeTotals: number[],
      awayTotals: number[],
      roleH: PlayerRole,
      roleA: PlayerRole,
      tour: Tour = "unknown",
    ): { input: ProjectionInput; reasons: { home: string | null; away: string | null } } => {
      const ctx = {
        surface: tournament.surface,
        indoor: tournament.indoor,
        wind_mph: weather?.wind_mph ?? null,
        temp_f: weather?.temp_f ?? null,
      };
      const adjH = roleAdjustment(roleH, ctx);
      const adjA = roleAdjustment(roleA, ctx);
      return {
        input: {
          p1_l3: homeTotals,
          p2_l3: awayTotals,
          surface: tournament.surface,
          sets_format: tournament.sets_format,
          ml_home: null, ml_away: null,
          weather, indoor: tournament.indoor,
          role_adj_home: adjH.adj_games,
          role_adj_away: adjA.adj_games,
          tour,
        },
        reasons: { home: adjH.reason, away: adjA.reason },
      };
    };

    // 5a. Odds API match totals
    const breakdownByPick = new Map<number, { breakdown: ProjectionBreakdown; matchProjection: number }>();
    const baselineSurface: Surface = (tournament.surface as Surface) || "unknown";
    const baselineSets: SetsFormat = tournament.sets_format === "best_of_5" ? "best_of_5" : "best_of_3";
    const setsKey: "bo3" | "bo5" = tournament.sets_format === "best_of_5" || (tournament.sets_format as string) === "bo5" ? "bo5" : "bo3";
    const tourFromKey = (k: string | undefined): Tour => {
      const s = (k || "").toLowerCase();
      if (s.includes("atp")) return "atp";
      if (s.includes("wta")) return "wta";
      return "unknown";
    };
    let baselineSidesUsed = 0;
    for (const ev of oddsEvents) {
      if (ev.total_point == null) continue;
      const h = l3[ev.home_team];
      const a = l3[ev.away_team];
      const hOk = !!(h?.ok && h?.totals?.length);
      const aOk = !!(a?.ok && a?.totals?.length);
      // Loosened gate: if BOTH players are missing L3, skip. If only one is
      // missing, fill that side with a surface baseline and cap verdict to LEAN_*.
      if (!hOk && !aOk) continue;
      const homeTotals = hOk ? h!.totals! : baselineL3(baselineSurface, baselineSets);
      const awayTotals = aOk ? a!.totals! : baselineL3(baselineSurface, baselineSets);
      const baselineUsed = !hOk || !aOk;
      if (baselineUsed) baselineSidesUsed += 1;
      const roleH = roleMap[ev.home_team] ?? UNKNOWN_ROLE;
      const roleA = roleMap[ev.away_team] ?? UNKNOWN_ROLE;
      const evTour = tourFromKey(ev.sport_key);
      const { input: inp, reasons } = projectMatch(homeTotals, awayTotals, roleH, roleA, evTour);
      inp.ml_home = ev.ml_home; inp.ml_away = ev.ml_away;
      const proj = project(inp);
      const sigma = pickSigma(evTour, setsKey);
      const e = edgeFor("match_total", proj.projection, ev.total_point, {
        over_price: ev.total_over_price ?? null,
        under_price: ev.total_under_price ?? null,
        sigma,
      });
      // Cap verdict to LEAN_* when one side is a baseline — never STRONG_*.
      let verdict = e.verdict;
      if (baselineUsed && verdict !== "QUARANTINE") {
        if (verdict === "STRONG_OVER") verdict = "LEAN_OVER";
        else if (verdict === "STRONG_UNDER") verdict = "LEAN_UNDER";
      }
      picks.push({
        source: "odds_api",
        matchup: `${ev.home_team} vs ${ev.away_team}`,
        player: null,
        opponent: null,
        market: "match_total",
        line: ev.total_point,
        projection: Number(proj.projection.toFixed(2)),
        edge: Number((e.edge_pp ?? 0).toFixed(4)),
        edge_pct: Number(((e.edge_pp ?? 0) * 100).toFixed(2)),
        verdict,
        formula: {
          ...proj,
          ml_home: ev.ml_home,
          ml_away: ev.ml_away,
          bookmaker: ev.bookmaker,
          baseline_used: baselineUsed,
          baseline_side: baselineUsed ? (!hOk ? "home" : "away") : null,
          baseline_reason: baselineUsed ? baselineFor(baselineSurface, baselineSets).reason : null,
          sigma,
          tour: tourFromKey(ev.sport_key),
        },
        tournament: tournament.name,
        surface: tournament.surface,
        sets_format: tournament.sets_format,
        indoor: tournament.indoor,
        weather,
        commence_at: ev.commence_time,
        role_home: roleH.archetype,
        role_away: roleA.archetype,
        role_adj_home: proj.role_adj_home,
        role_adj_away: proj.role_adj_away,
        role_reasons: reasons,
        model_prob: e.edge_side === "under" ? e.model_prob_under : e.model_prob_over,
        vig_free_implied: e.edge_side === "under" ? e.vig_free_implied_under : e.vig_free_implied_over,
        edge_pp: e.edge_pp,
        edge_side: e.edge_side,
        quarantine_reason: e.quarantine_reason ?? null,
        books_count: ev.books_count ?? null,
        book_lines: ev.book_lines ?? null,
      });
      breakdownByPick.set(picks.length - 1, { breakdown: proj, matchProjection: proj.projection });
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
      const roleH = roleMap[pp.player] ?? UNKNOWN_ROLE;
      const roleA = opp ? (roleMap[opp] ?? UNKNOWN_ROLE) : UNKNOWN_ROLE;
      const evTour = tourFromKey(ev?.sport_key);
      const { input: inp, reasons } = projectMatch(me.totals, opponentTotals, roleH, roleA, evTour);
      if (ev) { inp.ml_home = ev.ml_home; inp.ml_away = ev.ml_away; }
      const proj = project(inp);
      const sigma = pickSigma(evTour, setsKey);
      const e = edgeFor("player_total_games", proj.projection, pp.line, {
        // PrizePicks-only paths have no two-sided book price → PASS unless we can borrow from odds event.
        over_price: ev?.total_over_price ?? null,
        under_price: ev?.total_under_price ?? null,
        sigma,
      });
      picks.push({
        source: "prizepicks",
        matchup: opp ? `${pp.player} vs ${opp}` : pp.player,
        player: pp.player,
        opponent: opp,
        market: "player_total_games",
        line: pp.line,
        projection: Number(e.reference.toFixed(2)),
        edge: Number((e.edge_pp ?? 0).toFixed(4)),
        edge_pct: Number(((e.edge_pp ?? 0) * 100).toFixed(2)),
        verdict: e.verdict,
        formula: { ...proj, stat_type: pp.stat_type, ml_home: inp.ml_home, ml_away: inp.ml_away, sigma, tour: tourFromKey(ev?.sport_key) },
        tournament: tournament.name,
        surface: tournament.surface,
        sets_format: tournament.sets_format,
        indoor: tournament.indoor,
        weather,
        commence_at: pp.start_at || ev?.commence_time || null,
        role_home: roleH.archetype,
        role_away: roleA.archetype,
        role_adj_home: proj.role_adj_home,
        role_adj_away: proj.role_adj_away,
        role_reasons: reasons,
        model_prob: e.edge_side === "under" ? e.model_prob_under : e.model_prob_over,
        vig_free_implied: e.edge_side === "under" ? e.vig_free_implied_under : e.vig_free_implied_over,
        edge_pp: e.edge_pp,
        edge_side: e.edge_side,
        quarantine_reason: e.quarantine_reason ?? null,
        books_count: ev?.books_count ?? null,
        book_lines: ev?.book_lines ?? null,
      });
      breakdownByPick.set(picks.length - 1, { breakdown: proj, matchProjection: proj.projection });
    }

    // 6. Sort
    picks.sort((a, b) => Math.abs(b.edge_pct) - Math.abs(a.edge_pct));
    // breakdownByPick is keyed by *pre-sort* index. Re-key by the sorted picks so we can look up later.
    const breakdownByPickRef = new Map<Pick, { breakdown: ProjectionBreakdown; matchProjection: number }>();
    // Rebuild from picks by re-running a cheap lookup: we tagged formula with ProjectionBreakdown fields,
    // so just re-derive a breakdown from formula on each pick instead of trying to remap indices.
    for (const p of picks) {
      const f = p.formula as any;
      breakdownByPickRef.set(p, {
        matchProjection: typeof f?.projection === "number" ? f.projection : p.projection,
        breakdown: {
          base_l3: f?.base_l3 ?? 0,
          surface_mult: f?.surface_mult ?? 1,
          sets_mult: f?.sets_mult ?? 1,
          spread_adj: f?.spread_adj ?? 0,
          weather_adj: f?.weather_adj ?? 0,
          indoor_adj: f?.indoor_adj ?? 0,
          role_adj_home: f?.role_adj_home ?? 0,
          role_adj_away: f?.role_adj_away ?? 0,
          projection: f?.projection ?? 0,
        },
      });
    }
    push(`Total picks: ${picks.length}`);
    if (baselineSidesUsed > 0) push(`Baseline-fallback sides used: ${baselineSidesUsed}`);

    // Phase 2 diagnostic — count sanity-clamps and blowout flags from formula breakdowns.
    {
      let clamped = 0; let blow = 0;
      for (const p of picks) {
        const f = p.formula as any;
        if (f?.clamped === true) clamped += 1;
        if (typeof f?.blowout_adj === "number" && f.blowout_adj < 0) blow += 1;
      }
      push(`Clamped: ${clamped}/${picks.length} · Blowout flags: ${blow}`);
    }

    // 6b. Build drilldown text for the top non-PASS picks (cap 5)
    const DRILLDOWN_CAP = 5;
    const topForDrilldown = picks.filter((p) => p.verdict !== "PASS").slice(0, DRILLDOWN_CAP);
    for (const p of topForDrilldown) {
      const ref = breakdownByPickRef.get(p);
      if (!ref) continue;
      const homeName = p.market === "match_total"
        ? (p.matchup?.split(" vs ")[0] || "Player A")
        : (p.player || "Player A");
      const awayName = p.market === "match_total"
        ? (p.matchup?.split(" vs ")[1] || "Player B")
        : (p.opponent || "Opponent");
      const lh = l3[homeName];
      const la = l3[awayName];
      const roleH = roleMap[homeName] ?? { ...UNKNOWN_ROLE, player_name: homeName };
      const roleA = roleMap[awayName] ?? { ...UNKNOWN_ROLE, player_name: awayName };
      const drill = buildDrilldown({
        market: p.market,
        matchup: p.matchup || `${homeName} vs ${awayName}`,
        player_home: homeName,
        player_away: awayName,
        line: p.line,
        projection: p.projection,
        match_projection: ref.matchProjection,
        edge_pct: p.edge_pct,
        verdict: p.verdict,
        source: p.source,
        tournament_name: p.tournament,
        surface: p.surface,
        sets_format: p.sets_format,
        indoor: p.indoor,
        weather: weather as any,
        l3_home: lh?.totals || [],
        l3_away: la?.totals || [],
        raw_home: (lh as any)?.raw || null,
        raw_away: (la as any)?.raw || null,
        breakdown: ref.breakdown,
        role_home: roleH,
        role_away: roleA,
        role_reason_home: p.role_reasons?.home ?? null,
        role_reason_away: p.role_reasons?.away ?? null,
        ml_home: (p.formula as any)?.ml_home ?? null,
        ml_away: (p.formula as any)?.ml_away ?? null,
        bookmaker: (p.formula as any)?.bookmaker ?? null,
        run_id: runId,
      });
      p.drilldown_text = drill;
    }

    // 7. Persist picks
    if (picks.length > 0) {
      try {
        // Strip Phase-1 fields from the top level (no DB columns yet) and tuck
        // them into the existing `formula` JSON so we can audit without a migration.
        const rows = picks.map((p) => {
          const {
            model_prob, vig_free_implied, edge_pp, edge_side,
            quarantine_reason, books_count, book_lines,
            ...rest
          } = p;
          return {
            ...rest,
            run_id: runId,
            formula: {
              ...(rest.formula as Record<string, unknown>),
              model_prob,
              vig_free_implied,
              edge_pp,
              edge_side,
              quarantine_reason,
              books_count,
              book_lines,
            },
          };
        });
        const { error: pErr } = await supabase.from("court_edge_picks").insert(rows);
        if (pErr) errors.push({ step: "persist_picks", error: pErr.message });
      } catch (e) {
        errors.push({ step: "persist_picks", error: e instanceof Error ? e.message : String(e) });
      }
    }

    // 8. Telegram digest
    const ppBlocked = ppRes?.ok && (ppRes as any)?.blocked === true;
    const diagnostics = `odds_events=${oddsEvents.length} · pp_blocked=${ppBlocked} · l3_hits=${l3Got}/${players.length} · weather=${weather ? "ok" : "miss"} · baseline_sides=${baselineSidesUsed}`;
    const digest = buildDigest(picks, {
      date: easternDate(),
      tournament,
      weather,
      sources: {
        odds: oddsRes?.ok ? "✓" : "✗",
        pp: ppRes?.ok ? (ppBlocked ? "blocked" : "✓") : "✗",
        l3: `${l3Got}/${players.length}`,
        wx: weather ? "✓" : "✗",
      },
      runId,
      errors: errors.length,
      // Only buildDigest reads this; cast is safe — interface is structural.
      ...({ diagnostics } as any),
    } as any);

    let telegramSent = false;
    try {
      const tgRes = await callFunction("bot-send-telegram", { message: digest, parse_mode: "Markdown" });
      telegramSent = !!tgRes?.success;
      if (!telegramSent) errors.push({ step: "telegram", error: tgRes?.error || "send failed" });
    } catch (e) {
      errors.push({ step: "telegram", error: e instanceof Error ? e.message : String(e) });
    }

    // 8b. Send each drilldown as its own message (after digest)
    let drilldownsSent = 0;
    for (const p of topForDrilldown) {
      if (!p.drilldown_text) continue;
      try {
        const tgRes = await callFunction("bot-send-telegram", {
          message: p.drilldown_text,
          parse_mode: "Markdown",
          reference_key: `court_edge_drilldown:${runId}:${p.market}:${p.player || p.matchup}`,
        });
        if (tgRes?.success) drilldownsSent += 1;
        else errors.push({ step: "drilldown_telegram", error: tgRes?.error || "send failed" });
      } catch (e) {
        errors.push({ step: "drilldown_telegram", error: e instanceof Error ? e.message : String(e) });
      }
    }
    push(`Drilldowns sent: ${drilldownsSent}/${topForDrilldown.length}`);

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
      drilldowns_sent: drilldownsSent,
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