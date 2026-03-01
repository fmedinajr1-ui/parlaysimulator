/**
 * bot-announce-strategy-update
 * 
 * One-time invocable function that broadcasts a strategy update
 * announcement to all active Telegram customers.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ANNOUNCEMENT_MESSAGE = `📢 *STRATEGY UPDATE — March 2026*

Hey\\! Quick update on how your picks are delivered:

🔄 *More Parlays, More Coverage*
We've significantly increased daily parlay volume\\. Instead of \\~80 parlays, we now generate *200\\-300\\+ unique combinations per day*\\. This means more chances to hit\\.

💰 *Adjusted Stake Sizing*
With more parlays in play, individual stake sizes are lower to manage total exposure \\— but your overall profit potential increases because we're casting a wider net\\.

🔗 *Every Pick Cross\\-Referenced*
Every single pick is cross\\-referenced across multiple engines \\(conviction analyzer, bot parlay validator, double\\-confirmed scanner\\) before making it into a slip\\.

📊 *\\~70% Pick Accuracy*
Our individual picks are hitting at \\~70%\\. The challenge has been combining them into parlays where 1 miss kills the slip\\. More unique combinations with strict player caps means when 1 leg misses, only 2 parlays are affected instead of 5\\+\\.

🚫 *Strict Player Caps*
No player appears in more than 2 parlays across the entire daily slate\\. This eliminates correlated losses \\— if one player busts, it doesn't sink your whole day\\.

Questions\\? Just type your question here and the bot will answer\\.

\\— Parlay Bot Team`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
    const supabase = createClient(supabaseUrl, supabaseKey);

    if (!botToken) {
      throw new Error('TELEGRAM_BOT_TOKEN not configured');
    }

    // Fetch all active customers
    const { data: users, error } = await supabase
      .from('bot_authorized_users')
      .select('chat_id, username')
      .eq('is_active', true);

    if (error) throw error;
    if (!users || users.length === 0) {
      return new Response(JSON.stringify({ success: true, sent: 0, reason: 'no_active_users' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[Announce] Broadcasting to ${users.length} active users`);

    let sent = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const user of users) {
      try {
        const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: user.chat_id,
            text: ANNOUNCEMENT_MESSAGE,
            parse_mode: 'MarkdownV2',
          }),
        });

        const result = await resp.json();
        if (result.ok) {
          sent++;
          console.log(`[Announce] ✅ Sent to ${user.username || user.chat_id}`);
        } else {
          failed++;
          errors.push(`${user.chat_id}: ${result.description}`);
          console.log(`[Announce] ❌ Failed for ${user.chat_id}: ${result.description}`);
        }

        // Rate limit: 100ms delay between messages
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (err) {
        failed++;
        errors.push(`${user.chat_id}: ${err.message}`);
      }
    }

    console.log(`[Announce] Done: ${sent} sent, ${failed} failed`);

    return new Response(JSON.stringify({
      success: true,
      total: users.length,
      sent,
      failed,
      errors: errors.slice(0, 10),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[Announce] Error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
