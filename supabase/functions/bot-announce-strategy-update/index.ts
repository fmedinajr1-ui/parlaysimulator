/**
 * bot-announce-strategy-update
 * 
 * Broadcasts a strategy update announcement to all active Telegram customers.
 * Pulls live accuracy stats from category_sweet_spots at broadcast time.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

    // Pull live accuracy stats
    const { data: settled } = await supabase
      .from('category_sweet_spots')
      .select('outcome')
      .in('outcome', ['hit', 'miss', 'push']);

    const hits = (settled || []).filter(p => p.outcome === 'hit').length;
    const misses = (settled || []).filter(p => p.outcome === 'miss').length;
    const total = hits + misses;
    const rate = total > 0 ? ((hits / total) * 100).toFixed(1) : 'N/A';

    const ANNOUNCEMENT_MESSAGE = `🚀 *STRATEGY UPDATE — Sweet Spot Engine*

We've upgraded our parlay system\\. Every execution parlay now uses our *Sweet Spot Engine* as the foundation — all 3 core legs come from picks with 70%\\+ historical hit rates\\.

📊 *Current accuracy:* ${rate}% \\(${hits}W \\- ${misses}L\\)

*What changed:*
• All 3 legs in your parlays come from the Sweet Spot engine
• Optional 4th leg only added if it passes strict quality gates
• Mispriced\\-only parlays are now a backup, not the default

Type /accuracy to see live engine stats anytime\\.

\\— Parlay Farm Team`;

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
      accuracy: { rate, hits, misses },
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
