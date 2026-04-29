// Court.Edge — fetch PrizePicks tennis player projections (Total Games variants).
// PrizePicks blocks edge functions sometimes; this gracefully returns ok:true with empty list on 403.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PP_BASE = "https://api.prizepicks.com";
const TENNIS_LEAGUE_NAMES = /tennis|atp|wta/i;

interface PPProjection {
  player: string;
  league: string;
  stat_type: string;
  line: number;
  start_at: string;
  description?: string;
}

async function ppFetch(path: string): Promise<{ ok: boolean; data?: unknown; status: number }> {
  const res = await fetch(`${PP_BASE}${path}`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      "Accept": "application/json",
    },
  });
  if (!res.ok) return { ok: false, status: res.status };
  const data = await res.json().catch(() => null);
  return { ok: true, data, status: res.status };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const leaguesRes = await ppFetch("/leagues");
    if (!leaguesRes.ok) {
      return new Response(JSON.stringify({ ok: true, projections: [], blocked: true, status: leaguesRes.status }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const leagues = (leaguesRes.data as { data?: Array<{ id: string; attributes?: { name?: string } }> })?.data || [];
    const tennisLeagueIds = leagues
      .filter((l) => l?.attributes?.name && TENNIS_LEAGUE_NAMES.test(l.attributes.name))
      .map((l) => l.id);

    const projections: PPProjection[] = [];
    const errors: Array<{ league: string; error: string }> = [];

    for (const lid of tennisLeagueIds) {
      const r = await ppFetch(`/projections?league_id=${lid}&per_page=250&single_stat=true`);
      if (!r.ok) {
        errors.push({ league: lid, error: `status ${r.status}` });
        continue;
      }
      const body = r.data as { data?: any[]; included?: any[] };
      const included = body.included || [];
      const playerById: Record<string, string> = {};
      const leagueById: Record<string, string> = {};
      for (const inc of included) {
        if (inc.type === "new_player" && inc.attributes?.name) playerById[inc.id] = inc.attributes.name;
        if (inc.type === "league" && inc.attributes?.name) leagueById[inc.id] = inc.attributes.name;
      }
      for (const proj of body.data || []) {
        const a = proj.attributes || {};
        const stat = String(a.stat_type || "");
        if (!/total games|games won|total sets/i.test(stat)) continue;
        const line = Number(a.line_score);
        if (!Number.isFinite(line)) continue;
        const playerId = proj.relationships?.new_player?.data?.id;
        const leagueId = proj.relationships?.league?.data?.id;
        projections.push({
          player: playerById[playerId] || "Unknown",
          league: leagueById[leagueId] || "Tennis",
          stat_type: stat,
          line,
          start_at: a.start_time || "",
          description: a.description || "",
        });
      }
    }

    return new Response(JSON.stringify({ ok: true, projections, errors }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    // Never fail hard — return empty so the orchestrator can continue.
    return new Response(JSON.stringify({ ok: true, projections: [], blocked: true, error: e instanceof Error ? e.message : String(e) }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});