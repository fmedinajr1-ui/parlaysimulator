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

const ANNOUNCEMENT_MESSAGE = `🆕 *NEW FEATURE — /lookup Command*

You can now look up any NBA player directly in chat\\!

\`/lookup \\[player name\\]\`

What you'll get:
• L10 game log \\(last 10 games\\)
• L10 stat averages \\(PTS, REB, AST, 3PT, STL, BLK\\)
• Tonight's defensive matchup ranking
• Today's prop lines with L10 hit rates

Example: \`/lookup LeBron James\`

📊 *New Data in the Pipeline:*
• Double Doubles and Triple Doubles are now tracked and analyzed
• Team Moneylines scraped across NBA, MLB, NHL, NFL
• All new prop types run through the mispriced \\+ correct\\-priced detection engine

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
