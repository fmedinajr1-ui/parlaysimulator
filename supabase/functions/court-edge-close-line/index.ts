// Court.Edge — capture closing line (CLV) for picks near match start.
// Cron-driven every 5 min. For each pick with commence_at within
// [now - 30 min, now + 15 min] and close_line still null, fetches current
// totals from The Odds API and writes:
//   close_line          = total games line at capture time
//   close_captured_at   = now
//   clv_games           = signed line move IN OUR FAVOR
//                         (close - bet) for OVERs, (bet - close) for UNDERs
// Positive clv_games means the market closed toward our side — real edge.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ODDS_BASE = "https://api.the-odds-api.com/v4/sports";
const PRE_WINDOW_MIN = 15;   // pick must start within next 15 min (or be already ≤30 min old)
const POST_WINDOW_MIN = 30;

function apiKey(): string | null {
  return Deno.env.get("THE_ODDS_API_KEY") || Deno.env.get("ODDS_API_KEY") || null;
}

function norm(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .trim();
}

function nameKey(home: string, away: string): string {
  return [norm(home), norm(away)].sort().join("|");
}

interface EventTotals {
  commence_time: string;
  home_team: string;
  away_team: string;
  total_point: number | null;
}

async function listTennisSportKeys(key: string): Promise<string[]> {
  const r = await fetch(`${ODDS_BASE}?all=false&apiKey=${key}`);
  if (!r.ok) throw new Error(`sports list ${r.status}`);
  const data = await r.json();
  return (data || [])
    .filter((s: any) => s?.active !== false && typeof s?.key === "string" && s.key.toLowerCase().includes("tennis"))
    .map((s: any) => s.key as string);
}

async function fetchSportTotals(key: string, sk: string): Promise<EventTotals[]> {
  const r = await fetch(`${ODDS_BASE}/${sk}/odds?regions=us,eu&markets=totals&oddsFormat=american&apiKey=${key}`);
  if (!r.ok) return [];
  const data = await r.json();
  const out: EventTotals[] = [];
  for (const ev of data || []) {
    let total: number | null = null;
    for (const bk of ev.bookmakers || []) {
      for (const mkt of bk.markets || []) {
        if (mkt.key !== "totals") continue;
        for (const oc of mkt.outcomes || []) {
          if (typeof oc.point === "number") { total = oc.point; break; }
        }
        if (total != null) break;
      }
      if (total != null) break;
    }
    out.push({
      commence_time: ev.commence_time,
      home_team: ev.home_team,
      away_team: ev.away_team,
      total_point: total,
    });
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const key = apiKey();
    if (!key) {
      return new Response(JSON.stringify({ ok: false, error: "missing THE_ODDS_API_KEY" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const now = Date.now();
    const lo = new Date(now - POST_WINDOW_MIN * 60_000).toISOString();
    const hi = new Date(now + PRE_WINDOW_MIN * 60_000).toISOString();

    const { data: picks, error } = await supabase
      .from("court_edge_picks")
      .select("id,matchup,verdict,line,commence_at,market")
      .is("close_line", null)
      .eq("market", "match_total")
      .gte("commence_at", lo)
      .lte("commence_at", hi)
      .limit(300);
    if (error) throw new Error(error.message);
    if (!picks?.length) {
      return new Response(JSON.stringify({ ok: true, candidates: 0, captured: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Index live odds events by sorted normalized name pair
    const sportKeys = await listTennisSportKeys(key);
    const evIdx = new Map<string, EventTotals>();
    for (const sk of sportKeys) {
      const list = await fetchSportTotals(key, sk);
      for (const ev of list) {
        const k = nameKey(ev.home_team, ev.away_team);
        // Prefer entry with a totals line if one exists
        const existing = evIdx.get(k);
        if (!existing || (existing.total_point == null && ev.total_point != null)) evIdx.set(k, ev);
      }
    }

    let captured = 0;
    let unmatched = 0;
    const updates: Array<{ id: string; close_line: number; clv_games: number; close_captured_at: string }> = [];
    for (const p of picks) {
      const [home, away] = (p.matchup || "").split(/\s+vs\s+/i);
      if (!home || !away) { unmatched++; continue; }
      const ev = evIdx.get(nameKey(home, away));
      if (!ev || ev.total_point == null) { unmatched++; continue; }
      const close = Number(ev.total_point);
      const bet = Number(p.line);
      const isOver = String(p.verdict).endsWith("_OVER");
      const clv = isOver ? (close - bet) : (bet - close);
      updates.push({
        id: p.id,
        close_line: close,
        clv_games: +clv.toFixed(2),
        close_captured_at: new Date().toISOString(),
      });
    }

    for (const u of updates) {
      const { error: upErr } = await supabase
        .from("court_edge_picks")
        .update({
          close_line: u.close_line,
          clv_games: u.clv_games,
          close_captured_at: u.close_captured_at,
        })
        .eq("id", u.id);
      if (upErr) console.error(`[clv] ${u.id}`, upErr.message);
      else captured++;
    }

    return new Response(JSON.stringify({
      ok: true,
      candidates: picks.length,
      captured,
      unmatched,
      sport_keys: sportKeys.length,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});