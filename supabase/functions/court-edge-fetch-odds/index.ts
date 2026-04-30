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

async function fetchSportEvents(apiKey: string, sportKey: string): Promise<NormalizedEvent[]> {
  const url = `${ODDS_BASE}/${sportKey}/odds?regions=us,eu&markets=h2h,totals&oddsFormat=american&apiKey=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`odds for ${sportKey} ${res.status}: ${txt.slice(0, 200)}`);
  }
  const events = await res.json();
  const cutoff = Date.now() + 48 * 60 * 60 * 1000;
  const out: NormalizedEvent[] = [];

  for (const ev of events || []) {
    const commence = Date.parse(ev.commence_time);
    if (!Number.isFinite(commence) || commence > cutoff) continue;

    let totalPoint: number | null = null;
    let mlHome: number | null = null;
    let mlAway: number | null = null;
    let bookmaker: string | null = null;

    for (const bk of ev.bookmakers || []) {
      for (const mkt of bk.markets || []) {
        if (mkt.key === "totals" && totalPoint == null) {
          const out1 = mkt.outcomes?.[0];
          if (typeof out1?.point === "number") {
            totalPoint = out1.point;
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
      if (totalPoint != null && mlHome != null && mlAway != null) break;
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

    for (const sk of sportKeys) {
      try {
        const ev = await fetchSportEvents(apiKey, sk);
        events.push(...ev);
      } catch (e) {
        errors.push({ sport: sk, error: e instanceof Error ? e.message : String(e) });
      }
    }

    return new Response(JSON.stringify({ ok: true, sport_keys: sportKeys, events, errors }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});