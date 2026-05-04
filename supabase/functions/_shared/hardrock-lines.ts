// ============================================================================
// hardrock-lines.ts
// Pulls live NBA player-prop lines from Hard Rock Bet via The Odds API and
// exposes a lookup keyed by (event_id, player, prop_type).
//
// Cascade/single alerts gate against this so we never broadcast a line the
// user can't actually book on Hard Rock.
// ============================================================================

export interface HardRockLine {
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

export const HRB_LINE_TOLERANCE = 0.5;
export const HRB_MAX_JUICE = -200; // worse than -200 → unbettable, drop

export function hrbKey(eventId: string, player: string, propType: string): string {
  return `${eventId}|${(player ?? '').toLowerCase().trim()}|${(propType ?? '').toLowerCase().trim()}`;
}

let cache: { ts: number; map: Map<string, HardRockLine> } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min — engine runs every couple minutes

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
 * Returns a Map of HardRockLine keyed by hrbKey(). On API failure returns an
 * empty map — callers should treat empty as "no HRB coverage right now".
 */
export async function loadHardRockLines(opts?: { apiKey?: string; eventIds?: string[] }): Promise<Map<string, HardRockLine>> {
  const now = Date.now();
  if (cache && now - cache.ts < CACHE_TTL_MS) return cache.map;

  const apiKey = opts?.apiKey ?? Deno.env.get('THE_ODDS_API_KEY');
  const map = new Map<string, HardRockLine>();
  if (!apiKey) {
    console.warn('[hardrock-lines] THE_ODDS_API_KEY missing — HRB gating disabled');
    cache = { ts: now, map };
    return map;
  }

  try {
    const sport = 'basketball_nba';
    // Step 1: discover events (h2h is cheapest)
    const evUrl = `https://api.the-odds-api.com/v4/sports/${sport}/odds?apiKey=${apiKey}&regions=us&markets=h2h&oddsFormat=american&bookmakers=hardrockbet`;
    const evRes = await fetchWithTimeout(evUrl);
    if (!evRes.ok) {
      console.warn(`[hardrock-lines] event discovery failed ${evRes.status}`);
      cache = { ts: now, map };
      return map;
    }
    const events: Array<{ id: string }> = await evRes.json();
    const filterIds = opts?.eventIds && opts.eventIds.length > 0 ? new Set(opts.eventIds) : null;
    const eventIds = events.map((e) => e.id).filter((id) => !filterIds || filterIds.has(id));

    // Step 2: per-event prop fetch
    for (const eventId of eventIds) {
      const propsUrl = `https://api.the-odds-api.com/v4/sports/${sport}/events/${eventId}/odds?apiKey=${apiKey}&regions=us&markets=${PROP_MARKETS.join(',')}&oddsFormat=american&bookmakers=hardrockbet`;
      try {
        const r = await fetchWithTimeout(propsUrl, 8000);
        if (!r.ok) continue;
        const data = await r.json();
        for (const bm of (data.bookmakers ?? [])) {
          if (bm.key !== 'hardrockbet') continue;
          for (const market of (bm.markets ?? [])) {
            // group outcomes per (player, line) so we capture both sides
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
              map.set(hrbKey(eventId, player, market.key), {
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
        console.warn(`[hardrock-lines] event ${eventId} fetch failed:`, err);
      }
    }
  } catch (err) {
    console.error('[hardrock-lines] fatal:', err);
  }

  cache = { ts: now, map };
  console.log(`[hardrock-lines] cached ${map.size} HRB lines`);
  return map;
}

export interface HrbCheckInput {
  event_id: string;
  player: string;
  prop_type: string;
  side: 'Over' | 'Under';
  line: number;
}

export interface HrbCheckResult {
  ok: boolean;
  reason?: string;
  hrb?: HardRockLine;
  hrb_price?: number | null; // price for the alerted side on HRB
}

/**
 * Validate a single leg against HRB. Returns ok=false (with reason) if the
 * line is missing, off by more than HRB_LINE_TOLERANCE, or the juice is
 * worse than HRB_MAX_JUICE.
 */
export function checkHrbLine(map: Map<string, HardRockLine>, leg: HrbCheckInput): HrbCheckResult {
  const hrb = map.get(hrbKey(leg.event_id, leg.player, leg.prop_type));
  if (!hrb) return { ok: false, reason: 'no_hrb_listing' };
  if (Math.abs(hrb.line - leg.line) > HRB_LINE_TOLERANCE) {
    return { ok: false, reason: `line_mismatch (alert ${leg.line} vs HRB ${hrb.line})`, hrb };
  }
  const price = leg.side === 'Over' ? hrb.over_price : hrb.under_price;
  if (price == null) return { ok: false, reason: 'no_hrb_price_for_side', hrb };
  if (price < HRB_MAX_JUICE) return { ok: false, reason: `juice_too_high (${price})`, hrb, hrb_price: price };
  return { ok: true, hrb, hrb_price: price };
}

/** Test-only: reset module cache. */
export function __resetHrbCache() { cache = null; }
