import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Create Supabase client
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

// ==================== AUTHORIZATION HELPERS ====================

async function isAuthorized(chatId: string): Promise<boolean> {
  const { data } = await supabase
    .from("bot_authorized_users")
    .select("is_active")
    .eq("chat_id", chatId)
    .eq("is_active", true)
    .maybeSingle();
  return !!data;
}

async function tryPasswordAuth(chatId: string, password: string, username?: string): Promise<{ success: boolean; message: string }> {
  // Check if password matches any active password
  const { data: pwRecord } = await supabase
    .from("bot_access_passwords")
    .select("*")
    .eq("password", password.trim())
    .eq("is_active", true)
    .maybeSingle();

  if (!pwRecord) {
    return { success: false, message: "❌ Invalid password. Contact admin for access." };
  }

  // Check max uses
  if (pwRecord.max_uses !== null && pwRecord.times_used >= pwRecord.max_uses) {
    return { success: false, message: "❌ This password has reached its usage limit. Contact admin for a new one." };
  }

  // Increment usage
  await supabase
    .from("bot_access_passwords")
    .update({ times_used: pwRecord.times_used + 1 })
    .eq("id", pwRecord.id);

  // Add user to authorized users
  await supabase.from("bot_authorized_users").upsert({
    chat_id: chatId,
    username: username || null,
    authorized_by: "password",
    is_active: true,
  }, { onConflict: "chat_id" });

  await logActivity("user_authorized", `User ${chatId} authorized via password`, { chatId, username });

  return { success: true, message: `✅ *Access Granted!*\n\nWelcome to Parlay Farm! 🌾\n\nUse /start to see your commands.` };
}

// Admin command handlers for user management

async function handleSetPassword(chatId: string, args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  if (!parts[0]) return "Usage: /setpassword [password] [max_uses]\nExample: /setpassword farm2024 10";

  const password = parts[0];
  const maxUses = parts[1] ? parseInt(parts[1]) : null;

  await supabase.from("bot_access_passwords").insert({
    password,
    created_by: chatId,
    max_uses: maxUses,
  });

  return `✅ Password created!\n\n*Password:* \`${password}\`\n*Max uses:* ${maxUses || 'unlimited'}`;
}

async function handleGrantAccess(chatId: string, args: string): Promise<string> {
  const targetChatId = args.trim();
  if (!targetChatId) return "Usage: /grantaccess [chat_id]";

  await supabase.from("bot_authorized_users").upsert({
    chat_id: targetChatId,
    authorized_by: "admin_grant",
    is_active: true,
  }, { onConflict: "chat_id" });

  await logActivity("admin_grant_access", `Admin granted access to ${targetChatId}`, { chatId, targetChatId });
  return `✅ Access granted to chat ID: ${targetChatId}`;
}

async function handleListUsers(chatId: string): Promise<string> {
  const { data: users } = await supabase
    .from("bot_authorized_users")
    .select("*")
    .order("authorized_at", { ascending: false })
    .limit(50);

  if (!users || users.length === 0) return "No authorized users found.";

  const active = users.filter(u => u.is_active);
  const revoked = users.filter(u => !u.is_active);

  let msg = `👥 *Authorized Users* (${active.length} active)\n\n`;
  active.slice(0, 20).forEach(u => {
    const name = u.username ? `@${u.username}` : u.chat_id;
    const method = u.authorized_by === 'grandfathered' ? '👴' : u.authorized_by === 'password' ? '🔑' : '✋';
    msg += `${method} ${name} (${u.chat_id})\n`;
  });
  if (active.length > 20) msg += `... and ${active.length - 20} more\n`;
  if (revoked.length > 0) msg += `\n🚫 ${revoked.length} revoked`;

  return msg;
}

async function handleRevokeAccess(chatId: string, args: string): Promise<string> {
  const targetChatId = args.trim();
  if (!targetChatId) return "Usage: /revokeaccess [chat_id]";

  await supabase
    .from("bot_authorized_users")
    .update({ is_active: false })
    .eq("chat_id", targetChatId);

  await logActivity("admin_revoke_access", `Admin revoked access for ${targetChatId}`, { chatId, targetChatId });
  return `🚫 Access revoked for chat ID: ${targetChatId}`;
}

// EST-aware date helper to avoid UTC date mismatch after 7 PM EST
function getEasternDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function getEasternDateDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

// Helper: Send message via Telegram API with optional inline keyboard
async function sendMessage(chatId: string, text: string, parseMode = "Markdown", replyMarkup?: any) {
  const payload: any = {
    chat_id: chatId,
    text,
    parse_mode: parseMode,
  };
  if (replyMarkup) payload.reply_markup = replyMarkup;

  const response = await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  // If Markdown parsing fails, retry without parse_mode
  if (!result.ok && result.description?.includes('parse') && parseMode) {
    console.warn('[Telegram] Markdown parse failed, retrying as plain text');
    const fallbackPayload: any = { chat_id: chatId, text };
    if (replyMarkup) fallbackPayload.reply_markup = replyMarkup;
    const fallback = await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fallbackPayload),
    });
    return fallback.json();
  }
  return result;
}

// Helper: Send long messages split by Telegram 4096 char limit
async function sendLongMessage(chatId: string, text: string, parseMode = "Markdown") {
  if (text.length <= 4096) {
    return sendMessage(chatId, text, parseMode);
  }
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= 4096) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf('\n', 4096);
    if (splitAt < 100) splitAt = 4096;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }
  for (const chunk of chunks) {
    await sendMessage(chatId, chunk, parseMode);
  }
}

// Helper: Answer callback query
async function answerCallbackQuery(callbackQueryId: string, text?: string) {
  await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
  });
}

// Helper: Log activity to bot_activity_log
async function logActivity(
  eventType: string,
  message: string,
  metadata: Record<string, unknown> = {},
  severity: string = "info"
) {
  try {
    await supabase.from("bot_activity_log").insert({
      event_type: eventType,
      message,
      metadata,
      severity,
    });
  } catch (error) {
    console.error("Failed to log activity:", error);
  }
}

// Helper: Save conversation message
async function saveConversation(
  chatId: string,
  role: "user" | "assistant",
  content: string
) {
  try {
    await supabase.from("bot_conversations").insert({
      telegram_chat_id: chatId,
      role,
      content,
    });
  } catch (error) {
    console.error("Failed to save conversation:", error);
  }
}

// Helper: Get recent conversation history
async function getConversationHistory(chatId: string, limit: number = 10) {
  const { data } = await supabase
    .from("bot_conversations")
    .select("role, content")
    .eq("telegram_chat_id", chatId)
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data || []).reverse();
}

// Data fetching functions for AI tools
async function getStatus() {
  // Match desktop: get latest entry regardless of date
  const { data: activation } = await supabase
    .from("bot_activation_status")
    .select("*")
    .order("check_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: recentDays } = await supabase
    .from("bot_activation_status")
    .select("is_profitable_day, daily_profit_loss")
    .order("check_date", { ascending: false })
    .limit(7);

  const streak =
    recentDays?.filter((d) => d.is_profitable_day).length || 0;
  const mode = activation?.is_real_mode_ready ? "Real" : "Simulation";
  const bankroll = activation?.is_real_mode_ready
    ? activation?.real_bankroll
    : activation?.simulated_bankroll;

  return {
    mode,
    streak,
    bankroll: bankroll || 1000,
    isReady: activation?.is_real_mode_ready || false,
    consecutiveProfitableDays: activation?.consecutive_profitable_days || 0,
  };
}

async function getParlays() {
  const today = getEasternDate();

  const { data: parlays } = await supabase
    .from("bot_daily_parlays")
    .select("*")
    .eq("parlay_date", today)
    .order("created_at", { ascending: false });

  if (!parlays || parlays.length === 0) {
    return { count: 0, parlays: [], distribution: {} };
  }

  // Show ALL of today's parlays (no batch filter)
  const allToday = parlays;

  const distribution: Record<number, number> = {};
  allToday.forEach((p) => {
    const legCount = p.leg_count || 3;
    distribution[legCount] = (distribution[legCount] || 0) + 1;
  });

  const tierGroups: Record<string, typeof allToday> = { exploration: [], validation: [], execution: [] };
  allToday.forEach((p) => {
    const tier = classifyTier(p.strategy_name);
    tierGroups[tier].push(p);
  });

  const tierSummary: Record<string, { count: number; topParlays: Array<{ id: string; strategy: string; legs: number; odds: number; outcome: string | null }> }> = {};
  for (const [tier, group] of Object.entries(tierGroups)) {
    if (group.length === 0) continue;
    tierSummary[tier] = {
      count: group.length,
      topParlays: group.slice(0, 2).map((p) => ({
        id: p.id,
        strategy: p.strategy_name,
        legs: p.leg_count,
        odds: p.expected_odds,
        outcome: p.outcome,
      })),
    };
  }

  return {
    count: allToday.length,
    parlays: allToday.slice(0, 5).map((p) => ({
      id: p.id,
      strategy: p.strategy_name,
      legs: p.leg_count,
      odds: p.expected_odds,
      outcome: p.outcome,
    })),
    distribution,
    tierSummary,
  };
}

// Shared tier classification helper
function classifyTier(strategyName: string | null): string {
  const name = (strategyName || '').toLowerCase();
  if (name.includes('validation') || name.includes('validated') || name.includes('proving')) {
    return 'validation';
  }
  if (name.includes('execution') || name.includes('elite') || name.includes('cash_lock') ||
      name.includes('boosted_cash') || name.includes('golden_lock') || name.includes('hybrid_exec') ||
      name.includes('team_exec') || name.includes('mispriced') || name.includes('conviction') ||
      name.startsWith('force_')) {
    return 'execution';
  }
  return 'exploration';
}

async function getPerformance() {
  // Exclude voided parlays to match desktop
  const { data: settled } = await supabase
    .from("bot_daily_parlays")
    .select("outcome, profit_loss, expected_odds")
    .in("outcome", ["won", "lost"]);

  if (!settled || settled.length === 0) {
    return { winRate: 0, roi: 0, totalSettled: 0, wins: 0, losses: 0, totalProfit: 0 };
  }

  const wins = settled.filter((p) => p.outcome === "won").length;
  const losses = settled.filter((p) => p.outcome === "lost").length;
  const totalProfit = settled.reduce((sum, p) => sum + (p.profit_loss || 0), 0);
  const totalStaked = settled.reduce((sum, p) => sum + (p.simulated_stake || 10), 0);

  return {
    winRate: settled.length > 0 ? (wins / settled.length) * 100 : 0,
    roi: totalStaked > 0 ? (totalProfit / totalStaked) * 100 : 0,
    totalSettled: settled.length,
    wins,
    losses,
    totalProfit,
  };
}

async function getWeights() {
  const { data: weights } = await supabase
    .from("bot_category_weights")
    .select("category, side, weight, current_hit_rate, total_picks")
    .eq("is_blocked", false)
    .order("weight", { ascending: false })
    .limit(10);

  return weights || [];
}

// AI-powered natural language handler
async function handleNaturalLanguage(
  message: string,
  chatId: string
): Promise<string> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) {
    return "AI features are not configured. Use /status, /parlays, or /performance commands instead.";
  }

  const history = await getConversationHistory(chatId, 6);

  const [status, parlays, performance, weights, pendingLegsRes] = await Promise.all([
    getStatus(),
    getParlays(),
    getPerformance(),
    getWeights(),
    supabase.from("bot_daily_parlays").select("legs").eq("parlay_date", getEasternDate()).eq("outcome", "pending").limit(10),
  ]);

  // Extract real pending legs for the AI to reference
  const seenLegKeys = new Set<string>();
  const realLegs: string[] = [];
  for (const p of (pendingLegsRes.data || [])) {
    const legs = Array.isArray(p.legs) ? p.legs : JSON.parse(p.legs || '[]');
    for (const leg of legs) {
      if (leg.type === 'team') continue;
      const key = `${(leg.player_name || '').toLowerCase()}_${leg.prop_type}_${leg.side}`;
      if (seenLegKeys.has(key)) continue;
      seenLegKeys.add(key);
      const side = (leg.side || 'over').toUpperCase();
      const line = leg.line || leg.selected_line || '?';
      const propType = leg.prop_type ? leg.prop_type.toUpperCase() : '';
      realLegs.push(`${leg.player_name || 'Unknown'} ${side} ${line} ${propType}`);
      if (realLegs.length >= 5) break;
    }
    if (realLegs.length >= 5) break;
  }

  const pendingLegsContext = realLegs.length > 0
    ? `- Top Pending Legs (REAL DATA - do NOT make up player names):\n${realLegs.map((l, i) => `  ${i + 1}. ${l}`).join('\n')}`
    : '- No pending legs today';

  const systemPrompt = `You are ParlayIQ Bot, an autonomous sports betting bot assistant running on Telegram.
You help users check parlay status, performance, and give recommendations.

CURRENT DATA:
- Mode: ${status.mode} (${status.consecutiveProfitableDays} profitable days streak, need 3 for Real Mode)
- Bankroll: $${status.bankroll?.toFixed(0) || "1,000"}
- Today's Parlays: ${parlays.count} generated
- Distribution: ${Object.entries(parlays.distribution)
    .map(([legs, count]) => `${legs}-leg: ${count}`)
    .join(", ") || "None"}
- Performance: ${performance.winRate.toFixed(1)}% win rate, ${performance.roi.toFixed(1)}% ROI
- Settled: ${performance.wins}W - ${performance.losses}L (${performance.totalSettled} total)
- Top Weights: ${weights
    .slice(0, 3)
    .map((w) => `${w.category} ${w.side}: ${(w.weight * 100).toFixed(0)}%`)
    .join(", ") || "None learned yet"}
${pendingLegsContext}

CRITICAL RULES:
- NEVER invent or guess player names. Only mention players listed in "Top Pending Legs" above.
- If you don't have specific player data, say "use /parlay to see today's actual legs" instead of guessing.
- Keep responses concise for Telegram (under 500 chars when possible)
- Use Telegram Markdown formatting (*bold*, _italic_)
- Use emojis for visual appeal
- Be helpful and conversational`;

  const messages = [
    { role: "system" as const, content: systemPrompt },
    ...history.map((h) => ({
      role: h.role as "user" | "assistant",
      content: h.content,
    })),
    { role: "user" as const, content: message },
  ];

  try {
    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages,
          max_tokens: 500,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      return "I'm having trouble thinking right now. Try using /status or /parlays commands.";
    }

    const data = await response.json();
    const aiResponse =
      data.choices?.[0]?.message?.content ||
      "I couldn't generate a response. Try a command like /status.";

    return aiResponse;
  } catch (error) {
    console.error("AI request failed:", error);
    return "Something went wrong. Use /status, /parlays, or /performance for quick updates.";
  }
}

// ==================== COMMAND HANDLERS ====================

async function handleCalendar(chatId: string) {
  await logActivity("telegram_calendar", `User requested P&L calendar`, { chatId });

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const monthStart = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month + 1, 0).getDate();
  const monthEnd = `${year}-${String(month + 1).padStart(2, '0')}-${lastDay}`;

  const { data: days } = await supabase
    .from('bot_activation_status')
    .select('check_date, daily_profit_loss, is_profitable_day, parlays_won, parlays_lost, simulated_bankroll')
    .gte('check_date', monthStart)
    .lte('check_date', monthEnd)
    .order('check_date', { ascending: true });

  if (!days || days.length === 0) {
    return `📅 *${new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(now)} P&L*\n\nNo data recorded yet this month.`;
  }

  const totalPnL = days.reduce((s, d) => s + (d.daily_profit_loss || 0), 0);
  const winDays = days.filter(d => d.is_profitable_day).length;
  const lossDays = days.filter(d => !d.is_profitable_day && (d.daily_profit_loss || 0) !== 0).length;
  const totalDays = winDays + lossDays;
  const winPct = totalDays > 0 ? ((winDays / totalDays) * 100).toFixed(0) : '0';

  let bestDay = days[0];
  let worstDay = days[0];
  let streak = 0;
  let bestStreak = 0;
  days.forEach(d => {
    if ((d.daily_profit_loss || 0) > (bestDay.daily_profit_loss || 0)) bestDay = d;
    if ((d.daily_profit_loss || 0) < (worstDay.daily_profit_loss || 0)) worstDay = d;
    if (d.is_profitable_day) { streak++; bestStreak = Math.max(bestStreak, streak); }
    else { streak = 0; }
  });
  const currentStreak = streak;

  const lastBankroll = days[days.length - 1].simulated_bankroll || 0;
  const monthName = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(now);
  const bestDate = new Date(bestDay.check_date + 'T12:00:00');
  const worstDate = new Date(worstDay.check_date + 'T12:00:00');
  const fmtDate = (d: Date) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(d);
  const fmtPnL = (v: number) => v >= 0 ? `+$${v.toFixed(0)}` : `-$${Math.abs(v).toFixed(0)}`;

  return `📅 *${monthName} P&L*

*Record:* ${winDays}W - ${lossDays}L (${winPct}%)
*Total P&L:* ${fmtPnL(totalPnL)}
*Best Day:* ${fmtDate(bestDate)} (${fmtPnL(bestDay.daily_profit_loss || 0)})
*Worst Day:* ${fmtDate(worstDate)} (${fmtPnL(worstDay.daily_profit_loss || 0)})
*Current Streak:* ${currentStreak}W
*Best Streak:* ${bestStreak}W
*Bankroll:* $${lastBankroll.toLocaleString()}`;
}

async function handleStart(chatId: string) {
  await logActivity("telegram_start", `User started bot chat`, { chatId });

  return `🤖 *ParlayIQ Bot v3*

*Core:*
/status /parlays /parlay /performance /weights /calendar

*Actions:*
/generate /settle /force-settle [date]
/mispriced /highconv /doubleconfirmed /forcegen

*Analytics:*
/roi /streaks /compare /sharp /avoid /backtest [strategy]

*Learning:*
/learning /tiers /explore /validate

*Multi-Sport:*
/nhl /tennis /spreads /totals
/mlb /pitcherk /runmlbbatter

*Intelligence:*
/research /watch [player]

*Control:*
/pause /resume /bankroll [amt] /subscribe /export [date]

*Management:*
/deleteparlay [id] /voidtoday /fixleg
/deletesweep /deletebystrat [name]
/fixpipeline /regenparlay /fixprops
/healthcheck /errorlog /broadcast

Or *ask me anything* naturally!`;
}

async function handleStatus(chatId: string) {
  await logActivity("telegram_status", `User requested status`, { chatId });

  const status = await getStatus();
  const parlays = await getParlays();

  // Check pause state
  const { data: pauseEvent } = await supabase
    .from("bot_activity_log")
    .select("event_type")
    .in("event_type", ["bot_paused", "bot_resumed"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const isPaused = pauseEvent?.event_type === "bot_paused";

  return `📊 *Bot Status*

*Mode:* ${status.mode === "Real" ? "🟢 Real" : "🟡 Simulation"}${isPaused ? " ⏸ PAUSED" : ""}
*Streak:* ${status.consecutiveProfitableDays}/3 profitable days
*Bankroll:* $${status.bankroll?.toFixed(0) || "1,000"}

*Today's Parlays:* ${parlays.count} generated
${Object.entries(parlays.distribution)
  .map(([legs, count]) => `• ${legs}-Leg: ${count}`)
  .join("\n") || "• None yet"}

${
  status.isReady
    ? "✅ Bot is ready for real betting!"
    : `⏳ ${3 - status.consecutiveProfitableDays} more profitable day(s) needed`
}`;
}

async function handleParlays(chatId: string, page = 1) {
  await logActivity("telegram_parlays", `User requested parlays page ${page}`, { chatId });

  const today = getEasternDate();
  const PARLAYS_PER_PAGE = 5;
  
  // Fetch ALL of today's parlays (no batch filter)
  const { data: allParlays } = await supabase
    .from("bot_daily_parlays")
    .select("*")
    .eq("parlay_date", today)
    .order("created_at", { ascending: false });

  if (!allParlays || allParlays.length === 0) {
    return "📭 No parlays generated today yet.\n\nUse /generate to create new parlays!";
  }

  // Group by tier using shared classifier
  const tierGroups: Record<string, typeof allParlays> = { execution: [], validation: [], exploration: [] };
  allParlays.forEach((p) => {
    const tier = classifyTier(p.strategy_name);
    tierGroups[tier].push(p);
  });

  // Flatten in tier order for pagination
  const orderedParlays = [
    ...tierGroups.execution,
    ...tierGroups.validation,
    ...tierGroups.exploration,
  ];

  const totalParlays = orderedParlays.length;
  const totalPages = Math.ceil(totalParlays / PARLAYS_PER_PAGE);
  const safePage = Math.max(1, Math.min(page, totalPages));
  const startIdx = (safePage - 1) * PARLAYS_PER_PAGE;
  const endIdx = Math.min(startIdx + PARLAYS_PER_PAGE, totalParlays);
  const pageParlays = orderedParlays.slice(startIdx, endIdx);

  const tierLabels: Record<string, string> = {
    exploration: '🔬 Exploration',
    validation: '✅ Validation',
    execution: '💰 Execution',
  };

  // Header with counts
  const tierCounts = Object.entries(tierGroups)
    .filter(([_, g]) => g.length > 0)
    .map(([t, g]) => `${tierLabels[t]}: ${g.length}`)
    .join(' | ');

  let message = `🎯🔥 *TODAY'S PARLAYS* 🔥🎯\n`;
  message += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  message += `Showing ${startIdx + 1}-${endIdx} of ${totalParlays} parlays\n`;
  message += `${tierCounts}\n\n`;

  // Track which tier label we last printed
  let lastTier = '';
  for (let i = 0; i < pageParlays.length; i++) {
    const p = pageParlays[i];
    const tier = classifyTier(p.strategy_name);
    if (tier !== lastTier) {
      const tierStake = p.simulated_stake ? `$${p.simulated_stake} stake` : 'simulated';
      message += `${tierLabels[tier]} — _${tierStake}_\n\n`;
      lastTier = tier;
    }

    const globalIdx = startIdx + i + 1;
    const outcomeEmoji = p.outcome === 'won' ? '✅' : p.outcome === 'lost' ? '❌' : '⏳';
    const oddsStr = p.expected_odds > 0 ? `+${p.expected_odds}` : `${p.expected_odds}`;
    message += `  ${globalIdx}. 🎲 (${p.leg_count}-leg) ${oddsStr} ${outcomeEmoji}\n`;
    
    const legs = Array.isArray(p.legs) ? p.legs : JSON.parse(p.legs || '[]');
    for (const leg of legs) {
      const legText = formatLegDisplay(leg);
      const legLines = legText.split('\n');
      message += `     ${legLines[0]}\n`;
      if (legLines.length > 1 && legLines[1].trim()) {
        message += `     ${legLines[1]}\n`;
      }
    }
    
    const avgScore = legs.reduce((s: number, l: any) => s + (l.composite_score || 0), 0) / (legs.length || 1);
    const avgHit = legs.reduce((s: number, l: any) => s + (l.hit_rate || 0), 0) / (legs.length || 1);
    if (avgScore > 0 || avgHit > 0) {
      message += `     🎯${Math.round(avgScore)} | 💎${Math.round(avgHit)}%\n`;
    }
    message += `\n`;
  }

  // Build pagination inline keyboard
  const buttons: Array<{ text: string; callback_data: string }> = [];
  if (safePage > 1) {
    buttons.push({ text: `< Prev ${PARLAYS_PER_PAGE}`, callback_data: `parlays_page:${safePage - 1}` });
  }
  if (safePage < totalPages) {
    buttons.push({ text: `Next ${PARLAYS_PER_PAGE} >`, callback_data: `parlays_page:${safePage + 1}` });
  }

  const replyMarkup = buttons.length > 0 ? { inline_keyboard: [buttons] } : undefined;
  await sendLongMessage(chatId, message, "Markdown");
  // Send pagination buttons as a separate small message if needed
  if (replyMarkup) {
    await sendMessage(chatId, `📄 Page ${safePage}/${totalPages}`, "Markdown", replyMarkup);
  }
  return null; // Already sent
}

async function handlePerformance(chatId: string) {
  await logActivity("telegram_performance", `User requested performance`, { chatId });

  const perf = await getPerformance();

  return `📈 *Performance Stats*

*Win Rate:* ${perf.winRate.toFixed(1)}%
*ROI:* ${perf.roi >= 0 ? "+" : ""}${perf.roi.toFixed(1)}%

*Record:* ${perf.wins}W - ${perf.losses}L
*Total Settled:* ${perf.totalSettled} parlays
*Net Profit:* ${perf.totalProfit >= 0 ? "+" : ""}$${perf.totalProfit.toFixed(0)}`;
}

async function handleWeights(chatId: string) {
  await logActivity("telegram_weights", `User requested weights`, { chatId });

  const weights = await getWeights();

  if (weights.length === 0) {
    return "📊 No category weights learned yet.\n\nThe bot will learn from settled parlays!";
  }

  let message = `⚖️ *Top Category Weights*\n\n`;

  weights.slice(0, 8).forEach((w, i) => {
    // current_hit_rate is already stored as a percentage (e.g. 64.1)
    const hitRate = w.current_hit_rate !== null && w.current_hit_rate !== undefined
      ? `(${w.current_hit_rate.toFixed(0)}% hit)`
      : "";
    message += `${i + 1}. *${w.category}* ${w.side}\n`;
    message += `   Weight: ${((w.weight || 1) * 100).toFixed(0)}% ${hitRate}\n`;
  });

  return message;
}

async function handleGenerate(chatId: string) {
  // Check if bot is paused
  const { data: pauseEvent } = await supabase
    .from("bot_activity_log")
    .select("event_type")
    .in("event_type", ["bot_paused", "bot_resumed"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pauseEvent?.event_type === "bot_paused") {
    return "⏸ Bot is *paused*. Use /resume to re-enable generation.";
  }

  await logActivity("telegram_generate", `User triggered generation`, { chatId });

  try {
    const response = await fetch(
      `${Deno.env.get("SUPABASE_URL")}/functions/v1/bot-generate-daily-parlays`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      }
    );

    if (!response.ok) {
      throw new Error(`Generation failed: ${response.status}`);
    }

    const result = await response.json();
    const count = result.parlays?.length || result.totalParlays || 0;

    return `✅ *Generation Complete!*\n\n${count} parlays created.\n\nUse /parlays to view them.`;
  } catch (error) {
    console.error("Generation error:", error);
    return "❌ Generation failed. Please try again later or check the dashboard.";
  }
}

async function handleSettle(chatId: string) {
  await logActivity("telegram_settle", `User triggered settlement`, { chatId });

  try {
    const response = await fetch(
      `${Deno.env.get("SUPABASE_URL")}/functions/v1/bot-settle-and-learn`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      }
    );

    if (!response.ok) {
      throw new Error(`Settlement failed: ${response.status}`);
    }

    const result = await response.json();

    // Auto-research trigger: check 7-day rolling win rate
    try {
      const sevenDaysAgo = getEasternDateDaysAgo(7);
      const { data: recentParlays } = await supabase
        .from("bot_daily_parlays")
        .select("outcome")
        .not("outcome", "is", null)
        .gte("parlay_date", sevenDaysAgo);

      if (recentParlays && recentParlays.length >= 10) {
        const wins7d = recentParlays.filter(p => p.outcome === "won").length;
        const winRate7d = wins7d / recentParlays.length;
        if (winRate7d < 0.35) {
          console.log(`[AutoResearch] 7d win rate ${(winRate7d * 100).toFixed(1)}% < 35%, triggering research`);
          await sendMessage(chatId, `⚠️ 7-day win rate at ${(winRate7d * 100).toFixed(1)}% — auto-triggering research agent...`);
          supabase.functions.invoke('ai-research-agent').catch(e => console.error('[AutoResearch] Error:', e));
        }
      }
    } catch (e) {
      console.error('[AutoResearch] Check failed:', e);
    }

    return `✅ *Settlement Complete!*\n\n${
      result.summary ||
      `Settled ${result.settledCount || 0} parlays.\nProfit/Loss: ${
        result.totalProfitLoss >= 0 ? "+" : ""
      }$${result.totalProfitLoss?.toFixed(0) || 0}`
    }\n\nUse /performance to see updated stats.`;
  } catch (error) {
    console.error("Settlement error:", error);
    return "❌ Settlement failed. Please try again later or check the dashboard.";
  }
}

// Sport key to human-readable label
function getSportLabel(sport: string): string {
  const labels: Record<string, string> = {
    'basketball_nba': 'NBA', 'basketball_ncaab': 'NCAAB', 'icehockey_nhl': 'NHL',
    'baseball_mlb': 'MLB', 'baseball_ncaa': 'NCAA BB', 'americanfootball_nfl': 'NFL',
    'tennis_atp': 'ATP', 'tennis_wta': 'WTA', 'tennis_pingpong': 'Table Tennis',
    'golf_pga': 'PGA', 'hockey_nhl': 'NHL',
  };
  return labels[sport] || sport?.replace(/^[a-z]+_/, '').toUpperCase() || '';
}

// Source/reason to human-readable label
function getSourceLabel(source?: string, reason?: string): string {
  const labels: Record<string, string> = {
    'whale_signal': 'Whale Signal', 'projection_gap': 'Projection Edge',
    'alternate_line': 'Alt Line Shop', 'main_line': 'Main Line',
    'single_pick': 'Single Pick', 'projected': 'Projection',
    'synthetic_dry_run': 'Synthetic', 'consensus': 'Consensus',
  };
  if (source && labels[source]) return labels[source];
  if (reason && labels[reason]) return labels[reason];
  return source || reason || '';
}

// Format a parlay leg for display in Telegram — action-first with reasoning
function formatLegDisplay(leg: any): string {
  const odds = leg.american_odds ? (leg.american_odds > 0 ? `(+${leg.american_odds})` : `(${leg.american_odds})`) : '';
  const sportLabel = getSportLabel(leg.sport);
  
  let actionLine = '';
  let matchupLine = '';
  let betIcon = '🏀';
  
  // Detect team-based legs: explicit type='team' OR player_name contains " @ " with spread/total/h2h prop_type
  const category = (leg.category || '').toUpperCase();
  const propTypeLower = (leg.prop_type || '').toLowerCase();
  const isTeamLeg = leg.type === 'team' || 
    (!leg.type && (category === 'SPREAD' || category === 'TOTAL' || category === 'MONEYLINE' ||
     propTypeLower === 'spread' || propTypeLower === 'total' || propTypeLower === 'h2h' || propTypeLower === 'moneyline') &&
     leg.player_name && leg.player_name.includes(' @ '));
  
  if (isTeamLeg) {
    let away = leg.away_team || '';
    let home = leg.home_team || '';
    // Parse from player_name if missing
    if ((!away || !home) && leg.player_name && leg.player_name.includes(' @ ')) {
      const parts = leg.player_name.split(' @ ');
      away = parts[0]?.trim() || away;
      home = parts[1]?.trim() || home;
    }
    const betType = (leg.bet_type || leg.prop_type || '').toLowerCase();
    
    if (betType.includes('total') || category === 'TOTAL') {
      const side = (leg.side || 'over').toUpperCase();
      actionLine = `📈 Take ${side} ${leg.line} ${odds}`;
      betIcon = '📈';
    } else if (betType.includes('spread') || category === 'SPREAD') {
      const teamName = leg.side === 'home' ? home : away;
      const line = leg.line > 0 ? `+${leg.line}` : `${leg.line}`;
      actionLine = `📊 Take ${teamName} ${line} ${odds}`;
      betIcon = '📊';
    } else if (betType.includes('moneyline') || betType.includes('h2h') || category === 'MONEYLINE') {
      const teamName = leg.side === 'home' ? home : away;
      actionLine = `💎 Take ${teamName} ML ${odds}`;
      betIcon = '💎';
    } else {
      const sideLabel = leg.side === 'home' ? home : leg.side === 'away' ? away : (leg.side || '').toUpperCase();
      actionLine = `📊 Take ${sideLabel} ${leg.line || ''} ${odds}`;
    }
    matchupLine = `${away} @ ${home}`;
  } else {
    // Player prop
    const propLabels: Record<string, string> = {
      threes: '3PT', points: 'PTS', assists: 'AST', rebounds: 'REB',
      steals: 'STL', blocks: 'BLK', turnovers: 'TO', pra: 'PRA',
      pts_rebs: 'P+R', pts_asts: 'P+A', rebs_asts: 'R+A',
      three_pointers_made: '3PT', fantasy_score: 'FPTS',
      goals: 'G', assists_nhl: 'A', shots: 'SOG', saves: 'SVS',
      aces: 'ACES', games: 'GAMES',
    };
    const name = leg.player_name || 'Player';
    const side = (leg.side || 'over').toUpperCase();
    const line = leg.line || leg.selected_line || '';
    const propType = propLabels[leg.prop_type] || (leg.prop_type || '').toUpperCase();
    actionLine = `🏀 Take ${name} ${side} ${line} ${propType} ${odds}`;
    matchupLine = leg.matchup || '';
  }
  
  // Build compact reasoning line with icons
  const score = leg.composite_score ? Math.round(leg.composite_score) : 0;
  const hitRate = leg.hit_rate ? Math.round(leg.hit_rate) : 0;
  const source = (leg.source || leg.reason || '').toLowerCase();
  const opponent = leg.opponent_name || leg.opponent || '';
  const defRank = leg.opponent_defense_rank || leg.defense_rank || null;
  
  // Status emoji
  let statusEmoji = '';
  if (score >= 80) statusEmoji = '🔥';
  else if (score >= 60 && hitRate >= 70) statusEmoji = '✨';
  if (hitRate < 50 || score < 40) statusEmoji = '⚠️';
  if (source.includes('whale')) statusEmoji = '🐋';
  
  // Compact icon line: 🎯85 | 💎75% | vs LAL (#3 DEF) 🔥
  const compactParts: string[] = [];
  if (score) compactParts.push(`🎯${score}`);
  if (hitRate) compactParts.push(`💎${hitRate}%`);
  if (opponent) {
    const defStr = defRank ? ` (#${defRank} DEF)` : '';
    compactParts.push(`vs ${opponent}${defStr}`);
  } else if (defRank) {
    compactParts.push(`#${defRank} DEF`);
  }
  if (statusEmoji) compactParts.push(statusEmoji);
  
  let result = actionLine.trim();
  if (matchupLine && sportLabel) {
    result += `\n  ${matchupLine} | ${sportLabel}`;
  } else if (matchupLine) {
    result += `\n  ${matchupLine}`;
  }
  if (compactParts.length > 0) {
    result += `\n  ${compactParts.join(' | ')}`;
  }
  
  return result;
}

// ==================== CUSTOMER PERSONAL DATA ====================

async function handleCustomerCalendar(chatId: string) {
  await logActivity("telegram_customer_calendar", `Customer requested personal calendar`, { chatId });

  const { data: authUser } = await supabase
    .from("bot_authorized_users")
    .select("authorized_at")
    .eq("chat_id", chatId)
    .maybeSingle();

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const monthStart = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month + 1, 0).getDate();
  const monthEnd = `${year}-${String(month + 1).padStart(2, '0')}-${lastDay}`;

  const { data: days } = await supabase
    .from('customer_daily_pnl')
    .select('pnl_date, daily_profit_loss, parlays_won, parlays_lost, parlays_total')
    .eq('chat_id', chatId)
    .gte('pnl_date', monthStart)
    .lte('pnl_date', monthEnd)
    .order('pnl_date', { ascending: true });

  const monthName = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(now);
  const joinDate = authUser?.authorized_at ? new Date(authUser.authorized_at) : null;
  const joinStr = joinDate ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(joinDate) : 'Unknown';

  if (!days || days.length === 0) {
    return `📅 *${monthName} — Your P&L*\n\n📆 Member since: ${joinStr}\n\nNo results recorded yet this month. Your data will appear here as parlays settle!`;
  }

  const totalPnL = days.reduce((s, d) => s + (d.daily_profit_loss || 0), 0);
  const winDays = days.filter(d => (d.daily_profit_loss || 0) > 0).length;
  const lossDays = days.filter(d => (d.daily_profit_loss || 0) < 0).length;
  const totalDays = winDays + lossDays;
  const winPct = totalDays > 0 ? ((winDays / totalDays) * 100).toFixed(0) : '0';

  let bestDay = days[0];
  let worstDay = days[0];
  days.forEach(d => {
    if ((d.daily_profit_loss || 0) > (bestDay.daily_profit_loss || 0)) bestDay = d;
    if ((d.daily_profit_loss || 0) < (worstDay.daily_profit_loss || 0)) worstDay = d;
  });

  const fmtDate = (dateStr: string) => {
    const d = new Date(dateStr + 'T12:00:00');
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(d);
  };
  const fmtPnL = (v: number) => v >= 0 ? `+$${v.toFixed(0)}` : `-$${Math.abs(v).toFixed(0)}`;

  const totalWon = days.reduce((s, d) => s + (d.parlays_won || 0), 0);
  const totalLost = days.reduce((s, d) => s + (d.parlays_lost || 0), 0);

  return `📅 *${monthName} — Your P&L*\n\n📆 Member since: ${joinStr}\n\n*Record:* ${winDays}W - ${lossDays}L (${winPct}%)\n*Total P&L:* ${fmtPnL(totalPnL)}\n*Parlays:* ${totalWon}W - ${totalLost}L\n*Best Day:* ${fmtDate(bestDay.pnl_date)} (${fmtPnL(bestDay.daily_profit_loss || 0)})\n*Worst Day:* ${fmtDate(worstDay.pnl_date)} (${fmtPnL(worstDay.daily_profit_loss || 0)})`;
}

async function handleCustomerRoi(chatId: string) {
  await logActivity("telegram_customer_roi", "Customer requested personal ROI", { chatId });

  const [d7, d30, dAll] = await Promise.all([
    supabase.from("customer_daily_pnl").select("*").eq("chat_id", chatId).gte("pnl_date", getEasternDateDaysAgo(7)),
    supabase.from("customer_daily_pnl").select("*").eq("chat_id", chatId).gte("pnl_date", getEasternDateDaysAgo(30)),
    supabase.from("customer_daily_pnl").select("*").eq("chat_id", chatId),
  ]);

  const calcStats = (data: any[]) => {
    if (!data || data.length === 0) return { pnl: 0, won: 0, lost: 0, total: 0, days: 0 };
    const pnl = data.reduce((s: number, d: any) => s + (d.daily_profit_loss || 0), 0);
    const won = data.reduce((s: number, d: any) => s + (d.parlays_won || 0), 0);
    const lost = data.reduce((s: number, d: any) => s + (d.parlays_lost || 0), 0);
    const total = data.reduce((s: number, d: any) => s + (d.parlays_total || 0), 0);
    return { pnl, won, lost, total, days: data.length };
  };

  const s7 = calcStats(d7.data || []);
  const s30 = calcStats(d30.data || []);
  const sAll = calcStats(dAll.data || []);

  const fmtPnL = (v: number) => v >= 0 ? `+$${v.toFixed(0)}` : `-$${Math.abs(v).toFixed(0)}`;
  const winRate = (won: number, total: number) => total > 0 ? ((won / total) * 100).toFixed(1) : '0.0';

  if (sAll.days === 0) {
    return `📊 *Your ROI*\n\nNo results recorded yet. Your personal stats will appear here as parlays settle!`;
  }

  let msg = `📊 *Your ROI*\n\n`;
  msg += `*7 Day:* ${fmtPnL(s7.pnl)} | ${winRate(s7.won, s7.won + s7.lost)}% WR (${s7.won}W-${s7.lost}L)\n`;
  msg += `*30 Day:* ${fmtPnL(s30.pnl)} | ${winRate(s30.won, s30.won + s30.lost)}% WR (${s30.won}W-${s30.lost}L)\n`;
  msg += `*All-Time:* ${fmtPnL(sAll.pnl)} | ${winRate(sAll.won, sAll.won + sAll.lost)}% WR (${sAll.won}W-${sAll.lost}L)\n`;
  msg += `\n📅 Tracked over ${sAll.days} day(s)`;

  return msg;
}

// ==================== ANALYTICS COMMANDS ====================

async function handleRoi(chatId: string) {
  await logActivity("telegram_roi", "User requested ROI breakdown", { chatId });

  const [settled7d, settled30d, settledAll] = await Promise.all([
    supabase.from("bot_daily_parlays").select("strategy_name, outcome, profit_loss, expected_odds").in("outcome", ["won", "lost"]).gte("parlay_date", getEasternDateDaysAgo(7)),
    supabase.from("bot_daily_parlays").select("strategy_name, outcome, profit_loss, expected_odds").in("outcome", ["won", "lost"]).gte("parlay_date", getEasternDateDaysAgo(30)),
    supabase.from("bot_daily_parlays").select("strategy_name, outcome, profit_loss, expected_odds").in("outcome", ["won", "lost"]),
  ]);

  const calcRoi = (data: any[]) => {
    if (!data || data.length === 0) return { winRate: 0, roi: 0, count: 0 };
    const wins = data.filter(p => p.outcome === "won").length;
    const totalPL = data.reduce((s, p) => s + (p.profit_loss || 0), 0);
    return { winRate: (wins / data.length) * 100, roi: (totalPL / (data.length * 10)) * 100, count: data.length };
  };

  const r7 = calcRoi(settled7d.data || []);
  const r30 = calcRoi(settled30d.data || []);
  const rAll = calcRoi(settledAll.data || []);

  // Strategy breakdown (all-time)
  const stratMap: Record<string, { won: number; total: number; pl: number }> = {};
  (settledAll.data || []).forEach((p: any) => {
    const s = p.strategy_name || 'unknown';
    if (!stratMap[s]) stratMap[s] = { won: 0, total: 0, pl: 0 };
    stratMap[s].total++;
    if (p.outcome === 'won') stratMap[s].won++;
    stratMap[s].pl += p.profit_loss || 0;
  });

  const topStrats = Object.entries(stratMap)
    .map(([name, s]) => ({ name, winRate: (s.won / s.total) * 100, roi: (s.pl / (s.total * 10)) * 100, count: s.total }))
    .sort((a, b) => b.roi - a.roi)
    .slice(0, 5);

  // Top/bottom categories
  const { data: cats } = await supabase
    .from("bot_category_weights")
    .select("category, side, current_hit_rate, total_picks")
    .not("current_hit_rate", "is", null)
    .order("current_hit_rate", { ascending: false });

  const topCats = (cats || []).filter(c => (c.total_picks || 0) >= 5).slice(0, 3);
  const bottomCats = (cats || []).filter(c => (c.total_picks || 0) >= 5).slice(-3).reverse();

  let msg = `📊 *ROI Breakdown*\n\n`;
  msg += `*7 Day:* ${r7.winRate.toFixed(1)}% WR | ${r7.roi >= 0 ? '+' : ''}${r7.roi.toFixed(1)}% ROI (${r7.count})\n`;
  msg += `*30 Day:* ${r30.winRate.toFixed(1)}% WR | ${r30.roi >= 0 ? '+' : ''}${r30.roi.toFixed(1)}% ROI (${r30.count})\n`;
  msg += `*All-Time:* ${rAll.winRate.toFixed(1)}% WR | ${rAll.roi >= 0 ? '+' : ''}${rAll.roi.toFixed(1)}% ROI (${rAll.count})\n\n`;

  if (topStrats.length > 0) {
    msg += `*Top Strategies:*\n`;
    topStrats.forEach(s => {
      msg += `• ${s.name}: ${s.winRate.toFixed(0)}% WR, ${s.roi >= 0 ? '+' : ''}${s.roi.toFixed(0)}% ROI (${s.count})\n`;
    });
    msg += `\n`;
  }

  if (topCats.length > 0) {
    msg += `🔥 *Best Categories:*\n`;
    topCats.forEach(c => msg += `• ${c.category} ${c.side}: ${(c.current_hit_rate || 0).toFixed(0)}% hit\n`);
    msg += `\n❄️ *Worst Categories:*\n`;
    bottomCats.forEach(c => msg += `• ${c.category} ${c.side}: ${(c.current_hit_rate || 0).toFixed(0)}% hit\n`);
  }

  return msg;
}

async function handleStreaks(chatId: string) {
  await logActivity("telegram_streaks", "User requested streaks", { chatId });

  const { data: weights } = await supabase
    .from("bot_category_weights")
    .select("category, side, current_streak, best_streak, worst_streak, current_hit_rate, total_picks")
    .not("current_streak", "is", null)
    .order("current_streak", { ascending: false });

  const allWeights = weights || [];
  const hot = allWeights.filter(w => (w.current_streak || 0) > 0).slice(0, 5);
  const cold = [...allWeights].sort((a, b) => (a.current_streak || 0) - (b.current_streak || 0)).filter(w => (w.current_streak || 0) < 0).slice(0, 5);

  let msg = `🔥 *Hot Streaks*\n\n`;
  if (hot.length === 0) {
    msg += `No active hot streaks.\n\n`;
  } else {
    hot.forEach(w => {
      msg += `• *${w.category}* ${w.side}: ${w.current_streak} in a row ✅\n`;
      msg += `  Best ever: ${w.best_streak || 0} | Hit rate: ${(w.current_hit_rate || 0).toFixed(0)}%\n`;
    });
    msg += `\n`;
  }

  msg += `❄️ *Cold Streaks*\n\n`;
  if (cold.length === 0) {
    msg += `No active cold streaks.`;
  } else {
    cold.forEach(w => {
      msg += `• *${w.category}* ${w.side}: ${Math.abs(w.current_streak || 0)} misses ❌\n`;
      msg += `  Worst ever: ${w.worst_streak || 0} | Hit rate: ${(w.current_hit_rate || 0).toFixed(0)}%\n`;
    });
  }

  return msg;
}

async function handleCompare(chatId: string) {
  await logActivity("telegram_compare", "User requested period comparison", { chatId });

  const d7 = getEasternDateDaysAgo(7);
  const d30 = getEasternDateDaysAgo(30);

  const [res7, res30] = await Promise.all([
    supabase.from("bot_daily_parlays").select("strategy_name, outcome, profit_loss, expected_odds").in("outcome", ["won", "lost"]).gte("parlay_date", d7),
    supabase.from("bot_daily_parlays").select("strategy_name, outcome, profit_loss, expected_odds").in("outcome", ["won", "lost"]).gte("parlay_date", d30).lt("parlay_date", d7),
  ]);

  const analyze = (data: any[]) => {
    if (!data || data.length === 0) return { wr: 0, roi: 0, avgOdds: 0, count: 0, bestStrat: 'N/A' };
    const wins = data.filter(p => p.outcome === "won").length;
    const pl = data.reduce((s, p) => s + (p.profit_loss || 0), 0);
    const avgOdds = data.reduce((s, p) => s + (p.expected_odds || 0), 0) / data.length;
    const stratCount: Record<string, number> = {};
    data.forEach(p => { const s = p.strategy_name || 'unknown'; stratCount[s] = (stratCount[s] || 0) + (p.outcome === 'won' ? 1 : 0); });
    const bestStrat = Object.entries(stratCount).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';
    return { wr: (wins / data.length) * 100, roi: (pl / (data.length * 10)) * 100, avgOdds, count: data.length, bestStrat };
  };

  const last7 = analyze(res7.data || []);
  const prev = analyze(res30.data || []);

  const arrow = (a: number, b: number) => a > b ? '📈' : a < b ? '📉' : '➡️';

  return `📊 *7d vs Previous 23d Comparison*

| Metric | Last 7d | Prev 23d |
*Win Rate:* ${last7.wr.toFixed(1)}% ${arrow(last7.wr, prev.wr)} vs ${prev.wr.toFixed(1)}%
*ROI:* ${last7.roi >= 0 ? '+' : ''}${last7.roi.toFixed(1)}% vs ${prev.roi >= 0 ? '+' : ''}${prev.roi.toFixed(1)}%
*Avg Odds:* ${last7.avgOdds > 0 ? '+' : ''}${last7.avgOdds.toFixed(0)} vs ${prev.avgOdds > 0 ? '+' : ''}${prev.avgOdds.toFixed(0)}
*Sample:* ${last7.count} vs ${prev.count}
*Best Strategy:* ${last7.bestStrat} vs ${prev.bestStrat}`;
}

// ==================== INTELLIGENCE COMMANDS ====================

async function handleSharp(chatId: string) {
  await logActivity("telegram_sharp", "User requested sharp categories", { chatId });

  const { data: weights } = await supabase
    .from("bot_category_weights")
    .select("category, side, current_hit_rate, total_picks, weight")
    .eq("is_blocked", false)
    .not("current_hit_rate", "is", null)
    .order("current_hit_rate", { ascending: false })
    .limit(10);

  if (!weights || weights.length === 0) {
    return "🎯 *Sharp Categories*\n\nNo calibrated categories yet.";
  }

  let msg = `🎯 *Sharpest Categories*\n\n`;
  weights.forEach((w, i) => {
    const hr = w.current_hit_rate || 0;
    const samples = w.total_picks || 0;
    const isGolden = hr >= 60 && samples >= 20;
    const label = isGolden ? ' 🌟 GOLDEN' : '';
    msg += `${i + 1}. *${w.category}* ${w.side}${label}\n`;
    msg += `   ${hr.toFixed(1)}% hit | ${samples} samples | wt ${((w.weight || 1) * 100).toFixed(0)}%\n`;
  });

  const goldenCount = weights.filter(w => (w.current_hit_rate || 0) >= 60 && (w.total_picks || 0) >= 20).length;
  if (goldenCount > 0) msg += `\n🌟 ${goldenCount} golden categories (60%+ hit, 20+ samples)`;

  return msg;
}

async function handleAvoid(chatId: string) {
  await logActivity("telegram_avoid", "User requested blocked categories", { chatId });

  const [blocked, nearBlock] = await Promise.all([
    supabase.from("bot_category_weights").select("category, side, block_reason, current_hit_rate, total_picks").eq("is_blocked", true).order("current_hit_rate", { ascending: true }),
    supabase.from("bot_category_weights").select("category, side, current_hit_rate, total_picks").eq("is_blocked", false).not("current_hit_rate", "is", null).gte("total_picks", 5).lte("current_hit_rate", 45).order("current_hit_rate", { ascending: true }).limit(5),
  ]);

  let msg = `🚫 *Blocked Categories*\n\n`;

  if (!blocked.data || blocked.data.length === 0) {
    msg += `No categories currently blocked.\n\n`;
  } else {
    blocked.data.forEach(b => {
      msg += `• *${b.category}* ${b.side}\n`;
      msg += `  ${(b.current_hit_rate || 0).toFixed(0)}% hit (${b.total_picks || 0} samples)\n`;
      if (b.block_reason) msg += `  Reason: ${b.block_reason}\n`;
    });
    msg += `\n`;
  }

  if (nearBlock.data && nearBlock.data.length > 0) {
    msg += `⚠️ *Near Block Threshold (40-45%):*\n`;
    nearBlock.data.forEach(n => {
      msg += `• ${n.category} ${n.side}: ${(n.current_hit_rate || 0).toFixed(0)}% (${n.total_picks || 0} samples)\n`;
    });
  }

  return msg;
}

async function handleBacktest(chatId: string, strategyInput: string) {
  await logActivity("telegram_backtest", "User requested backtest", { chatId, strategy: strategyInput });

  if (!strategyInput) {
    const { data: strategies } = await supabase
      .from("bot_strategies")
      .select("strategy_name, win_rate, times_used, is_active")
      .order("times_used", { ascending: false })
      .limit(10);

    if (!strategies || strategies.length === 0) return "No strategies found.";

    let msg = `📋 *Available Strategies*\n\nUse /backtest [name] to analyze:\n\n`;
    strategies.forEach(s => {
      const wr = s.win_rate ? `${(s.win_rate * 100).toFixed(0)}%` : 'N/A';
      const status = s.is_active ? '🟢' : '🔴';
      msg += `${status} *${s.strategy_name}* — ${wr} WR (${s.times_used || 0} uses)\n`;
    });
    return msg;
  }

  const { data: parlays } = await supabase
    .from("bot_daily_parlays")
    .select("parlay_date, outcome, profit_loss, expected_odds, leg_count")
    .ilike("strategy_name", `%${strategyInput}%`)
    .not("outcome", "is", null)
    .order("parlay_date", { ascending: true });

  if (!parlays || parlays.length === 0) {
    return `📊 No settled parlays found for strategy matching "*${strategyInput}*".`;
  }

  const wins = parlays.filter(p => p.outcome === "won").length;
  const totalPL = parlays.reduce((s, p) => s + (p.profit_loss || 0), 0);
  const avgOdds = parlays.reduce((s, p) => s + (p.expected_odds || 0), 0) / parlays.length;

  let bestDay = parlays[0], worstDay = parlays[0];
  parlays.forEach(p => {
    if ((p.profit_loss || 0) > (bestDay.profit_loss || 0)) bestDay = p;
    if ((p.profit_loss || 0) < (worstDay.profit_loss || 0)) worstDay = p;
  });

  return `📊 *Backtest: ${strategyInput}*

*Record:* ${wins}W - ${parlays.length - wins}L
*Win Rate:* ${(wins / parlays.length * 100).toFixed(1)}%
*ROI:* ${(totalPL / (parlays.length * 10) * 100).toFixed(1)}%
*Avg Odds:* ${avgOdds > 0 ? '+' : ''}${avgOdds.toFixed(0)}
*Total P&L:* ${totalPL >= 0 ? '+' : ''}$${totalPL.toFixed(0)}
*Best Day:* ${bestDay.parlay_date} ($${(bestDay.profit_loss || 0).toFixed(0)})
*Worst Day:* ${worstDay.parlay_date} ($${(worstDay.profit_loss || 0).toFixed(0)})
*Period:* ${parlays[0].parlay_date} to ${parlays[parlays.length - 1].parlay_date}`;
}

// ==================== REAL-TIME & WATCH ====================

async function handleWatch(chatId: string, playerName: string) {
  await logActivity("telegram_watch", "User requested player watch", { chatId, player: playerName });

  if (!playerName) {
    return "Usage: /watch [player name]\n\nExample: /watch LeBron James";
  }

  const [sweetSpots, props] = await Promise.all([
    supabase.from("category_sweet_spots").select("player_name, prop_type, recommended_line, recommended_side, actual_hit_rate, confidence_score, analysis_date, outcome").ilike("player_name", `%${playerName}%`).order("analysis_date", { ascending: false }).limit(10),
    supabase.from("unified_props").select("player_name, prop_type, current_line, bookmaker, sport, game_description, over_price, under_price").ilike("player_name", `%${playerName}%`).eq("is_active", true).limit(10),
  ]);

  const ssData = sweetSpots.data || [];
  const propsData = props.data || [];

  if (ssData.length === 0 && propsData.length === 0) {
    return `🔍 No data found for "*${playerName}*". Check spelling or try a different name.`;
  }

  let msg = `👁 *Watching: ${playerName}*\n\n`;

  if (propsData.length > 0) {
    msg += `*Active Lines:*\n`;
    propsData.forEach(p => {
      const overOdds = p.over_price ? `O ${p.over_price > 0 ? '+' : ''}${p.over_price}` : '';
      const underOdds = p.under_price ? `U ${p.under_price > 0 ? '+' : ''}${p.under_price}` : '';
      msg += `• ${p.prop_type}: ${p.current_line} (${overOdds} / ${underOdds}) [${p.bookmaker}]\n`;
    });
    msg += `\n`;
  }

  if (ssData.length > 0) {
    msg += `*Sweet Spot Analysis:*\n`;
    ssData.slice(0, 5).forEach(s => {
      const hr = s.actual_hit_rate ? `${(s.actual_hit_rate * 100).toFixed(0)}% hit` : '';
      const outcomeEmoji = s.outcome === 'hit' ? '✅' : s.outcome === 'miss' ? '❌' : '⏳';
      msg += `• ${s.prop_type} ${s.recommended_side || ''} ${s.recommended_line || ''} ${hr} ${outcomeEmoji}\n`;
    });
  }

  return msg;
}

// ==================== CONTROL COMMANDS ====================

async function handlePause(chatId: string) {
  await logActivity("bot_paused", "Bot paused via Telegram", { chatId });
  return "⏸ *Bot Paused*\n\nDaily generation is now paused. Cron jobs will skip generation.\n\nUse /resume to re-enable.";
}

async function handleResume(chatId: string) {
  await logActivity("bot_resumed", "Bot resumed via Telegram", { chatId });
  return "▶️ *Bot Resumed*\n\nDaily generation is back online.\n\nUse /generate to create parlays now.";
}

async function handleBankroll(chatId: string, amountStr: string) {
  await logActivity("telegram_bankroll", "User updating bankroll", { chatId, amount: amountStr });

  if (!amountStr) {
    return "Usage: /bankroll [amount]\n\nExample: /bankroll 1500";
  }

  const amount = parseFloat(amountStr);
  if (isNaN(amount) || amount <= 0 || amount > 1000000) {
    return "❌ Invalid amount. Must be a positive number under $1,000,000.";
  }

  const today = getEasternDate();
  const { data: existing } = await supabase
    .from("bot_activation_status")
    .select("id, is_real_mode_ready")
    .eq("check_date", today)
    .maybeSingle();

  const bankrollField = existing?.is_real_mode_ready ? "real_bankroll" : "simulated_bankroll";

  if (existing) {
    await supabase.from("bot_activation_status").update({ [bankrollField]: amount }).eq("id", existing.id);
  } else {
    await supabase.from("bot_activation_status").insert({ check_date: today, [bankrollField]: amount });
  }

  return `✅ Bankroll updated to *$${amount.toLocaleString()}* (${existing?.is_real_mode_ready ? 'real' : 'simulated'} mode)`;
}

async function handleForceSettle(chatId: string, dateStr: string) {
  await logActivity("telegram_force_settle", "User forced settlement", { chatId, date: dateStr });

  if (!dateStr) {
    return "Usage: /force-settle [YYYY-MM-DD]\n\nExample: /force-settle 2026-02-08";
  }

  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return "❌ Invalid date format. Use YYYY-MM-DD.";
  }

  await sendMessage(chatId, `⏳ Settling for ${dateStr}...`);

  try {
    const response = await fetch(
      `${Deno.env.get("SUPABASE_URL")}/functions/v1/bot-settle-and-learn`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ targetDate: dateStr }),
      }
    );

    if (!response.ok) throw new Error(`Settlement failed: ${response.status}`);

    const result = await response.json();
    return `✅ *Force Settlement Complete* (${dateStr})\n\n${result.summary || `Settled ${result.settledCount || 0} parlays.`}`;
  } catch (error) {
    console.error("Force settle error:", error);
    return "❌ Force settlement failed. Check the date and try again.";
  }
}

// ==================== UX COMMANDS ====================

async function handleSubscribe(chatId: string) {
  await logActivity("telegram_subscribe", "User checking subscriptions", { chatId });

  const { data: settings } = await supabase
    .from("bot_notification_settings")
    .select("*")
    .limit(1)
    .maybeSingle();

  if (!settings) {
    return `📬 *Notification Settings*\n\nNo settings configured yet. All notifications are enabled by default.\n\nUse /unsubscribe [type] to disable:\n• parlays\n• settlement\n• activation\n• weights\n• strategy`;
  }

  const checks = [
    { key: 'notify_parlays_generated', label: 'Parlays Generated', icon: '📊' },
    { key: 'notify_settlement', label: 'Settlement', icon: '💰' },
    { key: 'notify_activation_ready', label: 'Activation Ready', icon: '🚀' },
    { key: 'notify_weight_changes', label: 'Weight Changes', icon: '⚖️' },
    { key: 'notify_strategy_updates', label: 'Strategy Updates', icon: '📋' },
  ];

  let msg = `📬 *Notification Settings*\n\n`;
  checks.forEach(c => {
    const enabled = settings[c.key] !== false;
    msg += `${c.icon} ${c.label}: ${enabled ? '✅ ON' : '❌ OFF'}\n`;
  });
  msg += `\nQuiet Hours: ${settings.quiet_start_hour || 23}:00 - ${settings.quiet_end_hour || 7}:00 ET`;
  msg += `\n\nUse /unsubscribe [type] to toggle off.`;

  return msg;
}

async function handleUnsubscribe(chatId: string, typeStr: string) {
  await logActivity("telegram_unsubscribe", "User toggling notification", { chatId, type: typeStr });

  const typeMap: Record<string, string> = {
    'parlays': 'notify_parlays_generated',
    'settlement': 'notify_settlement',
    'activation': 'notify_activation_ready',
    'weights': 'notify_weight_changes',
    'strategy': 'notify_strategy_updates',
  };

  if (!typeStr || !typeMap[typeStr.toLowerCase()]) {
    return `Usage: /unsubscribe [type]\n\nTypes: parlays, settlement, activation, weights, strategy`;
  }

  const field = typeMap[typeStr.toLowerCase()];

  // Get or create settings
  const { data: existing } = await supabase.from("bot_notification_settings").select("id, " + field).limit(1).maybeSingle();

  if (existing) {
    const currentValue = (existing as any)[field];
    const newValue = currentValue === false ? true : false;
    await supabase.from("bot_notification_settings").update({ [field]: newValue }).eq("id", existing.id);
    return `${newValue ? '✅' : '❌'} *${typeStr}* notifications ${newValue ? 'enabled' : 'disabled'}.`;
  } else {
    await supabase.from("bot_notification_settings").insert({ [field]: false, telegram_enabled: true });
    return `❌ *${typeStr}* notifications disabled.`;
  }
}

async function handleExport(chatId: string, dateStr: string) {
  await logActivity("telegram_export", "User requested data export", { chatId, date: dateStr });

  const targetDate = dateStr || getEasternDate();

  if (dateStr && !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return "❌ Invalid date format. Use YYYY-MM-DD or just /export for today.";
  }

  const { data: picks } = await supabase
    .from("category_sweet_spots")
    .select("player_name, prop_type, recommended_line, recommended_side, outcome, actual_value, confidence_score")
    .eq("analysis_date", targetDate)
    .order("player_name");

  if (!picks || picks.length === 0) {
    return `📄 No picks found for ${targetDate}.`;
  }

  let msg = `📄 *Export: ${targetDate}* (${picks.length} picks)\n\n`;
  msg += `Player | Prop | Line | Side | Result | Actual\n`;
  msg += `${'—'.repeat(40)}\n`;

  picks.forEach(p => {
    const result = p.outcome === 'hit' ? '✅' : p.outcome === 'miss' ? '❌' : '⏳';
    msg += `${p.player_name} | ${p.prop_type} | ${p.recommended_line || '-'} | ${(p.recommended_side || '-').toUpperCase()} | ${result} | ${p.actual_value ?? '-'}\n`;
  });

  await sendLongMessage(chatId, msg);
  return null; // Already sent
}

// ==================== MISPRICED LINES HANDLER ====================

function normalizePropType(raw: string): string {
  const s = (raw || '').replace(/^(player_|batter_|pitcher_)/, '').toLowerCase().trim();
  if (/points.*rebounds.*assists|pts.*rebs.*asts|^pra$/.test(s)) return 'pra';
  if (/points.*rebounds|pts.*rebs|^pr$/.test(s)) return 'pr';
  if (/points.*assists|pts.*asts|^pa$/.test(s)) return 'pa';
  if (/rebounds.*assists|rebs.*asts|^ra$/.test(s)) return 'ra';
  if (/three_pointers|threes_made|^threes$/.test(s)) return 'threes';
  return s;
}

async function handleMispriced(chatId: string, page = 1) {
  const today = getEasternDate();
  const PER_PAGE = 10;

  const { data: lines } = await supabase
    .from('mispriced_lines')
    .select('player_name, prop_type, signal, edge_pct, confidence_tier, book_line, player_avg_l10, sport')
    .eq('analysis_date', today)
    .order('edge_pct', { ascending: true });

  if (!lines || lines.length === 0) {
    await sendMessage(chatId, "📭 No mispriced lines found today.\n\nUse /runmispriced to trigger a scan.");
    return;
  }

  // Group by tier
  const tierOrder = ['ELITE', 'HIGH', 'MEDIUM'];
  const grouped: Record<string, typeof lines> = { ELITE: [], HIGH: [], MEDIUM: [] };
  lines.forEach(l => {
    const tier = l.confidence_tier || 'MEDIUM';
    if (grouped[tier]) grouped[tier].push(l);
    else grouped.MEDIUM.push(l);
  });

  // Flatten in tier order
  const ordered = [...grouped.ELITE, ...grouped.HIGH, ...grouped.MEDIUM];
  const total = ordered.length;
  const totalPages = Math.ceil(total / PER_PAGE);
  const safePage = Math.max(1, Math.min(page, totalPages));
  const startIdx = (safePage - 1) * PER_PAGE;
  const endIdx = Math.min(startIdx + PER_PAGE, total);
  const pageLines = ordered.slice(startIdx, endIdx);

  // Stats
  const sportCounts: Record<string, number> = {};
  let overCount = 0, underCount = 0;
  lines.forEach(l => {
    const sport = getSportLabel(l.sport || '') || 'OTHER';
    sportCounts[sport] = (sportCounts[sport] || 0) + 1;
    if (l.signal?.toLowerCase() === 'over') overCount++;
    else underCount++;
  });

  const dateLabel = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' }).format(new Date());
  let msg = `📉 *MISPRICED LINES — ${dateLabel}*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `Showing ${startIdx + 1}-${endIdx} of ${total} lines\n`;
  msg += `${Object.entries(sportCounts).map(([s, c]) => `${s}: ${c}`).join(' | ')} | ⬆️${overCount} | ⬇️${underCount}\n\n`;

  let lastTier = '';
  for (let i = 0; i < pageLines.length; i++) {
    const l = pageLines[i];
    const tier = l.confidence_tier || 'MEDIUM';
    if (tier !== lastTier) {
      const tierEmoji = tier === 'ELITE' ? '💎' : tier === 'HIGH' ? '🔥' : '📊';
      msg += `${tierEmoji} *${tier} EDGES:*\n\n`;
      lastTier = tier;
    }
    const globalIdx = startIdx + i + 1;
    const side = (l.signal || 'UNDER').toUpperCase().charAt(0);
    const propLabel = normalizePropType(l.prop_type || '').toUpperCase();
    const edgeStr = l.edge_pct >= 0 ? `+${l.edge_pct.toFixed(0)}%` : `${l.edge_pct.toFixed(0)}%`;
    msg += `${globalIdx}. *${l.player_name}* — ${propLabel} ${side} ${l.book_line}\n`;
    msg += `   L10: ${l.player_avg_l10?.toFixed(1) || '?'} | Edge: ${edgeStr}\n`;
  }

  // Pagination buttons
  const buttons: Array<{ text: string; callback_data: string }> = [];
  if (safePage > 1) buttons.push({ text: `< Prev ${PER_PAGE}`, callback_data: `mispriced_page:${safePage - 1}` });
  if (safePage < totalPages) buttons.push({ text: `Next ${PER_PAGE} >`, callback_data: `mispriced_page:${safePage + 1}` });

  await sendLongMessage(chatId, msg, "Markdown");
  if (buttons.length > 0) {
    await sendMessage(chatId, `📄 Page ${safePage}/${totalPages}`, "Markdown", { inline_keyboard: [buttons] });
  }
}

// ==================== HIGH CONVICTION HANDLER ====================

async function handleHighConv(chatId: string, page = 1) {
  const today = getEasternDate();
  const PER_PAGE = 5;

  // Fetch mispriced lines + engine picks in parallel
  const [mispricedRes, riskRes, propV2Res] = await Promise.all([
    supabase.from('mispriced_lines')
      .select('player_name, prop_type, signal, edge_pct, confidence_tier, book_line, player_avg_l10, sport')
      .eq('analysis_date', today),
    supabase.from('nba_risk_engine_picks')
      .select('player_name, prop_type, side, confidence_score')
      .eq('game_date', today),
    supabase.from('prop_engine_v2_picks')
      .select('player_name, prop_type, side, ses_score')
      .eq('game_date', today),
  ]);

  const mispricedLines = mispricedRes.data || [];
  if (mispricedLines.length === 0) {
    await sendMessage(chatId, "📭 No mispriced lines found today. Run /runmispriced first.");
    return;
  }

  // Build engine map
  interface EPick { player_name: string; prop_type: string; side: string; confidence?: number; engine: string }
  const engineMap = new Map<string, EPick[]>();
  const addPick = (p: EPick) => {
    if (!p.player_name || !p.prop_type) return;
    const key = `${p.player_name.toLowerCase()}|${normalizePropType(p.prop_type)}`;
    if (!engineMap.has(key)) engineMap.set(key, []);
    engineMap.get(key)!.push(p);
  };

  for (const p of riskRes.data || []) {
    addPick({ player_name: p.player_name, prop_type: p.prop_type, side: p.side || 'over', confidence: p.confidence_score, engine: 'risk' });
  }
  for (const p of propV2Res.data || []) {
    addPick({ player_name: p.player_name, prop_type: p.prop_type, side: p.side || 'over', confidence: p.ses_score, engine: 'propv2' });
  }

  // Cross-reference
  const plays: Array<{
    player_name: string; prop_type: string; signal: string; edge_pct: number;
    confidence_tier: string; book_line: number; engines: EPick[];
    sideAgreement: boolean; convictionScore: number;
  }> = [];

  for (const ml of mispricedLines) {
    const key = `${ml.player_name.toLowerCase()}|${normalizePropType(ml.prop_type)}`;
    const matches = engineMap.get(key);
    if (!matches || matches.length === 0) continue;

    const mispricedSide = ml.signal.toLowerCase();
    const sideAgreement = matches.every(m => m.side.toLowerCase() === mispricedSide);

    const edgeScore = Math.min(Math.abs(ml.edge_pct) / 10, 10);
    const tierBonus = ml.confidence_tier === 'ELITE' ? 3 : ml.confidence_tier === 'HIGH' ? 2 : 1;
    const engineCountBonus = matches.length * 2;
    const agreementBonus = sideAgreement ? 3 : 0;
    const sameDir = matches.filter(m => m.side.toLowerCase() === mispricedSide).length;
    const dirBonus = sameDir * 1.5;
    const riskConf = matches.find(m => m.engine === 'risk')?.confidence || 0;
    const riskBonus = riskConf > 0 ? riskConf / 20 : 0;
    const convictionScore = edgeScore + tierBonus + engineCountBonus + agreementBonus + dirBonus + riskBonus;

    plays.push({
      player_name: ml.player_name, prop_type: normalizePropType(ml.prop_type),
      signal: ml.signal, edge_pct: ml.edge_pct, confidence_tier: ml.confidence_tier,
      book_line: ml.book_line, engines: matches, sideAgreement, convictionScore,
    });
  }

  plays.sort((a, b) => b.convictionScore - a.convictionScore);

  if (plays.length === 0) {
    await sendMessage(chatId, "📭 No cross-engine overlaps found today.\n\nMispriced lines exist but no engine picks match.");
    return;
  }

  const total = plays.length;
  const totalPages = Math.ceil(total / PER_PAGE);
  const safePage = Math.max(1, Math.min(page, totalPages));
  const startIdx = (safePage - 1) * PER_PAGE;
  const endIdx = Math.min(startIdx + PER_PAGE, total);
  const pagePlays = plays.slice(startIdx, endIdx);

  const allAgree = plays.filter(p => p.sideAgreement).length;
  const engineSet = new Set<string>();
  plays.forEach(p => p.engines.forEach(e => engineSet.add(e.engine)));

  const dateLabel = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' }).format(new Date());
  let msg = `🎯 *HIGH CONVICTION PLAYS — ${dateLabel}*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `Showing ${startIdx + 1}-${endIdx} of ${total} overlaps\n`;
  msg += `All Agree: ${allAgree} | Engines: ${[...engineSet].join(', ')}\n\n`;

  for (let i = 0; i < pagePlays.length; i++) {
    const p = pagePlays[i];
    const globalIdx = startIdx + i + 1;
    const side = (p.signal || 'UNDER').toUpperCase();
    const propLabel = p.prop_type.toUpperCase();
    const edgeStr = p.edge_pct >= 0 ? `+${p.edge_pct.toFixed(0)}%` : `${p.edge_pct.toFixed(0)}%`;
    const agreeEmoji = p.sideAgreement ? '✅' : '⚠️';

    msg += `${globalIdx}. *${p.player_name}* — ${propLabel} ${side} ${p.book_line}\n`;
    msg += `   Edge: ${edgeStr} (${p.confidence_tier}) ${agreeEmoji}\n`;

    const engineDetails = p.engines.map(e => {
      const eSide = e.side.toUpperCase();
      const agrees = eSide === side ? '✓' : '✗';
      return `${e.engine} ${agrees} ${eSide}`;
    }).join(' | ');
    msg += `   ${engineDetails} | Score: ${p.convictionScore.toFixed(1)}/30\n\n`;
  }

  // Pagination buttons
  const buttons: Array<{ text: string; callback_data: string }> = [];
  if (safePage > 1) buttons.push({ text: `< Prev ${PER_PAGE}`, callback_data: `highconv_page:${safePage - 1}` });
  if (safePage < totalPages) buttons.push({ text: `Next ${PER_PAGE} >`, callback_data: `highconv_page:${safePage + 1}` });

  await sendLongMessage(chatId, msg, "Markdown");
  if (buttons.length > 0) {
    await sendMessage(chatId, `📄 Page ${safePage}/${totalPages}`, "Markdown", { inline_keyboard: [buttons] });
  }
}

// ==================== PITCHER K HANDLER ====================

async function handlePitcherK(chatId: string, page = 1) {
  const today = getEasternDate();
  const PER_PAGE = 5;

  const { data: lines } = await supabase
    .from('mispriced_lines')
    .select('player_name, prop_type, signal, edge_pct, confidence_tier, book_line, player_avg_l10, sport, metadata')
    .eq('analysis_date', today)
    .eq('prop_type', 'pitcher_strikeouts')
    .order('edge_pct', { ascending: true });

  if (!lines || lines.length === 0) {
    await sendMessage(chatId, "⚾ No pitcher K analysis found today.\n\nUse /runpitcherk to trigger the analyzer.");
    return;
  }

  // Group by tier
  const tierOrder = ['ELITE', 'HIGH', 'MEDIUM'];
  const grouped: Record<string, typeof lines> = { ELITE: [], HIGH: [], MEDIUM: [] };
  lines.forEach(l => {
    const tier = l.confidence_tier || 'MEDIUM';
    if (grouped[tier]) grouped[tier].push(l);
    else grouped.MEDIUM.push(l);
  });

  const ordered = [...grouped.ELITE, ...grouped.HIGH, ...grouped.MEDIUM];
  const total = ordered.length;
  const totalPages = Math.ceil(total / PER_PAGE);
  const safePage = Math.max(1, Math.min(page, totalPages));
  const startIdx = (safePage - 1) * PER_PAGE;
  const endIdx = Math.min(startIdx + PER_PAGE, total);
  const pageLines = ordered.slice(startIdx, endIdx);

  let overCount = 0, underCount = 0;
  lines.forEach(l => { if (l.signal?.toLowerCase() === 'over') overCount++; else underCount++; });

  const dateLabel = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' }).format(new Date());
  let msg = `⚾ *PITCHER K PROPS — ${dateLabel}*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `Showing ${startIdx + 1}-${endIdx} of ${total} pitchers\n`;
  msg += `⬆️ OVER: ${overCount} | ⬇️ UNDER: ${underCount}\n\n`;

  let lastTier = '';
  for (let i = 0; i < pageLines.length; i++) {
    const l = pageLines[i];
    const tier = l.confidence_tier || 'MEDIUM';
    if (tier !== lastTier) {
      const tierEmoji = tier === 'ELITE' ? '💎' : tier === 'HIGH' ? '🔥' : '📊';
      msg += `${tierEmoji} *${tier}:*\n\n`;
      lastTier = tier;
    }
    const globalIdx = startIdx + i + 1;
    const side = (l.signal || 'UNDER').toUpperCase();
    const edgeStr = l.edge_pct >= 0 ? `+${l.edge_pct.toFixed(0)}%` : `${l.edge_pct.toFixed(0)}%`;
    const meta = (l.metadata as any) || {};
    const hitRate = meta.hit_rate_over != null
      ? (side === 'OVER' ? `${meta.hit_rate_over.toFixed(0)}% over` : `${(100 - meta.hit_rate_over).toFixed(0)}% under`)
      : '';
    const team = meta.team ? ` (${meta.team})` : '';
    
    msg += `${globalIdx}. *${l.player_name}*${team}\n`;
    msg += `   ${side} ${l.book_line} | L10: ${l.player_avg_l10?.toFixed(1) || '?'} | Edge: ${edgeStr}`;
    if (hitRate) msg += ` | ${hitRate}`;
    msg += `\n`;
    if (meta.l10_median != null) {
      msg += `   Med: ${meta.l10_median.toFixed(1)} | Range: ${meta.l10_min}-${meta.l10_max} (${meta.games_analyzed || '?'} games)\n`;
    }
    msg += `\n`;
  }

  const buttons: Array<{ text: string; callback_data: string }> = [];
  if (safePage > 1) buttons.push({ text: `< Prev ${PER_PAGE}`, callback_data: `pitcherk_page:${safePage - 1}` });
  if (safePage < totalPages) buttons.push({ text: `Next ${PER_PAGE} >`, callback_data: `pitcherk_page:${safePage + 1}` });

  await sendLongMessage(chatId, msg, "Markdown");
  if (buttons.length > 0) {
    await sendMessage(chatId, `📄 Page ${safePage}/${totalPages}`, "Markdown", { inline_keyboard: [buttons] });
  }
}

// ==================== MLB FULL SLATE HANDLER ====================

async function handleMLB(chatId: string) {
  const today = getEasternDate();

  const { data: lines } = await supabase
    .from('mispriced_lines')
    .select('player_name, prop_type, signal, edge_pct, confidence_tier, book_line, player_avg_l10, sport, metadata')
    .eq('analysis_date', today)
    .eq('sport', 'baseball_mlb')
    .order('confidence_tier', { ascending: true });

  if (!lines || lines.length === 0) {
    await sendMessage(chatId, "⚾ No MLB analysis found today.\n\nUse /runpitcherk and /runmlbbatter to trigger analyzers.");
    return;
  }

  // Group by prop_type
  const byProp = new Map<string, typeof lines>();
  lines.forEach(l => {
    if (!byProp.has(l.prop_type)) byProp.set(l.prop_type, []);
    byProp.get(l.prop_type)!.push(l);
  });

  const propLabels: Record<string, string> = {
    pitcher_strikeouts: 'Pitcher Ks',
    batter_home_runs: 'Home Runs',
    batter_total_bases: 'Total Bases',
    player_hits: 'Hits',
    batter_hits: 'Hits',
    player_rbis: 'RBIs',
    batter_rbis: 'RBIs',
    player_runs: 'Runs',
    batter_runs: 'Runs',
    batter_stolen_bases: 'Stolen Bases',
    player_fantasy_score: 'Fantasy Score',
  };

  const dateLabel = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' }).format(new Date());
  let msg = `⚾ *MLB FULL SLATE — ${dateLabel}*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  // Summary line
  const summaryParts: string[] = [];
  for (const [prop, plays] of byProp) {
    summaryParts.push(`${propLabels[prop] || prop}: ${plays.length}`);
  }
  msg += summaryParts.join(' | ') + `\n\n`;

  const tierOrder = ['ELITE', 'HIGH', 'MEDIUM'];
  for (const [prop, plays] of byProp) {
    const label = propLabels[prop] || prop;
    msg += `📌 *${label}*\n`;

    for (const tier of tierOrder) {
      const tierPlays = plays.filter(p => p.confidence_tier === tier);
      if (tierPlays.length === 0) continue;
      const emoji = tier === 'ELITE' ? '💎' : tier === 'HIGH' ? '🔥' : '📊';
      msg += `${emoji} *${tier}:*\n`;
      tierPlays.slice(0, 5).forEach(p => {
        const side = (p.signal || 'UNDER').toUpperCase();
        const edgeStr = p.edge_pct >= 0 ? `+${p.edge_pct.toFixed(0)}%` : `${p.edge_pct.toFixed(0)}%`;
        const meta = (p.metadata as any) || {};
        const hitStr = meta.hit_rate_over != null
          ? (side === 'OVER' ? `${meta.hit_rate_over.toFixed(0)}% over` : `${(100 - meta.hit_rate_over).toFixed(0)}% under`)
          : '';
        msg += `• ${p.player_name} ${side} ${p.book_line}\n`;
        msg += `  L10: ${p.player_avg_l10?.toFixed(1) || '?'} | Edge: ${edgeStr}`;
        if (hitStr) msg += ` | ${hitStr}`;
        msg += `\n`;
      });
      if (tierPlays.length > 5) msg += `  +${tierPlays.length - 5} more\n`;
    }
    msg += `\n`;
  }

  await sendLongMessage(chatId, msg, "Markdown");
}

// ==================== ADMIN MANAGEMENT COMMANDS ====================

async function handleDeleteParlay(chatId: string, args: string) {
  const id = args.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return "❌ Invalid UUID format.\n\nUsage: `/deleteparlay [uuid]`";
  }
  const { data: parlay, error } = await supabase
    .from('bot_daily_parlays')
    .select('id, strategy_name, leg_count, outcome')
    .eq('id', id)
    .maybeSingle();
  if (error || !parlay) return `❌ Parlay \`${id.slice(0, 8)}...\` not found.`;
  
  await supabase.from('bot_daily_parlays').update({
    outcome: 'void',
    lesson_learned: 'Voided by admin via Telegram',
  }).eq('id', id);
  
  await logActivity('admin_delete_parlay', `Admin voided parlay ${id}`, { parlay_id: id, strategy: parlay.strategy_name });
  return `✅ *Parlay Voided*\n\nID: \`${id.slice(0, 8)}...\`\nStrategy: ${parlay.strategy_name}\nLegs: ${parlay.leg_count}\nPrevious outcome: ${parlay.outcome || 'pending'}`;
}

async function handleVoidToday(chatId: string) {
  const today = getEasternDate();
  const { count } = await supabase
    .from('bot_daily_parlays')
    .select('*', { count: 'exact', head: true })
    .eq('parlay_date', today)
    .or('outcome.eq.pending,outcome.is.null');
  
  if (!count || count === 0) return "📭 No pending parlays today to void.";
  
  await sendMessage(chatId, `⚠️ This will void *${count} pending parlays* for today (${today}).\n\nAre you sure?`, "Markdown", {
    inline_keyboard: [[
      { text: `✅ Void ${count} parlays`, callback_data: 'fix:void_today_confirm' },
      { text: '❌ Cancel', callback_data: 'fix:cancel' },
    ]],
  });
  return null;
}

async function handleFixLeg(chatId: string, args: string) {
  const parts = args.trim().split(/\s+/);
  if (parts.length < 4) return "❌ Usage: `/fixleg [parlay_id] [leg_index] [field] [value]`\n\nFields: `line`, `side`, `player_name`, `prop_type`";
  
  const [parlayId, legIdxStr, field, ...valueParts] = parts;
  const value = valueParts.join(' ');
  const legIdx = parseInt(legIdxStr, 10);
  const validFields = ['line', 'side', 'player_name', 'prop_type'];
  
  if (!validFields.includes(field)) return `❌ Invalid field \`${field}\`.\n\nValid fields: ${validFields.join(', ')}`;
  
  const { data: parlay } = await supabase
    .from('bot_daily_parlays')
    .select('id, legs')
    .eq('id', parlayId)
    .maybeSingle();
  if (!parlay) return `❌ Parlay \`${parlayId.slice(0, 8)}...\` not found.`;
  
  const legs = Array.isArray(parlay.legs) ? parlay.legs : JSON.parse(parlay.legs || '[]');
  if (legIdx < 0 || legIdx >= legs.length) return `❌ Leg index ${legIdx} out of range (0-${legs.length - 1}).`;
  
  const oldValue = legs[legIdx][field];
  legs[legIdx][field] = field === 'line' ? parseFloat(value) : value;
  
  await supabase.from('bot_daily_parlays').update({ legs }).eq('id', parlayId);
  await logActivity('admin_fix_leg', `Admin fixed leg ${legIdx} of parlay ${parlayId}`, { parlay_id: parlayId, leg_index: legIdx, field, old_value: oldValue, new_value: value });
  
  return `✅ *Leg Fixed*\n\nParlay: \`${parlayId.slice(0, 8)}...\`\nLeg #${legIdx}: \`${field}\`\nOld: ${oldValue}\nNew: ${value}`;
}

async function handleDeleteSweep(chatId: string) {
  const today = getEasternDate();
  const { data: sweeps } = await supabase
    .from('bot_daily_parlays')
    .select('id')
    .eq('parlay_date', today)
    .eq('strategy_name', 'leftover_sweep');
  
  if (!sweeps || sweeps.length === 0) return "📭 No sweep parlays found today.";
  
  await supabase.from('bot_daily_parlays').update({
    outcome: 'void',
    lesson_learned: 'Sweep parlays voided by admin',
  }).eq('parlay_date', today).eq('strategy_name', 'leftover_sweep');
  
  await logActivity('admin_delete_sweep', `Admin voided ${sweeps.length} sweep parlays`, { count: sweeps.length });
  return `✅ Voided *${sweeps.length}* sweep parlays for today.`;
}

async function handleDeleteByStrat(chatId: string, args: string) {
  const stratName = args.trim();
  if (!stratName) return "❌ Usage: `/deletebystrat [strategy_name]`";
  
  const today = getEasternDate();
  const { data: matches } = await supabase
    .from('bot_daily_parlays')
    .select('id')
    .eq('parlay_date', today)
    .eq('strategy_name', stratName)
    .or('outcome.eq.pending,outcome.is.null');
  
  if (!matches || matches.length === 0) return `📭 No pending parlays found for strategy \`${stratName}\` today.`;
  
  await supabase.from('bot_daily_parlays').update({
    outcome: 'void',
    lesson_learned: `Voided by admin (strategy: ${stratName})`,
  }).eq('parlay_date', today).eq('strategy_name', stratName).or('outcome.eq.pending,outcome.is.null');
  
  await logActivity('admin_delete_by_strat', `Admin voided ${matches.length} parlays for strategy ${stratName}`, { strategy: stratName, count: matches.length });
  return `✅ Voided *${matches.length}* parlays for strategy \`${stratName}\`.`;
}

async function handleFixPipeline(chatId: string) {
  await sendMessage(chatId, "⏳ Running *full data pipeline*...", "Markdown");
  try {
    const resp = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/data-pipeline-orchestrator`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'full' }),
    });
    if (!resp.ok) return `❌ Pipeline failed (${resp.status}): ${(await resp.text()).slice(0, 200)}`;
    const data = await resp.json();
    await logActivity('admin_fix_pipeline', 'Admin triggered full pipeline', { result: data });
    return `✅ *Pipeline Complete*\n\n\`${JSON.stringify(data).slice(0, 300)}\``;
  } catch (err) {
    return `❌ Pipeline error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function handleRegenParlay(chatId: string) {
  await sendMessage(chatId, "⏳ Voiding today's parlays and regenerating...", "Markdown");
  try {
    const resp = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/bot-force-fresh-parlays`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!resp.ok) return `❌ Regen failed (${resp.status})`;
    const data = await resp.json();
    await logActivity('admin_regen_parlay', 'Admin triggered parlay regeneration', { result: data });
    return `✅ *Parlays Regenerated*\n\n\`${JSON.stringify(data).slice(0, 300)}\``;
  } catch (err) {
    return `❌ Regen error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function handleFixProps(chatId: string) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  
  await sendMessage(chatId, "⏳ Step 1/2: Refreshing props...", "Markdown");
  try {
    const r1 = await fetch(`${supabaseUrl}/functions/v1/refresh-todays-props`, {
      method: 'POST', headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' }, body: '{}',
    });
    if (!r1.ok) return `❌ Props refresh failed (${r1.status})`;
    await sendMessage(chatId, "✅ Props refreshed. Step 2/2: Generating parlays...", "Markdown");
    
    const r2 = await fetch(`${supabaseUrl}/functions/v1/bot-generate-daily-parlays`, {
      method: 'POST', headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' }, body: '{}',
    });
    if (!r2.ok) return `❌ Generation failed (${r2.status})`;
    const data = await r2.json();
    await logActivity('admin_fix_props', 'Admin triggered props refresh + generation', {});
    return `✅ *Props Fixed & Parlays Generated*\n\n\`${JSON.stringify(data).slice(0, 300)}\``;
  } catch (err) {
    return `❌ Fix props error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function handleHealthcheck(chatId: string) {
  await sendMessage(chatId, "⏳ Running healthcheck...", "Markdown");
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  
  try {
    const [preflightResp, integrityResp] = await Promise.all([
      fetch(`${supabaseUrl}/functions/v1/bot-pipeline-preflight`, {
        method: 'POST', headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' }, body: '{}',
      }),
      fetch(`${supabaseUrl}/functions/v1/bot-parlay-integrity-check`, {
        method: 'POST', headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' }, body: '{}',
      }),
    ]);
    
    const preflight = preflightResp.ok ? await preflightResp.json() : { error: `HTTP ${preflightResp.status}` };
    const integrity = integrityResp.ok ? await integrityResp.json() : { error: `HTTP ${integrityResp.status}` };
    
    let msg = `🏥 *Healthcheck Results*\n\n`;
    msg += `*Preflight:* ${preflight.ready ? '✅ Ready' : '❌ Not Ready'}\n`;
    if (preflight.checks) {
      for (const c of preflight.checks) {
        msg += `  ${c.passed ? '✅' : '❌'} ${c.name}: ${c.detail}\n`;
      }
    }
    if (preflight.blockers?.length > 0) {
      msg += `\n*Blockers:*\n${preflight.blockers.map((b: string) => `⚠️ ${b}`).join('\n')}\n`;
    }
    msg += `\n*Integrity:* ${integrity.clean ? '✅ Clean' : `❌ ${integrity.violations || 0} violations`}\n`;
    if (integrity.strategy_counts) {
      msg += `Strategy breakdown: ${JSON.stringify(integrity.strategy_counts)}\n`;
    }
    return msg;
  } catch (err) {
    return `❌ Healthcheck error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function handleErrorLog(chatId: string) {
  const { data: errors } = await supabase
    .from('bot_activity_log')
    .select('created_at, event_type, message')
    .eq('severity', 'error')
    .order('created_at', { ascending: false })
    .limit(10);
  
  if (!errors || errors.length === 0) return "✅ No recent errors in the log.";
  
  let msg = `🚨 *Last ${errors.length} Errors*\n\n`;
  errors.forEach((e, i) => {
    const time = new Date(e.created_at).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    msg += `${i + 1}. *${e.event_type}*\n   ${time}\n   ${(e.message || '').slice(0, 100)}\n\n`;
  });
  return msg;
}

async function handleBroadcast(chatId: string) {
  const today = getEasternDate();

  // Fetch approved/edited parlays for today
  const { data: approvedParlays } = await supabase
    .from('bot_daily_parlays')
    .select('*')
    .eq('parlay_date', today)
    .in('approval_status', ['approved', 'edited'])
    .order('created_at', { ascending: false });

  if (!approvedParlays || approvedParlays.length === 0) {
    await sendMessage(chatId, '⚠️ No approved parlays to broadcast. Review and approve parlays first.');
    return;
  }

  const propLabels: Record<string, string> = {
    threes: '3PT', points: 'PTS', assists: 'AST', rebounds: 'REB',
    steals: 'STL', blocks: 'BLK', pra: 'PRA', goals: 'G',
    shots: 'SOG', saves: 'SVS', aces: 'ACES',
  };

  const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });

  let msg = `📋 *DAILY PICKS — ${dateStr}*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `✅ *${approvedParlays.length} parlays locked in*\n\n`;

  for (let i = 0; i < approvedParlays.length; i++) {
    const p = approvedParlays[i];
    const legs = Array.isArray(p.legs) ? p.legs : JSON.parse(p.legs || '[]');
    const strategy = (p.strategy_name || 'unknown').replace(/_/g, ' ');
    const oddsStr = p.expected_odds > 0 ? `+${p.expected_odds}` : `${p.expected_odds}`;
    msg += `*Parlay #${i + 1}* (${strategy}) ${oddsStr}\n`;

    for (const leg of legs) {
      const side = (leg.side || 'over').toUpperCase();
      const prop = propLabels[leg.prop_type] || (leg.prop_type || '').toUpperCase();
      const hitRate = leg.hit_rate_l10 || leg.hit_rate ? ` (${Math.round(leg.hit_rate_l10 || leg.hit_rate)}% L10)` : '';
      msg += ` Take ${leg.player_name || 'Player'} ${side} ${leg.line} ${prop}${hitRate}\n`;
    }
    msg += `\n`;
  }

  // Send to all active customers
  const { data: customers } = await supabase
    .from('bot_authorized_users')
    .select('chat_id, username')
    .eq('is_active', true);

  let sentCount = 0;
  let failCount = 0;

  if (customers && customers.length > 0) {
    for (const customer of customers) {
      try {
        await sendLongMessage(customer.chat_id, msg, 'Markdown');
        sentCount++;
      } catch (e) {
        console.warn(`[Broadcast] Failed to send to ${customer.chat_id}:`, e);
        failCount++;
      }
    }
  }

  await logActivity('broadcast_sent', `Admin broadcast ${approvedParlays.length} parlays to ${sentCount} customers`, {
    parlayCount: approvedParlays.length,
    sentCount,
    failCount,
  });

  await sendMessage(chatId, `📡 *Broadcast complete!*\n\n✅ Sent ${approvedParlays.length} parlays to ${sentCount} customers${failCount > 0 ? `\n⚠️ ${failCount} failed` : ''}`);
}

// ==================== CALLBACK QUERY HANDLER ====================

async function handleCallbackQuery(callbackQueryId: string, data: string, chatId: string) {
  if (data.startsWith('legs:')) {
    const parlayId = data.slice(5);

    const { data: parlay } = await supabase
      .from("bot_daily_parlays")
      .select("legs, strategy_name, leg_count, expected_odds, outcome, combined_probability")
      .eq("id", parlayId)
      .maybeSingle();

    if (!parlay) {
      await answerCallbackQuery(callbackQueryId, "Parlay not found");
      return;
    }

    const legs = Array.isArray(parlay.legs) ? parlay.legs : JSON.parse(parlay.legs || '[]');
    const outcomeLabel = parlay.outcome === 'won' ? '✅ WON' : parlay.outcome === 'lost' ? '❌ LOST' : '⏳ PENDING';
    const oddsStr = parlay.expected_odds > 0 ? `+${parlay.expected_odds}` : `${parlay.expected_odds}`;
    
    let msg = `📋 *${parlay.strategy_name}* (${parlay.leg_count}-leg) ${oddsStr} ${outcomeLabel}\n\n`;
    legs.forEach((leg: any, i: number) => {
      msg += `${i + 1}. ${formatLegDisplay(leg)}\n\n`;
    });
    
    const avgScore = legs.reduce((s: number, l: any) => s + (l.composite_score || 0), 0) / (legs.length || 1);
    const avgHit = legs.reduce((s: number, l: any) => s + (l.hit_rate || 0), 0) / (legs.length || 1);
    if (avgScore > 0 || avgHit > 0) {
      msg += `📊 Avg Score: ${Math.round(avgScore)} | Avg Hit: ${Math.round(avgHit)}%`;
    }

    await answerCallbackQuery(callbackQueryId);
    await sendLongMessage(chatId, msg);
  } else if (data.startsWith('parlays_page:')) {
    const page = parseInt(data.split(':')[1], 10) || 1;
    await answerCallbackQuery(callbackQueryId, `Loading page ${page}...`);
    await handleParlays(chatId, page);
  } else if (data.startsWith('mispriced_page:')) {
    const page = parseInt(data.split(':')[1], 10) || 1;
    await answerCallbackQuery(callbackQueryId, `Loading page ${page}...`);
    await handleMispriced(chatId, page);
  } else if (data.startsWith('highconv_page:')) {
    const page = parseInt(data.split(':')[1], 10) || 1;
    await answerCallbackQuery(callbackQueryId, `Loading page ${page}...`);
    await handleHighConv(chatId, page);
  } else if (data.startsWith('pitcherk_page:')) {
    const page = parseInt(data.split(':')[1], 10) || 1;
    await answerCallbackQuery(callbackQueryId, `Loading page ${page}...`);
    await handlePitcherK(chatId, page);
  } else if (data === 'fix:void_today_confirm') {
    await answerCallbackQuery(callbackQueryId, 'Voiding all pending parlays...');
    const today = getEasternDate();
    const { data: voided } = await supabase
      .from('bot_daily_parlays')
      .select('id')
      .eq('parlay_date', today)
      .or('outcome.eq.pending,outcome.is.null');
    await supabase.from('bot_daily_parlays').update({
      outcome: 'void',
      lesson_learned: 'Voided by admin via /voidtoday',
    }).eq('parlay_date', today).or('outcome.eq.pending,outcome.is.null');
    await logActivity('admin_void_today', `Admin voided ${voided?.length || 0} parlays`, { count: voided?.length || 0 });
    await sendMessage(chatId, `✅ Voided *${voided?.length || 0}* pending parlays for today.`);
  } else if (data.startsWith('cancel_sub_confirm:')) {
    const email = data.slice('cancel_sub_confirm:'.length);
    await answerCallbackQuery(callbackQueryId, 'Cancelling subscription...');
    await executeCancelSubscription(chatId, email);
  } else if (data === 'cancel_sub_abort') {
    await answerCallbackQuery(callbackQueryId, 'Keeping subscription');
    await sendMessage(chatId, '✅ Great! Your subscription stays active.');
  } else if (data === 'fix:cancel') {
    await answerCallbackQuery(callbackQueryId, 'Cancelled');
    await sendMessage(chatId, '❌ Action cancelled.');
  } else if (data.startsWith('approve_parlay:')) {
    const parlayId = data.slice('approve_parlay:'.length);
    await supabase.from('bot_daily_parlays').update({ approval_status: 'approved' }).eq('id', parlayId);
    await answerCallbackQuery(callbackQueryId, '✅ Parlay approved!');
    await sendMessage(chatId, `✅ Parlay approved! Use /broadcast when ready to send to customers.`);
    await logActivity('parlay_approved', `Admin approved parlay ${parlayId}`, { parlayId });

  } else if (data.startsWith('reject_parlay:')) {
    const parlayId = data.slice('reject_parlay:'.length);
    await supabase.from('bot_daily_parlays').update({ approval_status: 'rejected', outcome: 'void' }).eq('id', parlayId);
    await answerCallbackQuery(callbackQueryId, '❌ Parlay rejected');
    await sendMessage(chatId, `❌ Parlay rejected and voided.`);
    await logActivity('parlay_rejected', `Admin rejected parlay ${parlayId}`, { parlayId });

  } else if (data.startsWith('edit_parlay:')) {
    const parlayId = data.slice('edit_parlay:'.length);
    const { data: parlay } = await supabase
      .from('bot_daily_parlays')
      .select('id, legs, strategy_name, expected_odds')
      .eq('id', parlayId)
      .maybeSingle();

    if (!parlay) {
      await answerCallbackQuery(callbackQueryId, 'Parlay not found');
      return;
    }

    const propLabels: Record<string, string> = {
      threes: '3PT', points: 'PTS', assists: 'AST', rebounds: 'REB',
      steals: 'STL', blocks: 'BLK', pra: 'PRA', goals: 'G',
      shots: 'SOG', saves: 'SVS', aces: 'ACES',
    };

    const legs = Array.isArray(parlay.legs) ? parlay.legs : JSON.parse(parlay.legs || '[]');
    let msg = `✏️ *Editing Parlay* (${(parlay.strategy_name || '').replace(/_/g, ' ')})\n\n`;
    msg += `Tap Flip to change OVER↔UNDER:\n\n`;
    for (let i = 0; i < legs.length; i++) {
      const leg = legs[i];
      const side = (leg.side || 'over').toUpperCase();
      const prop = propLabels[leg.prop_type] || (leg.prop_type || '').toUpperCase();
      msg += `${i + 1}. ${leg.player_name || 'Player'} *${side}* ${leg.line} ${prop}\n`;
    }

    const inline_keyboard: any[][] = [];
    for (let i = 0; i < legs.length; i++) {
      const leg = legs[i];
      const currentSide = (leg.side || 'over').toUpperCase();
      const flipTo = currentSide === 'OVER' ? 'UNDER' : 'OVER';
      inline_keyboard.push([
        { text: `🔄 #${i + 1} → ${flipTo}`, callback_data: `flip_leg:${parlayId}:${i}` },
      ]);
    }
    inline_keyboard.push([{ text: '✅ Done - Approve', callback_data: `approve_parlay:${parlayId}` }]);

    await answerCallbackQuery(callbackQueryId);
    await sendMessage(chatId, msg, 'Markdown', { inline_keyboard });

  } else if (data.startsWith('flip_leg:')) {
    const parts = data.split(':');
    const parlayId = parts[1];
    const legIndex = parseInt(parts[2], 10);

    const { data: parlay } = await supabase
      .from('bot_daily_parlays')
      .select('id, legs, strategy_name')
      .eq('id', parlayId)
      .maybeSingle();

    if (!parlay) {
      await answerCallbackQuery(callbackQueryId, 'Parlay not found');
      return;
    }

    const legs = Array.isArray(parlay.legs) ? parlay.legs : JSON.parse(parlay.legs || '[]');
    if (legIndex < 0 || legIndex >= legs.length) {
      await answerCallbackQuery(callbackQueryId, 'Invalid leg index');
      return;
    }

    // Flip the side
    const currentSide = (legs[legIndex].side || 'over').toLowerCase();
    legs[legIndex].side = currentSide === 'over' ? 'under' : 'over';

    // Save back
    await supabase.from('bot_daily_parlays').update({ legs, approval_status: 'edited' }).eq('id', parlayId);

    const propLabels: Record<string, string> = {
      threes: '3PT', points: 'PTS', assists: 'AST', rebounds: 'REB',
      steals: 'STL', blocks: 'BLK', pra: 'PRA', goals: 'G',
      shots: 'SOG', saves: 'SVS', aces: 'ACES',
    };

    // Re-render edit view
    let msg = `✏️ *Editing Parlay* (${(parlay.strategy_name || '').replace(/_/g, ' ')})\n\n`;
    msg += `🔄 Flipped leg #${legIndex + 1} to ${legs[legIndex].side.toUpperCase()}\n\n`;
    for (let i = 0; i < legs.length; i++) {
      const leg = legs[i];
      const side = (leg.side || 'over').toUpperCase();
      const prop = propLabels[leg.prop_type] || (leg.prop_type || '').toUpperCase();
      msg += `${i + 1}. ${leg.player_name || 'Player'} *${side}* ${leg.line} ${prop}\n`;
    }

    const inline_keyboard: any[][] = [];
    for (let i = 0; i < legs.length; i++) {
      const leg = legs[i];
      const cSide = (leg.side || 'over').toUpperCase();
      const flipTo = cSide === 'OVER' ? 'UNDER' : 'OVER';
      inline_keyboard.push([
        { text: `🔄 #${i + 1} → ${flipTo}`, callback_data: `flip_leg:${parlayId}:${i}` },
      ]);
    }
    inline_keyboard.push([{ text: '✅ Done - Approve', callback_data: `approve_parlay:${parlayId}` }]);

    await answerCallbackQuery(callbackQueryId, `Flipped to ${legs[legIndex].side.toUpperCase()}`);
    await sendMessage(chatId, msg, 'Markdown', { inline_keyboard });
    await logActivity('parlay_leg_flipped', `Admin flipped leg ${legIndex} in parlay ${parlayId}`, { parlayId, legIndex, newSide: legs[legIndex].side });

  } else if (data === 'approve_all_parlays') {
    const today = getEasternDate();
    const { data: pending } = await supabase
      .from('bot_daily_parlays')
      .select('id')
      .eq('parlay_date', today)
      .eq('approval_status', 'pending_approval');

    const count = pending?.length || 0;
    if (count > 0) {
      await supabase.from('bot_daily_parlays')
        .update({ approval_status: 'approved' })
        .eq('parlay_date', today)
        .eq('approval_status', 'pending_approval');
    }

    await answerCallbackQuery(callbackQueryId, `✅ ${count} parlays approved!`);
    await sendMessage(chatId, `✅ All ${count} pending parlays approved! Use /broadcast to send to customers.`);
    await logActivity('parlays_bulk_approved', `Admin approved all ${count} pending parlays`, { count });

  } else if (data.startsWith('fix:')) {
    await handleFixAction(callbackQueryId, data.slice(4), chatId);
  } else {
    await answerCallbackQuery(callbackQueryId, "Unknown action");
  }
}

// ==================== FIX ACTION HANDLER ====================

async function handleFixAction(callbackQueryId: string, action: string, chatId: string) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const fixConfig: Record<string, { label: string; functions: string[] }> = {
    'refresh_props': { label: 'Refresh Props', functions: ['refresh-todays-props'] },
    'calibrate': { label: 'Calibrate Weights', functions: ['calibrate-bot-weights'] },
    'generate': { label: 'Generate Parlays', functions: ['bot-generate-daily-parlays'] },
    'settle': { label: 'Settle Parlays', functions: ['bot-settle-and-learn'] },
    'run_crons': { label: 'Run All Jobs', functions: ['calibrate-bot-weights', 'bot-settle-and-learn', 'bot-generate-daily-parlays'] },
  };

  const config = fixConfig[action];
  if (!config) {
    await answerCallbackQuery(callbackQueryId, "Unknown fix action");
    return;
  }

  await answerCallbackQuery(callbackQueryId, `Running ${config.label}...`);
  await sendMessage(chatId, `⏳ *Running ${config.label}...*`);
  await logActivity("fix_action", `Fix triggered: ${action}`, { chatId, action }, "info");

  const results: string[] = [];
  for (const fnName of config.functions) {
    try {
      const resp = await fetch(`${supabaseUrl}/functions/v1/${fnName}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({}),
      });
      const body = await resp.text();
      if (resp.ok) {
        results.push(`✅ ${fnName}`);
      } else {
        results.push(`❌ ${fnName}: ${resp.status}`);
        console.error(`[Fix] ${fnName} failed:`, body);
      }
    } catch (err) {
      results.push(`❌ ${fnName}: ${err.message}`);
      console.error(`[Fix] ${fnName} error:`, err);
    }
  }

  const summary = `*${config.label} Complete*\n\n${results.join('\n')}`;
  await sendMessage(chatId, summary);
}

// ==================== WEEKLY DIGEST ====================

async function handleWeeklySummary(chatId: string) {
  const d7 = getEasternDateDaysAgo(7);

  const [parlaysRes, daysRes, weightsRes] = await Promise.all([
    supabase.from("bot_daily_parlays").select("strategy_name, outcome, profit_loss").in("outcome", ["won", "lost"]).gte("parlay_date", d7),
    supabase.from("bot_activation_status").select("check_date, daily_profit_loss, is_profitable_day, parlays_won, parlays_lost").gte("check_date", d7).order("check_date"),
    supabase.from("bot_category_weights").select("category, side, current_hit_rate, total_picks").eq("is_blocked", false).not("current_hit_rate", "is", null).order("current_hit_rate", { ascending: false }).limit(5),
  ]);

  const parlays = parlaysRes.data || [];
  const days = daysRes.data || [];
  const topWeights = weightsRes.data || [];

  const wins = parlays.filter(p => p.outcome === 'won').length;
  const totalPL = parlays.reduce((s, p) => s + (p.profit_loss || 0), 0);
  const winDays = days.filter(d => d.is_profitable_day).length;
  const totalDayPL = days.reduce((s, d) => s + (d.daily_profit_loss || 0), 0);

  let msg = `📅 *Weekly Digest*\n`;
  msg += `━━━━━━━━━━━━━━━━━\n\n`;
  msg += `*Parlays:* ${wins}W-${parlays.length - wins}L (${parlays.length > 0 ? (wins / parlays.length * 100).toFixed(0) : 0}%)\n`;
  msg += `*P&L:* ${totalPL >= 0 ? '+' : ''}$${totalPL.toFixed(0)}\n`;
  msg += `*Days:* ${winDays}/${days.length} profitable\n`;
  msg += `*Daily P&L:* ${totalDayPL >= 0 ? '+' : ''}$${totalDayPL.toFixed(0)}\n\n`;

  if (topWeights.length > 0) {
    msg += `*Top Categories:*\n`;
    topWeights.forEach(w => msg += `• ${w.category} ${w.side}: ${(w.current_hit_rate || 0).toFixed(0)}%\n`);
    msg += `\n`;
  }

  // Best strategy this week
  const stratMap: Record<string, { wins: number; total: number }> = {};
  parlays.forEach(p => {
    const s = p.strategy_name || 'unknown';
    if (!stratMap[s]) stratMap[s] = { wins: 0, total: 0 };
    stratMap[s].total++;
    if (p.outcome === 'won') stratMap[s].wins++;
  });
  const bestStrat = Object.entries(stratMap).sort((a, b) => (b[1].wins / b[1].total) - (a[1].wins / a[1].total))[0];
  if (bestStrat) {
    msg += `*Best Strategy:* ${bestStrat[0]} (${(bestStrat[1].wins / bestStrat[1].total * 100).toFixed(0)}% WR)\n`;
  }

  return msg;
}

// ==================== MULTI-SPORT HANDLERS ====================

async function getNHLPicks() {
  const { data } = await supabase
    .from('whale_picks')
    .select('*')
    .eq('sport', 'hockey_nhl')
    .gte('expires_at', new Date().toISOString())
    .order('sharp_score', { ascending: false })
    .limit(5);
  return data || [];
}

async function getTennisPicks() {
  const { data } = await supabase
    .from('whale_picks')
    .select('*')
    .or('sport.eq.tennis_atp,sport.eq.tennis_wta')
    .gte('expires_at', new Date().toISOString())
    .order('sharp_score', { ascending: false })
    .limit(5);
  return data || [];
}

async function getTeamBets(betType: string) {
  const { data } = await supabase
    .from('game_bets')
    .select('*')
    .eq('bet_type', betType)
    .eq('is_active', true)
    .gt('commence_time', new Date().toISOString())
    .order('sharp_score', { ascending: false })
    .limit(5);
  return data || [];
}

async function handleNHL(chatId: string) {
  await logActivity("telegram_nhl", `User requested NHL picks`, { chatId });
  const picks = await getNHLPicks();
  if (picks.length === 0) return "🏒 *NHL Picks*\n\nNo active NHL signals right now.";
  let message = "🏒 *NHL Sharp Signals*\n\n";
  picks.forEach((p, i) => {
    const grade = p.sharp_score >= 80 ? 'A' : p.sharp_score >= 65 ? 'B' : 'C';
    message += `${i + 1}. *${p.player_name}* ${p.stat_type}\n   ${p.recommended_side} ${p.pp_line} (Grade ${grade})\n   📍 ${p.matchup}\n\n`;
  });
  return message;
}

async function handleTennis(chatId: string) {
  await logActivity("telegram_tennis", `User requested Tennis picks`, { chatId });
  const picks = await getTennisPicks();
  if (picks.length === 0) return "🎾 *Tennis Picks*\n\nNo active tennis signals right now.";
  let message = "🎾 *Tennis Sharp Signals*\n\n";
  picks.forEach((p, i) => {
    const grade = p.sharp_score >= 80 ? 'A' : p.sharp_score >= 65 ? 'B' : 'C';
    const tour = p.sport === 'tennis_atp' ? 'ATP' : 'WTA';
    message += `${i + 1}. *${p.player_name}* ${p.stat_type} [${tour}]\n   ${p.recommended_side} ${p.pp_line} (Grade ${grade})\n   📍 ${p.matchup}\n\n`;
  });
  return message;
}

async function handleSpreads(chatId: string) {
  await logActivity("telegram_spreads", `User requested spread signals`, { chatId });
  const bets = await getTeamBets('spread');
  if (bets.length === 0) return "📊 *Spread Signals*\n\nNo active spread signals right now.";
  let message = "📊 *Sharp Spread Signals*\n\n";
  bets.forEach((b: any, i: number) => {
    const grade = (b.sharp_score || 0) >= 80 ? 'A' : (b.sharp_score || 0) >= 65 ? 'B' : 'C';
    const line = b.line > 0 ? `+${b.line}` : b.line;
    message += `${i + 1}. *${b.away_team} @ ${b.home_team}*\n   ${b.recommended_side || 'TBD'} ${line} (Grade ${grade})\n\n`;
  });
  return message;
}

async function handleTotals(chatId: string) {
  await logActivity("telegram_totals", `User requested totals signals`, { chatId });
  const bets = await getTeamBets('total');
  if (bets.length === 0) return "🎯 *Totals Signals*\n\nNo active O/U signals right now.";
  let message = "🎯 *Sharp Totals Signals*\n\n";
  bets.forEach((b: any, i: number) => {
    const grade = (b.sharp_score || 0) >= 80 ? 'A' : (b.sharp_score || 0) >= 65 ? 'B' : 'C';
    message += `${i + 1}. *${b.away_team} @ ${b.home_team}*\n   ${b.recommended_side || 'TBD'} ${b.line} (Grade ${grade})\n\n`;
  });
  return message;
}

// ==================== TIER HANDLERS ====================

async function handleLearning(chatId: string) {
  await logActivity("telegram_learning", `User requested learning metrics`, { chatId });
  const { data: parlays } = await supabase.from('bot_daily_parlays').select('strategy_name, outcome').not('outcome', 'is', null);
  const tierStats: Record<string, { total: number; won: number; lost: number }> = {
    exploration: { total: 0, won: 0, lost: 0 }, validation: { total: 0, won: 0, lost: 0 }, execution: { total: 0, won: 0, lost: 0 },
  };
  (parlays || []).forEach((p: any) => {
    const sn = (p.strategy_name || '').toLowerCase();
    const tier = sn.includes('exploration') ? 'exploration' : sn.includes('validation') ? 'validation' : 'execution';
    if (tierStats[tier]) { tierStats[tier].total++; if (p.outcome === 'won') tierStats[tier].won++; if (p.outcome === 'lost') tierStats[tier].lost++; }
  });
  let message = `📊 *Learning Velocity*\n\n`;
  for (const [tier, stats] of Object.entries(tierStats)) {
    const winRate = stats.total > 0 ? (stats.won / stats.total * 100).toFixed(1) : '0';
    const target = tier === 'exploration' ? 500 : 300;
    const progress = Math.min(100, (stats.total / target) * 100).toFixed(0);
    const emoji = tier === 'exploration' ? '🔬' : tier === 'validation' ? '✓' : '🚀';
    message += `${emoji} *${tier.charAt(0).toUpperCase() + tier.slice(1)}*\n   ${stats.total}/${target} samples (${progress}%)\n   ${stats.won}W-${stats.lost}L (${winRate}% WR)\n\n`;
  }
  const totalSamples = Object.values(tierStats).reduce((s, t) => s + t.total, 0);
  const avgProgress = Object.values(tierStats).reduce((s, t) => {
    const target = t === tierStats.exploration ? 500 : 300;
    return s + Math.min(100, (t.total / target) * 100);
  }, 0) / 3;
  message += `📈 *Overall:* ${totalSamples} samples, ${avgProgress.toFixed(0)}% to confidence`;
  return message;
}

async function handleTiers(chatId: string) {
  await logActivity("telegram_tiers", `User requested tier summary`, { chatId });
  const today = getEasternDate();
  const { data: todayParlays } = await supabase.from('bot_daily_parlays').select('strategy_name, leg_count, outcome, expected_odds').eq('parlay_date', today);
  const tiers: Record<string, any[]> = { exploration: [], validation: [], execution: [] };
  (todayParlays || []).forEach((p: any) => {
    const sn = (p.strategy_name || '').toLowerCase();
    const tier = sn.includes('exploration') ? 'exploration' : sn.includes('validation') ? 'validation' : 'execution';
    if (tiers[tier]) tiers[tier].push(p);
  });
  let message = `🎯 *Today's Tier Summary*\n\n`;
  const tierEmoji = { exploration: '🔬', validation: '✓', execution: '🚀' };
  const tierDesc = { exploration: 'Edge discovery ($0)', validation: 'Pattern confirm ($50)', execution: 'Best bets (Kelly)' };
  for (const [tier, parlays] of Object.entries(tiers)) {
    const emoji = tierEmoji[tier as keyof typeof tierEmoji];
    const desc = tierDesc[tier as keyof typeof tierDesc];
    if (parlays.length === 0) { message += `${emoji} *${tier}:* 0 parlays\n\n`; } else {
      const legDist = parlays.reduce((acc, p) => { acc[p.leg_count] = (acc[p.leg_count] || 0) + 1; return acc; }, {} as Record<number, number>);
      message += `${emoji} *${tier}* (${parlays.length})\n   ${desc}\n   ${Object.entries(legDist).map(([l, c]) => `${l}-leg: ${c}`).join(', ')}\n\n`;
    }
  }
  const total = Object.values(tiers).reduce((s, t) => s + t.length, 0);
  message += `📊 *Total:* ${total} parlays generated today`;
  return message;
}

async function handleExplore(chatId: string) {
  await logActivity("telegram_explore", `User requested exploration tier`, { chatId });
  const today = getEasternDate();
  const { data: allParlays } = await supabase.from('bot_daily_parlays').select('*').eq('parlay_date', today).order('combined_probability', { ascending: false });
  const exploreParlays = (allParlays || []).filter((p: any) => {
    const sn = (p.strategy_name || '').toLowerCase();
    return sn.includes('exploration') || sn.includes('explore') || sn.includes('cross_sport') || sn.includes('team_') || sn.includes('props_') || sn.includes('tennis_') || sn.includes('nhl_') || sn.includes('max_diversity');
  });
  if (exploreParlays.length === 0) return "🔬 *Exploration Tier*\n\nNo exploration parlays generated today.\n\nUse /generate to create tiered parlays!";
  let message = `🔬 *Exploration Tier Highlights* (${exploreParlays.length} total)\n\n_Edge discovery parlays ($0 stake)_\n\n`;
  exploreParlays.slice(0, 5).forEach((p: any, i: number) => {
    const legs = Array.isArray(p.legs) ? p.legs : JSON.parse(p.legs || '[]');
    const topLegs = legs.slice(0, 3).map((l: any) => formatLegDisplay(l)).join('\n   ');
    message += `${i + 1}. *${p.leg_count}-leg* +${p.expected_odds}\n   ${topLegs}${legs.length > 3 ? `\n   +${legs.length - 3} more` : ''}\n   Win Rate: ${(p.combined_probability * 100).toFixed(1)}%\n\n`;
  });
  if (exploreParlays.length > 5) message += `... +${exploreParlays.length - 5} more exploration parlays`;
  return message;
}

async function handleValidate(chatId: string) {
  await logActivity("telegram_validate", `User requested validation tier`, { chatId });
  const today = getEasternDate();
  const { data: allParlays } = await supabase.from('bot_daily_parlays').select('*').eq('parlay_date', today).order('simulated_edge', { ascending: false });
  const validateParlays = (allParlays || []).filter((p: any) => {
    const sn = (p.strategy_name || '').toLowerCase();
    return sn.includes('validation') || sn.includes('validated');
  });
  if (validateParlays.length === 0) return "✓ *Validation Tier*\n\nNo validation parlays generated today.\n\nUse /generate to create tiered parlays!";
  let message = `✓ *Validation Tier Picks* (${validateParlays.length} total)\n\n_Pattern confirmation ($50 stake)_\n\n`;
  validateParlays.slice(0, 5).forEach((p: any, i: number) => {
    const legs = Array.isArray(p.legs) ? p.legs : JSON.parse(p.legs || '[]');
    const topLegs = legs.slice(0, 3).map((l: any) => formatLegDisplay(l)).join('\n   ');
    message += `${i + 1}. *${p.leg_count}-leg* +${p.expected_odds}\n   ${topLegs}${legs.length > 3 ? `\n   +${legs.length - 3} more` : ''}\n   Edge: ${((p.simulated_edge || 0) * 100).toFixed(1)}%\n\n`;
  });
  if (validateParlays.length > 5) message += `... +${validateParlays.length - 5} more validation parlays`;
  return message;
}

async function handleResearch(chatId: string) {
  await logActivity("telegram_research", "User triggered AI research agent", { chatId });
  await sendMessage(chatId, "🔬 Running AI research agent... This may take a minute.");
  try {
    const { data, error } = await supabase.functions.invoke('ai-research-agent');
    if (error) { console.error('[Research] Invoke error:', error); return "❌ Research agent failed to run."; }
    if (!data?.success) return `❌ Research agent error: ${data?.error || 'Unknown'}`;
    const categoryLabels: Record<string, string> = { competing_ai: '🤖 Competing AI', statistical_models: '📊 Statistical Models', injury_intel: '🏥 Injury Intel' };
    let message = `✅ *Research Complete*\n\n`;
    for (const f of (data.findings || [])) {
      const label = categoryLabels[f.category] || f.category;
      const relevance = f.relevance >= 0.65 ? 'high' : f.relevance >= 0.40 ? 'medium' : 'low';
      message += `${label}: ${f.insightsCount} insights (${relevance} relevance)\n`;
    }
    message += `\n📈 ${data.actionableCount}/${data.findingsCount} categories with actionable intel`;
    return message;
  } catch (err) { console.error('[Research] Error:', err); return "❌ Research agent failed unexpectedly."; }
}

// ==================== /parlay HANDLER ====================

async function handleParlayStatus(chatId: string) {
  await logActivity("telegram_parlay", "User requested /parlay summary", { chatId });
  const today = getEasternDate();

  const [parlaysRes, weightsRes, statusData] = await Promise.all([
    supabase.from("bot_daily_parlays").select("*").eq("parlay_date", today).eq("outcome", "pending").order("combined_probability", { ascending: false }),
    supabase.from("bot_category_weights").select("category, side, weight, current_hit_rate").eq("is_blocked", false).order("weight", { ascending: false }).limit(20),
    getStatus(),
  ]);

  const pendingParlays = parlaysRes.data || [];
  if (pendingParlays.length === 0) {
    const perfData = await getPerformance();
    return `🎯 *Today's Parlays*\n\nNo pending parlays for today.\n\n*Stats:* ${perfData.wins}W-${perfData.losses}L (${perfData.winRate.toFixed(1)}%)\n*Mode:* ${statusData.mode}\n*Bankroll:* $${statusData.bankroll?.toFixed(0) || "1,000"}\n\nUse /generate to create new parlays!`;
  }

  // Extract and deduplicate legs
  const weightMap = new Map<string, number>();
  (weightsRes.data || []).forEach((w: any) => weightMap.set(`${w.category}_${w.side}`, w.weight || 0));

  const seenLegs = new Set<string>();
  const allLegs: Array<{ display: string; weight: number; verified: boolean }> = [];

  for (const p of pendingParlays) {
    const legs = Array.isArray(p.legs) ? p.legs : JSON.parse(p.legs || '[]');
    for (const leg of legs) {
      const key = leg.type === 'team' 
        ? `team_${(leg.home_team || '').toLowerCase()}_${leg.bet_type}_${leg.side}`
        : `${(leg.player_name || '').toLowerCase()}_${leg.prop_type}_${leg.side}`;
      if (seenLegs.has(key)) continue;
      seenLegs.add(key);
      const w = weightMap.get(`${leg.category || leg.prop_type}_${leg.side}`) || 0;
      const hasRealLine = leg.has_real_line || leg.verified_line || leg.bookmaker;
      allLegs.push({ display: formatLegDisplay(leg), weight: w, verified: !!hasRealLine });
    }
  }

  allLegs.sort((a, b) => b.weight - a.weight);
  const topLegs = allLegs.slice(0, 8);

  const perfData = await getPerformance();

  let message = `🎯 *Today's Pending Parlays* (${pendingParlays.length})\n\n`;
  message += `*Top Legs:*\n`;
  topLegs.forEach((leg, i) => {
    const badge = leg.verified ? '✅' : '⚠️';
    message += `${i + 1}. ${leg.display} ${badge}\n`;
  });
  if (allLegs.length > 8) message += `_+${allLegs.length - 8} more legs_\n`;

  message += `\n*Mode:* ${statusData.mode}\n`;
  message += `*Bankroll:* $${statusData.bankroll?.toFixed(0) || "1,000"}\n`;
  message += `*ROI:* ${perfData.roi.toFixed(1)}% | *WR:* ${perfData.winRate.toFixed(1)}%\n`;
  message += `\n✅ = Verified line | ⚠️ = Projected`;

  return message;
}

// ==================== CANCEL SUBSCRIPTION HANDLER ====================

import Stripe from "https://esm.sh/stripe@18.5.0";

async function handleCancelSubscription(chatId: string): Promise<string> {
  // Look up user in bot_authorized_users
  const { data: authUser } = await supabase
    .from("bot_authorized_users")
    .select("chat_id, username")
    .eq("chat_id", chatId)
    .eq("is_active", true)
    .maybeSingle();

  if (!authUser) {
    return "❌ You don't appear to have an active account. Contact support.";
  }

  // Find email from email_subscribers by matching chat_id metadata or by looking up linked email
  const { data: emailRecord } = await supabase
    .from("email_subscribers")
    .select("email")
    .eq("telegram_chat_id", chatId)
    .maybeSingle();

  // Fallback: try to find by username match
  let customerEmail = emailRecord?.email;
  if (!customerEmail && authUser.username) {
    const { data: byUsername } = await supabase
      .from("email_subscribers")
      .select("email")
      .eq("telegram_username", authUser.username)
      .maybeSingle();
    customerEmail = byUsername?.email;
  }

  if (!customerEmail) {
    return "❌ Could not find your subscription email. Please contact admin for help cancelling.";
  }

  // Send confirmation with inline button
  await sendMessage(chatId, 
    `⚠️ *Cancel Subscription?*\n\nThis will cancel your subscription at the end of the current billing period. You'll keep access until then.\n\nEmail: ${customerEmail}`,
    "Markdown",
    {
      inline_keyboard: [[
        { text: "✅ Yes, Cancel", callback_data: `cancel_sub_confirm:${customerEmail}` },
        { text: "❌ Keep It", callback_data: "cancel_sub_abort" },
      ]]
    }
  );
  return null as any; // Already sent
}

async function executeCancelSubscription(chatId: string, email: string): Promise<void> {
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  if (!stripeKey) {
    await sendMessage(chatId, "❌ Stripe is not configured. Contact admin.");
    return;
  }

  const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

  try {
    // Find Stripe customer
    const customers = await stripe.customers.list({ email, limit: 1 });
    if (customers.data.length === 0) {
      await sendMessage(chatId, "❌ No Stripe customer found for your email. Contact admin.");
      return;
    }

    const customerId = customers.data[0].id;

    // Find active/trialing subscriptions
    const [activeSubs, trialingSubs] = await Promise.all([
      stripe.subscriptions.list({ customer: customerId, status: "active", limit: 5 }),
      stripe.subscriptions.list({ customer: customerId, status: "trialing", limit: 5 }),
    ]);

    const allSubs = [...activeSubs.data, ...trialingSubs.data];
    if (allSubs.length === 0) {
      await sendMessage(chatId, "❌ No active subscription found. You may have already cancelled.");
      return;
    }

    // Cancel at period end (graceful)
    const sub = allSubs[0];
    await stripe.subscriptions.update(sub.id, { cancel_at_period_end: true });

    const endDate = new Date(sub.current_period_end * 1000);
    const endStr = endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    await sendMessage(chatId, `✅ *Subscription Cancelled*\n\nYour subscription will end on *${endStr}*. You'll keep full access until then.\n\nIf you change your mind, contact admin to reactivate.`);

    // Notify admin
    if (ADMIN_CHAT_ID) {
      const { data: authUser } = await supabase
        .from("bot_authorized_users")
        .select("username")
        .eq("chat_id", chatId)
        .maybeSingle();
      const username = authUser?.username ? `@${authUser.username}` : chatId;
      await sendMessage(ADMIN_CHAT_ID, `🚫 *Subscription Cancelled*\n\nCustomer: ${username}\nEmail: ${email}\nChat ID: ${chatId}\nAccess ends: ${endStr}`);
    }

    await logActivity("subscription_cancelled", `Customer ${chatId} cancelled subscription`, { chatId, email, endDate: endStr });
  } catch (error) {
    console.error("Cancel subscription error:", error);
    await sendMessage(chatId, "❌ Failed to cancel subscription. Please contact admin.");
  }
}

// ==================== ADMIN CHECK ====================

const ADMIN_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID");
const isAdmin = (chatId: string) => chatId === ADMIN_CHAT_ID;

// Customer-facing /start message (for authorized users)
async function handleCustomerStart(chatId: string) {
  await logActivity("telegram_start", `Customer started bot chat`, { chatId });
  return `🌾 *Welcome to Parlay Farm!*

💰 *Recommended Starter Balance:* $200–$400
📊 *Stake $10–$20 per parlay*

*Commands:*
/parlays — Today's picks
/calendar — Your monthly P&L
/roi — Your ROI breakdown
/streaks — Hot & cold streaks
/help — All commands

One winning day can return 10x your investment. 🚀

💬 Or just *ask me anything* in plain English!`;
}

// ==================== CUSTOMER AI Q&A ====================

async function handleCustomerQuestion(message: string, chatId: string): Promise<string> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) {
    return "I'm not able to answer questions right now. Use /parlays, /performance, or /help to check the bot.";
  }

  try {
    const history = await getConversationHistory(chatId, 6);
    const [parlays, performance] = await Promise.all([getParlays(), getPerformance()]);

    const systemPrompt = `You are ParlayIQ Bot, a friendly sports betting assistant for Parlay Farm members.
You help members understand today's picks and track their performance.

CURRENT DATA:
- Today's Parlays: ${parlays.count} generated
- Distribution: ${Object.entries(parlays.distribution).map(([l, c]) => `${l}-leg: ${c}`).join(', ') || 'None'}
- Performance: ${performance.winRate.toFixed(1)}% win rate, ${performance.roi.toFixed(1)}% ROI
- Record: ${performance.wins}W - ${performance.losses}L

RULES:
- Be friendly, concise, and helpful (under 400 chars when possible)
- Never share admin controls, internal weights, or system configuration
- If asked about specific picks, direct them to /parlays
- If asked about ROI or stats, give the real numbers above
- Use Telegram Markdown (*bold*, _italic_) and emojis
- If you can't answer something, say "Try /help to see what I can show you"`;

    const messages = [
      { role: "system" as const, content: systemPrompt },
      ...history.map(h => ({ role: h.role as "user" | "assistant", content: h.content })),
      { role: "user" as const, content: message },
    ];

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "google/gemini-3-flash-preview", messages, max_tokens: 400 }),
    });

    if (!response.ok) return "I'm having trouble right now. Try /parlays or /performance.";
    const data = await response.json();
    return data.choices?.[0]?.message?.content || "Use /help to see available commands.";
  } catch {
    return "Something went wrong. Use /parlays or /help for quick info.";
  }
}

// ==================== MAIN ROUTER ====================

async function handleMessage(chatId: string, text: string, username?: string) {
  const parts = text.trim().split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1).join(' ');

  // Admin always bypasses authorization
  if (isAdmin(chatId)) {
    // Admin /start
    if (cmd === "/start") return await handleStart(chatId);
    if (cmd === "/parlays") { await handleParlays(chatId); return null; }
    if (cmd === "/parlay") return await handleParlayStatus(chatId);
    if (cmd === "/performance") return await handlePerformance(chatId);
    if (cmd === "/calendar") return await handleCalendar(chatId);
    if (cmd === "/roi") return await handleRoi(chatId);
    if (cmd === "/streaks") return await handleStreaks(chatId);
    if (cmd === "/help") {
      return `📋 *Available Commands*

/parlays — Today's picks
/parlay — Pending summary
/performance — Win rate & ROI
/calendar — Monthly P&L (bot)
/roi — Detailed ROI breakdown
/streaks — Hot & cold streaks
/status — Bot status
/compare — Compare strategies
/sharp — Sharp signals
/avoid — Avoid patterns
/backtest — Run backtest
/watch — Watch picks
/pause / /resume — Pause/resume bot
/bankroll — Set bankroll
/force-settle — Force settle
/subscribe / /unsubscribe — Alerts
/export — Export data
/digest — Weekly summary

*User Management:*
/setpassword [pw] [max] — Create password
/grantaccess [chat\\_id] — Grant access
/revokeaccess [chat\\_id] — Revoke access
/listusers — List all users

*Management:*
/deleteparlay [id] — Void a parlay
/voidtoday — Void all pending today
/fixleg [id] [idx] [field] [val] — Fix leg
/deletesweep — Void sweep parlays
/deletebystrat [name] — Void by strategy
/fixpipeline — Run full pipeline
/regenparlay — Void & regenerate
/fixprops — Refresh props + regen
/healthcheck — Preflight + integrity
/errorlog — Last 10 errors

💬 Or just ask me anything!`;
    }
    // Admin user management commands
    if (cmd === "/setpassword") return await handleSetPassword(chatId, args);
    if (cmd === "/grantaccess") return await handleGrantAccess(chatId, args);
    if (cmd === "/listusers") return await handleListUsers(chatId);
    if (cmd === "/revokeaccess") return await handleRevokeAccess(chatId, args);
    // Admin-only operational commands
    if (cmd === "/status") return await handleStatus(chatId);
    if (cmd === "/compare") return await handleCompare(chatId);
    if (cmd === "/sharp") return await handleSharp(chatId);
    if (cmd === "/avoid") return await handleAvoid(chatId);
    if (cmd === "/backtest") return await handleBacktest(chatId, args);
    if (cmd === "/watch") return await handleWatch(chatId, args);
    if (cmd === "/pause") return await handlePause(chatId);
    if (cmd === "/resume") return await handleResume(chatId);
    if (cmd === "/bankroll") return await handleBankroll(chatId, args);
    if (cmd === "/force-settle") return await handleForceSettle(chatId, args);
    if (cmd === "/subscribe") return await handleSubscribe(chatId);
    if (cmd === "/unsubscribe") return await handleUnsubscribe(chatId, args);
    if (cmd === "/export") { await handleExport(chatId, args); return null; }
    if (cmd === "/digest") return await handleWeeklySummary(chatId);
    if (cmd === "/mispriced") { await handleMispriced(chatId, 1); return null; }
    if (cmd === "/highconv") { await handleHighConv(chatId, 1); return null; }
    if (cmd === "/runmispriced") return await handleTriggerFunction(chatId, 'detect-mispriced-lines', 'Mispriced Lines Scan');
    if (cmd === "/runhighconv") return await handleTriggerFunction(chatId, 'high-conviction-analyzer', 'High-Conviction Analyzer');
    if (cmd === "/doubleconfirmed") return await handleTriggerFunction(chatId, 'double-confirmed-scanner', 'Double-Confirmed Scanner');
    if (cmd === "/rundoubleconfirmed") return await handleTriggerFunction(chatId, 'double-confirmed-scanner', 'Double-Confirmed Scanner');
    if (cmd === "/pitcherk") { await handlePitcherK(chatId, 1); return null; }
    if (cmd === "/runpitcherk") return await handleTriggerFunction(chatId, 'mlb-pitcher-k-analyzer', 'Pitcher K Analyzer');
    if (cmd === "/mlb") { await handleMLB(chatId); return null; }
    if (cmd === "/runmlbbatter") return await handleTriggerFunction(chatId, 'mlb-batter-analyzer', 'MLB Batter Analyzer');
    if (cmd === "/forcegen") return await handleTriggerFunction(chatId, 'bot-force-fresh-parlays', 'Force Fresh Parlays');
    if (cmd === "/deleteparlay") return await handleDeleteParlay(chatId, args);
    if (cmd === "/voidtoday") { await handleVoidToday(chatId); return null; }
    if (cmd === "/fixleg") return await handleFixLeg(chatId, args);
    if (cmd === "/deletesweep") return await handleDeleteSweep(chatId);
    if (cmd === "/deletebystrat") return await handleDeleteByStrat(chatId, args);
    if (cmd === "/fixpipeline") { const r = await handleFixPipeline(chatId); return r; }
    if (cmd === "/regenparlay") { const r = await handleRegenParlay(chatId); return r; }
    if (cmd === "/fixprops") { const r = await handleFixProps(chatId); return r; }
    if (cmd === "/healthcheck") { const r = await handleHealthcheck(chatId); return r; }
    if (cmd === "/errorlog") return await handleErrorLog(chatId);
    if (cmd === "/broadcast") { await handleBroadcast(chatId); return null; }

    // Generic edge function trigger handler
    async function handleTriggerFunction(cid: string, fnName: string, label: string): Promise<string> {
      await logActivity(`telegram_${fnName}`, `Admin triggered ${label}`, { chatId: cid });
      await sendMessage(cid, `⏳ Running *${label}*...`, "Markdown");
      try {
        const resp = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/${fnName}`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        });
        if (!resp.ok) {
          const errText = await resp.text();
          return `❌ *${label}* failed (${resp.status}):\n${errText.slice(0, 200)}`;
        }
        const data = await resp.json();
        const summary = JSON.stringify(data).slice(0, 300);
        return `✅ *${label}* complete!\n\n\`${summary}\``;
      } catch (err) {
        return `❌ *${label}* error: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    // Admin natural language fallback
    await saveConversation(chatId, "user", text);
    await logActivity("telegram_message", `User sent message`, { chatId, messagePreview: text.slice(0, 50) });
    const response = await handleNaturalLanguage(text, chatId);
    await saveConversation(chatId, "assistant", response);
    return response;
  }

  // ===== NON-ADMIN (CUSTOMER) FLOW =====

  // /start: check authorization
  if (cmd === "/start") {
    const authorized = await isAuthorized(chatId);
    if (authorized) {
      return await handleCustomerStart(chatId);
    }
    // Not authorized — prompt for password
    await logActivity("telegram_start_unauthorized", `Unauthorized user attempted /start`, { chatId, username });
    return `🌾 *Welcome to Parlay Farm!*\n\n🔒 This bot requires an access password.\n\nPlease enter your password below:`;
  }

  // Check if user is authorized for all other interactions
  const authorized = await isAuthorized(chatId);

  if (!authorized) {
    // Not authorized — treat any message as a password attempt
    if (cmd.startsWith('/')) {
      return "🔒 You need to be authorized first.\n\nSend /start to begin the access process.";
    }
    const result = await tryPasswordAuth(chatId, text.trim(), username);
    return result.message;
  }

  // ===== AUTHORIZED CUSTOMER COMMANDS =====
  if (cmd === "/parlays") { await handleParlays(chatId); return null; }
  if (cmd === "/calendar") return await handleCustomerCalendar(chatId);
  if (cmd === "/roi") return await handleCustomerRoi(chatId);
  if (cmd === "/streaks") return await handleStreaks(chatId);
  if (cmd === "/cancel") return await handleCancelSubscription(chatId);
  if (cmd === "/help") {
    return `📋 *Parlay Farm — Help*

*Commands:*
/parlays — Today's full pick list
/calendar — Your monthly P&L
/roi — Your personal ROI
/streaks — Hot & cold streaks
/cancel — Cancel your subscription

💬 *Ask me anything:*
Just type a question in plain English! Examples:
• "How are we doing this week?"
• "Which picks look the strongest today?"
• "What's my ROI this month?"
• "Is today a good day to bet?"`;
  }

  // Block unknown slash commands
  if (cmd.startsWith('/')) {
    return "🔒 This command is not available.\n\nUse /help to see your commands, or just ask me a question!";
  }

  // Customer AI Q&A fallback
  await saveConversation(chatId, "user", text);
  const response = await handleCustomerQuestion(text, chatId);
  await saveConversation(chatId, "assistant", response);
  return response;
}

// Main server
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const secret = url.searchParams.get("secret");
  const expectedSecret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");

  if (expectedSecret && secret !== expectedSecret) {
    console.error("Invalid webhook secret");
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const update = await req.json();
    console.log("Received Telegram update:", JSON.stringify(update));

    // Handle callback queries (inline button presses)
    if (update.callback_query) {
      const cbChatId = update.callback_query.message?.chat?.id?.toString();
      const cbData = update.callback_query.data;
      const cbId = update.callback_query.id;
      if (cbChatId && cbData && cbId) {
        await handleCallbackQuery(cbId, cbData, cbChatId);
      }
      return new Response("OK", { status: 200 });
    }

    // Handle message
    if (update.message?.text) {
      const chatId = update.message.chat.id.toString();
      const text = update.message.text;
      const username = update.message.from?.username || undefined;

      const response = await handleMessage(chatId, text, username);
      if (response) await sendMessage(chatId, response);
    }

    // Handle weekly digest cron trigger
    if (update.cron === "weekly_digest") {
      const chatId = Deno.env.get("TELEGRAM_CHAT_ID");
      if (chatId) {
        const digest = await handleWeeklySummary(chatId);
        await sendMessage(chatId, digest);
      }
      return new Response("OK", { status: 200 });
    }

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("Webhook error:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
});
