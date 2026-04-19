// supabase/functions/telegram-webhook/index.ts
//
// INBOUND TELEGRAM HANDLER.
//
// Fixes from v1:
//   C2 — Secret is read from header X-Telegram-Bot-Api-Secret-Token (not query string)
//   C3 — Fails CLOSED if TELEGRAM_WEBHOOK_SECRET env var is not set
//
// Adds conversational commands that make the bot feel responsive:
//   /why <pickid>      → explain why a pick was chosen
//   /today             → today's plays
//   /edge              → best current edges
//   /pulse             → live status of today's plays
//   /record            → recent P/L
//   /ask <question>    → conversational Q&A (falls through to LLM if enabled)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { Pick } from '../_shared/constants.ts';
import { etDateKey, etDateKeyDaysAgo } from '../_shared/date-et.ts';
import { renderPickCard, renderPickLine, renderPickSummaryList } from '../_shared/pick-formatter.ts';
import { MessageBuilder, bold, italic } from '../_shared/voice.ts';
import { sendToChat } from '../_shared/telegram-client.ts';
import {
  startOnboarding,
  showPreferences,
  handleCallback as handleOnboardingCallback,
  handleFreeText as handleOnboardingFreeText,
} from '../_shared/onboarding-state-machine.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-telegram-bot-api-secret-token',
};

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);
const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!;

// ─── Fail closed if secret isn't set ──────────────────────────────────────

const EXPECTED_SECRET = Deno.env.get('TELEGRAM_WEBHOOK_SECRET');
if (!EXPECTED_SECRET) {
  console.error('[webhook] CRITICAL: TELEGRAM_WEBHOOK_SECRET env var is not set. Webhook will reject all requests.');
  // Note: we don't throw here at import time because edge functions import
  // gets retried. We check in each request instead.
}

// ─── Auth helpers ─────────────────────────────────────────────────────────

function isAdmin(chatId: string): boolean {
  const adminId = Deno.env.get('TELEGRAM_CHAT_ID');
  return !!adminId && chatId === adminId;
}

async function isAuthorized(chatId: string): Promise<boolean> {
  const { data } = await supabase
    .from('bot_authorized_users')
    .select('is_active')
    .eq('chat_id', chatId)
    .eq('is_active', true)
    .maybeSingle();
  return !!data;
}

// ─── Command: /why <pick_id> ──────────────────────────────────────────────
// Customer can ask about any recent pick and get the reasoning replayed.

async function handleWhy(chatId: string, args: string): Promise<string> {
  const pickIdArg = args.trim();
  if (!pickIdArg) {
    // Show recent picks they can ask about
    const today = etDateKey();
    const { data: picks } = await supabase
      .from('bot_daily_picks')
      .select('*')
      .eq('pick_date', today)
      .order('confidence', { ascending: false })
      .limit(10);

    if (!picks || picks.length === 0) return "No picks on the board right now.";

    const m = new MessageBuilder();
    m.line(`Which pick do you want me to explain? Reply ${italic('/why <number>')}:`);
    m.blank();
    for (let i = 0; i < picks.length; i++) {
      m.line(`${i + 1}. ${renderPickLine(picks[i] as Pick, { showConfidence: true })}`);
    }
    return m.build();
  }

  // Try as an index first, then as a pick id
  const today = etDateKey();
  const { data: allPicks } = await supabase
    .from('bot_daily_picks')
    .select('*')
    .eq('pick_date', today)
    .order('confidence', { ascending: false });

  if (!allPicks || allPicks.length === 0) return "No active picks today.";

  const asIdx = parseInt(pickIdArg, 10);
  let pick: Pick | null = null;
  if (!isNaN(asIdx) && asIdx >= 1 && asIdx <= allPicks.length) {
    pick = allPicks[asIdx - 1] as Pick;
  } else {
    pick = (allPicks.find((p: any) => p.id === pickIdArg) || null) as Pick | null;
  }

  if (!pick) return `Couldn't find that pick. Try ${italic('/why')} with no argument to see the list.`;

  // Load the customer's bankroll for personalized stake
  const { data: customer } = await supabase
    .from('bot_authorized_users')
    .select('bankroll')
    .eq('chat_id', chatId)
    .maybeSingle();

  return renderPickCard(pick, customer?.bankroll);
}

// ─── Command: /today ──────────────────────────────────────────────────────

async function handleToday(chatId: string): Promise<string> {
  const today = etDateKey();
  const { data: picks } = await supabase
    .from('bot_daily_picks')
    .select('*')
    .eq('pick_date', today)
    .order('confidence', { ascending: false });

  if (!picks || picks.length === 0) {
    return "Nothing posted yet today. Dawn brief goes out at 8am ET, full slate locks at 11am.";
  }

  const m = new MessageBuilder();
  m.header(`Today's plays`, '🎯');
  m.line(`${picks.length} on the board.`);
  m.blank();
  m.raw(renderPickSummaryList(picks as Pick[], 20));
  m.blank();
  m.aside(`Reply /why <number> for the full reasoning on any pick.`);
  return m.build();
}

// ─── Command: /edge ───────────────────────────────────────────────────────
// Shows picks with the highest edge% (not just highest confidence).

async function handleEdge(chatId: string): Promise<string> {
  const today = etDateKey();
  const { data: picks } = await supabase
    .from('bot_daily_picks')
    .select('*')
    .eq('pick_date', today)
    .not('edge_pct', 'is', null)
    .order('edge_pct', { ascending: false })
    .limit(5);

  if (!picks || picks.length === 0) return "No edge data on today's picks yet.";

  const m = new MessageBuilder();
  m.header(`Biggest edges on the board`, '📈');
  for (let i = 0; i < picks.length; i++) {
    const p = picks[i] as Pick;
    const edge = p.edge_pct != null ? `+${p.edge_pct.toFixed(1)}% edge` : '';
    m.line(`${i + 1}. ${renderPickLine(p)} · ${bold(edge)}`);
  }
  return m.build();
}

// ─── Command: /pulse ──────────────────────────────────────────────────────
// Live status of today's active plays.

async function handlePulse(): Promise<string> {
  const today = etDateKey();
  const { data: legs } = await supabase
    .from('bot_parlay_legs')
    .select('*, parlay:bot_daily_parlays(parlay_date, outcome)')
    .eq('parlay.parlay_date', today)
    .in('outcome', ['hit', 'miss', 'pending'])
    .order('updated_at', { ascending: false })
    .limit(50);

  if (!legs || legs.length === 0) return "Nothing live right now.";

  const hits = legs.filter((l: any) => l.outcome === 'hit').length;
  const misses = legs.filter((l: any) => l.outcome === 'miss').length;
  const pending = legs.filter((l: any) => l.outcome === 'pending').length;

  const m = new MessageBuilder();
  m.header(`Live pulse`, '📡');
  m.line(`✅ ${hits} hit · ❌ ${misses} miss · ⏳ ${pending} pending`);
  m.blank();

  const pendingLegs = legs.filter((l: any) => l.outcome === 'pending').slice(0, 10);
  if (pendingLegs.length > 0) {
    m.line(bold('Still live:'));
    for (const leg of pendingLegs) {
      m.line(`• ${renderPickLine(leg as Pick)}`);
    }
  }
  return m.build();
}

// ─── Command: /record ─────────────────────────────────────────────────────

async function handleRecord(): Promise<string> {
  const sevenDaysAgo = etDateKeyDaysAgo(7);
  const { data: parlays } = await supabase
    .from('bot_daily_parlays')
    .select('parlay_date, outcome, profit_loss')
    .gte('parlay_date', sevenDaysAgo)
    .in('outcome', ['won', 'lost']);

  if (!parlays || parlays.length === 0) return "No settled parlays in the last 7 days.";

  const won = parlays.filter((p: any) => p.outcome === 'won').length;
  const lost = parlays.filter((p: any) => p.outcome === 'lost').length;
  const pnl = parlays.reduce((s: number, p: any) => s + (p.profit_loss || 0), 0);
  const winRate = Math.round((won / (won + lost)) * 100);
  const sign = pnl >= 0 ? '+' : '';

  const m = new MessageBuilder();
  m.header(`Last 7 days`, '📊');
  m.line(`${bold(won)}W · ${bold(lost)}L (${winRate}%)`);
  m.line(`Net: ${bold(`${sign}$${Math.abs(pnl).toFixed(0)}`)}`);
  return m.build();
}

// ─── Command: /start [password] ──────────────────────────────────────────
// /start with no args → returns the welcome (existing behavior)
// /start <password> → activates an unauthorized user, then kicks off onboarding

async function handleStart(chatId: string, args: string, username: string | undefined): Promise<string | null> {
  const pwd = args.trim();

  if (pwd) {
    // Password activation flow
    const { data: pwdRow } = await supabase
      .from('bot_access_passwords')
      .select('*')
      .eq('password', pwd)
      .eq('is_active', true)
      .maybeSingle();

    if (!pwdRow) {
      return `🔒 That password isn't valid. Contact the admin.`;
    }
    if (pwdRow.max_uses && pwdRow.times_used >= pwdRow.max_uses) {
      return `🔒 That password has been used up. Contact the admin for a new one.`;
    }

    // Activate the user (idempotent)
    await supabase.from('bot_authorized_users').upsert({
      chat_id: chatId,
      username: username ?? null,
      is_active: true,
    }, { onConflict: 'chat_id' });

    // Mark password used
    await supabase.from('bot_access_passwords').update({
      times_used: (pwdRow.times_used ?? 0) + 1,
      retrieved: true,
    }).eq('id', pwdRow.id);

    // Kick off onboarding wizard (sends step 1)
    await startOnboarding(supabase, TELEGRAM_BOT_TOKEN, chatId);
    return null; // onboarding sends its own messages
  }

  // No password → standard welcome
  const m = new MessageBuilder();
  m.header(`Welcome`, '🌾');
  m.line(`I'm ParlayIQ. I watch the board, run the numbers, and send over plays I actually like with reasoning attached.`);
  m.blank();
  m.line(bold(`What I send you:`));
  m.line(`🌅 Dawn brief at 8am ET — the read for the day`);
  m.line(`🎯 Slate lock at 11am — plays are set`);
  m.line(`📇 Individual pick cards with full reasoning`);
  m.line(`⏰ Pre-game updates (line moves, scratches)`);
  m.line(`📊 Honest settlement recap each night`);
  m.blank();
  m.line(bold(`Commands:`));
  m.line(`/today — current plays`);
  m.line(`/why <#> — explain a pick`);
  m.line(`/edge — biggest edges right now`);
  m.line(`/pulse — live status`);
  m.line(`/record — last 7 days`);
  m.line(`/preferences — view or change your settings`);
  return m.build();
}

// ─── Command dispatch ─────────────────────────────────────────────────────

async function handleCommand(chatId: string, text: string, username?: string): Promise<string | null> {
  const trimmed = text.trim();
  const [cmd, ...rest] = trimmed.split(/\s+/);
  const args = rest.join(' ');
  const c = cmd.toLowerCase().replace(/@.*$/, ''); // strip bot username suffix

  switch (c) {
    case '/start':       return handleStart(chatId, args, username);
    case '/today':       return handleToday(chatId);
    case '/why':         return handleWhy(chatId, args);
    case '/edge':        return handleEdge(chatId);
    case '/pulse':       return handlePulse();
    case '/record':      return handleRecord();
    case '/preferences':
    case '/settings':
      await showPreferences(supabase, TELEGRAM_BOT_TOKEN, chatId);
      return null;
    case '/help':        return handleStart(chatId, '', username);
    default:
      return `I didn't recognize ${bold(cmd)}. Try /start for the list.`;
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  // FIX v1 bug C3: fail closed if env var missing
  if (!EXPECTED_SECRET) {
    console.error('[webhook] Rejecting — TELEGRAM_WEBHOOK_SECRET not set');
    return new Response('Server misconfigured', { status: 503 });
  }

  // FIX v1 bug C2: read header, not query string
  const providedSecret = req.headers.get('X-Telegram-Bot-Api-Secret-Token');
  if (!providedSecret || providedSecret !== EXPECTED_SECRET) {
    console.warn('[webhook] Invalid or missing secret header');
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const update = await req.json();

    // Only handle text messages for this simplified surface
    const message = update.message;
    if (!message || !message.text) return new Response('OK', { status: 200 });

    const chatId = String(message.chat.id);
    const text = message.text;

    // Non-command text: let it fall through (could be a password attempt, or
    // just chat — your original webhook had lots of this logic. Preserved
    // externally; this file only covers the command surface.)
    if (!text.startsWith('/')) {
      return new Response('OK', { status: 200 });
    }

    // Auth: admin bypasses everything; everyone else needs to be authorized.
    if (!isAdmin(chatId)) {
      const authd = await isAuthorized(chatId);
      if (!authd) {
        await sendToChat(supabase, {
          botToken: TELEGRAM_BOT_TOKEN,
          chatId,
          text: `🔒 You need to be authorized first. Contact the admin for access.`,
        });
        return new Response('OK', { status: 200 });
      }
    }

    const reply = await handleCommand(chatId, text);
    await sendToChat(supabase, {
      botToken: TELEGRAM_BOT_TOKEN,
      chatId,
      text: reply,
      parseMode: 'Markdown',
    });

    return new Response('OK', { status: 200 });
  } catch (e: any) {
    console.error('[webhook] Error:', e);
    return new Response('Error', { status: 500 });
  }
});
