// _shared/onboarding-state-machine.ts
//
// 4-step onboarding wizard for new Telegram subscribers.
//
//   START → awaiting_bet_type → awaiting_sports → awaiting_bankroll
//         → awaiting_risk → complete
//
// Each step:
//   1. Sends a question with inline keyboard buttons (no free text where possible)
//   2. Validates the answer
//   3. Persists to bot_user_preferences
//   4. Advances cursor + sends next question
// After 'complete' a personalized recap is sent.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendToChat } from './telegram-client.ts';
import { MessageBuilder, bold, italic, pickRandom } from './voice.ts';

const SPORTS_OPTIONS = [
  { code: 'NBA', label: '🏀 NBA' },
  { code: 'MLB', label: '⚾ MLB' },
  { code: 'NFL', label: '🏈 NFL' },
  { code: 'NHL', label: '🏒 NHL' },
  { code: 'tennis', label: '🎾 Tennis' },
  { code: 'soccer', label: '⚽ Soccer' },
];

const RISK_PROFILE_DEFAULTS: Record<string, { min_confidence: number; max_legs: number }> = {
  conservative: { min_confidence: 75, max_legs: 2 },
  balanced:     { min_confidence: 65, max_legs: 3 },
  aggressive:   { min_confidence: 55, max_legs: 5 },
};

const ONBOARDING_OPENERS = [
  "Welcome aboard 👋 Quick 4 questions so I send picks you'll actually use, not 50 alerts a day you'll mute.",
  "You're in. Before I start firing picks at you — 4 quick questions. Takes 30 seconds.",
  "Locked in. Let me get to know you so I'm not flooding your phone with stuff you don't bet.",
];

// ── Telegram inline keyboard helpers ──

function btn(text: string, data: string) { return { text, callback_data: data }; }

function betTypeKeyboard() {
  return {
    inline_keyboard: [[
      btn('🎯 Singles', 'onb:bet:singles_only'),
      btn('🎰 Parlays', 'onb:bet:parlays_only'),
      btn('🔥 Both', 'onb:bet:both'),
    ]],
  };
}

function sportsKeyboard(selected: string[]) {
  const rows: any[][] = [];
  for (let i = 0; i < SPORTS_OPTIONS.length; i += 2) {
    rows.push(SPORTS_OPTIONS.slice(i, i + 2).map(s => {
      const checked = selected.includes(s.code) ? '✅ ' : '';
      return btn(`${checked}${s.label}`, `onb:sport:${s.code}`);
    }));
  }
  rows.push([btn('✅ Done — continue', 'onb:sport:DONE')]);
  return { inline_keyboard: rows };
}

function riskKeyboard() {
  return {
    inline_keyboard: [
      [btn('🛡️ Conservative — only my best plays', 'onb:risk:conservative')],
      [btn('⚖️ Balanced — mix of safe + value',     'onb:risk:balanced')],
      [btn('🚀 Aggressive — show me everything',   'onb:risk:aggressive')],
    ],
  };
}

// ── Step senders ──

async function sendStep(
  sb: SupabaseClient,
  botToken: string,
  chatId: string,
  text: string,
  replyMarkup?: any
) {
  await sendToChat(sb, {
    botToken,
    chatId,
    text,
    parseMode: 'Markdown',
    replyMarkup,
    referenceKey: 'onboarding',
  });
}

async function sendBetTypeQuestion(sb: SupabaseClient, botToken: string, chatId: string) {
  const m = new MessageBuilder();
  m.line(pickRandom(ONBOARDING_OPENERS, chatId));
  m.blank();
  m.line(bold('1 of 4 — How do you bet?'));
  await sendStep(sb, botToken, chatId, m.build(), betTypeKeyboard());
}

async function sendSportsQuestion(
  sb: SupabaseClient, botToken: string, chatId: string, selected: string[]
) {
  const m = new MessageBuilder();
  m.line(bold('2 of 4 — Which sports?'));
  m.line(italic('Tap as many as you want, then hit Done.'));
  if (selected.length > 0) {
    m.blank();
    m.line(`Selected: ${selected.join(', ')}`);
  }
  await sendStep(sb, botToken, chatId, m.build(), sportsKeyboard(selected));
}

async function sendBankrollQuestion(sb: SupabaseClient, botToken: string, chatId: string) {
  const m = new MessageBuilder();
  m.line(bold('3 of 4 — What\'s your betting bankroll?'));
  m.line(`Just type a number (e.g. ${italic('2000')}).`);
  m.blank();
  m.line(italic('This is just for stake sizing — I never see your real account.'));
  await sendStep(sb, botToken, chatId, m.build());
}

async function sendRiskQuestion(sb: SupabaseClient, botToken: string, chatId: string) {
  const m = new MessageBuilder();
  m.line(bold('4 of 4 — Risk profile?'));
  await sendStep(sb, botToken, chatId, m.build(), riskKeyboard());
}

async function sendRecap(
  sb: SupabaseClient, botToken: string, chatId: string,
  prefs: { bet_type: string; sports: string[]; bankroll_size: number; risk_profile: string; min_confidence: number; }
) {
  const betLabel = prefs.bet_type === 'both' ? 'Singles + parlays'
    : prefs.bet_type === 'parlays_only' ? 'Parlays only' : 'Singles only';
  const m = new MessageBuilder();
  m.header('Locked in', '✅');
  m.line(`🎯 ${bold('Bet type:')} ${betLabel}`);
  m.line(`🏟  ${bold('Sports:')} ${prefs.sports.join(', ') || 'all'}`);
  m.line(`💰 ${bold('Bankroll:')} $${prefs.bankroll_size.toLocaleString()}`);
  m.line(`⚖️  ${bold('Risk:')} ${prefs.risk_profile} — picks I'm ${prefs.min_confidence}%+ confident on`);
  m.blank();
  m.line(`First picks roll in around 2 PM ET. Reply ${italic('/preferences')} anytime to adjust.`);
  m.line(`Let's eat. 🍽️`);
  await sendStep(sb, botToken, chatId, m.build());
}

// ── Public API ──

/**
 * Begin onboarding for a brand-new user. Creates the prefs row and sends step 1.
 */
export async function startOnboarding(
  sb: SupabaseClient, botToken: string, chatId: string
) {
  await sb.from('bot_user_preferences').upsert({
    chat_id: chatId,
    onboarding_step: 'awaiting_bet_type',
    pending_sports: [],
  }, { onConflict: 'chat_id' });
  await sendBetTypeQuestion(sb, botToken, chatId);
}

/**
 * Re-show the user's current preferences with edit buttons.
 */
export async function showPreferences(
  sb: SupabaseClient, botToken: string, chatId: string
) {
  const { data } = await sb
    .from('bot_user_preferences')
    .select('*')
    .eq('chat_id', chatId)
    .maybeSingle();
  if (!data) {
    await startOnboarding(sb, botToken, chatId);
    return;
  }
  const m = new MessageBuilder();
  m.header('Your preferences', '⚙️');
  m.line(`🎯 ${bold('Bet type:')} ${data.bet_type}`);
  m.line(`🏟  ${bold('Sports:')} ${(data.sports || []).join(', ') || 'all'}`);
  m.line(`💰 ${bold('Bankroll:')} $${Number(data.bankroll_size).toLocaleString()}`);
  m.line(`⚖️  ${bold('Risk:')} ${data.risk_profile}`);
  m.blank();
  m.line(italic('Tap below to change anything.'));
  const kb = {
    inline_keyboard: [
      [btn('🔄 Change bet type', 'onb:edit:bet_type')],
      [btn('🔄 Change sports',   'onb:edit:sports')],
      [btn('🔄 Change bankroll', 'onb:edit:bankroll')],
      [btn('🔄 Change risk',     'onb:edit:risk')],
      [btn('🔁 Restart full setup', 'onb:edit:restart')],
    ],
  };
  await sendStep(sb, botToken, chatId, m.build(), kb);
}

/**
 * Handle a callback_query from an inline keyboard button.
 * Returns true if it was an onboarding callback (and was handled).
 */
export async function handleCallback(
  sb: SupabaseClient, botToken: string, chatId: string, callbackData: string
): Promise<boolean> {
  if (!callbackData.startsWith('onb:')) return false;

  const [, kind, value] = callbackData.split(':');
  const { data: prefs } = await sb
    .from('bot_user_preferences')
    .select('*')
    .eq('chat_id', chatId)
    .maybeSingle();

  if (!prefs) {
    await startOnboarding(sb, botToken, chatId);
    return true;
  }

  // Edit menu shortcuts (from /preferences)
  if (kind === 'edit') {
    switch (value) {
      case 'bet_type':
        await sb.from('bot_user_preferences')
          .update({ onboarding_step: 'awaiting_bet_type' }).eq('chat_id', chatId);
        await sendBetTypeQuestion(sb, botToken, chatId);
        return true;
      case 'sports':
        await sb.from('bot_user_preferences')
          .update({ onboarding_step: 'awaiting_sports', pending_sports: [] }).eq('chat_id', chatId);
        await sendSportsQuestion(sb, botToken, chatId, []);
        return true;
      case 'bankroll':
        await sb.from('bot_user_preferences')
          .update({ onboarding_step: 'awaiting_bankroll' }).eq('chat_id', chatId);
        await sendBankrollQuestion(sb, botToken, chatId);
        return true;
      case 'risk':
        await sb.from('bot_user_preferences')
          .update({ onboarding_step: 'awaiting_risk' }).eq('chat_id', chatId);
        await sendRiskQuestion(sb, botToken, chatId);
        return true;
      case 'restart':
        await startOnboarding(sb, botToken, chatId);
        return true;
    }
    return true;
  }

  // Step: bet_type chosen
  if (kind === 'bet') {
    if (!['singles_only', 'parlays_only', 'both'].includes(value)) return true;
    await sb.from('bot_user_preferences').update({
      bet_type: value,
      onboarding_step: 'awaiting_sports',
      pending_sports: [],
    }).eq('chat_id', chatId);
    await sendSportsQuestion(sb, botToken, chatId, []);
    return true;
  }

  // Step: sport toggled OR done
  if (kind === 'sport') {
    const current: string[] = prefs.pending_sports || [];
    if (value === 'DONE') {
      if (current.length === 0) {
        await sendSportsQuestion(sb, botToken, chatId, current);
        await sendStep(sb, botToken, chatId, italic('Pick at least one sport first.'));
        return true;
      }
      await sb.from('bot_user_preferences').update({
        sports: current,
        onboarding_step: 'awaiting_bankroll',
      }).eq('chat_id', chatId);
      await sendBankrollQuestion(sb, botToken, chatId);
      return true;
    }
    const validCodes = SPORTS_OPTIONS.map(s => s.code);
    if (!validCodes.includes(value)) return true;
    const next = current.includes(value)
      ? current.filter(s => s !== value)
      : [...current, value];
    await sb.from('bot_user_preferences').update({ pending_sports: next }).eq('chat_id', chatId);
    await sendSportsQuestion(sb, botToken, chatId, next);
    return true;
  }

  // Step: risk chosen → complete
  if (kind === 'risk') {
    if (!RISK_PROFILE_DEFAULTS[value]) return true;
    const defaults = RISK_PROFILE_DEFAULTS[value];
    const updated = await sb.from('bot_user_preferences').update({
      risk_profile: value,
      min_confidence: defaults.min_confidence,
      max_legs: defaults.max_legs,
      onboarding_step: 'complete',
      onboarding_completed_at: new Date().toISOString(),
    }).eq('chat_id', chatId).select('*').maybeSingle();
    const final = updated.data || prefs;
    await sendRecap(sb, botToken, chatId, {
      bet_type: final.bet_type,
      sports: final.sports || [],
      bankroll_size: Number(final.bankroll_size),
      risk_profile: final.risk_profile,
      min_confidence: Number(final.min_confidence),
    });
    return true;
  }

  return true;
}

/**
 * Handle a free-text message during onboarding.
 * Currently used only for the bankroll step.
 * Returns true if the message was consumed by onboarding.
 */
export async function handleFreeText(
  sb: SupabaseClient, botToken: string, chatId: string, text: string
): Promise<boolean> {
  const { data: prefs } = await sb
    .from('bot_user_preferences')
    .select('onboarding_step')
    .eq('chat_id', chatId)
    .maybeSingle();
  if (!prefs) return false;
  if (prefs.onboarding_step === 'complete' || prefs.onboarding_step === 'legacy_skip') return false;

  if (prefs.onboarding_step === 'awaiting_bankroll') {
    const cleaned = text.replace(/[$,\s]/g, '');
    const num = Number(cleaned);
    if (!isFinite(num) || num <= 0 || num > 10_000_000) {
      await sendStep(sb, botToken, chatId,
        italic('Just a number please — like 2000 or 500.'));
      return true;
    }
    await sb.from('bot_user_preferences').update({
      bankroll_size: num,
      onboarding_step: 'awaiting_risk',
    }).eq('chat_id', chatId);
    await sendRiskQuestion(sb, botToken, chatId);
    return true;
  }

  // Ignore free text in button-only steps; re-prompt
  if (prefs.onboarding_step === 'awaiting_bet_type') {
    await sendBetTypeQuestion(sb, botToken, chatId);
    return true;
  }
  if (prefs.onboarding_step === 'awaiting_sports') {
    const { data } = await sb.from('bot_user_preferences')
      .select('pending_sports').eq('chat_id', chatId).maybeSingle();
    await sendSportsQuestion(sb, botToken, chatId, data?.pending_sports || []);
    return true;
  }
  if (prefs.onboarding_step === 'awaiting_risk') {
    await sendRiskQuestion(sb, botToken, chatId);
    return true;
  }

  return false;
}
