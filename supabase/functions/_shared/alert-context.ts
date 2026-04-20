// _shared/alert-context.ts
//
// Live-context lookups for the v3 alert renderer:
//   - Line at first detection vs current line (from `line_movements`)
//   - Time-to-tip / live status (from `bot_daily_picks.game_start_utc`)
//
// All lookups are tolerant: missing data → returns nulls, never throws.
// Per-invocation memoization so a burst of alerts hits the DB once each.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export interface LineContext {
  openLine: number | null;
  currentLine: number | null;
  openPrice: number | null;
  currentPrice: number | null;
  movement: number | null;        // current - open (point)
  priceMovement: number | null;   // current - open (price/odds)
  movedAt: string | null;
}

export interface GameContext {
  tipInMinutes: number | null;     // negative = already started
  tipDisplay: string | null;        // "2h14m", "live", "T-22m", "final"
  status: 'pre' | 'live' | 'final' | 'unknown';
  commenceTime: string | null;
}

const lineCache = new Map<string, LineContext>();
const gameCache = new Map<string, GameContext>();
let lineCacheLoadedAt = 0;
let gameCacheLoadedAt = 0;
const TTL_MS = 60_000;

function cacheKey(eventId: string, marketKey?: string | null): string {
  return `${eventId}::${marketKey ?? ''}`;
}

/**
 * Pull open + current line/price for a market. Falls back to most-recent rows
 * if `marketKey` isn't provided. Returns nulls if nothing matches.
 */
export async function getLineContext(
  sb: SupabaseClient,
  eventId: string | null | undefined,
  marketKey?: string | null
): Promise<LineContext> {
  const empty: LineContext = {
    openLine: null, currentLine: null, openPrice: null, currentPrice: null,
    movement: null, priceMovement: null, movedAt: null,
  };
  if (!eventId) return empty;

  const k = cacheKey(eventId, marketKey);
  if (lineCache.has(k) && Date.now() - lineCacheLoadedAt < TTL_MS) {
    return lineCache.get(k)!;
  }

  try {
    let q = sb
      .from('line_movements')
      .select('opening_point, new_point, opening_price, new_price, detected_at, market_type')
      .eq('event_id', eventId)
      .order('detected_at', { ascending: false })
      .limit(1);
    if (marketKey) q = q.eq('market_type', marketKey);

    const { data } = await q.maybeSingle();
    if (!data) {
      lineCache.set(k, empty);
      lineCacheLoadedAt = Date.now();
      return empty;
    }

    const openLine = data.opening_point != null ? Number(data.opening_point) : null;
    const currentLine = data.new_point != null ? Number(data.new_point) : null;
    const openPrice = data.opening_price != null ? Number(data.opening_price) : null;
    const currentPrice = data.new_price != null ? Number(data.new_price) : null;

    const ctx: LineContext = {
      openLine,
      currentLine,
      openPrice,
      currentPrice,
      movement: openLine != null && currentLine != null ? currentLine - openLine : null,
      priceMovement: openPrice != null && currentPrice != null ? currentPrice - openPrice : null,
      movedAt: data.detected_at ?? null,
    };
    lineCache.set(k, ctx);
    lineCacheLoadedAt = Date.now();
    return ctx;
  } catch (e) {
    console.warn('[alert-context] getLineContext failed:', (e as Error).message);
    return empty;
  }
}

/**
 * Tip-time lookup. Tries `bot_daily_picks.game_start_utc` first (we already
 * persist this), then falls back to `line_movements.commence_time` if any
 * recent row exists for the event_id.
 */
export async function getGameContext(
  sb: SupabaseClient,
  eventId: string | null | undefined
): Promise<GameContext> {
  const empty: GameContext = {
    tipInMinutes: null, tipDisplay: null, status: 'unknown', commenceTime: null,
  };
  if (!eventId) return empty;

  if (gameCache.has(eventId) && Date.now() - gameCacheLoadedAt < TTL_MS) {
    return gameCache.get(eventId)!;
  }

  try {
    let commenceISO: string | null = null;

    // Try bot_daily_picks first (richer + always populated for our own picks)
    const { data: pick } = await sb
      .from('bot_daily_picks')
      .select('game_start_utc')
      .eq('game_id', eventId)
      .not('game_start_utc', 'is', null)
      .order('generated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (pick?.game_start_utc) commenceISO = pick.game_start_utc;

    // Fall back to line_movements
    if (!commenceISO) {
      const { data: mv } = await sb
        .from('line_movements')
        .select('commence_time')
        .eq('event_id', eventId)
        .not('commence_time', 'is', null)
        .order('detected_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (mv?.commence_time) commenceISO = mv.commence_time;
    }

    if (!commenceISO) {
      gameCache.set(eventId, empty);
      gameCacheLoadedAt = Date.now();
      return empty;
    }

    const ctx = buildGameContextFromCommence(commenceISO);
    gameCache.set(eventId, ctx);
    gameCacheLoadedAt = Date.now();
    return ctx;
  } catch (e) {
    console.warn('[alert-context] getGameContext failed:', (e as Error).message);
    return empty;
  }
}

/** Pure helper — exposed for callers that already know commence_time. */
export function buildGameContextFromCommence(commenceISO: string): GameContext {
  const now = Date.now();
  const tip = new Date(commenceISO).getTime();
  const minutes = Math.round((tip - now) / 60_000);

  let status: GameContext['status'] = 'pre';
  if (minutes < -240) status = 'final';            // 4h+ since tip → assume final
  else if (minutes <= 0) status = 'live';

  const tipDisplay =
    status === 'final' ? 'final'
    : status === 'live' ? 'live'
    : minutes < 60 ? `T-${minutes}m`
    : `${Math.floor(minutes / 60)}h${minutes % 60}m`;

  return { tipInMinutes: minutes, tipDisplay, status, commenceTime: commenceISO };
}

/** Format a price/odds movement as ±X. */
export function formatPriceMove(open: number | null, current: number | null): string | null {
  if (open == null || current == null || open === current) return null;
  const sign = current > open ? '+' : '';
  return `${formatAmerican(open)} → ${formatAmerican(current)} (${sign}${current - open})`;
}

function formatAmerican(odds: number): string {
  return odds > 0 ? `+${odds}` : `${odds}`;
}

/** Format a line/point movement as a → b. */
export function formatLineMove(open: number | null, current: number | null): string | null {
  if (open == null || current == null || open === current) return null;
  const sign = current > open ? '↑' : '↓';
  return `${open} → ${current} ${sign}`;
}