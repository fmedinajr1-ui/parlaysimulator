// supabase/functions/bot-reonboard-existing/index.ts
//
// One-shot broadcaster: re-onboards every existing Telegram user (admin + customer)
// who hasn't completed the new personalization wizard yet.
//
// Idempotent: only targets users whose onboarding_step is in
// ('legacy_skip', 'awaiting_bet_type'). Anyone mid-flow on a later step
// or already 'complete' is skipped.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendToChat } from '../_shared/telegram-client.ts';
import { startOnboarding } from '../_shared/onboarding-state-machine.ts';
import { MessageBuilder, bold } from '../_shared/voice.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
  if (!botToken) {
    return new Response(JSON.stringify({ error: 'TELEGRAM_BOT_TOKEN missing' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const body = await req.json().catch(() => ({}));
  const dryRun = body.dry_run === true;

  // Pull every active authorized user joined with their prefs
  const { data: rows, error } = await sb
    .from('bot_authorized_users')
    .select('chat_id, username, is_active, bot_user_preferences(onboarding_step)')
    .eq('is_active', true);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const targets: { chat_id: string; username: string | null }[] = [];
  for (const r of rows || []) {
    const prefs = Array.isArray((r as any).bot_user_preferences)
      ? (r as any).bot_user_preferences[0]
      : (r as any).bot_user_preferences;
    const step = prefs?.onboarding_step ?? null;
    // Eligible: no prefs row, legacy_skip, or already at step 1 (re-nudge)
    if (!step || step === 'legacy_skip' || step === 'awaiting_bet_type') {
      targets.push({ chat_id: (r as any).chat_id, username: (r as any).username ?? null });
    }
  }

  if (dryRun) {
    return new Response(JSON.stringify({ dry_run: true, would_send: targets.length, targets }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let sent = 0, failed = 0;
  const errors: string[] = [];

  for (const t of targets) {
    try {
      // 1) Friendly upgrade announcement
      const m = new MessageBuilder();
      m.line(`Heads up 👋 I just got smarter.`);
      m.blank();
      m.line(`Now I personalize picks per person — your sports, your bankroll, your stake sizes. ` +
             `30 seconds to set up, then I stop sending you stuff you'd mute.`);
      m.blank();
      m.line(bold(`Ready? Tap below to start. 👇`));

      const r = await sendToChat(sb, {
        botToken,
        chatId: t.chat_id,
        text: m.build(),
        parseMode: 'Markdown',
        referenceKey: 'reonboard_v1',
      });

      // 2) Fire onboarding step 1 (bet type buttons)
      if (r.success) {
        await startOnboarding(sb, botToken, t.chat_id);
        sent++;
      } else {
        failed++;
        errors.push(`${t.chat_id}: ${r.errors.join('; ')}`);
      }

      // Stagger 100ms to respect Telegram global rate limit
      await new Promise(res => setTimeout(res, 100));
    } catch (e: any) {
      failed++;
      errors.push(`${t.chat_id}: ${String(e?.message || e)}`);
    }
  }

  return new Response(JSON.stringify({
    sent, failed, skipped_already_in_flow: (rows?.length || 0) - targets.length,
    errors: errors.slice(0, 10),
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
