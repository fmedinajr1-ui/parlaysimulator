// Court.Edge — STRONG-promotion gates.
// A pick that earns STRONG_OVER/STRONG_UNDER from edge math must additionally
// pass independent confirmations or it's demoted to LEAN_*. Pure function, no I/O.

import type { Verdict } from "./court-edge-projection.ts";

export interface PromotionContext {
  // Book agreement
  books_count?: number | null;
  reference_line: number;             // line we computed edge against
  median_line?: number | null;        // median across books, if available
  // Weather / venue
  indoor: boolean;
  weather_present: boolean;
  // Baseline fallback (one side missing L3)
  baseline_used: boolean;
  // Prior sanity
  projection: number;
  prior_mu: number;
  prior_sd: number;
  edge_side: "over" | "under" | "none";
}

export interface PromotionResult {
  verdict: Verdict;
  blocked_reason?: string;
}

const BOOK_LINE_TOLERANCE_GAMES = 0.5;
const PRIOR_CONTRADICTION_SIGMAS = 0.5;

function demote(v: Verdict): Verdict {
  if (v === "STRONG_OVER") return "LEAN_OVER";
  if (v === "STRONG_UNDER") return "LEAN_UNDER";
  return v;
}

export function applyPromotionGates(verdict: Verdict, ctx: PromotionContext): PromotionResult {
  // Only STRONG verdicts are subject to promotion gating; everything else passes through.
  if (verdict !== "STRONG_OVER" && verdict !== "STRONG_UNDER") return { verdict };

  // 1. Baseline fallback → demote (one side has no real L3 sample)
  if (ctx.baseline_used) {
    return { verdict: demote(verdict), blocked_reason: "baseline_fallback_used" };
  }

  // 2. Multi-book agreement
  const bc = Number.isFinite(ctx.books_count as number) ? (ctx.books_count as number) : 0;
  if (bc < 2) {
    return { verdict: demote(verdict), blocked_reason: "single_book_only" };
  }
  if (ctx.median_line != null && Number.isFinite(ctx.median_line)) {
    if (Math.abs(ctx.median_line - ctx.reference_line) > BOOK_LINE_TOLERANCE_GAMES) {
      return { verdict: demote(verdict), blocked_reason: "book_line_outlier" };
    }
  }

  // 3. Outdoor weather-required
  if (!ctx.indoor && !ctx.weather_present) {
    return { verdict: demote(verdict), blocked_reason: "outdoor_weather_missing" };
  }

  // 4. Prior-contradiction sanity
  if (Number.isFinite(ctx.projection) && Number.isFinite(ctx.prior_mu) && Number.isFinite(ctx.prior_sd) && ctx.prior_sd > 0) {
    const tol = PRIOR_CONTRADICTION_SIGMAS * ctx.prior_sd;
    if (verdict === "STRONG_OVER" && ctx.projection < ctx.prior_mu - tol) {
      return { verdict: demote(verdict), blocked_reason: "projection_contradicts_over" };
    }
    if (verdict === "STRONG_UNDER" && ctx.projection > ctx.prior_mu + tol) {
      return { verdict: demote(verdict), blocked_reason: "projection_contradicts_under" };
    }
  }

  return { verdict };
}

// Helper: median of book line points. Returns null on empty/invalid input.
export function medianBookLine(book_lines: Array<{ point?: number | null }> | null | undefined): number | null {
  if (!Array.isArray(book_lines) || book_lines.length === 0) return null;
  const pts = book_lines.map((b) => Number(b?.point)).filter((n) => Number.isFinite(n));
  if (pts.length === 0) return null;
  pts.sort((a, b) => a - b);
  const mid = Math.floor(pts.length / 2);
  return pts.length % 2 === 1 ? pts[mid] : (pts[mid - 1] + pts[mid]) / 2;
}