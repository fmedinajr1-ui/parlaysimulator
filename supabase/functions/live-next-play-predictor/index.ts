// Live AI predictor: ranks the top sportsbook props most likely to resolve
// on the very next discrete play (at-bat / possession / snap) given live PBP
// + game state + active prop quotes. Writes results to live_next_play_predictions.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Quote = {
  player_name: string;
  prop_type: string;
  bookmaker: string;
  line: number | null;
  over_price: number | null;
  under_price: number | null;
  fetched_at: string;
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

function americanToProb(p: number | null): number | null {
  if (p == null) return null;
  return p > 0 ? 100 / (p + 100) : -p / (-p + 100);
}

// In-process cache to limit Gemini calls per event_id
const cache = new Map<string, number>();
const CACHE_MS = 12_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { event_id } = await req.json();
    if (!event_id || typeof event_id !== "string") {
      return json({ error: "event_id required" }, 400);
    }

    const last = cache.get(event_id) ?? 0;
    if (Date.now() - last < CACHE_MS) {
      return json({ skipped: true, reason: "cache" });
    }
    cache.set(event_id, Date.now());

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    const [{ data: stateRow }, { data: quoteRows }] = await Promise.all([
      sb.from("live_game_state").select("*").eq("game_id", event_id).maybeSingle(),
      sb
        .from("live_prop_quotes")
        .select("player_name, prop_type, bookmaker, line, over_price, under_price, fetched_at")
        .eq("event_id", event_id)
        .order("fetched_at", { ascending: false })
        .limit(800),
    ]);

    if (!stateRow) return json({ skipped: true, reason: "no_state" });
    const quotes: Quote[] = (quoteRows as Quote[]) ?? [];
    if (!quotes.length) return json({ skipped: true, reason: "no_quotes" });

    // Latest snapshot per player|prop|book|line
    const latest = new Map<string, Quote>();
    for (const q of quotes) {
      if (q.line == null) continue;
      const k = `${q.player_name}|${q.prop_type}|${q.bookmaker}|${q.line}`;
      if (!latest.has(k)) latest.set(k, q);
    }

    // Reference price per player|prop|line (prefer FanDuel, else first)
    const refByKey = new Map<string, Quote>();
    const REF_PRIORITY = ["fanduel", "draftkings", "betmgm", "williamhill_us", "pinnacle"];
    for (const q of latest.values()) {
      const k = `${q.player_name}|${q.prop_type}|${q.line}`;
      const cur = refByKey.get(k);
      const curRank = cur ? REF_PRIORITY.indexOf(cur.bookmaker) : 99;
      const newRank = REF_PRIORITY.indexOf(q.bookmaker);
      if (!cur || (newRank !== -1 && (curRank === -1 || newRank < curRank))) refByKey.set(k, q);
    }

    // Build a compact prop list for the model — top 40
    const propList = Array.from(refByKey.values())
      .slice(0, 40)
      .map((q) => ({
        player: q.player_name,
        prop: PROP_LABEL[q.prop_type] ?? q.prop_type,
        prop_type: q.prop_type,
        line: q.line,
        book: q.bookmaker,
        over: q.over_price,
        under: q.under_price,
      }));

    if (!apiKey) {
      return json({ skipped: true, reason: "no_lovable_key" });
    }

    const gameCtx = {
      sport: stateRow.sport,
      home: stateRow.home_team,
      away: stateRow.away_team,
      home_score: stateRow.home_score,
      away_score: stateRow.away_score,
      period: stateRow.period,
      clock: stateRow.clock,
      possession: stateRow.possession,
      status: stateRow.status,
    };

    const sys =
      "You are an elite live sports betting analyst watching one specific game in real time. " +
      "Predict the top 5 sportsbook props most likely to RESOLVE in the bettor's favor on the VERY NEXT discrete play " +
      "(next at-bat in baseball, next possession in basketball, next snap in football, next shift in hockey, next attacking phase in soccer). " +
      "Use the current game state and recent context. Be decisive about Over vs Under. " +
      "Each prediction MUST be an exact prop from the provided list (same player_name, prop_type, line, book). " +
      "Return ONLY JSON: {\"predictions\":[{\"player_name\",\"prop_type\",\"line\",\"book\",\"side\":\"Over\"|\"Under\",\"prob_next_play\":0..1,\"rationale\":\"<=110 chars\"}]}.";

    const user = `GAME CONTEXT:\n${JSON.stringify(gameCtx)}\n\nACTIVE PROPS (only choose from these):\n${JSON.stringify(propList)}`;

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!aiRes.ok) {
      const text = await aiRes.text();
      console.error("[live-next-play-predictor] gateway error", aiRes.status, text);
      return json({ error: "ai_gateway", status: aiRes.status }, 502);
    }
    const aiJson = await aiRes.json();
    const raw = aiJson?.choices?.[0]?.message?.content ?? "{}";
    let parsed: { predictions?: any[] } = {};
    try {
      parsed = safeParseJson(raw);
    } catch (err) {
      console.error("[live-next-play-predictor] bad JSON from model", err, String(raw).slice(0, 500));
      return json({ skipped: true, reason: "bad_model_json" });
    }
    const preds = Array.isArray(parsed.predictions) ? parsed.predictions.slice(0, 5) : [];
    if (!preds.length) return json({ inserted: 0, reason: "no_preds" });

    const rows = preds
      .map((p) => {
        const refKey = `${p.player_name}|${p.prop_type}|${Number(p.line)}`;
        const ref = refByKey.get(refKey);
        if (!ref) return null;
        const price = p.side === "Over" ? ref.over_price : ref.under_price;
        const implied = americanToProb(price);
        const prob = clamp01(Number(p.prob_next_play));
        const edge = implied != null ? +((prob - implied) * 100).toFixed(2) : null;
        return {
          event_id,
          player_name: ref.player_name,
          prop_type: ref.prop_type,
          prop_label: PROP_LABEL[ref.prop_type] ?? ref.prop_type,
          line: ref.line,
          side: p.side === "Under" ? "Under" : "Over",
          book: ref.bookmaker,
          american_price: price,
          prob_next_play: prob,
          edge_pct: edge,
          rationale: typeof p.rationale === "string" ? p.rationale.slice(0, 200) : null,
          state_context: gameCtx as unknown as Record<string, unknown>,
          model: "google/gemini-3-flash-preview",
        };
      })
      .filter(Boolean);

    if (!rows.length) return json({ inserted: 0, reason: "no_matched_props" });

    // Prune expired rows for this event then insert fresh batch
    await sb.from("live_next_play_predictions").delete().eq("event_id", event_id);
    const { error: insErr } = await sb.from("live_next_play_predictions").insert(rows as any);
    if (insErr) {
      console.error("[live-next-play-predictor] insert err", insErr);
      return json({ error: "insert_failed", detail: insErr.message }, 500);
    }

    return json({ inserted: rows.length });
  } catch (err) {
    console.error("[live-next-play-predictor] unexpected", err);
    return json({ error: String(err) }, 500);
  }
});

function clamp01(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}