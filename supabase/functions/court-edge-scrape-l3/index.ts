// Court.Edge — scrape last-3 match game totals for a list of players from TennisAbstract.
// 24h cache via court_edge_l3_cache. Concurrency capped at 3.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { playerSlug as sharedPlayerSlug } from "../_shared/court-edge-slug.ts";
import { inferRoleFromL3 } from "../_shared/court-edge-roles.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TA_BASE = "https://www.tennisabstract.com/cgi-bin/player.cgi";
const TA_FRAG = "https://www.tennisabstract.com/jsfrags";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export const playerSlug = sharedPlayerSlug;

function parseSetScore(s: string): number | null {
  // "6-4", "7-6(5)", "7-6^7", "6-3 ret."
  const m = s.match(/^(\d{1,2})-(\d{1,2})/);
  if (!m) return null;
  return parseInt(m[1], 10) + parseInt(m[2], 10);
}

// Pull every <td>SCORE</td> cell out of the recent-results table inside the
// jsfrag and convert it to a per-match games total.
function extractRecentTotals(html: string): { totals: number[]; raw: string[] } {
  const found: Array<{ raw: string; total: number }> = [];

  // Each row in #recent-results has a Score cell of the form
  //   <td>6-2 6-4</td>  or  <td>6-2 7-6(0)</td>  or  <td>3-6 6-4 6-2</td>
  // We allow 2-5 sets and tiebreak parens.
  const cellRe = /<td[^>]*>\s*(\d{1,2}-\d{1,2}(?:\([0-9]+\))?(?:\s+\d{1,2}-\d{1,2}(?:\([0-9]+\))?){1,4})\s*<\/td>/g;
  let m: RegExpExecArray | null;
  while ((m = cellRe.exec(html)) !== null) {
    const raw = m[1].trim();
    const sets = raw.split(/\s+/);
    let total = 0;
    let ok = true;
    for (const s of sets) {
      const t = parseSetScore(s);
      if (t == null) { ok = false; break; }
      total += t;
    }
    if (ok && total >= 6 && total <= 80) found.push({ raw, total });
    if (found.length >= 10) break;
  }

  // Fallback: looser whitespace match across the whole document.
  if (found.length === 0) {
    const looseRe = /\b(\d{1,2}-\d{1,2}(?:\([0-9]+\))?(?:\s+\d{1,2}-\d{1,2}(?:\([0-9]+\))?){1,4})\b/g;
    while ((m = looseRe.exec(html)) !== null) {
      const raw = m[1];
      const sets = raw.split(/\s+/);
      let total = 0; let ok = true;
      for (const s of sets) {
        const t = parseSetScore(s);
        if (t == null) { ok = false; break; }
        total += t;
      }
      if (ok && total >= 6 && total <= 80) found.push({ raw, total });
      if (found.length >= 10) break;
    }
  }

  return {
    totals: found.slice(0, 3).map((f) => f.total),
    raw: found.slice(0, 3).map((f) => f.raw),
  };
}

async function scrapeOne(name: string): Promise<{ ok: boolean; totals?: number[]; raw?: string[]; error?: string }> {
  const slug = playerSlug(name);
  if (!slug) return { ok: false, error: "empty slug" };
  // Primary: TennisAbstract serves the recent-results table from a JS fragment
  // at /jsfrags/<Slug>.js — that's where the actual match rows live. The HTML
  // page only loads a shell that injects this fragment client-side.
  const headers = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121 Safari/537.36",
    "Accept": "text/html,application/javascript,*/*",
    "Referer": `${TA_BASE}?p=${slug}`,
  };

  const tryUrls = [
    `${TA_FRAG}/${slug}.js`,
    `${TA_BASE}?p=${slug}`,
    `https://www.tennisabstract.com/cgi-bin/player-classic.cgi?p=${slug}`,
  ];

  let lastErr = "no scores parsed";
  let lastSnippet: string | null = null;
  for (const url of tryUrls) {
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) { lastErr = `status ${res.status} @ ${url}`; continue; }
      const html = await res.text();
      const { totals, raw } = extractRecentTotals(html);
      if (totals.length > 0) return { ok: true, totals, raw };
      lastSnippet = html.slice(0, 400);
    } catch (e) {
      lastErr = `${e instanceof Error ? e.message : String(e)} @ ${url}`;
    }
  }
  if (lastSnippet) console.log(`[court-edge-scrape-l3] no rows for ${slug}; first 400ch: ${lastSnippet.replace(/\s+/g, " ")}`);
  return { ok: false, error: lastErr };
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
    const body = (await req.json().catch(() => ({}))) as { players?: string[] };
    const players = (body.players || []).filter((p): p is string => typeof p === "string" && p.trim().length > 0);
    if (players.length === 0) {
      return new Response(JSON.stringify({ ok: true, results: {} }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const slugs = players.map((p) => ({ name: p, slug: playerSlug(p) }));
    const slugList = slugs.map((s) => s.slug).filter(Boolean);

    // Try cache first
    const cacheMap: Record<string, { totals: number[]; raw_scores: unknown; fetched_at: string }> = {};
    try {
      const { data: cacheRows } = await supabase
        .from("court_edge_l3_cache")
        .select("player_slug,totals,raw_scores,fetched_at")
        .in("player_slug", slugList);
      for (const row of cacheRows || []) cacheMap[row.player_slug] = row as any;
    } catch (e) {
      console.error("[court-edge-scrape-l3] cache read failed", e);
    }

    const now = Date.now();
    const toScrape: typeof slugs = [];
    const results: Record<string, { ok: boolean; totals?: number[]; raw?: unknown; cached?: boolean; error?: string }> = {};

    for (const s of slugs) {
      const cached = cacheMap[s.slug];
      if (cached && now - Date.parse(cached.fetched_at) < CACHE_TTL_MS && (cached.totals?.length || 0) > 0) {
        results[s.name] = { ok: true, totals: cached.totals, raw: cached.raw_scores, cached: true };
      } else {
        toScrape.push(s);
      }
    }

    if (toScrape.length > 0) {
      const scraped = await runWithConcurrency(toScrape, 3, async (s) => ({
        s,
        result: await scrapeOne(s.name).catch((e) => ({ ok: false, error: e instanceof Error ? e.message : String(e) })),
      }));

      const upserts: Array<{ player_slug: string; player_name: string; totals: number[]; raw_scores: unknown }> = [];
      for (const { s, result } of scraped) {
        if (result.ok && result.totals) {
          results[s.name] = { ok: true, totals: result.totals, raw: result.raw, cached: false };
          upserts.push({ player_slug: s.slug, player_name: s.name, totals: result.totals, raw_scores: result.raw || [] });
        } else {
          results[s.name] = { ok: false, error: result.error || "scrape failed" };
        }
      }
      if (upserts.length > 0) {
        try {
          await supabase.from("court_edge_l3_cache").upsert(
            upserts.map((u) => ({
              ...u,
              inferred_role: inferRoleFromL3((u.raw_scores as string[]) || [], "hard"),
              fetched_at: new Date().toISOString(),
            })),
            { onConflict: "player_slug" },
          );
        } catch (e) {
          console.error("[court-edge-scrape-l3] cache write failed", e);
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, results }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});