// Court.Edge — parser diff backfill (one-shot, admin-invoked).
// Re-fetches the TennisAbstract row for every graded pick and re-parses the
// score with a candidate parser that (a) defensively strips tiebreak
// parentheticals like "(8)" and (b) treats any "set" with total games > 13
// as a super-tiebreak worth 1 game. Compares against the stored
// actual_total_games and reports how many would change / flip W↔L.
//
// Does NOT write to the DB. Pure read-only audit.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { playerSlug } from "../_shared/court-edge-slug.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TA_FRAG = "https://www.tennisabstract.com/jsfrags";
const TA_BASE = "https://www.tennisabstract.com/cgi-bin/player.cgi";

interface Pick {
  id: string;
  player: string | null;
  opponent: string | null;
  matchup: string | null;
  line: number;
  verdict: string;
  result: string | null;
  actual_total_games: number | null;
}

// Candidate parser: strip "(N)" tiebreak parens, super-tiebreak rule.
function parseSetCandidate(s: string): number | null {
  const stripped = s.replace(/\([0-9]+\)/g, "");
  const m = stripped.match(/^(\d{1,2})-(\d{1,2})/);
  if (!m) return null;
  const a = parseInt(m[1], 10);
  const b = parseInt(m[2], 10);
  const total = a + b;
  // Super-tiebreak detection: a deciding 10-point tiebreak presents like
  // "10-7"/"11-9". If total > 13 (impossible in a real set under normal
  // rules including a final-set tiebreak which is 7-6 = 13), treat as 1.
  if (total > 13) return 1;
  return total;
}

function candidateTotal(raw: string): { total: number; valid: boolean } {
  const parts = raw.trim().split(/\s+/);
  let total = 0;
  for (const s of parts) {
    const t = parseSetCandidate(s);
    if (t == null) return { total: 0, valid: false };
    total += t;
  }
  return { total, valid: total >= 6 && total <= 80 };
}

// Mirrors the current parser in court-edge-settle (anchored ^ on group 1).
function parseSetCurrent(s: string): number | null {
  const m = s.match(/^(\d{1,2})-(\d{1,2})/);
  if (!m) return null;
  return parseInt(m[1], 10) + parseInt(m[2], 10);
}
function currentTotal(raw: string): { total: number; valid: boolean } {
  const parts = raw.trim().split(/\s+/);
  let total = 0;
  for (const s of parts) {
    const t = parseSetCurrent(s);
    if (t == null) return { total: 0, valid: false };
    total += t;
  }
  return { total, valid: total >= 6 && total <= 80 };
}

interface Row { rawScore: string; opponentSlugFragment: string; retired: boolean }

function parseRows(html: string): Row[] {
  const rows: Row[] = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    const tr = m[1];
    const scoreMatch = tr.match(/<td[^>]*>\s*(\d{1,2}-\d{1,2}(?:\([0-9]+\))?(?:\s+\d{1,2}-\d{1,2}(?:\([0-9]+\))?){1,4})(\s*(?:ret\.?|RET|w\/o))?\s*<\/td>/i);
    if (!scoreMatch) continue;
    const raw = scoreMatch[1].trim();
    const retired = !!scoreMatch[2];
    const oppMatch = tr.match(/player(?:-classic)?\.cgi\?p=([A-Za-z]+)/);
    rows.push({ rawScore: raw, opponentSlugFragment: oppMatch ? oppMatch[1] : "", retired });
  }
  return rows;
}

async function fetchFragment(slug: string): Promise<string | null> {
  const headers = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/121 Safari/537.36",
    "Accept": "text/html,application/javascript,*/*",
    "Referer": `${TA_BASE}?p=${slug}`,
  };
  for (const url of [`${TA_FRAG}/${slug}.js`, `${TA_BASE}?p=${slug}`]) {
    try {
      const r = await fetch(url, { headers });
      if (r.ok) return await r.text();
    } catch (_) { /* try next */ }
  }
  return null;
}

function gradeVerdict(verdict: string, line: number, actual: number): "WIN" | "LOSS" | "PUSH" {
  const isOver = verdict.endsWith("_OVER");
  if (actual === line) return "PUSH";
  if (isOver) return actual > line ? "WIN" : "LOSS";
  return actual < line ? "WIN" : "LOSS";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const body = (await req.json().catch(() => ({}))) as { limit?: number };
    const limit = Math.min(Math.max(body.limit ?? 400, 1), 1000);

    const { data: picks, error } = await supabase
      .from("court_edge_picks")
      .select("id,player,opponent,matchup,line,verdict,result,actual_total_games")
      .eq("graded", true)
      .in("result", ["WIN", "LOSS"])
      .not("actual_total_games", "is", null)
      .order("commence_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    if (!picks?.length) {
      return new Response(JSON.stringify({ ok: true, scanned: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Cache fragments by slug
    const fragCache = new Map<string, string | null>();
    async function getFrag(slug: string) {
      if (fragCache.has(slug)) return fragCache.get(slug)!;
      const f = await fetchFragment(slug);
      fragCache.set(slug, f);
      return f;
    }

    let scanned = 0;
    let unmatched = 0;
    let changedTotal = 0;
    let flippedResult = 0;
    const samples: Array<Record<string, unknown>> = [];

    for (const p of picks as Pick[]) {
      scanned++;
      const home = p.player ?? p.matchup?.split(/\s+vs\s+/i)[0] ?? "";
      const away = p.opponent ?? p.matchup?.split(/\s+vs\s+/i)[1] ?? "";
      const hSlug = playerSlug(home), aSlug = playerSlug(away);
      if (!hSlug || !aSlug) { unmatched++; continue; }
      let row: Row | undefined;
      for (const slug of [hSlug, aSlug]) {
        const other = slug === hSlug ? aSlug : hSlug;
        const html = await getFrag(slug);
        if (!html) continue;
        const r = parseRows(html).find((x) =>
          x.opponentSlugFragment.toLowerCase() === other.toLowerCase()
        );
        if (r) { row = r; break; }
      }
      if (!row) { unmatched++; continue; }
      const cur = currentTotal(row.rawScore);
      const cand = candidateTotal(row.rawScore);
      const stored = Number(p.actual_total_games);
      const candidateActual = cand.valid ? cand.total : stored;
      if (candidateActual !== stored) {
        changedTotal++;
        const newResult = row.retired ? "VOID" : gradeVerdict(p.verdict, Number(p.line), candidateActual);
        if (newResult !== p.result) flippedResult++;
        if (samples.length < 25) {
          samples.push({
            id: p.id, matchup: p.matchup, raw: row.rawScore,
            stored, current_parse: cur.total, candidate_parse: candidateActual,
            stored_result: p.result, candidate_result: newResult,
          });
        }
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      scanned,
      unmatched,
      changed_count: changedTotal,
      changed_pct: scanned > 0 ? +(100 * changedTotal / scanned).toFixed(2) : 0,
      flipped_count: flippedResult,
      flipped_pct: scanned > 0 ? +(100 * flippedResult / scanned).toFixed(2) : 0,
      decision: changedTotal / Math.max(1, scanned) >= 0.05
        ? "PATCH_PARSER"
        : "PARSER_OK_LEAVE_AS_IS",
      samples,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});