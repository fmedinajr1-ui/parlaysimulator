import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { PropQuote } from "@/features/live3d/types";
import type { PlayerState } from "../types";

export type PropEdgeRow = {
  key: string;
  player_name: string;
  prop_type: string;
  prop_label: string;
  line: number;
  /** Reference (preferred) book — defaults to FanDuel when present */
  refBook: string;
  refOver: number | null;
  refUnder: number | null;
  refOverImpliedPct: number | null;
  refUnderImpliedPct: number | null;
  /** Consensus fair (de-vigged, averaged across books) */
  fairOverPct: number | null;
  fairUnderPct: number | null;
  /** Model line projection — same as consensus line right now */
  modelLine: number;
  /** Signed edge in percentage points for the recommended side */
  edgePct: number;
  /** Expected value per $100 stake on the recommended side at refBook price */
  impactPer100: number;
  recommendedSide: "Over" | "Under" | null;
  bookCount: number;
};

export type MarketSignalRow = {
  player_name: string | null;
  signal_label: string | null;
  market_score: number | null;
  market_type: string | null;
  rationale: string | null;
};

const PROP_LABEL: Record<string, string> = {
  player_points: "Points",
  player_rebounds: "Rebounds",
  player_assists: "Assists",
  player_threes: "3-Pointers",
  player_pass_yds: "Pass Yds",
  player_rush_yds: "Rush Yds",
  player_receptions: "Receptions",
  player_anytime_td: "Anytime TD",
  batter_hits: "Hits",
  batter_total_bases: "Total Bases",
  batter_home_runs: "Home Run",
  pitcher_strikeouts: "Strikeouts",
  player_shots_on_goal: "Shots On Goal",
  player_goals: "Goals",
  player_shots_on_target: "Shots On Target",
  player_shots: "Shots",
};

const BOOK_LABEL: Record<string, string> = {
  fanduel: "FanDuel",
  draftkings: "DraftKings",
  betmgm: "BetMGM",
  williamhill_us: "Caesars",
  betrivers: "BetRivers",
  espnbet: "ESPN BET",
  pinnacle: "Pinnacle",
};

const REF_BOOK_PRIORITY = ["fanduel", "draftkings", "betmgm", "williamhill_us", "pinnacle"];

function americanToProb(p: number | null): number | null {
  if (p == null) return null;
  return p > 0 ? 100 / (p + 100) : -p / (-p + 100);
}
function americanToDecimal(p: number): number {
  return p > 0 ? p / 100 + 1 : 100 / -p + 1;
}
function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function mode<T extends string | number>(vals: T[]): T | null {
  if (!vals.length) return null;
  const counts = new Map<T, number>();
  for (const v of vals) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: T = vals[0];
  let bestCount = 0;
  counts.forEach((c, v) => {
    if (c > bestCount) {
      bestCount = c;
      best = v;
    }
  });
  return best;
}

function buildEdgeRows(quotes: PropQuote[]): PropEdgeRow[] {
  // Group by player/prop, then pick consensus line (mode), de-vig fair prob per book at that line.
  const byPlayerProp = new Map<string, PropQuote[]>();
  for (const q of quotes) {
    if (q.line == null) continue;
    const k = `${q.player_name}|${q.prop_type}`;
    const arr = byPlayerProp.get(k) ?? [];
    arr.push(q);
    byPlayerProp.set(k, arr);
  }

  const rows: PropEdgeRow[] = [];
  byPlayerProp.forEach((rows0, key) => {
    const consensusLine = mode(rows0.map((r) => Number(r.line)))!;
    const atLine = rows0.filter((r) => Number(r.line) === consensusLine);
    if (!atLine.length) return;

    // De-vig per book then average
    const fairOvers: number[] = [];
    const fairUnders: number[] = [];
    for (const r of atLine) {
      const po = americanToProb(r.over_price);
      const pu = americanToProb(r.under_price);
      if (po != null && pu != null && po + pu > 0) {
        fairOvers.push(po / (po + pu));
        fairUnders.push(pu / (po + pu));
      }
    }
    const fairOver = fairOvers.length ? fairOvers.reduce((a, b) => a + b, 0) / fairOvers.length : null;
    const fairUnder = fairUnders.length ? fairUnders.reduce((a, b) => a + b, 0) / fairUnders.length : null;

    // Pick reference book
    const refBook =
      REF_BOOK_PRIORITY.find((b) => atLine.some((r) => r.bookmaker === b)) ?? atLine[0].bookmaker;
    const ref = atLine.find((r) => r.bookmaker === refBook)!;
    const refOverProb = americanToProb(ref.over_price);
    const refUnderProb = americanToProb(ref.under_price);

    const overEdge = fairOver != null && refOverProb != null ? fairOver - refOverProb : null;
    const underEdge = fairUnder != null && refUnderProb != null ? fairUnder - refUnderProb : null;

    let side: "Over" | "Under" | null = null;
    let edge = 0;
    let stakeImpact = 0;
    if (overEdge != null && underEdge != null) {
      if (overEdge >= underEdge && overEdge > 0) {
        side = "Over";
        edge = overEdge;
        const dec = americanToDecimal(ref.over_price!);
        stakeImpact = 100 * (fairOver! * (dec - 1) - (1 - fairOver!));
      } else if (underEdge > 0) {
        side = "Under";
        edge = underEdge;
        const dec = americanToDecimal(ref.under_price!);
        stakeImpact = 100 * (fairUnder! * (dec - 1) - (1 - fairUnder!));
      } else {
        // negative-EV both sides; surface the least bad for context
        if (overEdge >= underEdge) {
          side = "Over";
          edge = overEdge;
          if (ref.over_price != null) {
            const dec = americanToDecimal(ref.over_price);
            stakeImpact = 100 * (fairOver! * (dec - 1) - (1 - fairOver!));
          }
        } else {
          side = "Under";
          edge = underEdge;
          if (ref.under_price != null) {
            const dec = americanToDecimal(ref.under_price);
            stakeImpact = 100 * (fairUnder! * (dec - 1) - (1 - fairUnder!));
          }
        }
      }
    }

    rows.push({
      key,
      player_name: ref.player_name,
      prop_type: ref.prop_type,
      prop_label: PROP_LABEL[ref.prop_type] ?? ref.prop_type,
      line: consensusLine,
      refBook: BOOK_LABEL[refBook] ?? refBook,
      refOver: ref.over_price,
      refUnder: ref.under_price,
      refOverImpliedPct: refOverProb != null ? +(refOverProb * 100).toFixed(1) : null,
      refUnderImpliedPct: refUnderProb != null ? +(refUnderProb * 100).toFixed(1) : null,
      fairOverPct: fairOver != null ? +(fairOver * 100).toFixed(1) : null,
      fairUnderPct: fairUnder != null ? +(fairUnder * 100).toFixed(1) : null,
      modelLine: median(atLine.map((r) => Number(r.line))),
      edgePct: +(edge * 100).toFixed(2),
      impactPer100: +stakeImpact.toFixed(2),
      recommendedSide: side,
      bookCount: atLine.length,
    });
  });

  return rows.sort((a, b) => b.edgePct - a.edgePct);
}

const SIGNAL_MAP: Record<string, PlayerState> = {
  sharp: "sharp_action",
  sharp_money: "sharp_action",
  steam: "sharp_action",
  velocity_spike: "usage_spike",
  spike: "usage_spike",
  reverse_line_move: "sharp_action",
  volatile: "volatility",
  volatility: "volatility",
  snapback: "volatility",
  live_drift: "volatility",
  public_fade: "under_pace",
};

function statesFromSignals(rows: MarketSignalRow[]): Record<string, PlayerState> {
  const out: Record<string, PlayerState> = {};
  for (const r of rows) {
    if (!r.player_name) continue;
    const label = (r.signal_label ?? "").toLowerCase();
    const mapped = SIGNAL_MAP[label];
    if (mapped) out[r.player_name] = mapped;
    else if ((r.market_score ?? 0) >= 70) out[r.player_name] = "sharp_action";
  }
  return out;
}

export function useTerminalFeed(eventId: string | undefined, quotes: PropQuote[]) {
  const [signals, setSignals] = useState<MarketSignalRow[]>([]);
  const [projections, setProjections] = useState<
    Array<{ player_name: string; prop_type: string; projected_value: number | null; recommended_side: string | null; confidence_score: number | null }>
  >([]);
  const [quotesTick, setQuotesTick] = useState(0);

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    async function load() {
      try {
        const [{ data: sig }, { data: proj }] = await Promise.all([
          supabase
            .from("market_signals")
            .select("player_name, signal_label, market_score, market_type, rationale")
            .eq("event_id", eventId)
            .limit(500),
          supabase
            .from("player_prop_hitrates")
            .select("player_name, prop_type, projected_value, recommended_side, confidence_score")
            .eq("event_id", eventId)
            .limit(500),
        ]);
        if (cancelled) return;
        setSignals((sig as MarketSignalRow[]) ?? []);
        setProjections((proj as any[]) ?? []);
      } catch (err) {
        console.error("[useTerminalFeed] load failed", err);
      }
    }
    load();
    const id = setInterval(load, 20_000);

    const ch = supabase
      .channel(`terminal-feed-${eventId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "market_signals", filter: `event_id=eq.${eventId}` },
        () => load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "live_prop_quotes", filter: `event_id=eq.${eventId}` },
        () => setQuotesTick((t) => t + 1),
      )
      .subscribe();

    return () => {
      cancelled = true;
      clearInterval(id);
      supabase.removeChannel(ch);
    };
  }, [eventId]);

  // Freshness filter: only keep latest snapshot per (player|prop|book|line) by fetched_at
  const freshQuotes = useMemo(() => {
    const latest = new Map<string, PropQuote>();
    for (const q of quotes) {
      const k = `${q.player_name}|${q.prop_type}|${q.bookmaker}|${q.line}`;
      const prev = latest.get(k);
      const ts = (q as any).fetched_at ? new Date((q as any).fetched_at).getTime() : 0;
      const prevTs = prev && (prev as any).fetched_at ? new Date((prev as any).fetched_at).getTime() : -1;
      if (!prev || ts > prevTs) latest.set(k, q);
    }
    return Array.from(latest.values());
    // intentionally include quotesTick so realtime nudges recompute even if reference is same
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotes, quotesTick]);

  const enriched = useMemo(() => {
    const rows = buildEdgeRows(freshQuotes);
    const projIndex = new Map<string, { proj: number | null; side: string | null; conf: number | null }>();
    for (const p of projections) {
      projIndex.set(`${p.player_name}|${p.prop_type}`, {
        proj: p.projected_value,
        side: p.recommended_side,
        conf: p.confidence_score,
      });
    }
    return rows.map((r) => {
      const hit = projIndex.get(r.key);
      if (hit?.proj != null) return { ...r, modelLine: Number(hit.proj) };
      return r;
    });
  }, [freshQuotes, projections]);

  const lastUpdated = useMemo(() => {
    let max = 0;
    for (const q of quotes) {
      const ts = (q as any).fetched_at ? new Date((q as any).fetched_at).getTime() : 0;
      if (ts > max) max = ts;
    }
    return max || null;
  }, [quotes]);

  return {
    rows: enriched,
    playerStates: statesFromSignals(signals),
    signalCount: signals.length,
    hasProjections: projections.length > 0,
    lastUpdated,
  };
}