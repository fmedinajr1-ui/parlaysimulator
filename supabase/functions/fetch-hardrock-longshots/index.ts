import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const PROP_MARKETS = [
  'player_points',
  'player_rebounds',
  'player_assists',
  'player_threes',
  'player_points_rebounds_assists',
  'player_steals',
  'player_blocks',
];

const MIN_ODDS = 500;

function getTier(odds: number): string {
  if (odds >= 1000) return '+1000+';
  if (odds >= 900) return '+900';
  if (odds >= 700) return '+700';
  if (odds >= 650) return '+650';
  return '+500';
}

async function fetchWithTimeout(url: string, timeoutMs = 10000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Parse optional send_telegram flag
    let sendTelegram = false;
    try {
      const body = await req.json();
      sendTelegram = body?.send_telegram === true;
    } catch { /* no body or not JSON, that's fine */ }

    const apiKey = Deno.env.get('THE_ODDS_API_KEY');
    if (!apiKey) throw new Error('THE_ODDS_API_KEY not configured');

    const sport = 'basketball_nba';
    const longshots: any[] = [];

    // Step 1: Fetch moneyline (h2h) odds — uses the sport-level endpoint
    const h2hUrl = `https://api.the-odds-api.com/v4/sports/${sport}/odds?apiKey=${apiKey}&regions=us&markets=h2h&oddsFormat=american&bookmakers=hardrockbet`;
    console.log(`[fetch-hardrock-longshots] Fetching h2h odds`);
    const h2hRes = await fetchWithTimeout(h2hUrl);
    if (!h2hRes.ok) {
      const t = await h2hRes.text();
      throw new Error(`h2h API error ${h2hRes.status}: ${t}`);
    }
    const events: any[] = await h2hRes.json();
    console.log(`[fetch-hardrock-longshots] Got ${events.length} events`);

    // Collect h2h longshots
    for (const event of events) {
      const gameLabel = `${event.away_team} @ ${event.home_team}`;
      for (const bm of (event.bookmakers || [])) {
        if (bm.key !== 'hardrockbet') continue;
        for (const market of (bm.markets || [])) {
          for (const outcome of (market.outcomes || [])) {
            if (outcome.price >= MIN_ODDS) {
              longshots.push({
                game: gameLabel,
                commence_time: event.commence_time,
                market: 'moneyline',
                name: outcome.name,
                side: outcome.name,
                line: null,
                odds: `+${outcome.price}`,
                odds_raw: outcome.price,
                tier: getTier(outcome.price),
              });
            }
          }
        }
      }
    }

    // Step 2: Fetch player props per event (requires event-level endpoint)
    const eventIds = events.map(e => e.id);
    console.log(`[fetch-hardrock-longshots] Fetching props for ${eventIds.length} events`);

    for (const eventId of eventIds) {
      const event = events.find(e => e.id === eventId);
      const gameLabel = event ? `${event.away_team} @ ${event.home_team}` : eventId;

      const propsUrl = `https://api.the-odds-api.com/v4/sports/${sport}/events/${eventId}/odds?apiKey=${apiKey}&regions=us&markets=${PROP_MARKETS.join(',')}&oddsFormat=american&bookmakers=hardrockbet`;

      try {
        const propsRes = await fetchWithTimeout(propsUrl, 8000);
        if (!propsRes.ok) {
          const t = await propsRes.text();
          console.warn(`[fetch-hardrock-longshots] Props error for ${eventId}: ${propsRes.status} ${t}`);
          continue;
        }
        const propsData = await propsRes.json();

        for (const bm of (propsData.bookmakers || [])) {
          if (bm.key !== 'hardrockbet') continue;
          for (const market of (bm.markets || [])) {
            for (const outcome of (market.outcomes || [])) {
              if (outcome.price >= MIN_ODDS) {
                longshots.push({
                  game: gameLabel,
                  commence_time: event?.commence_time,
                  market: market.key,
                  name: outcome.description || outcome.name,
                  side: outcome.name,
                  line: outcome.point ?? null,
                  odds: `+${outcome.price}`,
                  odds_raw: outcome.price,
                  tier: getTier(outcome.price),
                });
              }
            }
          }
        }
      } catch (err) {
        console.warn(`[fetch-hardrock-longshots] Timeout/error for event ${eventId}:`, err);
      }
    }

    longshots.sort((a, b) => b.odds_raw - a.odds_raw);
    console.log(`[fetch-hardrock-longshots] Found ${longshots.length} longshots at +${MIN_ODDS}+`);

    // Build tiers summary
    const tierOrder = ['+1000+', '+900', '+700', '+650', '+500'];
    const tiers: Record<string, number> = {};
    for (const t of tierOrder) tiers[t] = 0;
    for (const l of longshots) tiers[l.tier] = (tiers[l.tier] || 0) + 1;

    // Send to admin via Telegram if requested
    if (sendTelegram && longshots.length > 0) {
      const tierLabels: Record<string, string> = {
        '+1000+': '🔥 +1000 & UP',
        '+900': '💰 +900',
        '+700': '🎯 +700',
        '+650': '📊 +650',
        '+500': '🎲 +500',
      };
      const sections: string[] = [];
      for (const tier of tierOrder) {
        const items = longshots.filter(l => l.tier === tier);
        if (items.length === 0) continue;
        const lines = items.map(l => {
          const marketLabel = l.market === 'moneyline' ? 'ML' :
            `${l.side} ${l.line !== null ? l.line : ''} ${l.market.replace('player_', '').replace(/_/g, ' ')}`;
          return `${l.odds} | ${l.name} ${marketLabel}\n${l.game}`;
        });
        sections.push(`--- ${tierLabels[tier]} ---\n${lines.join('\n\n')}`);
      }
      const message = `🎰 HRB LONGSHOTS\n\n${sections.join('\n\n')}`;

      const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
      const chatId = Deno.env.get('TELEGRAM_CHAT_ID');
      if (botToken && chatId) {
        try {
          const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: message,
            }),
          });
          const tgData = await tgRes.text();
          console.log(`[fetch-hardrock-longshots] Telegram send result: ${tgRes.status} ${tgData}`);
        } catch (err) {
          console.warn(`[fetch-hardrock-longshots] Telegram send failed:`, err);
        }
      } else {
        console.warn(`[fetch-hardrock-longshots] Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID`);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      count: longshots.length,
      min_odds: `+${MIN_ODDS}`,
      bookmaker: 'hardrockbet',
      sport,
      events_searched: events.length,
      telegram_sent: sendTelegram && longshots.length > 0,
      tiers,
      longshots,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[fetch-hardrock-longshots] Error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
