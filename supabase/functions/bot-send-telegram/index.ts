// supabase/functions/bot-send-telegram/index.ts
//
// NEW DISPATCHER — intentionally thin.
//
// This function used to be 1500 lines of formatters. All of that is gone.
// Formatting happens in _shared/pick-formatter.ts and _shared/voice.ts before
// anyone calls this function. This function's only job is to TRANSPORT a
// pre-rendered message to Telegram (admin + customer fanout) with the full
// safety stack (retry, fallback, rate-limit, chunking, logging).
//
// Bugs from v1 that no longer apply:
//   C1 — parse-mode fallback now in shared client
//   H5 — reply_markup chunking now in shared client
//   H6 — oversized-line chunk bug now in shared client
//   H3 — customer fanout failures are now logged to DB per recipient
//   H4 — global token bucket enforces 25 msg/sec ceiling
//
// New body shape:
//   {
//     message: string,                    // fully rendered text — NO TYPED 'type' field anymore
//     parse_mode?: 'Markdown' | 'HTML',
//     reply_markup?: object,
//     admin_only?: boolean,
//     fanout?: 'none' | 'all_active' | 'broadcast_tier_1',
//     narrative_phase?: DayPhase,
//     reference_key?: string,
//     personalize_stake_pct?: number,     // e.g. 0.05 → append "your stake: $X" per customer
//   }
//
// Legacy 'type' field callers are routed through a compatibility shim that
// emits a deprecation warning but still works. This lets you migrate generators
// one at a time.

import { initClient, sendToChat, fanoutToCustomers } from '../_shared/telegram-client.ts';
import { etHour } from '../_shared/date-et.ts';
import type { DayPhase } from '../_shared/constants.ts';
import { enrichLegacyAlert, shouldEnrich } from '../_shared/alert-enricher.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  message: string;
  parse_mode?: 'Markdown' | 'HTML';
  reply_markup?: object;
  admin_only?: boolean;
  fanout?: 'none' | 'all_active' | 'broadcast_tier_1';
  narrative_phase?: DayPhase;
  reference_key?: string;
  personalize_stake_pct?: number;
  // Legacy — deprecated
  type?: string;
  data?: Record<string, any>;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const body: RequestBody = await req.json();

    // ── Legacy compatibility shim ──
    // Default DISPATCHER_VERSION=compat: route legacy { type, data } payloads
    // through with a deprecation warning so the 99 existing generators keep
    // working. Set DISPATCHER_VERSION=strict to enforce v2 contract (HTTP 410).
    const compatMode = (Deno.env.get('DISPATCHER_VERSION') ?? 'compat') !== 'strict';
    if (body.type && !body.message) {
      if (!compatMode) {
        console.warn(`[bot-send-telegram] STRICT: rejected typed call type='${body.type}'`);
        return new Response(JSON.stringify({
          success: false,
          error: 'deprecated_typed_call',
          hint: `Render the message via _shared/pick-formatter.ts or _shared/voice.ts and pass it as 'message'. See MIGRATION.md.`,
          offending_type: body.type,
        }), {
          status: 410,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const legacyMsg = body.data?.message
        || body.data?.text
        || (typeof body.data === 'string' ? body.data : null)
        || `[${body.type}] (legacy payload — please migrate to v2 'message' field)`;
      body.message = String(legacyMsg);
      console.warn(`[bot-send-telegram] COMPAT: type='${body.type}' — migrate caller to v2 message field`);
    }

    if (!body.message || typeof body.message !== 'string') {
      return new Response(JSON.stringify({ success: false, error: 'missing_message' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { sb, botToken, adminChatId } = initClient();

    // ── Admin chat resolution ──
    let chatId = adminChatId;
    let settings: Record<string, any> = {};
    try {
      const { data: settingsRow } = await sb
        .from('bot_settings')
        .select('*')
        .eq('user_id', 'admin')
        .maybeSingle();
      if (settingsRow) {
        chatId = settingsRow.telegram_chat_id || adminChatId;
        settings = settingsRow;
      }
    } catch (_) { /* settings table missing is non-fatal */ }

    // ── Quiet hours (admin only, non-critical) ──
    // A "critical" message always fires, even in quiet hours. We use the
    // narrative_phase field: settlement, dawn_brief, pipeline_failure always go.
    const isCritical = body.admin_only === true
      || body.narrative_phase === 'settlement_story'
      || body.narrative_phase === 'dawn_brief'
      || (body.reference_key || '').startsWith('pipeline_failure');

    if (!isCritical) {
      const hour = etHour();
      const quietStart = settings.quiet_start_hour ?? 23;
      const quietEnd = settings.quiet_end_hour ?? 7;
      const inQuiet = quietStart > quietEnd
        ? (hour >= quietStart || hour < quietEnd)
        : (hour >= quietStart && hour < quietEnd);
      if (inQuiet) {
        return new Response(JSON.stringify({ success: true, skipped: true, reason: 'quiet_hours' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // ── Send to admin ──
    const adminResult = await sendToChat(sb, {
      botToken,
      chatId,
      text: body.message,
      parseMode: body.parse_mode || 'Markdown',
      replyMarkup: body.reply_markup,
      phase: body.narrative_phase ?? null,
      referenceKey: body.reference_key,
    });

    if (!adminResult.success) {
      console.error('[bot-send-telegram] Admin send failed:', adminResult.errors);
      return new Response(JSON.stringify({ success: false, errors: adminResult.errors }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Customer fanout (optional) ──
    let fanoutStats: { sent: number; failed: number; skipped: number } | null = null;
    if (body.fanout && body.fanout !== 'none' && !body.admin_only) {
      fanoutStats = await fanoutToCustomers(sb, {
        botToken,
        text: body.message,
        parseMode: body.parse_mode || 'Markdown',
        phase: body.narrative_phase ?? null,
        referenceKey: body.reference_key,
        excludeChatId: chatId,
        personalize: body.personalize_stake_pct
          ? (c) => {
              const pct = body.personalize_stake_pct!;
              if (!c.bankroll || c.bankroll <= 0) return body.message;
              const stake = Math.round(c.bankroll * pct);
              return `${body.message}\n\n💰 *Your stake:* $${stake} (${(pct * 100).toFixed(1)}% of your $${c.bankroll.toLocaleString()} bankroll)`;
            }
          : undefined,
      });
    }

    return new Response(JSON.stringify({
      success: true,
      messageIds: adminResult.messageIds,
      fanout: fanoutStats,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[bot-send-telegram] Uncaught error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
