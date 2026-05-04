// Court.Edge — per-run diagnostics builder. Pure function, no I/O.
// Aggregates pick-level signals into a structured JSON blob persisted on
// court_edge_runs.diagnostics and surfaces warnings for the digest footer.

import type { Verdict } from "./court-edge-projection.ts";
import type { TournamentTier } from "./court-edge-tournament-tier.ts";

export interface DiagnosticsPick {
  verdict: Verdict;
  formula?: Record<string, unknown> | null;
  quarantine_reason?: string | null;
}

export interface DiagnosticsContext {
  tier: TournamentTier | string;
  baseline_sides_used: number;
  l3_hits: number;
  l3_total: number;
  weather_present: boolean;
  pp_blocked: boolean;
  errors_count: number;
}

export interface RunDiagnostics {
  total: number;
  by_verdict: Record<Verdict, number>;
  by_tier: Record<string, number>;
  quarantine_reasons: Record<string, number>;
  promotion_demotions: Record<string, number>;
  baseline_sides_used: number;
  clamped: number;
  blowout_flags: number;
  l3_hit_rate: number;          // 0..1
  weather_present: boolean;
  pp_blocked: boolean;
  errors_count: number;
  quarantine_rate: number;      // 0..1
  actionable_count: number;     // STRONG_* + LEAN_*
  warnings: string[];
}

const ZERO_VERDICTS = (): Record<Verdict, number> => ({
  STRONG_OVER: 0, STRONG_UNDER: 0, LEAN_OVER: 0, LEAN_UNDER: 0, PASS: 0, QUARANTINE: 0,
});

const QUARANTINE_RATE_WARN = 0.20;

export function buildRunDiagnostics(picks: DiagnosticsPick[], ctx: DiagnosticsContext): RunDiagnostics {
  const by_verdict = ZERO_VERDICTS();
  const by_tier: Record<string, number> = {};
  const quarantine_reasons: Record<string, number> = {};
  const promotion_demotions: Record<string, number> = {};
  let clamped = 0;
  let blowout = 0;

  for (const p of picks) {
    by_verdict[p.verdict] = (by_verdict[p.verdict] ?? 0) + 1;
    const f = (p.formula ?? {}) as Record<string, unknown>;
    const t = String(f.tournament_tier ?? "unknown");
    by_tier[t] = (by_tier[t] ?? 0) + 1;
    if (p.verdict === "QUARANTINE") {
      const r = (f.quarantine_reason as string | undefined) ?? p.quarantine_reason ?? "unspecified";
      quarantine_reasons[r] = (quarantine_reasons[r] ?? 0) + 1;
    }
    const pr = f.promotion_blocked_reason as string | null | undefined;
    if (pr) promotion_demotions[pr] = (promotion_demotions[pr] ?? 0) + 1;
    if (f.clamped === true) clamped += 1;
    if (typeof f.blowout_adj === "number" && (f.blowout_adj as number) < 0) blowout += 1;
  }

  const total = picks.length;
  const quarantine_rate = total > 0 ? by_verdict.QUARANTINE / total : 0;
  const actionable_count =
    by_verdict.STRONG_OVER + by_verdict.STRONG_UNDER + by_verdict.LEAN_OVER + by_verdict.LEAN_UNDER;
  const l3_hit_rate = ctx.l3_total > 0 ? ctx.l3_hits / ctx.l3_total : 0;

  const warnings: string[] = [];
  if (total > 0 && quarantine_rate >= QUARANTINE_RATE_WARN) warnings.push("high_quarantine_rate");
  if (total > 0 && actionable_count === 0) warnings.push("no_actionable_picks");
  if (ctx.l3_total > 0 && l3_hit_rate < 0.5) warnings.push("low_l3_coverage");
  if (!ctx.weather_present) warnings.push("weather_missing");
  if (ctx.pp_blocked) warnings.push("prizepicks_blocked");
  if (ctx.errors_count > 0) warnings.push("pipeline_errors");

  return {
    total,
    by_verdict,
    by_tier,
    quarantine_reasons,
    promotion_demotions,
    baseline_sides_used: ctx.baseline_sides_used,
    clamped,
    blowout_flags: blowout,
    l3_hit_rate,
    weather_present: ctx.weather_present,
    pp_blocked: ctx.pp_blocked,
    errors_count: ctx.errors_count,
    quarantine_rate,
    actionable_count,
    warnings,
  };
}

// Short, human-readable footer for the Telegram digest. Returns null when there's nothing to warn about.
export function diagnosticsFooter(d: RunDiagnostics): string | null {
  if (d.warnings.length === 0) return null;
  const map: Record<string, string> = {
    high_quarantine_rate: `⚠️ ${(d.quarantine_rate * 100).toFixed(0)}% of picks quarantined`,
    no_actionable_picks: "⚠️ No actionable picks this run",
    low_l3_coverage: `⚠️ Low L3 coverage (${(d.l3_hit_rate * 100).toFixed(0)}%)`,
    weather_missing: "⚠️ Weather data unavailable",
    prizepicks_blocked: "⚠️ PrizePicks scrape blocked",
    pipeline_errors: `⚠️ ${d.errors_count} pipeline error(s)`,
  };
  return d.warnings.map((w) => map[w] ?? `⚠️ ${w}`).join(" · ");
}