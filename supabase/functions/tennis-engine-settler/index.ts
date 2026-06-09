// tennis-engine-settler
//
// Grades pending tennis rows in engine_live_tracker by scraping TennisAbstract
// for final match scores, then mapping the relevant prop to a real stat.
// Re-uses the proven Court.Edge scrape from court-edge-settle.
//
// Supported props (anything else stays pending — visibility > false positives):
//   - total_games / player_total_games  → sum of both players' games in the match
//   - player_games_won                  → games won by named player
//   - player_total_sets                 → number of sets played

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { playerSlug } from "../_shared/court-edge-slug.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TA_FRAG = "https://www.tennisabstract.com/jsfrags";
const TA_BASE = "https://www.tennisabstract.com/cgi-bin/player.cgi";
const MIN_AGE_HOURS = 3;
const MAX_AGE_DAYS = 14;

interface SetTotals { player: number; opponent: number; }
interface MatchScore { sets: SetTotals[]; totalGames: number; retired: boolean; opponentSlug: string; }

function parseSet(s: string): SetTotals | null {
  const m = s.match(/^(\d{1,2})-(\d{1,2})/);
  if (!m) return null;
  return { player: parseInt(m[1], 10), opponent: parseInt(m[2], 10) };
}

function parseScores(html: string): MatchScore[] {
  const out: MatchScore[] = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    const tr = m[1];
    const sm = tr.match(/<td[^>]*>\s*(\d{1,2}-\d{1,2}(?:\([0-9]+\))?(?:\s+\d{1,2}-\d{1,2}(?:\([0-9]+\))?){1,4})(\s*(?:ret\.?|RET|w\/o))?\s*<\/td>/i);
    if (!sm) continue;
    const retired = !!sm[2];
    const sets: SetTotals[] = [];
    let total = 0;
    for (const part of sm[1].trim().split(/\s+/)) {
      const s = parseSet(part); if (!s) { sets.length = 0; break; }
      sets.push(s); total += s.player + s.opponent;
    }
    if (!sets.length || total < 6 || total > 80) continue;
    const opp = tr.match(/player(?:-classic)?\.cgi\?p=([A-Za-z]+)/);
    out.push({ sets, totalGames: total, retired, opponentSlug: opp ? opp[1] : "" });
  }
  return out;
}

async function fetchFrag(slug: string): Promise<string | null> {
  const headers = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/121 Safari/537.36",
    "Accept": "text/html,application/javascript,*/*",
    "Referer": `${TA_BASE}?p=${slug}`,
  };
  for (const url of [`${TA_FRAG}/${slug}.js`, `${TA_BASE}?p=${slug}`]) {
    try { const r = await fetch(url, { headers }); if (r.ok) return await r.text(); } catch { /* */ }
  }
  return null;
}

function grade(side: string, line: number, actual: number): "won" | "lost" | "push" {
  if (actual === line) return "push";
  const isOver = side.toLowerCase() === "over";
  return ((actual > line) === isOver) ? "won" : "lost";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const log = (m: string) => console.log(`[tennis-settle] ${m}`);

  try {
    const minTs = new Date(Date.now() - MIN_AGE_HOURS * 3600 * 1000).toISOString();
    const maxTs = new Date(Date.now() - MAX_AGE_DAYS * 24 * 3600 * 1000).toISOString();

    const { data: pending, error } = await supabase
      .from("engine_live_tracker")
      .select("id, sport, player_name, prop_type, line, side, pick_description, game_time")
      .or("sport.ilike.tennis%,sport.eq.tennis_atp,sport.eq.tennis_wta")
      .eq("status", "pending")
      .not("side", "eq", "neutral")
      .not("line", "is", null)
      .lt("game_time", minTs)
      .gt("game_time", maxTs)
      .limit(150);
    if (error) throw new Error(`pending: ${error.message}`);
    if (!pending || pending.length === 0) {
      return new Response(JSON.stringify({ success: true, scanned: 0, settled: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let settled = 0, unmatched = 0, unsupported = 0;
    const byResult: Record<string, number> = {};

    for (const p of pending) {
      const pt = String(p.prop_type ?? "").toLowerCase();
      // Parse player + opponent from pick_description if no separate fields ("X vs Y")
      const desc = p.pick_description ?? "";
      const m = desc.match(/([A-Za-z .'\-]+?)\s+(?:OVER|UNDER)/i);
      const player = (p.player_name ?? (m ? m[1].trim() : "")).trim();
      // Opponent: best-effort — pull from any "vs X" elsewhere
      const oppMatch = desc.match(/vs\.?\s+([A-Za-z .'\-]+)/i);
      const opponent = oppMatch ? oppMatch[1].trim() : "";
      if (!player) { unmatched++; continue; }
      const slug = playerSlug(player);
      const oppSlug = opponent ? playerSlug(opponent) : "";
      if (!slug) { unmatched++; continue; }
      const html = await fetchFrag(slug);
      if (!html) { unmatched++; continue; }
      const rows = parseScores(html);
      // Pick the most recent row; if opponent slug known, require match
      const row = oppSlug
        ? rows.find((r) => r.opponentSlug.toLowerCase() === oppSlug.toLowerCase())
        : rows[0];
      if (!row) { unmatched++; continue; }
      if (row.retired) {
        await supabase.from("engine_live_tracker").update({
          status: "void", settled_at: new Date().toISOString(),
          signals: [{ source: "tennis-engine-settler", note: "retired" }],
        }).eq("id", p.id);
        byResult["void"] = (byResult["void"] || 0) + 1; settled++; continue;
      }
      let actual: number | null = null;
      if (pt === "total_games" || pt === "player_total_games") actual = row.totalGames;
      else if (pt === "player_games_won") actual = row.sets.reduce((s, x) => s + x.player, 0);
      else if (pt === "player_total_sets") actual = row.sets.length;
      if (actual == null) { unsupported++; continue; }
      const result = grade(String(p.side), Number(p.line), actual);
      byResult[result] = (byResult[result] || 0) + 1; settled++;
      await supabase.from("engine_live_tracker").update({
        status: result, settled_at: new Date().toISOString(),
        signals: [{ source: "tennis-engine-settler", actual, prop_type: p.prop_type }],
      }).eq("id", p.id);
    }

    return new Response(JSON.stringify({
      success: true, scanned: pending.length, settled, unmatched, unsupported, by_result: byResult,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[tennis-settle] fatal", msg);
    return new Response(JSON.stringify({ success: false, error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});