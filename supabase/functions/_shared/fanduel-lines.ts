// ============================================================================
// fanduel-lines.ts
// Pulls live NBA player-prop lines from FanDuel via The Odds API and exposes
// a lookup keyed by (event_id, player, prop_type). Cascade/single alerts
// gate against this so we never broadcast a line the user can't book on FD.
//
// Replaces the deprecated hardrock-lines.ts gate. Same shape, same tolerance
// (0.5 pts) and same juice cap (-200), just pointed at FanDuel.
// ============================================================================

export interface FanduelLine {
  event_id: string;
  player: string;
  prop_type: string;
  line: number;
  over_price: number | null;
  under_price: number | null;
}

const PROP_MARKETS = [
  'player_points',
  'player_rebounds',
  'player_assists',
  'player_threes',
  'player_points_rebounds_assists',
  'player_steals',
  'player_blocks',
];

export const FD_LINE_TOLERANCE = 0.5;
export const FD_MAX_JUICE = -200; // worse than -200 → unbettable, drop

export function fdKey(eventId: string, player: string, propType: string): string {
  return `${eventId}|${(player ?? '').toLowerCase().trim()}|${(propType ?? '').toLowerCase().trim()}`;
}

let cache: { ts: number; map: Map<string, FanduelLine> } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function fetchWithTimeout(url: string, timeoutMs = 9000): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

/**
 * Returns a Map of FanduelLine keyed by fdKey(). On API failure returns an
 * empty map — callers should treat empty as "no FD coverage right now".
 */
export async function loadFanduelLines(opts?: { apiKey?: string; eventIds?: string[] }): Promise<Map<string, FanduelLine>> {
  const now = Date.now();
  if (cache && now - cache.ts < CACHE_TTL_MS) return cache.map;

  const apiKey = opts?.apiKey ?? Deno.env.get('THE_ODDS_API_KEY');
  const map = new Map<string, FanduelLine>();
  if (!apiKey) {
    console.warn('[fanduel-lines] THE_ODDS_API_KEY missing — FD gating disabled');
    cache = { ts: now, map };
    return map;
  }

  try {
    const sport = 'basketball_nba';
    const evUrl = `https://api.the-odds-api.com/v4/sports/${sport}/odds?apiKey=${apiKey}&regions=us&markets=h2h&oddsFormat=american&bookmakers=fanduel`;
    const evRes = await fetchWithTimeout(evUrl);
    if (!evRes.ok) {
      console.warn(`[fanduel-lines] event discovery failed ${evRes.status}`);
      cache = { ts: now, map };
      return map;
    }
    const events: Array<{ id: string }> = await evRes.json();
    const filterIds = opts?.eventIds && opts.eventIds.length > 0 ? new Set(opts.eventIds) : null;
    const eventIds = events.map((e) => e.id).filter((id) => !filterIds || filterIds.has(id));

    for (const eventId of eventIds) {
      const propsUrl = `https://api.the-odds-api.com/v4/sports/${sport}/events/${eventId}/odds?apiKey=${apiKey}&regions=us&markets=${PROP_MARKETS.join(',')}&oddsFormat=american&bookmakers=fanduel`;
      try {
        const r = await fetchWithTimeout(propsUrl, 8000);
        if (!r.ok) continue;
        const data = await r.json();
        for (const bm of (data.bookmakers ?? [])) {
          if (bm.key !== 'fanduel') continue;
          for (const market of (bm.markets ?? [])) {
            const grouped = new Map<string, { over: number | null; under: number | null; line: number }>();
            for (const o of (market.outcomes ?? [])) {
              const player: string = o.description ?? '';
              const line: number = Number(o.point);
              if (!player || !Number.isFinite(line)) continue;
              const k = `${player.toLowerCase()}|${line}`;
              const cur = grouped.get(k) ?? { over: null, under: null, line };
              if (String(o.name).toLowerCase() === 'over') cur.over = Number(o.price);
              else if (String(o.name).toLowerCase() === 'under') cur.under = Number(o.price);
              grouped.set(k, cur);
            }
            for (const [k, v] of grouped) {
              const player = k.split('|')[0];
              map.set(fdKey(eventId, player, market.key), {
                event_id: eventId,
                player,
                prop_type: market.key,
                line: v.line,
                over_price: v.over,
                under_price: v.under,
              });
            }
          }
        }
      } catch (err) {
        console.warn(`[fanduel-lines] event ${eventId} fetch failed:`, err);
      }
    }
  } catch (err) {
    console.error('[fanduel-lines] fatal:', err);
  }

  cache = { ts: now, map };
  console.log(`[fanduel-lines] cached ${map.size} FD lines`);
  return map;
}

export interface FdCheckInput {
  event_id: string;
  player: string;
  prop_type: string;
  side: 'Over' | 'Under';
  line: number;
}

export interface FdCheckResult {
  ok: boolean;
  reason?: string;
  fd?: FanduelLine;
  fd_price?: number | null;
}

export function checkFdLine(map: Map<string, FanduelLine>, leg: FdCheckInput): FdCheckResult {
  const fd = map.get(fdKey(leg.event_id, leg.player, leg.prop_type));
  if (!fd) return { ok: false, reason: 'no_fd_listing' };
  if (Math.abs(fd.line - leg.line) > FD_LINE_TOLERANCE) {
    return { ok: false, reason: `line_mismatch (alert ${leg.line} vs FD ${fd.line})`, fd };
  }
  const price = leg.side === 'Over' ? fd.over_price : fd.under_price;
  if (price == null) return { ok: false, reason: 'no_fd_price_for_side', fd };
  if (price < FD_MAX_JUICE) return { ok: false, reason: `juice_too_high (${price})`, fd, fd_price: price };
  return { ok: true, fd, fd_price: price };
}

/** Test-only: reset module cache. */
export function __resetFdCache() { cache = null; }