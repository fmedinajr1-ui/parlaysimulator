// @ts-nocheck
// FanDuel Boost Scanner
// Scrapes the FanDuel boosts/promos lobby via Firecrawl, parses each boost
// into structured legs with Lovable AI, and stores fresh ones in fanduel_boosts.
// Designed to be invoked on a cron schedule.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const AI_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const AI_MODEL = "google/gemini-2.5-flash";
const FIRECRAWL_URL = "https://api.firecrawl.dev/v2/scrape";
const SCRAPINGBEE_URL = "https://app.scrapingbee.com/api/v1/";
const SCRAPINGANT_URL = "https://api.scrapingant.com/v2/general";

// Primary + fallback scrape targets. We try them in order and stop once we've
// gotten usable markdown for each "logical" page. Multiple state subdomains
// help when one regional edge is geo-blocking the Firecrawl proxy.
const TARGET_URLS = [
  "https://sportsbook.fanduel.com/promos",
  "https://sportsbook.fanduel.com/boosts",
  // Fallback regional subdomains (FanDuel mirrors content per state)
  "https://nj.sportsbook.fanduel.com/promos",
  "https://nj.sportsbook.fanduel.com/boosts",
  "https://pa.sportsbook.fanduel.com/promos",
  "https://co.sportsbook.fanduel.com/boosts",
  // Mobile / m. fallback (lighter JS, often easier to render)
  "https://m.sportsbook.fanduel.com/promos",
  "https://m.sportsbook.fanduel.com/boosts",
];

// Tunnel/proxy errors that should trigger a retry with backoff.
const RETRYABLE_ERROR_PATTERNS = [
  "ERR_TUNNEL_CONNECTION_FAILED",
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "EAI_AGAIN",
  "tunnel",
  "proxy",
  "timeout",
  "503",
  "502",
  "504",
  "429",
];

function isRetryable(msg: string): boolean {
  const lower = msg.toLowerCase();
  return RETRYABLE_ERROR_PATTERNS.some((p) => lower.includes(p.toLowerCase()));
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

const BOOST_TOOL_SCHEMA = {
  type: "function",
  function: {
    name: "extract_boosts",
    description:
      "Extract every boosted parlay / odds-boost card visible in the FanDuel promos page.",
    parameters: {
      type: "object",
      properties: {
        boosts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string", description: "Promo title, e.g. 'First Frame Fever'" },
              category: {
                type: ["string", "null"],
                description: "Section header it appeared under, e.g. 'MLB Boosts', 'NBA Boosts', 'The Hundred'",
              },
              sport: {
                type: ["string", "null"],
                description: "Lowercase sport key: nba, mlb, nfl, nhl, ncaaf, ncaab, soccer, tennis, mma, golf, mixed",
              },
              original_odds: {
                type: ["integer", "null"],
                description: "Pre-boost American odds (e.g. +1581). Null if not shown.",
              },
              boosted_odds: {
                type: ["integer", "null"],
                description: "Post-boost American odds (e.g. +1749). Required for a real boost.",
              },
              pays_text: {
                type: ["string", "null"],
                description: "Text like '$10 pays $184.91' if present.",
              },
              legs: {
                type: "array",
                description: "One entry per leg of the boosted parlay.",
                items: {
                  type: "object",
                  properties: {
                    sport: { type: ["string", "null"] },
                    market_type: {
                      type: "string",
                      description:
                        "Short token: 'player_points', 'player_rebounds', 'player_threes', 'team_moneyline', 'team_total', 'first_inning_runs', 'spread', 'game_total', etc.",
                    },
                    player_name: { type: ["string", "null"] },
                    team: { type: ["string", "null"] },
                    opponent: { type: ["string", "null"] },
                    game_description: {
                      type: ["string", "null"],
                      description: "e.g. 'DET @ CIN' or 'Lakers vs Warriors'",
                    },
                    line: { type: ["number", "null"] },
                    side: {
                      type: ["string", "null"],
                      description: "'over', 'under', 'win', 'cover', or null",
                    },
                    raw_text: { type: ["string", "null"] },
                  },
                  required: ["market_type"],
                  additionalProperties: false,
                },
              },
            },
            required: ["title", "boosted_odds", "legs"],
            additionalProperties: false,
          },
        },
      },
      required: ["boosts"],
      additionalProperties: false,
    },
  },
};

async function firecrawlScrapeOnce(
  url: string,
  apiKey: string,
  opts?: { mobile?: boolean; waitMs?: number },
): Promise<{ markdown: string | null; status: number; errorText?: string }> {
  const userAgent = opts?.mobile
    ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
    : "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

  const res = await fetch(FIRECRAWL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url,
      formats: ["markdown"],
      onlyMainContent: true,
      waitFor: opts?.waitMs ?? 4000,
      headers: { "User-Agent": userAgent },
      // Geo-route through the US — FanDuel blocks non-US edges
      location: { country: "US", languages: ["en-US"] },
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    return { markdown: null, status: res.status, errorText };
  }
  const json = await res.json();
  const md =
    json?.data?.markdown ??
    json?.markdown ??
    json?.data?.content ??
    null;
  return {
    markdown: typeof md === "string" && md.length > 0 ? md : null,
    status: res.status,
  };
}

/**
 * Scrape with exponential backoff. Retries on tunnel/proxy/timeout errors,
 * alternates between desktop and mobile UA on retries, and bails immediately
 * on non-retryable errors (4xx auth, 404, etc.).
 */
async function firecrawlScrapeWithRetry(
  url: string,
  apiKey: string,
  maxAttempts = 4,
): Promise<string | null> {
  let lastError = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const mobile = attempt % 2 === 0; // flip UA on even attempts
    const waitMs = 4000 + (attempt - 1) * 1500;
    try {
      const { markdown, status, errorText } = await firecrawlScrapeOnce(url, apiKey, {
        mobile,
        waitMs,
      });
      if (markdown) {
        if (attempt > 1) {
          console.log(`firecrawl ${url} succeeded on attempt ${attempt} (mobile=${mobile})`);
        }
        return markdown;
      }

      lastError = `status_${status}: ${(errorText ?? "").slice(0, 300)}`;
      console.warn(`firecrawl attempt ${attempt}/${maxAttempts} ${url} -> ${lastError}`);

      // Non-retryable: auth (401/403), not found (404), payload (400)
      if ([400, 401, 403, 404].includes(status)) return null;

      // Retryable HTTP or empty body — exponential backoff with jitter
      if (attempt < maxAttempts) {
        const base = 1000 * Math.pow(2, attempt - 1); // 1s, 2s, 4s, 8s
        const jitter = Math.floor(Math.random() * 500);
        await sleep(base + jitter);
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      console.warn(`firecrawl attempt ${attempt}/${maxAttempts} ${url} threw: ${lastError}`);
      if (!isRetryable(lastError)) return null;
      if (attempt < maxAttempts) {
        const base = 1000 * Math.pow(2, attempt - 1);
        const jitter = Math.floor(Math.random() * 500);
        await sleep(base + jitter);
      }
    }
  }
  console.error(`firecrawl exhausted ${maxAttempts} attempts for ${url}: ${lastError}`);
  return null;
}

/**
 * ScrapingBee with JS rendering + premium proxy. FanDuel renders boosts
 * client-side after geo + anti-bot checks; ScrapingBee's premium pool +
 * stealth-proxy handles those better than Firecrawl.
 * Returns raw HTML on success, null on failure.
 */
async function scrapingBeeFetch(
  url: string,
  apiKey: string,
  opts?: { stealth?: boolean },
): Promise<{ html: string | null; status: number; errorText?: string }> {
  const params = new URLSearchParams({
    api_key: apiKey,
    url,
    render_js: "true",
    premium_proxy: "true",
    country_code: "us",
    wait: "5000",
    // Wait until the boost cards (or their containers) appear
    wait_browser: "networkidle2",
    block_resources: "false",
  });
  if (opts?.stealth) {
    params.set("stealth_proxy", "true");
    params.delete("premium_proxy");
  }

  const res = await fetch(`${SCRAPINGBEE_URL}?${params.toString()}`, {
    method: "GET",
  });
  if (!res.ok) {
    const errorText = await res.text();
    return { html: null, status: res.status, errorText };
  }
  const html = await res.text();
  return { html: html && html.length > 500 ? html : null, status: res.status };
}

async function scrapingBeeFetchWithRetry(
  url: string,
  apiKey: string,
  maxAttempts = 3,
): Promise<string | null> {
  let lastError = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Flip to stealth proxy on the last attempt for stubborn pages
    const stealth = attempt === maxAttempts;
    try {
      const { html, status, errorText } = await scrapingBeeFetch(url, apiKey, { stealth });
      if (html) {
        if (attempt > 1) {
          console.log(`scrapingbee ${url} succeeded on attempt ${attempt} (stealth=${stealth})`);
        }
        return html;
      }
      lastError = `status_${status}: ${(errorText ?? "").slice(0, 300)}`;
      console.warn(`scrapingbee attempt ${attempt}/${maxAttempts} ${url} -> ${lastError}`);
      // 401/403/404 are non-retryable
      if ([400, 401, 403, 404].includes(status)) return null;
      if (attempt < maxAttempts) {
        const base = 1500 * Math.pow(2, attempt - 1);
        await sleep(base + Math.floor(Math.random() * 500));
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      console.warn(`scrapingbee attempt ${attempt}/${maxAttempts} ${url} threw: ${lastError}`);
      if (attempt < maxAttempts) {
        await sleep(1500 * Math.pow(2, attempt - 1));
      }
    }
  }
  console.error(`scrapingbee exhausted ${maxAttempts} attempts for ${url}: ${lastError}`);
  return null;
}

/**
 * ScrapingAnt with headless Chrome + residential proxy. Free tier gives
 * 10k credits/month and handles JS-rendered, anti-bot pages like FanDuel
 * better than Firecrawl. Returns raw HTML on success, null on failure.
 */
async function scrapingAntFetch(
  url: string,
  apiKey: string,
  opts?: { mobile?: boolean },
): Promise<{ html: string | null; status: number; errorText?: string }> {
  // Human-like dwell + scroll to defeat FanDuel's bot detector. The 423
  // "browser detected" response means Akamai/PerimeterX flagged the headless
  // session — extending wait time and simulating scroll greatly reduces this.
  const jsSnippet = `
    (async () => {
      await new Promise(r => setTimeout(r, 2500));
      window.scrollTo(0, document.body.scrollHeight / 3);
      await new Promise(r => setTimeout(r, 1500));
      window.scrollTo(0, document.body.scrollHeight / 2);
      await new Promise(r => setTimeout(r, 1500));
    })();
  `.trim();
  const jsSnippetB64 = btoa(jsSnippet);

  const params = new URLSearchParams({
    url,
    "x-api-key": apiKey,
    browser: "true",
    proxy_type: "residential",
    proxy_country: "US",
    return_text: "false",
    wait_for_selector: "main, [data-testid], .promo, .boost, a[href*='boost'], a[href*='promo']",
    js_snippet: jsSnippetB64,
  });
  const userAgent = opts?.mobile
    ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1"
    : "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

  const res = await fetch(`${SCRAPINGANT_URL}?${params.toString()}`, {
    method: "GET",
    headers: {
      "Ant-User-Agent": userAgent,
      "Ant-Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!res.ok) {
    const errorText = await res.text();
    return { html: null, status: res.status, errorText };
  }
  const html = await res.text();
  return { html: html && html.length > 500 ? html : null, status: res.status };
}

async function scrapingAntFetchWithRetry(
  url: string,
  apiKey: string,
  maxAttempts = 4,
): Promise<string | null> {
  let lastError = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const mobile = attempt % 2 === 0;
    try {
      const { html, status, errorText } = await scrapingAntFetch(url, apiKey, { mobile });
      if (html) {
        if (attempt > 1) {
          console.log(`scrapingant ${url} succeeded on attempt ${attempt} (mobile=${mobile})`);
        }
        return html;
      }
      lastError = `status_${status}: ${(errorText ?? "").slice(0, 300)}`;
      console.warn(`scrapingant attempt ${attempt}/${maxAttempts} ${url} -> ${lastError}`);
      // Hard-fail on auth/quota/payment — fall through to next provider
      // 422 = domain blocked on free plan (FanDuel is blocked, requires paid tier)
      if ([400, 401, 402, 403, 404, 422].includes(status)) return null;
      // 423 = rate-limited, 5xx = retryable
      if (attempt < maxAttempts) {
        const base = 1000 * Math.pow(2, attempt - 1); // 1s, 2s, 4s, 8s
        const jitter = Math.floor(Math.random() * 500);
        await sleep(base + jitter);
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      console.warn(`scrapingant attempt ${attempt}/${maxAttempts} ${url} threw: ${lastError}`);
      if (attempt < maxAttempts) {
        await sleep(1000 * Math.pow(2, attempt - 1));
      }
    }
  }
  console.error(`scrapingant exhausted ${maxAttempts} attempts for ${url}: ${lastError}`);
  return null;
}

/**
 * Strip HTML tags and collapse whitespace into a markdown-ish text blob
 * suitable for the AI parser. We don't need real markdown — Gemini reads
 * cleaned text just fine.
 */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Unified scraper: tries ScrapingAnt first (free 10k credits/mo + residential
 * proxy + headless Chrome), falls back to ScrapingBee, then Firecrawl.
 * Returns text/markdown for the AI parser.
 */
async function scrapePage(
  url: string,
  scrapingAntKey: string | undefined,
  scrapingBeeKey: string | undefined,
  firecrawlKey: string | undefined,
): Promise<string | null> {
  if (scrapingAntKey) {
    const t0 = Date.now();
    const html = await scrapingAntFetchWithRetry(url, scrapingAntKey);
    if (html) {
      const text = htmlToText(html);
      if (text.length > 200) {
        console.log(`[scanner] ${url} via scrapingant in ${Date.now() - t0}ms (${text.length} chars)`);
        return text;
      }
      console.warn(`scrapingant ${url}: html present but text too short (${text.length})`);
    }
  }
  if (scrapingBeeKey) {
    const t0 = Date.now();
    const html = await scrapingBeeFetchWithRetry(url, scrapingBeeKey);
    if (html) {
      const text = htmlToText(html);
      if (text.length > 200) {
        console.log(`[scanner] ${url} via scrapingbee in ${Date.now() - t0}ms (${text.length} chars)`);
        return text;
      }
      console.warn(`scrapingbee ${url}: html present but text too short (${text.length})`);
    }
  }
  if (firecrawlKey) {
    const t0 = Date.now();
    console.log(`[scanner] falling back to firecrawl for ${url}`);
    const md = await firecrawlScrapeWithRetry(url, firecrawlKey);
    if (md) {
      console.log(`[scanner] ${url} via firecrawl in ${Date.now() - t0}ms (${md.length} chars)`);
    }
    return md;
  }
  return null;
}

async function aiExtractBoosts(markdown: string): Promise<any[]> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) throw new Error("LOVABLE_API_KEY missing");

  const system =
    "You parse sportsbook boost/promo pages into structured data. Treat every odds-boost card, featured parlay, and 'hundred' style multi-leg promo as a boost. Skip pure deposit-bonus ads with no parlay legs. Sports are lowercase (nba, mlb, nfl, nhl, ncaaf, ncaab, etc.). For each leg, extract enough info to look up the corresponding real market line later. American odds only.";

  const res = await fetch(AI_GATEWAY_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: `Extract every boost from this FanDuel promo page markdown. Return structured tool call only.\n\n---\n${markdown.slice(0, 30000)}`,
        },
      ],
      tools: [BOOST_TOOL_SCHEMA],
      tool_choice: { type: "function", function: { name: "extract_boosts" } },
    }),
  });

  if (res.status === 429) throw new Error("rate_limited");
  if (res.status === 402) throw new Error("ai_credits_exhausted");
  if (!res.ok) throw new Error(`ai_${res.status}: ${await res.text()}`);

  const data = await res.json();
  const call = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!call) return [];
  try {
    const parsed = JSON.parse(call.function.arguments);
    return Array.isArray(parsed.boosts) ? parsed.boosts : [];
  } catch {
    return [];
  }
}

async function sha256(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function canonicalLegKey(leg: any): string {
  return [
    leg.sport ?? "",
    leg.market_type ?? "",
    (leg.player_name ?? leg.team ?? "").toLowerCase().trim(),
    leg.line ?? "",
    (leg.side ?? "").toLowerCase(),
    (leg.game_description ?? "").toLowerCase().trim(),
  ].join("|");
}

async function buildBoostHash(boost: any): Promise<string> {
  const legPart = (boost.legs ?? [])
    .map(canonicalLegKey)
    .sort()
    .join("||");
  return sha256(`${(boost.title ?? "").toLowerCase().trim()}::${legPart}`);
}

function inferSportFromBoost(boost: any): string | null {
  if (boost.sport) return String(boost.sport).toLowerCase();
  const cat = String(boost.category ?? "").toLowerCase();
  for (const s of ["nba", "mlb", "nfl", "nhl", "ncaab", "ncaaf", "wnba", "soccer", "tennis", "mma", "ufc", "golf", "pga"]) {
    if (cat.includes(s)) return s;
  }
  // Fall back from leg sports
  const legSports = (boost.legs ?? []).map((l: any) => String(l.sport ?? "").toLowerCase()).filter(Boolean);
  const unique = Array.from(new Set(legSports));
  if (unique.length === 1) return unique[0] as string;
  if (unique.length > 1) return "mixed";
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const scrapingAntKey = Deno.env.get("SCRAPINGANT_API_KEY");
    const scrapingBeeKey = Deno.env.get("SCRAPINGBEE_API_KEY");
    const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");
    if (!scrapingAntKey && !scrapingBeeKey && !firecrawlKey) {
      throw new Error("No scraper API key configured (need SCRAPINGANT_API_KEY, SCRAPINGBEE_API_KEY, or FIRECRAWL_API_KEY)");
    }

    let scraped = 0;
    let parsed = 0;
    let inserted = 0;
    const errors: string[] = [];
    // Track which logical pages succeeded so once we have a /promos and
    // /boosts page from any region, we can stop hitting fallbacks.
    const succeededLogical = new Set<string>();

    for (const url of TARGET_URLS) {
      // Logical key = trailing path (/promos vs /boosts). If we already got
      // good markdown for that key, skip remaining regional fallbacks for it.
      const logical = (() => {
        try {
          return new URL(url).pathname;
        } catch {
          return url;
        }
      })();
      if (succeededLogical.has(logical)) continue;

      try {
        const md = await scrapePage(url, scrapingAntKey, scrapingBeeKey, firecrawlKey);
        if (!md) {
          errors.push(`scrape_empty:${url}`);
          continue;
        }
        scraped++;
        succeededLogical.add(logical);

        const boosts = await aiExtractBoosts(md);
        parsed += boosts.length;

        for (const boost of boosts) {
          if (!boost.boosted_odds || !Array.isArray(boost.legs) || boost.legs.length === 0) continue;

          const hash = await buildBoostHash(boost);
          const sport = inferSportFromBoost(boost);

          const { error: insertError, data: insertData } = await supabase
            .from("fanduel_boosts")
            .insert({
              boost_hash: hash,
              title: String(boost.title).slice(0, 200),
              category: boost.category ?? null,
              sport,
              original_odds: boost.original_odds ?? null,
              boosted_odds: boost.boosted_odds,
              pays_text: boost.pays_text ?? null,
              legs: boost.legs,
              raw_text: null,
              source_url: url,
            })
            .select("id");

          if (insertError) {
            // 23505 = unique violation = already had this boost; not an error.
            if (!String(insertError.message).includes("duplicate") && insertError.code !== "23505") {
              errors.push(`insert:${insertError.message}`);
            }
            continue;
          }
          if (insertData && insertData.length > 0) inserted++;
        }
      } catch (e) {
        errors.push(`${url}:${e instanceof Error ? e.message : "unknown"}`);
      }
    }

    return new Response(
      JSON.stringify({ ok: true, scraped, parsed, inserted, errors }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("fanduel-boost-scanner error", e);
    return new Response(
      JSON.stringify({ ok: false, error: e instanceof Error ? e.message : "unknown" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});