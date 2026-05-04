// Court.Edge — fetch tennis odds (h2h + totals) from The Odds API.
// Returns events for the next 48h with totals point + American h2h prices.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ODDS_BASE = "https://api.the-odds-api.com/v4/sports";

interface NormalizedEvent {
  event_id: string;
  sport_key: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  total_point: number | null;
  ml_home: number | null;
  ml_away: number | null;
  bookmaker: string | null;
  total_over_price: number | null;
  total_under_price: number | null;
  books_count: number;
  book_lines: Array<{ book: string; point: number; over_price: number | null; under_price: number | null }>;
}

function pickKey(): string | null {
  return Deno.env.get("THE_ODDS_API_KEY") || Deno.env.get("ODDS_API_KEY") || null;
}

async function listTennisSportKeys(apiKey: string): Promise<string[]> {
  const url = `${ODDS_BASE}?all=false&apiKey=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`sports list failed ${res.status}`);
  const data = await res.json();
  return (data || [])
    .filter((s: { key?: string; active?: boolean }) =>
      s?.active !== false && typeof s?.key === "string" && s.key.toLowerCase().includes("tennis")
    )
    .map((s: { key: string }) => s.key);
}

const FORWARD_WINDOW_HOURS = 7 * 24; // was 48 — extend to 7d so Rome qualis etc. flow in early.

async function fetchSportEvents(apiKey: string, sportKey: string): Promise<NormalizedEvent[]> {
  const url = `${ODDS_BASE}/${sportKey}/odds?regions=us,eu&markets=h2h,totals&oddsFormat=american&apiKey=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`odds for ${sportKey} ${res.status}: ${txt.slice(0, 200)}`);
  }
  const events = await res.json();
  const cutoff = Date.now() + FORWARD_WINDOW_HOURS * 60 * 60 * 1000;
  const out: NormalizedEvent[] = [];

  for (const ev of events || []) {
    const commence = Date.parse(ev.commence_time);
    if (!Number.isFinite(commence) || commence > cutoff) continue;

    let totalPoint: number | null = null;
    let totalOverPrice: number | null = null;
    let totalUnderPrice: number | null = null;
    let mlHome: number | null = null;
    let mlAway: number | null = null;
    let bookmaker: string | null = null;
    const bookLines: Array<{ book: string; point: number; over_price: number | null; under_price: number | null }> = [];

    for (const bk of ev.bookmakers || []) {
      let bkPoint: number | null = null;
      let bkOver: number | null = null;
      let bkUnder: number | null = null;
      for (const mkt of bk.markets || []) {
        if (mkt.key === "totals") {
          for (const oc of mkt.outcomes || []) {
            if (typeof oc.point === "number" && bkPoint == null) bkPoint = oc.point;
            const nm = String(oc.name || "").toLowerCase();
            if (nm === "over" && typeof oc.price === "number") bkOver = oc.price;
            if (nm === "under" && typeof oc.price === "number") bkUnder = oc.price;
          }
          if (bkPoint != null && totalPoint == null) {
            totalPoint = bkPoint;
            totalOverPrice = bkOver;
            totalUnderPrice = bkUnder;
            bookmaker = bookmaker || bk.title || bk.key;
          }
        }
        if (mkt.key === "h2h" && (mlHome == null || mlAway == null)) {
          for (const oc of mkt.outcomes || []) {
            if (oc.name === ev.home_team && typeof oc.price === "number") mlHome = oc.price;
            if (oc.name === ev.away_team && typeof oc.price === "number") mlAway = oc.price;
          }
          bookmaker = bookmaker || bk.title || bk.key;
        }
      }
      if (bkPoint != null) {
        bookLines.push({ book: bk.title || bk.key, point: bkPoint, over_price: bkOver, under_price: bkUnder });
      }
    }

    out.push({
      event_id: ev.id,
      sport_key: ev.sport_key,
      commence_time: ev.commence_time,
      home_team: ev.home_team,
      away_team: ev.away_team,
      total_point: totalPoint,
      ml_home: mlHome,
      ml_away: mlAway,
      bookmaker,
      total_over_price: totalOverPrice,
      total_under_price: totalUnderPrice,
      books_count: bookLines.length,
      book_lines: bookLines,
    });
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const apiKey = pickKey();
    if (!apiKey) {
      return new Response(JSON.stringify({ ok: false, error: "missing THE_ODDS_API_KEY" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sportKeys = await listTennisSportKeys(apiKey);
    const events: NormalizedEvent[] = [];
    const errors: Array<{ sport: string; error: string }> = [];
    const empty_sport_keys: string[] = [];

    for (const sk of sportKeys) {
      try {
        const ev = await fetchSportEvents(apiKey, sk);
        if (ev.length === 0) empty_sport_keys.push(sk);
        events.push(...ev);
      } catch (e) {
        errors.push({ sport: sk, error: e instanceof Error ? e.message : String(e) });
      }
    }
    if (empty_sport_keys.length > 0) {
      console.log(`[court-edge-fetch-odds] sport keys with 0 events in next ${FORWARD_WINDOW_HOURS}h:`, empty_sport_keys.join(", "));
    }

    return new Response(JSON.stringify({ ok: true, sport_keys: sportKeys, events, errors, empty_sport_keys, window_hours: FORWARD_WINDOW_HOURS }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});