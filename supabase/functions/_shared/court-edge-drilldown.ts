// Court.Edge — pure builder for the per-pick drilldown Telegram message.

import type { ProjectionBreakdown, Verdict } from "./court-edge-projection.ts";
import { archetypeLabel, type PlayerRole } from "./court-edge-roles.ts";

export interface DrilldownInput {
  market: "match_total" | "player_total_games";
  matchup: string;
  player_home: string;
  player_away: string;
  line: number;
  projection: number; // already side-correct (player share for player markets)
  match_projection: number; // raw match total
  edge_pct: number;
  verdict: Verdict;
  source: "odds_api" | "prizepicks";

  tournament_name: string;
  surface: string;
  sets_format: string;
  indoor: boolean;
  weather: { temp_f?: number | null; humidity?: number | null; wind_mph?: number | null } | null;

  l3_home: number[];
  l3_away: number[];
  raw_home?: string[] | null;
  raw_away?: string[] | null;

  breakdown: ProjectionBreakdown;

  role_home: PlayerRole;
  role_away: PlayerRole;
  role_reason_home: string | null;
  role_reason_away: string | null;

  ml_home?: number | null;
  ml_away?: number | null;
  bookmaker?: string | null;

  pick_id?: string | null;
  run_id?: string | null;
}

function fmtPct(n: number) { const s = n >= 0 ? "+" : ""; return `${s}${n.toFixed(1)}%`; }
function fmtSigned(n: number) { return (n >= 0 ? "+" : "") + n.toFixed(2); }

function verdictHeader(v: Verdict) {
  switch (v) {
    case "STRONG_OVER": return "🟢 STRONG OVER";
    case "STRONG_UNDER": return "🔴 STRONG UNDER";
    case "LEAN_OVER": return "🟡 LEAN OVER";
    case "LEAN_UNDER": return "🟠 LEAN UNDER";
    default: return "⚪ PASS";
  }
}

function weightedL3Display(totals: number[]): string {
  if (!totals || totals.length === 0) return "n/a";
  const w = [0.5, 0.3, 0.2];
  let s = 0, ws = 0;
  for (let i = 0; i < Math.min(3, totals.length); i += 1) { s += totals[i] * w[i]; ws += w[i]; }
  return (s / ws).toFixed(1);
}

function weatherText(w: DrilldownInput["weather"]): string {
  if (!w) return "n/a";
  const parts: string[] = [];
  if (typeof w.temp_f === "number") parts.push(`${Math.round(w.temp_f)}°F`);
  if (typeof w.wind_mph === "number") parts.push(`${Math.round(w.wind_mph)}mph wind`);
  if (typeof w.humidity === "number") parts.push(`${Math.round(w.humidity)}%RH`);
  return parts.join(", ") || "n/a";
}

function roleLine(name: string, role: PlayerRole, reason: string | null, surface: string): string {
  const surfScore = surface === "clay" ? role.clay_score : surface === "grass" ? role.grass_score : role.hard_score;
  const tag = `${archetypeLabel(role.archetype)} · ${role.serve_tier} serve · ${surface} ${surfScore.toFixed(2)}`;
  let out = `• *${name}*: ${tag}`;
  if (reason) out += `\n   ⚠️ ${reason}`;
  return out;
}

export function buildDrilldown(d: DrilldownInput): string {
  const lines: string[] = [];
  const label = d.market === "match_total"
    ? `${d.matchup} — Match Total Games`
    : `${d.player_home} — Player Total Games (vs ${d.player_away})`;

  lines.push(`🎾 *COURT.EDGE DRILLDOWN*`);
  lines.push(label);
  lines.push(`Tournament: ${d.tournament_name} · ${d.surface} · ${d.sets_format} · ${d.indoor ? "Indoor" : "Outdoor"}${d.weather?.temp_f != null ? ` · ${Math.round(d.weather.temp_f as number)}°F` : ""}`);
  lines.push("");
  lines.push(`${verdictHeader(d.verdict)}  ·  line ${d.line}  proj ${d.projection.toFixed(2)}  edge ${fmtPct(d.edge_pct)}`);
  if (d.market === "player_total_games") {
    lines.push(`_(match proj ${d.match_projection.toFixed(2)} → player share ${(d.match_projection / 2).toFixed(2)})_`);
  }
  lines.push("");

  lines.push("📐 *Inputs*");
  lines.push(`• L3 ${d.player_home}: ${d.l3_home.join(", ") || "n/a"}  (wL3 ${weightedL3Display(d.l3_home)})`);
  if (d.raw_home && d.raw_home.length > 0) lines.push(`   raw: ${d.raw_home.slice(0, 3).join(" | ")}`);
  lines.push(`• L3 ${d.player_away}: ${d.l3_away.join(", ") || "n/a"}  (wL3 ${weightedL3Display(d.l3_away)})`);
  if (d.raw_away && d.raw_away.length > 0) lines.push(`   raw: ${d.raw_away.slice(0, 3).join(" | ")}`);
  lines.push(`• Base L3 (avg): ${d.breakdown.base_l3.toFixed(2)}`);
  lines.push(`• Surface mult (${d.surface}): ×${d.breakdown.surface_mult.toFixed(2)}`);
  lines.push(`• Sets mult (${d.sets_format}): ×${d.breakdown.sets_mult.toFixed(2)}`);
  const spreadCtx = (d.ml_home != null && d.ml_away != null) ? `  (ml ${d.ml_home > 0 ? "+" : ""}${d.ml_home} / ${d.ml_away > 0 ? "+" : ""}${d.ml_away})` : "";
  lines.push(`• Spread adj: ${fmtSigned(d.breakdown.spread_adj)}${spreadCtx}`);
  lines.push(`• Weather adj: ${fmtSigned(d.breakdown.weather_adj)}  (${weatherText(d.weather)})`);
  lines.push(`• Indoor adj: ${fmtSigned(d.breakdown.indoor_adj)}`);
  lines.push(`• Role adj ${d.player_home}: ${fmtSigned(d.breakdown.role_adj_home)}${d.role_reason_home ? `  (${d.role_reason_home})` : ""}`);
  lines.push(`• Role adj ${d.player_away}: ${fmtSigned(d.breakdown.role_adj_away)}${d.role_reason_away ? `  (${d.role_reason_away})` : ""}`);
  lines.push(`─────────────────`);
  lines.push(`Projection: *${d.match_projection.toFixed(2)}*`);
  lines.push("");

  lines.push("👥 *Roles*");
  lines.push(roleLine(d.player_home, d.role_home, d.role_reason_home, d.surface));
  lines.push(roleLine(d.player_away, d.role_away, d.role_reason_away, d.surface));
  lines.push("");

  const src = d.source === "odds_api" ? "OddsAPI" : "PrizePicks";
  lines.push(`📚 Sources: ${src} · TennisAbstract L3 · Open-Meteo`);
  if (d.run_id || d.pick_id) {
    const runShort = d.run_id ? d.run_id.slice(0, 8) : "";
    const pickShort = d.pick_id ? d.pick_id.slice(0, 8) : "";
    lines.push(`Run \`${runShort}\`${pickShort ? `  ·  pick \`${pickShort}\`` : ""}`);
  }
  return lines.join("\n");
}