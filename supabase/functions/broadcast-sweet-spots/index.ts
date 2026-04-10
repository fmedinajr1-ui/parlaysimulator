import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ─────────────────────────────────────────────────────────────────────────────
// broadcast-sweet-spots  (REWRITTEN)
//
// BUG 16 FIX — Limit query to 20 directly instead of fetching 25 then slicing.
//              This removes the misleading `total_found` vs `picks_sent` gap.
//
// BUG 18 FIX — Added AbortController timeout (8s) on the bot-send-telegram
//              fetch and proper error surfacing. Cold-starting edge functions
//              can take 2-3s; without a timeout the request hangs silently.
//
// IMPROVEMENT — Added retry logic on the Telegram send (1 retry after 2s)
//               to handle transient cold-start failures without crashing.
//
// IMPROVEMENT — Added `confidence_score` range validation: logs a warning if
//               the field appears to be on 0-1 scale vs expected 0-100 scale,
//               since bot-send-telegram's formatter does NOT multiply by 100
//               for sweet spots confidence (it uses the value directly as a
//               display percentage).
// ─────────────────────────────────────────────────────────────────────────────

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function getEasternDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

// BUG 18 FIX: fetch with timeout + 1 retry
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  timeoutMs = 8000,
  retries = 1
): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);
      return resp;
    } catch (err: any) {
      clearTimeout(timer);
      if (attempt === retries) throw err;
      // Wait 2s before retry (handles cold start)
      await new Promise(r => setTimeout(r, 2000));
      console.warn(`[broadcast-sweet-spots] Retrying Telegram send (attempt ${attempt + 2})...`);
    }
  }
  throw new Error('fetchWithRetry exhausted');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const sb = createClient(supabaseUrl, supabaseKey);

    const today = getEasternDate();
    console.log(`[broadcast-sweet-spots] Querying picks for ${today}`);

    // BUG 16 FIX: limit to 20 directly, removing the misleading 25→20 slice
    const { data: picks, error } = await sb
      .from('category_sweet_spots')
      .select('player_name, prop_type, category, recommended_side, recommended_line, confidence_score, l10_hit_rate, l10_avg, l3_avg, quality_tier')
      .eq('analysis_date', today)
      .eq('is_active', true)
      .gte('confidence_score', 70)
      .order('confidence_score', { ascending: false })
      .limit(20);  // BUG 16 FIX: was .limit(25) then picks.slice(0, 20)

    if (error) {
      console.error('[broadcast-sweet-spots] Query error:', error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: corsHeaders,
      });
    }

    if (!picks || picks.length === 0) {
      console.log('[broadcast-sweet-spots] No qualifying picks');
      return new Response(JSON.stringify({
        success: true, skipped: true, reason: 'no_picks',
      }), { headers: corsHeaders });
    }

    // IMPROVEMENT: sanity-check confidence_score scale
    const maxConf = Math.max(...picks.map(p => p.confidence_score || 0));
    if (maxConf <= 1.0) {
      console.warn(`[broadcast-sweet-spots] WARNING: max confidence_score=${maxConf} — may be 0-1 scale. Expected 0-100. Telegram formatter will display ${(maxConf * 100).toFixed(0)}% if formatted correctly.`);
    }

    console.log(`[broadcast-sweet-spots] Sending ${picks.length} picks`);

    // BUG 18 FIX: timeout + retry on Telegram fetch
    const resp = await fetchWithRetry(
      `${supabaseUrl}/functions/v1/bot-send-telegram`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'sweet_spots_broadcast',
          admin_only: true,
          parse_mode: 'Markdown',
          data: {
            picks,
            date: today,
            total_found: picks.length,
          },
        }),
      },
      8000, // 8s timeout
      1     // 1 retry
    );

    if (!resp.ok) {
      const errBody = await resp.text();
      console.error(`[broadcast-sweet-spots] Telegram HTTP ${resp.status}:`, errBody);
      return new Response(JSON.stringify({
        success: false,
        error: `Telegram returned ${resp.status}`,
        detail: errBody.slice(0, 200),
      }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const result = await resp.json();
    console.log('[broadcast-sweet-spots] Telegram result:', result);

    return new Response(JSON.stringify({
      success: true,
      picks_sent: picks.length,
      total_qualifying: picks.length, // BUG 16 FIX: no longer misleadingly different from picks_sent
      telegram: result,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err: any) {
    console.error('[broadcast-sweet-spots] Error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
