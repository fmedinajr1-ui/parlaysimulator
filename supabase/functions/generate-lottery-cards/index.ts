import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const TELEGRAM_API = 'https://api.telegram.org/bot';

const TIER_STYLES: Record<string, { emoji: string; accent: string; label: string; glow: string }> = {
  standard: { emoji: '🎟️', accent: '#00ff88', label: 'STANDARD TICKET', glow: 'green' },
  high_roller: { emoji: '💎', accent: '#ffd700', label: 'HIGH ROLLER', glow: 'gold' },
  mega_jackpot: { emoji: '🚀', accent: '#ff00ff', label: 'MEGA JACKPOT', glow: 'magenta' },
};

function getTierFromStrategy(strategyName: string, tier?: string): string {
  if (tier === 'mega_jackpot' || tier === 'jackpot') return 'mega_jackpot';
  if (tier === 'high_roller') return 'high_roller';
  if (tier === 'standard') return 'standard';
  // Fallback based on odds
  return 'standard';
}

function formatOdds(decimalOdds: number): string {
  if (decimalOdds >= 2) {
    return `+${Math.round((decimalOdds - 1) * 100)}`;
  }
  return `-${Math.round(100 / (decimalOdds - 1))}`;
}

function buildCardPrompt(parlay: any, tierKey: string): string {
  const style = TIER_STYLES[tierKey] || TIER_STYLES.standard;
  const legs = Array.isArray(parlay.legs) ? parlay.legs : [];
  const odds = parlay.expected_odds || 1;
  const americanOdds = formatOdds(odds);
  const stake = parlay.simulated_stake || (tierKey === 'mega_jackpot' ? 1 : tierKey === 'high_roller' ? 3 : 5);
  const payout = parlay.simulated_payout || (stake * odds);

  let legsText = '';
  legs.forEach((leg: any, i: number) => {
    const player = leg.player_name || leg.player || 'Unknown';
    const prop = leg.prop_type || leg.type || '';
    const side = leg.side || leg.pick || '';
    const line = leg.line != null ? leg.line : '';
    legsText += `\nLeg ${i + 1}: ${player} — ${prop} ${side} ${line}`;
  });

  return `Generate a premium dark sportsbook-style parlay ticket card image. 

DESIGN SPECIFICATIONS:
- Background: Very dark (#0f1015) with subtle noise texture
- Card shape: Rounded rectangle with a glowing ${style.glow} neon border (color: ${style.accent})
- Top-left: ${style.emoji} badge with text "${style.label}" in ${style.accent} color
- Top-right: Small badge "PARLAY FARM" in muted purple

MAIN CONTENT:
- Large centered American odds: "${americanOdds}" in massive bold ${style.accent} neon glowing text
- Below odds: "${legs.length}-LEG PARLAY" in smaller muted text

STATS ROW (two columns):
- Left: "STAKE" label with "$${stake.toFixed(2)}" in white
- Right: "TO WIN" label with "$${payout.toFixed(2)}" in bright green

LEGS SECTION (dark cards stacked):
${legsText}

Each leg in its own dark rounded card with a numbered circle on the left.

FOOTER:
- Left side: 🔥 emoji followed by "PARLAY FARM" in muted text
- Right side: "parlayfarm.com" in dim text
- Separated by a thin dark line above

STYLE: Premium, dark, neon accents, sportsbook aesthetic. Sharp and clean. No blurriness. Text must be crisp and readable.`;
}

function buildCaption(parlay: any, tierKey: string): string {
  const style = TIER_STYLES[tierKey] || TIER_STYLES.standard;
  const legs = Array.isArray(parlay.legs) ? parlay.legs : [];
  const odds = parlay.expected_odds || 1;
  const americanOdds = formatOdds(odds);
  const stake = parlay.simulated_stake || (tierKey === 'mega_jackpot' ? 1 : tierKey === 'high_roller' ? 3 : 5);
  const payout = parlay.simulated_payout || (stake * odds);

  let caption = `${style.emoji} <b>${style.label}</b>\n`;
  caption += `🎯 Odds: <b>${americanOdds}</b>\n`;
  caption += `💰 $${stake.toFixed(2)} → $${payout.toFixed(2)}\n\n`;

  legs.forEach((leg: any, i: number) => {
    const player = leg.player_name || leg.player || 'Unknown';
    const prop = leg.prop_type || leg.type || '';
    const side = leg.side || leg.pick || '';
    const line = leg.line != null ? leg.line : '';
    caption += `${i + 1}. ${player} — ${prop} ${side} ${line}\n`;
  });

  caption += `\n🔥 PARLAY FARM | parlayfarm.com`;
  return caption;
}

async function generateCardImage(prompt: string, apiKey: string): Promise<string | null> {
  try {
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash-image',
        messages: [{ role: 'user', content: prompt }],
        modalities: ['image', 'text'],
      }),
    });

    if (!response.ok) {
      console.error('AI image generation failed:', response.status, await response.text());
      return null;
    }

    const data = await response.json();
    const imageUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    return imageUrl || null;
  } catch (err) {
    console.error('Error generating card image:', err);
    return null;
  }
}

async function sendTelegramPhoto(
  botToken: string,
  chatId: string,
  base64DataUrl: string,
  caption: string
): Promise<boolean> {
  try {
    // Extract base64 data from data URL
    const base64Data = base64DataUrl.replace(/^data:image\/\w+;base64,/, '');
    const binaryData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));

    const formData = new FormData();
    formData.append('chat_id', chatId);
    formData.append('caption', caption);
    formData.append('parse_mode', 'HTML');
    formData.append('photo', new Blob([binaryData], { type: 'image/png' }), 'lottery-card.png');

    const res = await fetch(`${TELEGRAM_API}${botToken}/sendPhoto`, {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Telegram sendPhoto failed:', res.status, errText);
      return false;
    }
    return true;
  } catch (err) {
    console.error('Error sending Telegram photo:', err);
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
    const TELEGRAM_CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID');
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID || !LOVABLE_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Missing required environment variables');
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Get today's date in ET
    const now = new Date();
    const etDate = now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

    console.log(`🎟️ Loading lottery tickets for ${etDate}...`);

    // Load today's lottery parlays
    const { data: parlays, error } = await supabase
      .from('bot_daily_parlays')
      .select('*')
      .eq('parlay_date', etDate)
      .eq('strategy_name', 'mega_lottery_scanner')
      .order('expected_odds', { ascending: true });

    if (error) {
      throw new Error(`Failed to load parlays: ${error.message}`);
    }

    if (!parlays || parlays.length === 0) {
      console.log('No lottery tickets found for today');
      return new Response(JSON.stringify({ success: true, message: 'No lottery tickets found' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Found ${parlays.length} lottery tickets`);

    const results: { tier: string; imageGenerated: boolean; sent: boolean }[] = [];

    for (const parlay of parlays) {
      const tierKey = getTierFromStrategy(parlay.strategy_name, parlay.tier);
      const style = TIER_STYLES[tierKey] || TIER_STYLES.standard;

      console.log(`\n${style.emoji} Generating ${style.label} card...`);

      // Generate the card image
      const prompt = buildCardPrompt(parlay, tierKey);
      const imageDataUrl = await generateCardImage(prompt, LOVABLE_API_KEY);

      if (!imageDataUrl) {
        console.error(`Failed to generate image for ${style.label}`);
        results.push({ tier: tierKey, imageGenerated: false, sent: false });

        // Fallback: send text-only caption
        const caption = buildCaption(parlay, tierKey);
        const fallbackRes = await fetch(`${TELEGRAM_API}${TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: TELEGRAM_CHAT_ID,
            text: `⚠️ Card image failed to generate\n\n${caption}`,
            parse_mode: 'HTML',
          }),
        });
        console.log('Fallback text sent:', fallbackRes.ok);
        continue;
      }

      console.log(`✅ Image generated for ${style.label}`);

      // Send to Telegram
      const caption = buildCaption(parlay, tierKey);
      const sent = await sendTelegramPhoto(TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, imageDataUrl, caption);

      results.push({ tier: tierKey, imageGenerated: true, sent });
      console.log(`${sent ? '✅' : '❌'} Telegram photo ${sent ? 'sent' : 'failed'} for ${style.label}`);

      // Small delay between sends
      await new Promise(r => setTimeout(r, 2000));
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('generate-lottery-cards error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
