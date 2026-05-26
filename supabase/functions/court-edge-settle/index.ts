// Court.Edge — settle ungraded picks by scraping final game totals
// from TennisAbstract player jsfrags. Runs hourly via pg_cron.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { playerSlug } from "../_shared/court-edge-slug.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TA_FRAG = "https://www.tennisabstract.com/jsfrags";
const TA_BASE = "https://www.tennisabstract.com/cgi-bin/player.cgi";
const MIN_AGE_HOURS = 4; // wait at least 4h after scheduled start before grading
const MAX_AGE_DAYS = 21; // stop trying after 3 weeks

interface Pick {
  id: string;
  player: string | null;
  opponent: string | null;
  matchup: string | null;
  line: number;
  verdict: string;
  commence_at: string;
  market: string;
}

interface ParsedRow {
  rawScore: string;
  totalGames: number;
  opponentSlugFragment: string;
  retired: boolean;
}

function parseSetScore(s: string): number | null {
  const m = s.match(/^(\d{1,2})-(\d{1,2})/);
  if (!m) return null;
  return parseInt(m[1], 10) + parseInt(m[2], 10);
}

function sumSets(raw: string): { total: number; valid: boolean } {
  const parts = raw.split(/\s+/);
  let total = 0;
  for (const s of parts) {
    const t = parseSetScore(s);
    if (t == null) return { total: 0, valid: false };
    total += t;
  }
  return { total, valid: total >= 6 && total <= 80 };
}

// Parse rows from the jsfrag. Each <tr> in #recent-results contains
// Date · Tournament · Surface · Round · Rank · vs Player · Score · …
// We pull rows that have an opponent link and a score cell.
function parseRecentRows(html: string): ParsedRow[] {
  const rows: ParsedRow[] = [];
  // Naive row split: each <tr ...>...</tr>
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    const tr = m[1];
    // Score cell
    const scoreMatch = tr.match(/<td[^>]*>\s*(\d{1,2}-\d{1,2}(?:\([0-9]+\))?(?:\s+\d{1,2}-\d{1,2}(?:\([0-9]+\))?){1,4})(\s*(?:ret\.?|RET|w\/o))?\s*<\/td>/i);
    if (!scoreMatch) continue;
    const raw = scoreMatch[1].trim();
    const retired = !!scoreMatch[2];
    const { total, valid } = sumSets(raw);
    if (!valid) continue;
    // Opponent slug: look for a player.cgi link in this row
    const oppMatch = tr.match(/player(?:-classic)?\.cgi\?p=([A-Za-z]+)/);
    const opp = oppMatch ? oppMatch[1] : "";
    rows.push({ rawScore: raw, totalGames: total, opponentSlugFragment: opp, retired });
  }
  return rows;
}

async function fetchPlayerFragment(slug: string): Promise<string | null> {
  const headers = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/121 Safari/537.36",
    "Accept": "text/html,application/javascript,*/*",
    "Referer": `${TA_BASE}?p=${slug}`,
  };
  for (const url of [`${TA_FRAG}/${slug}.js`, `${TA_BASE}?p=${slug}`]) {
    try {
      const res = await fetch(url, { headers });
      if (res.ok) return await res.text();
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

async function settleOne(pick: Pick): Promise<{ graded: boolean; reason: string; actual?: number; result?: string; source?: string }> {
  const playerName = pick.player ?? pick.matchup?.split(/\s+vs\s+/i)[0] ?? "";
  const opponentName = pick.opponent ?? pick.matchup?.split(/\s+vs\s+/i)[1] ?? "";
  if (!playerName || !opponentName) return { graded: false, reason: "missing names" };

  const homeSlug = playerSlug(playerName);
  const awaySlug = playerSlug(opponentName);
  if (!homeSlug || !awaySlug) return { graded: false, reason: "empty slug" };

  // Try home player's fragment first; fall back to opponent's
  for (const slug of [homeSlug, awaySlug]) {
    const otherSlug = slug === homeSlug ? awaySlug : homeSlug;
    const html = await fetchPlayerFragment(slug);
    if (!html) continue;
    const rows = parseRecentRows(html);
    // Find the row whose opponent slug matches the other player
    const matchRow = rows.find((r) =>
      r.opponentSlugFragment.toLowerCase() === otherSlug.toLowerCase()
    );
    if (!matchRow) continue;
    if (matchRow.retired) {
      return { graded: true, reason: "retired", actual: matchRow.totalGames, result: "VOID", source: `ta:${slug}` };
    }
    const result = gradeVerdict(pick.verdict, Number(pick.line), matchRow.totalGames);
    return { graded: true, reason: "matched", actual: matchRow.totalGames, result, source: `ta:${slug}` };
  }

  return { graded: false, reason: "no match row found" };
}

async function runWithConcurrency<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = (await req.json().catch(() => ({}))) as { limit?: number; dry_run?: boolean };
    const limit = Math.min(Math.max(body.limit ?? 80, 1), 300);
    const dryRun = body.dry_run === true;

    const nowMs = Date.now();
    const minDone = new Date(nowMs - MIN_AGE_HOURS * 3600 * 1000).toISOString();
    const maxAge = new Date(nowMs - MAX_AGE_DAYS * 24 * 3600 * 1000).toISOString();

    const { data: picks, error } = await supabase
      .from("court_edge_picks")
      .select("id,player,opponent,matchup,line,verdict,commence_at,market")
      .eq("graded", false)
      .in("verdict", ["STRONG_OVER", "STRONG_UNDER", "LEAN_OVER", "LEAN_UNDER"])
      .lt("commence_at", minDone)
      .gt("commence_at", maxAge)
      .order("commence_at", { ascending: false })
      .limit(limit);

    if (error) throw new Error(`fetch picks: ${error.message}`);
    if (!picks || picks.length === 0) {
      return new Response(JSON.stringify({ ok: true, considered: 0, graded: 0 }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const settled = await runWithConcurrency(picks as Pick[], 3, async (p) => ({
      pick: p,
      outcome: await settleOne(p).catch((e) => ({ graded: false, reason: e instanceof Error ? e.message : String(e) })),
    }));

    let updates = 0;
    const byResult: Record<string, number> = {};
    for (const s of settled) {
      if (!s.outcome.graded) continue;
      const result = s.outcome.result || "VOID";
      byResult[result] = (byResult[result] || 0) + 1;
      if (dryRun) { updates++; continue; }
      const { error: upErr } = await supabase
        .from("court_edge_picks")
        .update({
          graded: true,
          result,
          actual_total_games: s.outcome.actual ?? null,
          settled_at: new Date().toISOString(),
          settle_source: s.outcome.source ?? "ta",
        })
        .eq("id", s.pick.id);
      if (upErr) console.error(`[settle] update ${s.pick.id}`, upErr.message);
      else updates++;
    }

    return new Response(JSON.stringify({
      ok: true,
      considered: picks.length,
      graded: updates,
      by_result: byResult,
      unmatched: settled.filter((s) => !s.outcome.graded).length,
      sample_unmatched: settled.filter((s) => !s.outcome.graded).slice(0, 5).map((s) => ({
        matchup: s.pick.matchup, reason: s.outcome.reason,
      })),
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});