import type { PickSide } from "@/types/sweetSpot";

export type LineFreshness = "fresh" | "stale" | "expired";
export type MarketStatus = "active" | "scanning" | "stale" | "off_market";

export interface MarketLineLike {
  bookmaker?: string | null;
  current_line?: number | null;
  over_price?: number | null;
  under_price?: number | null;
  is_active?: boolean | null;
  updated_at?: string | null;
  odds_updated_at?: string | null;
}

export const BOOKMAKER_PRIORITY = ["hardrockbet", "fanduel", "draftkings", "betmgm"] as const;

export const BOOKMAKER_LABELS: Record<string, string> = {
  hardrockbet: "HR",
  fanduel: "FD",
  draftkings: "DK",
  betmgm: "MGM",
  caesars: "CZR",
  pointsbet: "PB",
};

const FRESH_ODDS_MINUTES = 20;
const STALE_ODDS_MINUTES = 120;
const SCANNING_DRIFT_THRESHOLD = 0.5;

export function getLineTimestamp(row: MarketLineLike): string | null {
  return row.odds_updated_at ?? row.updated_at ?? null;
}

export function getLineAgeMinutes(row: MarketLineLike, now = new Date()): number | null {
  const ts = getLineTimestamp(row);
  if (!ts) return null;
  const ageMs = now.getTime() - new Date(ts).getTime();
  return Number.isFinite(ageMs) ? ageMs / 60_000 : null;
}

export function getLineFreshness(row: MarketLineLike, now = new Date()): LineFreshness {
  const ageMin = getLineAgeMinutes(row, now);
  if (ageMin == null) return "expired";
  if (ageMin <= FRESH_ODDS_MINUTES) return "fresh";
  if (ageMin <= STALE_ODDS_MINUTES) return "stale";
  return "expired";
}

function bookmakerPriorityIndex(bookmaker?: string | null): number {
  const normalized = bookmaker?.toLowerCase() ?? "";
  const idx = BOOKMAKER_PRIORITY.indexOf(normalized as (typeof BOOKMAKER_PRIORITY)[number]);
  return idx === -1 ? BOOKMAKER_PRIORITY.length : idx;
}

export function getAvailableBooks(rows: MarketLineLike[]): string[] {
  return Array.from(
    new Set(
      rows
        .filter((row) => row.is_active !== false && row.current_line != null)
        .map((row) => row.bookmaker?.toLowerCase())
        .filter((book): book is string => Boolean(book)),
    ),
  ).sort((a, b) => bookmakerPriorityIndex(a) - bookmakerPriorityIndex(b));
}

export function computeConsensusLine(rows: MarketLineLike[]): number | null {
  const lines = rows
    .filter((row) => row.is_active !== false && row.current_line != null)
    .map((row) => Number(row.current_line))
    .filter((line) => Number.isFinite(line))
    .sort((a, b) => a - b);

  if (lines.length === 0) return null;
  const middle = Math.floor(lines.length / 2);
  return lines.length % 2 === 0 ? (lines[middle - 1] + lines[middle]) / 2 : lines[middle];
}

export function computeLineDrift(selected: MarketLineLike | null, rows: MarketLineLike[]): number {
  if (!selected || selected.current_line == null) return 0;
  const consensus = computeConsensusLine(rows);
  if (consensus == null) return 0;
  return Number(selected.current_line) - consensus;
}

export function deriveMarketStatus(selected: MarketLineLike | null, rows: MarketLineLike[], now = new Date()): MarketStatus {
  if (!selected || selected.current_line == null || selected.is_active === false) return "off_market";

  const freshness = getLineFreshness(selected, now);
  if (freshness === "expired") return "off_market";
  if (freshness === "stale") return "stale";

  const drift = Math.abs(computeLineDrift(selected, rows));
  if (drift > SCANNING_DRIFT_THRESHOLD) return "scanning";

  return "active";
}

export function pickPreferredMarketLine<T extends MarketLineLike>(
  rows: T[],
  options: { requireSidePrice?: PickSide; now?: Date } = {},
): T | null {
  const { requireSidePrice, now = new Date() } = options;

  const eligible = rows.filter((row) => {
    if (row.is_active === false || row.current_line == null) return false;
    if (requireSidePrice === "over" && row.over_price == null) return false;
    if (requireSidePrice === "under" && row.under_price == null) return false;
    return true;
  });

  if (eligible.length === 0) return null;

  return [...eligible].sort((a, b) => {
    const priorityDiff = bookmakerPriorityIndex(a.bookmaker) - bookmakerPriorityIndex(b.bookmaker);
    if (priorityDiff !== 0) return priorityDiff;

    const freshnessOrder = { fresh: 0, stale: 1, expired: 2 } as const;
    const freshnessDiff = freshnessOrder[getLineFreshness(a, now)] - freshnessOrder[getLineFreshness(b, now)];
    if (freshnessDiff !== 0) return freshnessDiff;

    const ageA = getLineAgeMinutes(a, now) ?? Number.POSITIVE_INFINITY;
    const ageB = getLineAgeMinutes(b, now) ?? Number.POSITIVE_INFINITY;
    if (ageA !== ageB) return ageA - ageB;

    return (getLineTimestamp(b) ?? "").localeCompare(getLineTimestamp(a) ?? "");
  })[0] ?? null;
}

export function humanizeBookmaker(bookmaker?: string | null): string {
  if (!bookmaker) return "Book";
  const normalized = bookmaker.toLowerCase();
  return BOOKMAKER_LABELS[normalized] ?? bookmaker.toUpperCase();
}