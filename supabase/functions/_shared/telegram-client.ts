// _shared/telegram-client.ts
// The ONE AND ONLY way anything in this pipeline talks to Telegram.
// Do not call fetch('https://api.telegram.org/...') from anywhere else.

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { TelegramSendRequest, DayPhase } from './constants.ts';

const TELEGRAM_API = 'https://api.telegram.org/bot';
const MAX_TG_CHARS = 4096;
const CHUNK_TARGET = 3800; // leave headroom for markdown escape quirks
const GLOBAL_RATE_LIMIT_PER_SEC = 25; // Telegram allows ~30/sec across chats; we stay under

// ─── Token bucket for global rate limiting ────────────────────────────────

class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  constructor(private capacity: number, private refillPerSec: number) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }
  async take(): Promise<void> {
    this.refill();
    while (this.tokens < 1) {
      const waitMs = Math.max(10, Math.ceil(1000 / this.refillPerSec));
      await new Promise(r => setTimeout(r, waitMs));
      this.refill();
    }
    this.tokens -= 1;
  }
  private refill() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSec);
    this.lastRefill = now;
  }
}

const bucket = new TokenBucket(GLOBAL_RATE_LIMIT_PER_SEC, GLOBAL_RATE_LIMIT_PER_SEC);

// ─── Chunking ─────────────────────────────────────────────────────────────

function chunkMessage(text: string): string[] {
  if (text.length <= CHUNK_TARGET) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= CHUNK_TARGET) {
      chunks.push(remaining);
      break;
    }
    // Prefer break on double newline, then single newline, then space, then hard split.
    let cutAt = remaining.lastIndexOf('\n\n', CHUNK_TARGET);
    if (cutAt < CHUNK_TARGET / 2) cutAt = remaining.lastIndexOf('\n', CHUNK_TARGET);
    if (cutAt < CHUNK_TARGET / 2) cutAt = remaining.lastIndexOf(' ', CHUNK_TARGET);
    if (cutAt < 100) cutAt = CHUNK_TARGET; // hard split — protects against a single giant line (v1 H6)
    chunks.push(remaining.slice(0, cutAt).trimEnd());
    remaining = remaining.slice(cutAt).trimStart();
  }
  return chunks;
}

// ─── Message logging ──────────────────────────────────────────────────────
// Every outbound message is logged so the orchestrator can reference it later
// ("remember this morning I said...").

async function logMessage(
  sb: SupabaseClient,
  params: {
    chat_id: string;
    message_id?: number;
    text: string;
    phase: DayPhase | null;
    reference_key?: string;
    success: boolean;
    error?: string;
  }
) {
  try {
    await sb.from('bot_message_log').insert({
      chat_id: params.chat_id,
      telegram_message_id: params.message_id ?? null,
      text_preview: params.text.slice(0, 500),
      narrative_phase: params.phase,
      reference_key: params.reference_key ?? null,
      success: params.success,
      error: params.error ?? null,
      sent_at: new Date().toISOString(),
    });
  } catch (e) {
    // Logging must never break sending.
    console.warn('[tg] Failed to log message:', e);
  }
}

// ─── Single-message send with all the safety ──────────────────────────────

interface RawSendParams {
  botToken: string;
  chatId: string;
  text: string;
  parseMode?: 'Markdown' | 'HTML';
  replyMarkup?: object;
}

interface RawSendResult {
  ok: boolean;
  message_id?: number;
  error?: string;
  status?: number;
}

async function rawSend(p: RawSendParams): Promise<RawSendResult> {
  await bucket.take();
  const body: Record<string, any> = {
    chat_id: p.chatId,
    text: p.text,
    disable_web_page_preview: true,
  };
  if (p.parseMode) body.parse_mode = p.parseMode;
  if (p.replyMarkup) body.reply_markup = p.replyMarkup;

  try {
    const resp = await fetch(`${TELEGRAM_API}${p.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = await resp.json();
    if (!resp.ok) {
      return { ok: false, status: resp.status, error: result?.description || `HTTP ${resp.status}` };
    }
    return { ok: true, message_id: result?.result?.message_id };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/**
 * Send a message with the full safety stack:
 *   - Automatic retry with stripped parse_mode on Markdown/HTML parse errors (v1 bug C1)
 *   - Chunking for >4096-char messages, with reply_markup on FIRST chunk + continuation hint
 *   - 429 retry with backoff
 *   - Message logging
 */
export async function sendToChat(
  sb: SupabaseClient,
  params: {
    botToken: string;
    chatId: string;
    text: string;
    parseMode?: 'Markdown' | 'HTML';
    replyMarkup?: object;
    phase?: DayPhase | null;
    referenceKey?: string;
  }
): Promise<{ success: boolean; messageIds: number[]; errors: string[] }> {
  const { botToken, chatId, text, parseMode = 'Markdown', replyMarkup, phase = null, referenceKey } = params;
  const chunks = chunkMessage(text);
  const messageIds: number[] = [];
  const errors: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const isFirst = i === 0;
    const chunkText = chunks.length > 1 && !isFirst
      ? `_(cont. ${i + 1}/${chunks.length})_\n\n${chunks[i]}`
      : chunks.length > 1 && isFirst
      ? `${chunks[i]}\n\n_(1/${chunks.length} — more below)_`
      : chunks[i];

    let result = await rawSend({
      botToken, chatId, text: chunkText, parseMode,
      replyMarkup: isFirst ? replyMarkup : undefined, // markup on first chunk (v1 bug H5)
    });

    // Parse-mode fallback (v1 bug C1): if Telegram rejects the Markdown, retry as plain text.
    if (!result.ok && result.error && /can't parse entities|parse|entity/i.test(result.error)) {
      console.warn(`[tg] Parse error, retrying without parse_mode: ${result.error}`);
      result = await rawSend({
        botToken, chatId, text: chunkText, // no parseMode
        replyMarkup: isFirst ? replyMarkup : undefined,
      });
    }

    // 429 rate-limit retry with backoff from Telegram's retry_after hint
    if (!result.ok && result.status === 429) {
      const waitMs = 3000; // conservative
      console.warn(`[tg] 429 rate limited, waiting ${waitMs}ms`);
      await new Promise(r => setTimeout(r, waitMs));
      result = await rawSend({ botToken, chatId, text: chunkText, parseMode,
        replyMarkup: isFirst ? replyMarkup : undefined });
    }

    await logMessage(sb, {
      chat_id: chatId,
      message_id: result.message_id,
      text: chunkText,
      phase,
      reference_key: referenceKey,
      success: result.ok,
      error: result.error,
    });

    if (result.ok && result.message_id) messageIds.push(result.message_id);
    else if (result.error) errors.push(result.error);
  }

  return { success: errors.length === 0, messageIds, errors };
}

// ─── Customer fanout with throttling + per-customer routing ──────────────

import {
  decideForCustomer,
  loadAllCustomerPrefs,
  type AlertContext,
} from './customer-pick-router.ts';

export async function fanoutToCustomers(
  sb: SupabaseClient,
  params: {
    botToken: string;
    text: string;
    parseMode?: 'Markdown' | 'HTML';
    phase?: DayPhase | null;
    referenceKey?: string;
    /** Optional per-customer text transformer (e.g. personalized stake). */
    personalize?: (customer: { chat_id: string; username?: string; bankroll?: number }) => string | null;
    /** Skip this chat_id (usually the admin, who already got the message). */
    excludeChatId?: string;
    /** Alert context used by the customer pick router for filtering + personalized stake. */
    alertContext?: AlertContext;
  }
): Promise<{ sent: number; failed: number; skipped: number }> {
  const { data: customers } = await sb
    .from('bot_authorized_users')
    .select('chat_id, username, bankroll, is_active')
    .eq('is_active', true);

  const list = customers || [];
  const chatIds = list
    .filter(c => !(params.excludeChatId && c.chat_id === params.excludeChatId))
    .map(c => c.chat_id);
  const prefsMap = await loadAllCustomerPrefs(sb, chatIds);

  // ── Mute-30m enforcement ──
  // Build a set of (chat_id, player_name) pairs that are currently muted.
  // Any pick whose player_name matches a mute row from the last 30 min is skipped.
  const muteWindowIso = new Date(Date.now() - 30 * 60_000).toISOString();
  const muteSet = new Set<string>();
  let alertPlayerName: string | null = null;
  try {
    if (params.alertContext && (params.alertContext as any).pick_id) {
      const { data: pickRow } = await sb
        .from('bot_daily_picks')
        .select('player_name')
        .eq('id', (params.alertContext as any).pick_id)
        .maybeSingle();
      alertPlayerName = pickRow?.player_name ?? null;
    }
    if (alertPlayerName && chatIds.length > 0) {
      const { data: muteRows } = await sb
        .from('bot_pick_actions')
        .select('chat_id, player_name')
        .eq('action', 'mute_30m')
        .gte('created_at', muteWindowIso)
        .eq('player_name', alertPlayerName)
        .in('chat_id', chatIds.map(Number));
      for (const r of muteRows || []) {
        muteSet.add(`${r.chat_id}|${r.player_name}`);
      }
    }
  } catch (e) {
    console.warn('[tg] mute lookup failed (sending anyway):', e);
  }

  let sent = 0, failed = 0, skipped = 0;
  for (const c of list) {
    if (params.excludeChatId && c.chat_id === params.excludeChatId) {
      skipped++; continue;
    }

    // Skip if this customer muted this player in the last 30 min
    if (alertPlayerName && muteSet.has(`${Number(c.chat_id)}|${alertPlayerName}`)) {
      skipped++; continue;
    }

    // Customer pick router — filters + personalizes stake based on prefs
    const prefs = prefsMap.get(c.chat_id) || null;
    const decision = decideForCustomer(prefs, params.alertContext);
    if (!decision.shouldSend) {
      skipped++;
      // Audit log so we can answer "why didn't customer X get alert Y?"
      try {
        await sb.from('bot_message_log').insert({
          chat_id: c.chat_id,
          text_preview: `[skipped] ${decision.skipReason ?? 'unknown'}`,
          narrative_phase: params.phase ?? null,
          reference_key: params.referenceKey ?? null,
          success: false,
          error: `routed_skip:${decision.skipReason ?? 'unknown'}`,
          sent_at: new Date().toISOString(),
        });
      } catch (_) { /* never break sending on log failure */ }
      continue;
    }

    // Build per-customer text:
    //   1. If caller supplied personalize() → use that (back-compat)
    //   2. Else if router added personalizedFooter → append it
    //   3. Else use raw text
    let customerText: string | null = params.personalize
      ? params.personalize(c)
      : params.text;
    if (!customerText) { skipped++; continue; }
    if (!params.personalize && decision.personalizedFooter) {
      customerText = customerText + decision.personalizedFooter;
    }

    const r = await sendToChat(sb, {
      botToken: params.botToken,
      chatId: c.chat_id,
      text: customerText,
      parseMode: params.parseMode,
      phase: params.phase,
      referenceKey: params.referenceKey,
    });
    if (r.success) sent++;
    else failed++;
  }
  return { sent, failed, skipped };
}

// ─── Convenience: init from env ──────────────────────────────────────────

export function initClient(): { sb: SupabaseClient; botToken: string; adminChatId: string } {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
  const adminChatId = Deno.env.get('TELEGRAM_CHAT_ID');
  if (!supabaseUrl || !supabaseKey) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  if (!botToken) throw new Error('Missing TELEGRAM_BOT_TOKEN');
  if (!adminChatId) throw new Error('Missing TELEGRAM_CHAT_ID');
  return {
    sb: createClient(supabaseUrl, supabaseKey),
    botToken,
    adminChatId,
  };
}
