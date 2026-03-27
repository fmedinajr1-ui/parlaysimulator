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

// Shared prop labels
const PROP_LABELS: Record<string, string> = {
  threes: '3PT', points: 'PTS', assists: 'AST', rebounds: 'REB',
  steals: 'STL', blocks: 'BLK', turnovers: 'TO', pra: 'PRA',
  pts_rebs: 'P+R', pts_asts: 'P+A', rebs_asts: 'R+A',
  three_pointers_made: '3PT', fantasy_score: 'FPTS',
  goals: 'G', shots: 'SOG', saves: 'SVS', aces: 'ACES', games: 'GAMES',
  assists_nhl: 'A', spread: 'SPR', total: 'TOT', moneyline: 'ML', h2h: 'ML',
  player_points: 'PTS', player_rebounds: 'REB', player_assists: 'AST',
  player_threes: '3PT', player_blocks: 'BLK', player_steals: 'STL',
  player_turnovers: 'TO', player_pra: 'PRA', player_pts_rebs: 'P+R',
  player_pts_asts: 'P+A', player_rebs_asts: 'R+A',
  player_double_double: 'DD', player_triple_double: 'TD',
  player_goals: 'G', player_shots_on_goal: 'SOG', player_blocked_shots: 'BLK',
  player_power_play_points: 'PPP', player_points_nhl: 'PTS',
  player_assists_nhl: 'A', player_saves: 'SVS',
  pitcher_strikeouts: 'Ks', total_bases: 'TB', hits: 'H',
  runs: 'R', rbis: 'RBI', stolen_bases: 'SB', walks: 'BB',
  hitter_fantasy_score: 'FPTS', batter_home_runs: 'HR',
  player_fantasy_score: 'FPTS',
};

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

  // Map email to chat_id for auto-deactivation on subscription cancellation
  if (pwRecord.email) {
    await supabase.from("email_subscribers").upsert({
      email: pwRecord.email,
      telegram_chat_id: chatId,
      telegram_username: username || null,
      is_subscribed: true,
      source: "bot_activation",
      subscribed_at: new Date().toISOString(),
    }, { onConflict: "email" });
    await logActivity("email_mapped", `Mapped email ${pwRecord.email} to chat_id ${chatId}`, { chatId, email: pwRecord.email });
  }

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
/research /watch [player] /extras /engineaccuracy

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
  
  // Fetch today's pending parlays only (exclude voided + lost)
   const { data: allParlays } = await supabase
     .from("bot_daily_parlays")
     .select("*")
     .eq("parlay_date", today)
     .eq("outcome", "pending")
     .order("created_at", { ascending: false });

   // Count voided + lost for context
   const { count: voidedCount } = await supabase
     .from("bot_daily_parlays")
     .select("*", { count: "exact", head: true })
     .eq("parlay_date", today)
     .eq("outcome", "voided");
   const { count: lostCount } = await supabase
     .from("bot_daily_parlays")
     .select("*", { count: "exact", head: true })
     .eq("parlay_date", today)
     .eq("outcome", "lost");

  if (!allParlays || allParlays.length === 0) {
    const voidedNote = voidedCount ? `\n\n🗑 ${voidedCount} parlay(s) voided by DNA audit.` : '';
    return `📭 No active parlays today.${voidedNote}\n\nUse /generate to create new parlays!`;
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

  const voidedNote = voidedCount ? `\n🗑 ${voidedCount} voided by DNA audit` : '';

  let message = `🎯🔥 *TODAY'S PARLAYS* 🔥🎯\n`;
  message += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  message += `Showing ${startIdx + 1}-${endIdx} of ${totalParlays} active parlays${voidedNote}\n`;
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

    // Fetch trap analysis for all legs in this page
    const allPageLegs: { event_id: string; outcome_name: string }[] = [];
    for (const pp of pageParlays) {
      const pLegs = Array.isArray(pp.legs) ? pp.legs : JSON.parse(pp.legs || '[]');
      for (const l of pLegs) {
        if (l.event_id && l.player_name) {
          allPageLegs.push({ event_id: l.event_id, outcome_name: `${l.player_name} ${(l.side || 'over').toLowerCase()} ${l.line}` });
        }
      }
    }
    // Batch fetch cached trap data
    const trapMap = new Map<string, { risk_label: string; trap_probability: number }>();
    if (allPageLegs.length > 0) {
      const eventIds = [...new Set(allPageLegs.map(l => l.event_id))];
      const { data: trapRows } = await supabase
        .from('trap_probability_analysis')
        .select('event_id, outcome_name, risk_label, trap_probability')
        .in('event_id', eventIds.slice(0, 50));
      for (const t of trapRows || []) {
        trapMap.set(`${t.event_id}`, { risk_label: t.risk_label, trap_probability: t.trap_probability });
      }
    }

    const globalIdx = startIdx + i + 1;
    const outcomeEmoji = p.outcome === 'won' ? '✅' : p.outcome === 'lost' ? '❌' : '⏳';
    const oddsStr = p.expected_odds > 0 ? `+${p.expected_odds}` : `${p.expected_odds}`;
    message += `  ${globalIdx}. 🎲 (${p.leg_count}-leg) ${oddsStr} ${outcomeEmoji}\n`;
    
    const legs = Array.isArray(p.legs) ? p.legs : JSON.parse(p.legs || '[]');
    for (const leg of legs) {
      const legText = formatLegDisplay(leg);
      const legLines = legText.split('\n');
      // Append trap indicator if cached
      let trapTag = '';
      if (leg.event_id) {
        const trap = trapMap.get(leg.event_id);
        if (trap) {
          trapTag = trap.risk_label === 'High' ? ' ⚠️TRAP' : trap.risk_label === 'Medium' ? ' 🟡CAUTION' : ' ✅SAFE';
        }
      }
      message += `     ${legLines[0]}${trapTag}\n`;
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
      player_points: 'PTS', player_rebounds: 'REB', player_assists: 'AST',
      player_threes: '3PT', player_blocks: 'BLK', player_steals: 'STL',
      player_turnovers: 'TO', player_pra: 'PRA', player_pts_rebs: 'P+R',
      player_pts_asts: 'P+A', player_rebs_asts: 'R+A',
      player_double_double: 'DD', player_triple_double: 'TD',
      player_goals: 'G', player_shots_on_goal: 'SOG', player_blocked_shots: 'BLK',
      player_power_play_points: 'PPP', player_points_nhl: 'PTS',
      player_assists_nhl: 'A', player_saves: 'SVS',
      pitcher_strikeouts: 'Ks', total_bases: 'TB', hits: 'H',
      runs: 'R', rbis: 'RBI', stolen_bases: 'SB', walks: 'BB',
      hitter_fantasy_score: 'FPTS', batter_home_runs: 'HR',
      player_fantasy_score: 'FPTS',
    };
    // Sport-specific emoji
    const sportKey = (leg.sport || leg.category || '').toLowerCase();
    let sportEmoji = '🏀';
    if (sportKey.includes('nhl') || sportKey.includes('hockey')) sportEmoji = '🏒';
    else if (sportKey.includes('mlb') || sportKey.includes('baseball') || sportKey.includes('pitcher') || sportKey.includes('hitter') || sportKey.includes('batter')) sportEmoji = '⚾';
    else if (sportKey.includes('ncaab')) sportEmoji = '🏀';
    else if (sportKey.includes('nfl') || sportKey.includes('ncaaf')) sportEmoji = '🏈';

    const name = leg.player_name || 'Player';
    const side = (leg.side || 'over').toUpperCase();
    const line = leg.line || leg.selected_line || '';
    const propType = propLabels[leg.prop_type] || (leg.prop_type || '').toUpperCase();
    actionLine = `${sportEmoji} Take ${name} ${side} ${line} ${propType} ${odds}`;
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
    .select("authorized_at, bankroll")
    .eq("chat_id", chatId)
    .maybeSingle();

  const currentBankroll = authUser?.bankroll || 500;

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const monthStart = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month + 1, 0).getDate();
  const monthEnd = `${year}-${String(month + 1).padStart(2, '0')}-${lastDay}`;

  const { data: days } = await supabase
    .from('customer_daily_pnl')
    .select('pnl_date, daily_profit_loss, parlays_won, parlays_lost, parlays_total, bankroll')
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

  // Get latest bankroll from customer_daily_pnl or bot_authorized_users
  const latestBankroll = days[days.length - 1]?.bankroll || currentBankroll || 0;

  return `📅 *${monthName} — Your P&L*\n\n📆 Member since: ${joinStr}\n💰 Bankroll: $${latestBankroll.toLocaleString()}\n\n*Record:* ${winDays}W - ${lossDays}L (${winPct}%)\n*Total P&L:* ${fmtPnL(totalPnL)}\n*Parlays:* ${totalWon}W - ${totalLost}L\n*Best Day:* ${fmtDate(bestDay.pnl_date)} (${fmtPnL(bestDay.daily_profit_loss || 0)})\n*Worst Day:* ${fmtDate(worstDay.pnl_date)} (${fmtPnL(worstDay.daily_profit_loss || 0)})`;
}

// ==================== CUSTOMER ACCURACY COMMAND ====================

async function handleCustomerAccuracy(chatId: string): Promise<string> {
  await logActivity("telegram_customer_accuracy", "Customer requested accuracy stats", { chatId });

  try {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Fetch all settled sweet spot picks
    const { data: allSettled, error } = await supabase
      .from('category_sweet_spots')
      .select('outcome, analysis_date')
      .in('outcome', ['hit', 'miss', 'push']);

    if (error) throw error;
    if (!allSettled || allSettled.length === 0) {
      return "📊 *Sweet Spot Engine — Accuracy Report*\n\nNo settled picks yet. Check back after games settle!";
    }

    const calcStats = (picks: typeof allSettled) => {
      const hits = picks.filter(p => p.outcome === 'hit').length;
      const misses = picks.filter(p => p.outcome === 'miss').length;
      const total = hits + misses; // exclude pushes from rate
      const rate = total > 0 ? ((hits / total) * 100).toFixed(1) : '0.0';
      return { hits, misses, total, rate };
    };

    const last7 = calcStats(allSettled.filter(p => p.analysis_date >= sevenDaysAgo));
    const last30 = calcStats(allSettled.filter(p => p.analysis_date >= thirtyDaysAgo));
    const allTime = calcStats(allSettled);

    const gradeEmoji = (rate: string) => {
      const r = parseFloat(rate);
      if (r >= 75) return '🟢';
      if (r >= 65) return '🟡';
      return '🔴';
    };

    return `📊 *Sweet Spot Engine — Accuracy Report*

${gradeEmoji(last7.rate)} *Last 7 Days:* ${last7.rate}% (${last7.hits}W - ${last7.misses}L)
${gradeEmoji(last30.rate)} *Last 30 Days:* ${last30.rate}% (${last30.hits}W - ${last30.misses}L)
${gradeEmoji(allTime.rate)} *All-Time:* ${allTime.rate}% (${allTime.hits}W - ${allTime.misses}L)

This is the engine powering your parlays.
Type /accuracy anytime to check live stats.`;
  } catch (err) {
    console.error('[Accuracy] Error:', err);
    return "❌ Couldn't load accuracy stats right now. Try again shortly.";
  }
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

  // Get current bankroll
  const { data: userBankroll } = await supabase
    .from("bot_authorized_users")
    .select("bankroll")
    .eq("chat_id", chatId)
    .maybeSingle();
  const currentBankroll = userBankroll?.bankroll || 500;

  let msg = `📊 *Your ROI*\n\n`;
  msg += `💰 *Bankroll:* $${currentBankroll.toLocaleString()}\n\n`;
  msg += `*7 Day:* ${fmtPnL(s7.pnl)} | ${winRate(s7.won, s7.won + s7.lost)}% WR (${s7.won}W-${s7.lost}L)\n`;
  msg += `*30 Day:* ${fmtPnL(s30.pnl)} | ${winRate(s30.won, s30.won + s30.lost)}% WR (${s30.won}W-${s30.lost}L)\n`;
  msg += `*All-Time:* ${fmtPnL(sAll.pnl)} | ${winRate(sAll.won, sAll.won + sAll.lost)}% WR (${sAll.won}W-${sAll.lost}L)\n`;
  msg += `\n📅 Tracked over ${sAll.days} day(s)`;
  msg += `\n\n💡 Use /bankroll [amount] to update your bankroll`;

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
    // Show current bankroll
    const today = getEasternDate();
    const { data: existing } = await supabase
      .from("bot_activation_status")
      .select("simulated_bankroll, real_bankroll, is_real_mode_ready")
      .eq("check_date", today)
      .maybeSingle();
    const bankroll = existing?.is_real_mode_ready ? existing?.real_bankroll : existing?.simulated_bankroll;
    return `💰 *Current Bankroll:* $${(bankroll || 1000).toLocaleString()}\n\nUsage: /bankroll [amount]\nExample: /bankroll 1500`;
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

  // Also sync admin's personal bankroll + confirm date in bot_authorized_users
  await supabase
    .from("bot_authorized_users")
    .update({ bankroll: amount, bankroll_confirmed_date: today })
    .eq("chat_id", chatId);

  return `✅ Bankroll updated to *$${amount.toLocaleString()}* (${existing?.is_real_mode_ready ? 'real' : 'simulated'} mode)\n📊 Stakes: Exec $${(amount * 0.05).toFixed(0)} | Val $${(amount * 0.025).toFixed(0)} | Exp $${(amount * 0.01).toFixed(0)}`;
}

// Customer /bankroll command
async function handleCustomerBankroll(chatId: string, amountStr: string) {
  await logActivity("telegram_customer_bankroll", "Customer updating bankroll", { chatId, amount: amountStr });

  // Get current bankroll
  const { data: user } = await supabase
    .from("bot_authorized_users")
    .select("bankroll")
    .eq("chat_id", chatId)
    .maybeSingle();

  const currentBankroll = user?.bankroll || 500;

  if (!amountStr) {
    return `💰 *Your Bankroll:* $${currentBankroll.toLocaleString()}\n\nYour stakes are calculated based on this amount:\n• Execution: ${(currentBankroll * 0.05).toFixed(0)} (5%)\n• Validation: ${(currentBankroll * 0.025).toFixed(0)} (2.5%)\n• Exploration: ${(currentBankroll * 0.01).toFixed(0)} (1%)\n\nTo update: /bankroll [amount]\nExample: /bankroll 1000`;
  }

  const amount = parseFloat(amountStr);
  if (isNaN(amount) || amount <= 0 || amount > 1000000) {
    return "❌ Invalid amount. Must be a positive number under $1,000,000.";
  }

  const today = getEasternDate();
  await supabase
    .from("bot_authorized_users")
    .update({ bankroll: amount, bankroll_confirmed_date: today })
    .eq("chat_id", chatId);

  return `✅ Bankroll set to *$${amount.toLocaleString()}*\n\n📊 *Your new stakes:*\n• Execution: $${(amount * 0.05).toFixed(0)} (5%)\n• Validation: $${(amount * 0.025).toFixed(0)} (2.5%)\n• Exploration: $${(amount * 0.01).toFixed(0)} (1%)`;
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
// ==================== SCANLINES HANDLER ====================

async function handleScanLines(chatId: string) {
  await sendMessage(chatId, "⏳ Scanning lines + game markets...", "Markdown");

  // Trigger both scanners in parallel
  const scanPromises = [
    fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/detect-mispriced-lines`, {
      method: "POST",
      headers: { Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }).then(r => r.text()).catch(e => console.error('[Scanlines] detect-mispriced error:', e)),
    fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/scanlines-game-markets`, {
      method: "POST",
      headers: { Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }).then(r => r.text()).catch(e => console.error('[Scanlines] game-markets error:', e)),
  ];
  await Promise.allSettled(scanPromises);

  const today = getEasternDate();
  const dateLabel = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' }).format(new Date());

  // ==================== GAME MARKETS SECTION ====================
  const { data: gameMarkets } = await supabase
    .from('mispriced_lines')
    .select('player_name, prop_type, signal, edge_pct, confidence_tier, book_line, player_avg_l10, sport, shooting_context')
    .eq('analysis_date', today)
    .in('prop_type', ['game_total', 'game_moneyline'])
    .order('edge_pct', { ascending: false })
    .limit(12);

  // Get snapshot trails for drift display
  const { data: gmSnapshots } = await supabase
    .from('game_market_snapshots')
    .select('game_id, bet_type, fanduel_line, fanduel_home_odds, scan_time')
    .eq('analysis_date', today)
    .order('scan_time', { ascending: true });

  const gmTrailMap = new Map<string, { time: string; line: number | null; odds: number | null }[]>();
  for (const s of gmSnapshots || []) {
    const key = `${s.game_id}|${s.bet_type}`;
    if (!gmTrailMap.has(key)) gmTrailMap.set(key, []);
    const timeStr = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York', hour12: true
    }).format(new Date(s.scan_time)).toLowerCase();
    gmTrailMap.get(key)!.push({ time: timeStr, line: s.fanduel_line, odds: s.fanduel_home_odds });
  }

  let msg = `🔍 *SCANLINES — ${dateLabel}*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  // Game Markets
  if (gameMarkets && gameMarkets.length > 0) {
    const SPORT_EMOJI: Record<string, string> = {
      'basketball_ncaab': '🏀', 'basketball_nba': '🏀', 'icehockey_nhl': '🏒',
      'baseball_mlb': '⚾', 'americanfootball_nfl': '🏈',
    };
    const SPORT_LABEL: Record<string, string> = {
      'basketball_ncaab': 'NCAAB', 'basketball_nba': 'NBA', 'icehockey_nhl': 'NHL',
      'baseball_mlb': 'MLB', 'americanfootball_nfl': 'NFL',
    };

    // Group by sport
    const bySport = new Map<string, typeof gameMarkets>();
    for (const gm of gameMarkets) {
      const sport = gm.sport || 'unknown';
      if (!bySport.has(sport)) bySport.set(sport, []);
      bySport.get(sport)!.push(gm);
    }

    msg += `🎯 *GAME MARKETS (FanDuel)*\n\n`;

    for (const [sport, markets] of bySport.entries()) {
      const emoji = SPORT_EMOJI[sport] || '🎯';
      const label = SPORT_LABEL[sport] || sport;
      msg += `${emoji} *${label}*\n`;

      for (let i = 0; i < markets.length; i++) {
        const gm = markets[i];
        const ctx = gm.shooting_context as Record<string, any> | null;
        const tierIcon = gm.confidence_tier === 'ELITE' ? '💎' : gm.confidence_tier === 'HIGH' ? '🔥' : '📊';
        const typeLabel = gm.prop_type === 'game_total' ? 'TOTAL' : 'ML';
        const edgeStr = `+${(gm.edge_pct || 0).toFixed(0)}%`;

        msg += `${tierIcon} *${gm.player_name}*\n`;
        if (gm.prop_type === 'game_moneyline') {
          const mlSide = ctx?.ml_side || 'HOME';
          const homeOdds = ctx?.home_odds ? (ctx.home_odds > 0 ? `+${ctx.home_odds}` : `${ctx.home_odds}`) : '?';
          const awayOdds = ctx?.away_odds ? (ctx.away_odds > 0 ? `+${ctx.away_odds}` : `${ctx.away_odds}`) : '?';
          msg += `   ML ${mlSide} | Edge: ${edgeStr}\n`;
          msg += `   Home: ${homeOdds} | Away: ${awayOdds}\n`;
        } else {
          const overOdds = ctx?.over_odds ? (ctx.over_odds > 0 ? `+${ctx.over_odds}` : `${ctx.over_odds}`) : '?';
          const underOdds = ctx?.under_odds ? (ctx.under_odds > 0 ? `+${ctx.under_odds}` : `${ctx.under_odds}`) : '?';
          msg += `   ${typeLabel} ${(gm.signal || '').toUpperCase()} ${gm.book_line || ''} | Edge: ${edgeStr}\n`;
          msg += `   O: ${overOdds} | U: ${underOdds}\n`;
        }

        // KenPom context for NCAAB
        if (ctx && gm.player_avg_l10 && sport.includes('ncaab') && gm.prop_type === 'game_total') {
          msg += `   KenPom proj: ${gm.player_avg_l10} | Tempo: ${ctx.tempo_label || '?'}\n`;
        }

        // Drift trail
        if (ctx?.drift_amount && ctx.drift_amount > 0) {
          const driftIcon = ctx.drift_direction === 'DOWN' ? '📉' : '📈';
          const dramatic = (gm.prop_type === 'game_total' && ctx.drift_amount >= 1.5) ||
                          (gm.prop_type === 'game_moneyline' && ctx.drift_amount >= 15);
          msg += `   ${driftIcon} Drift: ${ctx.drift_amount.toFixed(1)} pts${dramatic ? ' (DRAMATIC)' : ''}\n`;
        }

        // Whale convergence
        if (ctx?.whale_convergence) {
          msg += `   🐋 Whale convergence confirmed\n`;
        }

        // Game time
        if (ctx?.commence_time) {
          const tipTime = new Intl.DateTimeFormat('en-US', {
            hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York', hour12: true
          }).format(new Date(ctx.commence_time));
          msg += `   ⏰ ${tipTime} ET\n`;
        }
      }
      msg += '\n';
    }
  }

  // ==================== PLAYER PROPS SECTION ====================
  const { data: lines } = await supabase
    .from('mispriced_lines')
    .select('player_name, prop_type, signal, edge_pct, confidence_tier, book_line, player_avg_l10, sport, shooting_context')
    .eq('analysis_date', today)
    .not('prop_type', 'in', '("game_total","game_moneyline")')
    .order('edge_pct', { ascending: false })
    .limit(30);

  // Sort by absolute edge and take top 15 for a mix of OVER and UNDER
  if (lines && lines.length > 0) {
    lines.sort((a, b) => Math.abs(b.edge_pct || 0) - Math.abs(a.edge_pct || 0));
    lines.splice(15);
  }

  // Fetch FanDuel odds for player props
  let fdOddsMap = new Map<string, { over_price: number | null; under_price: number | null }>();
  if (lines && lines.length > 0) {
    const playerNames = lines.map(l => l.player_name);
    const { data: fdProps } = await supabase
      .from('unified_props')
      .select('player_name, prop_type, over_price, under_price')
      .ilike('bookmaker', '%fanduel%')
      .in('player_name', playerNames);
    for (const fp of fdProps || []) {
      fdOddsMap.set(`${fp.player_name}|${fp.prop_type}`, { over_price: fp.over_price, under_price: fp.under_price });
    }
  }

  if (lines && lines.length > 0) {
    // Fetch snapshot history for movement trail
    const { data: snapshots } = await supabase
      .from('mispriced_line_snapshots')
      .select('player_name, prop_type, book_line, edge_pct, scan_time')
      .eq('analysis_date', today)
      .order('scan_time', { ascending: true });

    const snapshotTrail = new Map<string, { time: string; line: number; edge: number }[]>();
    for (const s of snapshots || []) {
      const key = `${s.player_name}|${s.prop_type}`;
      if (!snapshotTrail.has(key)) snapshotTrail.set(key, []);
      const timeStr = new Intl.DateTimeFormat('en-US', {
        hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York', hour12: true
      }).format(new Date(s.scan_time)).toLowerCase();
      snapshotTrail.get(key)!.push({ time: timeStr, line: Number(s.book_line), edge: Number(s.edge_pct) });
    }

    const { data: verdicts } = await supabase
      .from('mispriced_line_verdicts')
      .select('player_name, prop_type, whale_signal, verdict, verdict_reason')
      .eq('analysis_date', today);

    const verdictMap = new Map<string, { whale_signal: string; verdict: string; verdict_reason: string }>();
    for (const v of verdicts || []) {
      verdictMap.set(`${v.player_name}|${v.prop_type}`, v);
    }

    msg += `📋 *PLAYER PROPS*\n\n`;

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const side = (l.signal || 'UNDER').toUpperCase().charAt(0);
      const propLabel = normalizePropType(l.prop_type || '').toUpperCase();
      const edgeStr = (l.edge_pct || 0) >= 0 ? `+${(l.edge_pct || 0).toFixed(0)}%` : `${(l.edge_pct || 0).toFixed(0)}%`;
      const tierEmoji = l.confidence_tier === 'ELITE' ? '💎' : l.confidence_tier === 'HIGH' ? '🔥' : '📊';

      // FanDuel odds
      const fdKey = `${l.player_name}|${l.prop_type}`;
      const fdOdds = fdOddsMap.get(fdKey);
      let oddsStr = '';
      if (fdOdds) {
        const oP = fdOdds.over_price ? (fdOdds.over_price > 0 ? `+${fdOdds.over_price}` : `${fdOdds.over_price}`) : '?';
        const uP = fdOdds.under_price ? (fdOdds.under_price > 0 ? `+${fdOdds.under_price}` : `${fdOdds.under_price}`) : '?';
        oddsStr = ` (${oP}/${uP})`;
      }

      msg += `${i + 1}. ${tierEmoji} *${l.player_name}* — ${propLabel} ${side} ${l.book_line}${oddsStr}\n`;
      msg += `   Edge: ${edgeStr} | L10: ${l.player_avg_l10?.toFixed(1) || '?'}\n`;

      const trail = snapshotTrail.get(`${l.player_name}|${l.prop_type}`);
      if (trail && trail.length >= 2) {
        const trailStr = trail.map(t => `${t.time}: ${t.line}`).join(' → ');
        const firstLine = trail[0].line;
        const lastLine = trail[trail.length - 1].line;
        const moved = lastLine - firstLine;
        const moveIcon = moved < 0 ? '📉' : moved > 0 ? '📈' : '➡️';
        // Append current FanDuel odds to trail
        const fdTrail = fdOddsMap.get(`${l.player_name}|${l.prop_type}`);
        let trailOdds = '';
        if (fdTrail) {
          const oP = fdTrail.over_price ? (fdTrail.over_price > 0 ? `+${fdTrail.over_price}` : `${fdTrail.over_price}`) : '?';
          const uP = fdTrail.under_price ? (fdTrail.under_price > 0 ? `+${fdTrail.under_price}` : `${fdTrail.under_price}`) : '?';
          trailOdds = ` (O:${oP}/U:${uP})`;
        }
        msg += `   ${moveIcon} _${trailStr}${trailOdds}_\n`;
      }

      const vKey = `${l.player_name}|${l.prop_type}`;
      const verd = verdictMap.get(vKey);
      if (verd && verd.verdict !== 'HOLD') {
        const vIcon = verd.verdict === 'SHARP_CONFIRMED' ? '🐋' : '⚠️';
        msg += `   ${vIcon} *${verd.verdict}* — ${verd.verdict_reason}\n`;
      }

      const ctx = l.shooting_context as Record<string, any> | null;
      if (ctx) {
        const flags: string[] = [];
        if (ctx.variance_cv != null) flags.push(`CV:${ctx.variance_cv.toFixed(2)}`);
        if (ctx.historical_hit_rate != null) flags.push(`HR:${Math.round(ctx.historical_hit_rate * 100)}%`);
        if (ctx.consensus_deviation_pct != null && ctx.consensus_deviation_pct > 5) flags.push(`CD:${ctx.consensus_deviation_pct.toFixed(0)}%↑`);
        if (ctx.feedback_multiplier != null && ctx.feedback_multiplier !== 1) flags.push(`FB:${ctx.feedback_multiplier.toFixed(2)}x`);
        if (ctx.minutes_stability != null && ctx.minutes_stability < 0.8) flags.push(`⚠️MIN`);
        if (flags.length > 0) {
          msg += `   _${flags.join(' | ')}_\n`;
        }
      }
    }
  }

  if ((!gameMarkets || gameMarkets.length === 0) && (!lines || lines.length === 0)) {
    await sendMessage(chatId, "📭 Scan complete — no signals detected today.");
    return;
  }

  await sendLongMessage(chatId, msg, "Markdown");
  await logActivity("telegram_scanlines", `Admin ran /scanlines`, { chatId, game_markets: gameMarkets?.length || 0, props: lines?.length || 0 });
}

// ==================== LEG RESULTS HANDLER ====================

async function handleLegResults(chatId: string, args: string) {
  // Default to yesterday, or parse a date argument
  let targetDate: string;
  if (args && args.trim()) {
    targetDate = args.trim();
  } else {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    targetDate = yesterday.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  }

  await sendMessage(chatId, `⏳ Fetching individual leg results for ${targetDate}...`, "Markdown");

  // Query daily_elite_leg_outcomes for the target date via parlay date
  const { data: parlays } = await supabase
    .from("daily_elite_parlays")
    .select("id, parlay_date, strategy_name, outcome")
    .eq("parlay_date", targetDate);

  if (!parlays || parlays.length === 0) {
    await sendMessage(chatId, `No parlays found for ${targetDate}.`, "Markdown");
    return;
  }

  const parlayIds = parlays.map((p: any) => p.id);
  const { data: legs } = await supabase
    .from("daily_elite_leg_outcomes")
    .select("*")
    .in("parlay_id", parlayIds)
    .order("leg_index", { ascending: true });

  if (!legs || legs.length === 0) {
    // Fall back: check bot_daily_parlays for settled legs
    const { data: botParlays } = await supabase
      .from("bot_daily_parlays")
      .select("id, legs, outcome, parlay_date, strategy_name")
      .eq("parlay_date", targetDate)
      .in("outcome", ["won", "lost"]);

    if (!botParlays || botParlays.length === 0) {
      await sendMessage(chatId, `No settled leg data found for ${targetDate}.`, "Markdown");
      return;
    }

    // Extract legs from bot_daily_parlays
    let msg = `📊 *LEG RESULTS — ${targetDate}*\n━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `_(from settled parlays, no individual outcomes tracked)_\n\n`;

    for (const p of botParlays) {
      const legs = (p.legs || []) as any[];
      const emoji = p.outcome === "won" ? "✅" : "❌";
      msg += `${emoji} *${p.strategy_name}* (${p.outcome})\n`;
      for (const leg of legs) {
        const player = leg.player || leg.playerName || "Unknown";
        const prop = leg.prop || leg.propType || leg.stat_type || "";
        const side = leg.side || "";
        const line = leg.line || "";
        msg += `  • ${player} ${prop} ${side} ${line}\n`;
      }
      msg += `\n`;
    }

    await sendLongMessage(chatId, msg, "Markdown");
    return;
  }

  // Group by outcome
  const hits = legs.filter((l: any) => l.outcome === "hit");
  const misses = legs.filter((l: any) => l.outcome === "miss");
  const pushes = legs.filter((l: any) => l.outcome === "push");
  const unknown = legs.filter((l: any) => !["hit", "miss", "push"].includes(l.outcome || ""));

  let msg = `📊 *LEG RESULTS — ${targetDate}*\n━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `${hits.length}/${legs.length} legs hit (${legs.length > 0 ? Math.round(hits.length / legs.length * 100) : 0}%)\n\n`;

  if (hits.length > 0) {
    msg += `✅ *HITS:*\n`;
    for (const l of hits) {
      const actual = l.actual_value !== null ? ` → ${l.actual_value}` : "";
      msg += `  ${l.player_name} ${l.prop_type} ${l.side} ${l.line}${actual}\n`;
    }
    msg += `\n`;
  }

  if (misses.length > 0) {
    msg += `❌ *MISSES:*\n`;
    for (const l of misses) {
      const actual = l.actual_value !== null ? ` → ${l.actual_value}` : "";
      msg += `  ${l.player_name} ${l.prop_type} ${l.side} ${l.line}${actual}\n`;
    }
    msg += `\n`;
  }

  if (pushes.length > 0) {
    msg += `🔄 *PUSHES:*\n`;
    for (const l of pushes) {
      msg += `  ${l.player_name} ${l.prop_type} ${l.side} ${l.line}\n`;
    }
    msg += `\n`;
  }

  if (unknown.length > 0) {
    msg += `⚪ *UNSETTLED:* ${unknown.length} legs\n\n`;
  }

  await sendLongMessage(chatId, msg, "Markdown");
  await logActivity("telegram_legresults", `Admin ran /legresults`, { chatId, date: targetDate, total: legs.length, hits: hits.length });
}

// ==================== PIPELINE SUMMARY HANDLER ====================

async function handlePipelineSummary(chatId: string) {
  const today = getEasternDate();

  const { data: parlays } = await supabase
    .from('bot_daily_parlays')
    .select('id, strategy_name, tier, legs, leg_count, combined_probability, expected_odds, outcome')
    .eq('parlay_date', today)
    .order('created_at', { ascending: true });

  if (!parlays || parlays.length === 0) {
    await sendMessage(chatId, "📭 No parlays in pipeline today.\n\nCheck back after the bot runs its daily generation.");
    return;
  }

  // Extract unique picks
  const pickMap = new Map<string, { player_name: string; prop_type: string; line: number; side: string; composite_score?: number; l10_hit_rate?: number }>();
  for (const p of parlays) {
    const legs = (p.legs as any[]) || [];
    for (const leg of legs) {
      const key = `${leg.player_name}|${leg.prop_type}|${leg.line}|${leg.side}`;
      if (!pickMap.has(key)) {
        pickMap.set(key, {
          player_name: leg.player_name,
          prop_type: leg.prop_type,
          line: leg.line,
          side: leg.side,
          composite_score: leg.composite_score,
          l10_hit_rate: leg.l10_hit_rate,
        });
      }
    }
  }

  // Group by tier
  const tierGroups: Record<string, typeof parlays> = {};
  const tierOrder = ['execution', 'exploration', 'validation', 'bankroll_doubler'];
  for (const p of parlays) {
    const tier = p.tier || classifyTier(p.strategy_name);
    if (!tierGroups[tier]) tierGroups[tier] = [];
    tierGroups[tier].push(p);
  }

  const dateLabel = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' }).format(new Date());
  let msg = `🔧 *PIPELINE — ${dateLabel}*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `${parlays.length} parlays | ${pickMap.size} unique picks\n\n`;

  // Tier breakdown
  for (const tier of tierOrder) {
    const group = tierGroups[tier];
    if (!group || group.length === 0) continue;
    const tierLabel = tier.toUpperCase().replace('_', ' ');
    const emoji = tier === 'execution' ? '🎯' : tier === 'exploration' ? '🔬' : tier === 'validation' ? '✅' : '💰';
    msg += `${emoji} *${tierLabel}* (${group.length})\n`;
    for (const p of group.slice(0, 3)) {
      const oddsStr = p.expected_odds > 0 ? `+${p.expected_odds}` : `${p.expected_odds}`;
      const probStr = `${Math.round(p.combined_probability * 100)}%`;
      const outcomeStr = p.outcome ? ` ${p.outcome === 'won' ? '✅' : p.outcome === 'lost' ? '❌' : '⏳'}` : '';
      msg += `  • ${p.strategy_name} — ${p.leg_count}L ${oddsStr} | ${probStr}${outcomeStr}\n`;
    }
    if (group.length > 3) msg += `  _+${group.length - 3} more_\n`;
    msg += `\n`;
  }
  // Any other tiers not in tierOrder
  for (const [tier, group] of Object.entries(tierGroups)) {
    if (tierOrder.includes(tier)) continue;
    msg += `📋 *${tier.toUpperCase()}* (${group.length})\n`;
    for (const p of group.slice(0, 2)) {
      const oddsStr = p.expected_odds > 0 ? `+${p.expected_odds}` : `${p.expected_odds}`;
      msg += `  • ${p.strategy_name} — ${p.leg_count}L ${oddsStr}\n`;
    }
    msg += `\n`;
  }

  // Top picks by composite score
  const allPicks = Array.from(pickMap.values())
    .filter(p => p.composite_score != null)
    .sort((a, b) => (b.composite_score || 0) - (a.composite_score || 0))
    .slice(0, 5);

  if (allPicks.length > 0) {
    msg += `*Top Picks by Score:*\n`;
    for (let i = 0; i < allPicks.length; i++) {
      const p = allPicks[i];
      const sideLabel = p.side?.toUpperCase() === 'OVER' ? 'O' : 'U';
      const propLabel = (PROP_LABELS[p.prop_type] || p.prop_type).toUpperCase();
      const hitRate = p.l10_hit_rate != null ? ` L10:${Math.round(p.l10_hit_rate * 100)}%` : '';
      msg += `${i + 1}. *${p.player_name}* — ${propLabel} ${sideLabel} ${p.line} (Score:${p.composite_score}${hitRate})\n`;
    }
  }

  await sendLongMessage(chatId, msg, "Markdown");
  await logActivity("telegram_pipeline", `Admin ran /pipeline`, { chatId, parlayCount: parlays.length, pickCount: pickMap.size });
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
async function handleAdminDashboard(chatId: string) {
  const today = getEasternDate();
  const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });

  const { data: parlays } = await supabase
    .from('bot_daily_parlays')
    .select('id, approval_status, strategy_name, legs, expected_odds, tier')
    .eq('parlay_date', today);

  const counts: Record<string, number> = { pending_approval: 0, approved: 0, rejected: 0, edited: 0, auto_approved: 0 };
  for (const p of (parlays || [])) {
    const status = p.approval_status || 'pending_approval';
    counts[status] = (counts[status] || 0) + 1;
  }
  const total = parlays?.length || 0;

  let msg = `🤖 *ADMIN DASHBOARD — ${dateStr}*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `📊 *Today's Parlays:* (${total} total)\n`;
  msg += ` ⏳ Pending: ${counts.pending_approval}\n`;
  msg += ` ✅ Approved: ${counts.approved}\n`;
  msg += ` ❌ Rejected: ${counts.rejected}\n`;
  msg += ` ✏️ Edited: ${counts.edited}\n\n`;

  const inline_keyboard: any[][] = [];
  if (counts.pending_approval > 0) {
    inline_keyboard.push([{ text: `📋 Review Pending (${counts.pending_approval})`, callback_data: 'review_pending_parlays' }]);
    inline_keyboard.push([{ text: '✅ Approve All', callback_data: 'approve_all_parlays' }]);
  }
  if (counts.approved + counts.edited > 0) {
    inline_keyboard.push([{ text: '📢 Broadcast Approved', callback_data: 'trigger_broadcast' }]);
  }

  await sendMessage(chatId, msg, 'Markdown', inline_keyboard.length > 0 ? { inline_keyboard } : undefined);
  await logActivity('admin_dashboard', 'Admin opened dashboard', { counts, total });
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

  const propLabels = PROP_LABELS;

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

  // Send to all active customers with personalized stake sizing
  const { data: customers } = await supabase
    .from('bot_authorized_users')
    .select('chat_id, username, bankroll, bankroll_confirmed_date')
    .eq('is_active', true);

  let sentCount = 0;
  let failCount = 0;
  let unconfirmedCount = 0;

  if (customers && customers.length > 0) {
    for (const customer of customers) {
      try {
        const bankroll = customer.bankroll || 500;
        const isConfirmed = customer.bankroll_confirmed_date === today;

        // Build personalized stake section
        let personalMsg = msg;
        personalMsg += `\n💰 *Your Stakes* (Bankroll: $${bankroll.toLocaleString()})${!isConfirmed ? ' ⚠️ unconfirmed' : ''}\n`;

        for (let i = 0; i < approvedParlays.length; i++) {
          const p = approvedParlays[i];
          const tier = p.tier || 'exploration';
          let pct = 0.01; // exploration default
          if (tier === 'execution') pct = 0.05;
          else if (tier === 'validation') pct = 0.025;
          else if (tier === 'bankroll_doubler' || tier === 'lottery') pct = 0.005;

          const stake = Math.round(bankroll * pct);
          const odds = p.expected_odds;
          const payout = odds > 0
            ? Math.round(stake * (odds / 100))
            : Math.round(stake * (100 / Math.abs(odds)));

          personalMsg += `#${i + 1}: $${stake} → 💵 $${payout + stake} potential\n`;
        }

        if (!isConfirmed) {
          personalMsg += `\n⚠️ _Bankroll not confirmed today. Reply /bankroll ${bankroll} to confirm._`;
          unconfirmedCount++;
        }

        await sendLongMessage(customer.chat_id, personalMsg, 'Markdown');
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
    unconfirmedCount,
  });

  await sendMessage(chatId, `📡 *Broadcast complete!*\n\n✅ Sent ${approvedParlays.length} parlays to ${sentCount} customers${failCount > 0 ? `\n⚠️ ${failCount} failed` : ''}${unconfirmedCount > 0 ? `\n💰 ${unconfirmedCount} haven't confirmed today's bankroll` : ''}`);
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
  } else if (data.startsWith('sweetspots_page:')) {
    const page = parseInt(data.split(':')[1], 10) || 1;
    await answerCallbackQuery(callbackQueryId, `Loading page ${page}...`);
    await handleSweetSpots(chatId, page);
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
  } else if (data === 'integrity_void_bad') {
    await answerCallbackQuery(callbackQueryId, 'Voiding bad parlays...');
    const today = getEasternDate();
    const MAX_PLAYER_PROP_USAGE = 2; // Must match diversity-rebalance exposure cap
    let shortVoided = 0;
    let exposureVoided = 0;

    // 1. Void short parlays (< 3 legs)
    const { data: shortParlays } = await supabase
      .from('bot_daily_parlays')
      .select('id')
      .eq('parlay_date', today)
      .eq('outcome', 'pending')
      .lt('leg_count', 3);
    if (shortParlays && shortParlays.length > 0) {
      const ids = shortParlays.map(p => p.id);
      await supabase.from('bot_daily_parlays').update({
        outcome: 'void',
        lesson_learned: 'Voided by integrity alert button (< 3 legs)',
      }).in('id', ids);
      shortVoided = ids.length;
    }

    // 2. Void excess duplicate legs (> MAX_PLAYER_PROP_USAGE per player-prop-side)
    const { data: allPending } = await supabase
      .from('bot_daily_parlays')
      .select('id, legs, combined_probability')
      .eq('parlay_date', today)
      .eq('outcome', 'pending')
      .order('combined_probability', { ascending: false });

    if (allPending && allPending.length > 0) {
      const playerPropMap = new Map<string, { id: string; prob: number }[]>();
      for (const parlay of allPending) {
        const legs = Array.isArray(parlay.legs) ? parlay.legs : [];
        for (const leg of legs as any[]) {
          const player = (leg.player_name || leg.playerName || '').toLowerCase().trim();
          const rawProp = (leg.prop_type || leg.propType || '').replace(/^player_/i, '').toLowerCase().trim();
          // Normalize prop aliases to match diversity-rebalance canonical keys
          const propNormMap: Record<string, string> = {
            'pts': 'points', '3pm': 'threes', 'three_pointers': 'threes', 'three_pointers_made': 'threes',
            'reb': 'rebounds', 'ast': 'assists', 'blk': 'blocks', 'stl': 'steals', 'to': 'turnovers',
          };
          const prop = propNormMap[rawProp] || rawProp;
          const side = (leg.side || leg.recommended_side || 'over').toLowerCase().trim();
          if (!player || !prop) continue;
          const key = `${player}|${prop}|${side}`;
          const list = playerPropMap.get(key) || [];
          if (!list.some(e => e.id === parlay.id)) {
            list.push({ id: parlay.id, prob: parlay.combined_probability });
          }
          playerPropMap.set(key, list);
        }
      }

      const idsToVoid = new Set<string>();
      for (const [, entries] of playerPropMap) {
        if (entries.length <= MAX_PLAYER_PROP_USAGE) continue;
        // Keep top N by probability (already sorted desc), void the rest
        const excess = entries.slice(MAX_PLAYER_PROP_USAGE);
        for (const e of excess) idsToVoid.add(e.id);
      }

      if (idsToVoid.size > 0) {
        const voidIds = Array.from(idsToVoid);
        for (let i = 0; i < voidIds.length; i += 50) {
          const chunk = voidIds.slice(i, i + 50);
          await supabase.from('bot_daily_parlays').update({
            outcome: 'void',
            lesson_learned: 'Voided by integrity alert button (exposure cap exceeded)',
          }).in('id', chunk).eq('outcome', 'pending');
        }
        exposureVoided = voidIds.length;
      }
    }

    const totalVoided = shortVoided + exposureVoided;
    if (totalVoided > 0) {
      const parts: string[] = [];
      if (shortVoided > 0) parts.push(`${shortVoided} short (<3 legs)`);
      if (exposureVoided > 0) parts.push(`${exposureVoided} excess exposure`);
      await logActivity('integrity_void_bad', `Admin voided ${totalVoided} bad parlays via integrity alert`, { shortVoided, exposureVoided });
      await sendMessage(chatId, `✅ Voided *${totalVoided}* bad parlays: ${parts.join(', ')}.`);
    } else {
      await sendMessage(chatId, `✅ Slate is already clean — likely auto-resolved by diversity rebalance before you tapped. No action needed.`);
    }
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

    const propLabels = PROP_LABELS;

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

    const propLabels = PROP_LABELS;

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

  } else if (data === 'review_pending_parlays') {
    const today = getEasternDate();
    const { data: pending } = await supabase
      .from('bot_daily_parlays')
      .select('id, legs, strategy_name, expected_odds, tier')
      .eq('parlay_date', today)
      .eq('approval_status', 'pending_approval');

    if (!pending || pending.length === 0) {
      await answerCallbackQuery(callbackQueryId, 'No pending parlays');
      await sendMessage(chatId, '✅ No pending parlays to review!');
    } else {
      await answerCallbackQuery(callbackQueryId, `Loading ${pending.length} parlays...`);
      const propLabels = PROP_LABELS;
      for (let pi = 0; pi < pending.length; pi++) {
        const p = pending[pi];
        const legs = Array.isArray(p.legs) ? p.legs : JSON.parse(p.legs || '[]');
        const strategy = (p.strategy_name || 'unknown').replace(/_/g, ' ');
        const oddsStr = p.expected_odds > 0 ? `+${p.expected_odds}` : `${p.expected_odds}`;
        const tierLabel = p.tier ? ` | ${p.tier}` : '';

        let msg = `📋 *Pending #${pi + 1}/${pending.length}* (${strategy}${tierLabel}) ${oddsStr}\n\n`;
        for (let i = 0; i < legs.length; i++) {
          const leg = legs[i];
          const side = (leg.side || 'over').toUpperCase();
          const prop = propLabels[leg.prop_type] || (leg.prop_type || '').toUpperCase();
          msg += `${i + 1}. ${leg.player_name || 'Player'} *${side}* ${leg.line} ${prop}\n`;
        }

        await sendMessage(chatId, msg, 'Markdown', {
          inline_keyboard: [
            [
              { text: '✅ Approve', callback_data: `approve_parlay:${p.id}` },
              { text: '✏️ Edit', callback_data: `edit_parlay:${p.id}` },
              { text: '❌ Reject', callback_data: `reject_parlay:${p.id}` },
            ],
          ],
        });
      }
    }

  } else if (data === 'trigger_broadcast') {
    await answerCallbackQuery(callbackQueryId, 'Starting broadcast...');
    await handleBroadcast(chatId);

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

  } else if (data.startsWith('bankroll_keep:')) {
    const amount = parseFloat(data.split(':')[1]);
    const today = getEasternDate();
    await supabase
      .from("bot_authorized_users")
      .update({ bankroll_confirmed_date: today })
      .eq("chat_id", chatId);
    await answerCallbackQuery(callbackQueryId, `✅ Bankroll confirmed at $${amount.toLocaleString()}`);
    await sendMessage(chatId, `✅ Bankroll confirmed at *$${amount.toLocaleString()}* for today.\n\nStakes: Exec $${Math.round(amount * 0.05)} | Val $${Math.round(amount * 0.025)} | Exp $${Math.round(amount * 0.01)}`);

  } else if (data === 'bankroll_update_prompt') {
    await answerCallbackQuery(callbackQueryId, 'Send /bankroll [amount]');
    await sendMessage(chatId, `💰 Reply with your new bankroll amount:\n\n/bankroll 1500`);

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

// ==================== RANKINGS ====================

async function handleRankings(chatId: string, args: string): Promise<string> {
  const teamArg = args.trim().toUpperCase();

  const [nbaRes, nhlRes] = await Promise.all([
    supabase.from('team_defense_rankings').select('team_abbreviation, off_points_rank, opp_points_rank, off_rebounds_rank, opp_rebounds_rank, off_threes_rank, opp_threes_rank, off_assists_rank, opp_assists_rank, overall_rank').eq('is_current', true),
    supabase.from('nhl_team_defense_rankings').select('team_abbrev, team_name, goals_for_rank, goals_against_rank, shots_for_rank, shots_against_rank, power_play_rank, penalty_kill_rank'),
  ]);

  const nbaTeams = nbaRes.data || [];
  const nhlTeams = nhlRes.data || [];

  // Single team lookup
  if (teamArg) {
    const nba = nbaTeams.find(t => t.team_abbreviation === teamArg);
    const nhl = nhlTeams.find(t => t.team_abbrev === teamArg);

    if (!nba && !nhl) return `❌ Team "${teamArg}" not found. Try a 2-3 letter abbreviation (e.g., BOS, TOR).`;

    let msg = '';
    if (nba) {
      msg += `🏀 *${teamArg} — NBA Rankings*\n`;
      msg += `PTS:  OFF #${nba.off_points_rank || '?'}  |  DEF #${nba.opp_points_rank || '?'}\n`;
      msg += `REB:  OFF #${nba.off_rebounds_rank || '?'}  |  DEF #${nba.opp_rebounds_rank || '?'}\n`;
      msg += `3PT:  OFF #${nba.off_threes_rank || '?'}  |  DEF #${nba.opp_threes_rank || '?'}\n`;
      msg += `AST:  OFF #${nba.off_assists_rank || '?'}  |  DEF #${nba.opp_assists_rank || '?'}\n`;
    }
    if (nhl) {
      if (msg) msg += `\n`;
      msg += `🏒 *${teamArg} — NHL Rankings*\n`;
      msg += `Goals:  FOR #${nhl.goals_for_rank || '?'}  |  AGT #${nhl.goals_against_rank || '?'}\n`;
      msg += `Shots:  FOR #${nhl.shots_for_rank || '?'}  |  AGT #${nhl.shots_against_rank || '?'}\n`;
      msg += `PP:  #${nhl.power_play_rank || '?'}  |  PK:  #${nhl.penalty_kill_rank || '?'}\n`;
    }
    return msg;
  }

  // Summary view — top/bottom 5 per category
  let msg = `📊 *Team Rankings*\n━━━━━━━━━━━━━━━━━\n\n`;

  // NBA section
  if (nbaTeams.length > 0) {
    const sorted = [...nbaTeams].sort((a, b) => (a.overall_rank || 99) - (b.overall_rank || 99));
    msg += `🏀 *NBA — Overall*\n`;
    msg += `\`Team  OVR  PTS↑  PTS↓  REB↑  REB↓\`\n`;
    sorted.slice(0, 10).forEach(t => {
      const tm = (t.team_abbreviation || '').padEnd(5);
      msg += `\`${tm} #${String(t.overall_rank || '?').padEnd(3)} #${String(t.off_points_rank || '?').padEnd(4)} #${String(t.opp_points_rank || '?').padEnd(4)} #${String(t.off_rebounds_rank || '?').padEnd(4)} #${String(t.opp_rebounds_rank || '?').padEnd(3)}\`\n`;
    });
    msg += `\n_Use /rankings [TEAM] for full profile_\n\n`;
  }

  // NHL section
  if (nhlTeams.length > 0) {
    const sorted = [...nhlTeams].sort((a, b) => (a.goals_against_rank || 99) - (b.goals_against_rank || 99));
    msg += `🏒 *NHL — Best Defense*\n`;
    msg += `\`Team  GAR  GFR  SAR  SFR\`\n`;
    sorted.slice(0, 10).forEach(t => {
      const tm = (t.team_abbrev || '').padEnd(5);
      msg += `\`${tm} #${String(t.goals_against_rank || '?').padEnd(3)} #${String(t.goals_for_rank || '?').padEnd(3)} #${String(t.shots_against_rank || '?').padEnd(3)} #${String(t.shots_for_rank || '?').padEnd(3)}\`\n`;
    });
    msg += `\n_Use /rankings [TEAM] for full profile_\n`;
  }

  return msg;
}

// ==================== WEEKLY RUNDOWN ====================

async function handleWeeklyRundown(chatId: string): Promise<string> {
  const d7 = getEasternDateDaysAgo(7);

  const [parlaysRes, daysRes, weightsRes, nbaDefRes, nhlDefRes] = await Promise.all([
    supabase.from("bot_daily_parlays").select("strategy_name, outcome, profit_loss, legs").in("outcome", ["won", "lost"]).gte("parlay_date", d7),
    supabase.from("bot_activation_status").select("check_date, daily_profit_loss, is_profitable_day, parlays_won, parlays_lost").gte("check_date", d7).order("check_date"),
    supabase.from("bot_category_weights").select("category, side, current_hit_rate, total_picks, sport").eq("is_blocked", false).not("current_hit_rate", "is", null).order("current_hit_rate", { ascending: false }).limit(20),
    supabase.from("team_defense_rankings").select("team_abbreviation, opp_points_rank, opp_rebounds_rank, opp_threes_rank, opp_assists_rank").eq("is_current", true),
    supabase.from("nhl_team_defense_rankings").select("team_abbrev, goals_against_rank, shots_against_rank"),
  ]);

  const parlays = parlaysRes.data || [];
  const days = daysRes.data || [];
  const weights = weightsRes.data || [];
  const nbaDef = nbaDefRes.data || [];
  const nhlDef = nhlDefRes.data || [];

  const wins = parlays.filter(p => p.outcome === 'won').length;
  const losses = parlays.length - wins;
  const totalPL = parlays.reduce((s, p) => s + (p.profit_loss || 0), 0);
  const winDays = days.filter(d => d.is_profitable_day).length;

  // Day-by-day
  let bestDay = { date: '', pl: -Infinity };
  let worstDay = { date: '', pl: Infinity };
  days.forEach(d => {
    const pl = d.daily_profit_loss || 0;
    if (pl > bestDay.pl) bestDay = { date: d.check_date, pl };
    if (pl < worstDay.pl) worstDay = { date: d.check_date, pl };
  });

  // Strategy breakdown
  const stratMap: Record<string, { wins: number; total: number; pl: number }> = {};
  parlays.forEach(p => {
    const s = p.strategy_name || 'unknown';
    if (!stratMap[s]) stratMap[s] = { wins: 0, total: 0, pl: 0 };
    stratMap[s].total++;
    stratMap[s].pl += (p.profit_loss || 0);
    if (p.outcome === 'won') stratMap[s].wins++;
  });
  const stratEntries = Object.entries(stratMap).sort((a, b) => {
    const wrA = a[1].total > 0 ? a[1].wins / a[1].total : 0;
    const wrB = b[1].total > 0 ? b[1].wins / b[1].total : 0;
    return wrB - wrA;
  });

  // Category performance from legs
  const catHits: Record<string, { hits: number; total: number }> = {};
  parlays.forEach(p => {
    const legs = Array.isArray(p.legs) ? p.legs : [];
    legs.forEach((leg: any) => {
      const cat = leg.category || leg.prop_type || 'unknown';
      const side = leg.side || leg.recommended_side || '';
      const key = `${cat} ${side}`;
      if (!catHits[key]) catHits[key] = { hits: 0, total: 0 };
      catHits[key].total++;
      if (leg.outcome === 'won' || leg.hit === true) catHits[key].hits++;
    });
  });
  const catEntries = Object.entries(catHits).filter(([, v]) => v.total >= 3).sort((a, b) => (b[1].hits / b[1].total) - (a[1].hits / a[1].total));

  // Build message — RECAP
  const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const weekAgo = new Date(Date.now() - 7 * 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  let msg = `📊 *WEEKLY RUNDOWN* (${weekAgo} – ${today})\n━━━━━━━━━━━━━━━━━\n\n`;
  msg += `📈 *RESULTS*\n`;
  msg += `• Record: ${wins}W-${losses}L (${parlays.length > 0 ? (wins / parlays.length * 100).toFixed(0) : 0}%)\n`;
  msg += `• P&L: ${totalPL >= 0 ? '+' : ''}$${totalPL.toFixed(0)}\n`;
  msg += `• Days: ${winDays}/${days.length} profitable\n`;
  if (bestDay.date) msg += `• Best Day: ${bestDay.date} ${bestDay.pl >= 0 ? '+' : ''}$${bestDay.pl.toFixed(0)}\n`;
  if (worstDay.date && worstDay.pl < Infinity) msg += `• Worst Day: ${worstDay.date} ${worstDay.pl >= 0 ? '+' : ''}$${worstDay.pl.toFixed(0)}\n`;
  msg += `\n`;

  // Strategies
  if (stratEntries.length > 0) {
    msg += `🏆 *TOP STRATEGIES*\n`;
    stratEntries.slice(0, 5).forEach(([name, s], i) => {
      const wr = s.total > 0 ? (s.wins / s.total * 100).toFixed(0) : '0';
      msg += `${i + 1}. ${name} — ${s.wins}W-${s.total - s.wins}L (${wr}%)\n`;
    });
    msg += `\n`;
  }

  // Hottest/Coldest categories
  if (catEntries.length > 0) {
    const hot = catEntries.filter(([, v]) => v.hits / v.total >= 0.6).slice(0, 3);
    const cold = catEntries.filter(([, v]) => v.hits / v.total < 0.45).slice(-3);
    if (hot.length > 0) {
      msg += `🎯 *HOTTEST CATEGORIES*\n`;
      hot.forEach(([k, v]) => msg += `• ${k} — ${(v.hits / v.total * 100).toFixed(0)}% hit (${v.total} picks)\n`);
      msg += `\n`;
    }
    if (cold.length > 0) {
      msg += `❄️ *COLDEST CATEGORIES*\n`;
      cold.forEach(([k, v]) => msg += `• ${k} — ${(v.hits / v.total * 100).toFixed(0)}% hit (${v.total} picks)\n`);
      msg += `\n`;
    }
  }

  // FORWARD LEAN
  msg += `━━━━━━━━━━━━━━━━━\n🔮 *FORWARD LEAN — Next Week*\n━━━━━━━━━━━━━━━━━\n\n`;

  // Hot categories from bot_category_weights + weak defenses
  const hotWeights = weights.filter(w => (w.current_hit_rate || 0) >= 65 && (w.total_picks || 0) >= 10);
  const leanInto: string[] = [];
  const fade: string[] = [];

  // NBA leans
  const nbaDefMap: Record<string, any> = {};
  nbaDef.forEach(t => nbaDefMap[t.team_abbreviation] = t);

  // Find weak NBA defenses per category
  const worstRebDef = nbaDef.filter(t => (t.opp_rebounds_rank || 0) >= 25).map(t => t.team_abbreviation).slice(0, 3);
  const worstPtsDef = nbaDef.filter(t => (t.opp_points_rank || 0) >= 25).map(t => t.team_abbreviation).slice(0, 3);
  const worstAstDef = nbaDef.filter(t => (t.opp_assists_rank || 0) >= 25).map(t => t.team_abbreviation).slice(0, 3);
  const worstThreesDef = nbaDef.filter(t => (t.opp_threes_rank || 0) >= 25).map(t => t.team_abbreviation).slice(0, 3);

  // Best NBA defenses (fade targets)
  const bestPtsDef = nbaDef.filter(t => (t.opp_points_rank || 99) <= 5).map(t => t.team_abbreviation).slice(0, 3);
  const bestRebDef = nbaDef.filter(t => (t.opp_rebounds_rank || 99) <= 5).map(t => t.team_abbreviation).slice(0, 3);

  hotWeights.forEach(w => {
    const cat = w.category.toUpperCase();
    const hr = (w.current_hit_rate || 0).toFixed(0);
    if (cat.includes('REBOUND') && worstRebDef.length > 0) {
      leanInto.push(`Rebounds ${w.side} vs ${worstRebDef.join(', ')} (${hr}% cat HR)`);
    } else if (cat.includes('POINT') && worstPtsDef.length > 0) {
      leanInto.push(`Points ${w.side} vs ${worstPtsDef.join(', ')} (${hr}% cat HR)`);
    } else if (cat.includes('ASSIST') && worstAstDef.length > 0) {
      leanInto.push(`Assists ${w.side} vs ${worstAstDef.join(', ')} (${hr}% cat HR)`);
    } else if (cat.includes('THREE') && worstThreesDef.length > 0) {
      leanInto.push(`Threes ${w.side} vs ${worstThreesDef.join(', ')} (${hr}% cat HR)`);
    }
  });

  // NHL leans
  const worstNhlDef = nhlDef.filter(t => (t.goals_against_rank || 0) >= 25).map(t => t.team_abbrev).slice(0, 3);
  const worstNhlShotDef = nhlDef.filter(t => (t.shots_against_rank || 0) >= 25).map(t => t.team_abbrev).slice(0, 3);

  const nhlHot = hotWeights.filter(w => (w.sport || '').toLowerCase().includes('nhl') || (w.category || '').toUpperCase().includes('NHL'));
  nhlHot.forEach(w => {
    const hr = (w.current_hit_rate || 0).toFixed(0);
    if (w.category.toUpperCase().includes('SHOT') && worstNhlShotDef.length > 0) {
      leanInto.push(`🏒 SOG ${w.side} vs ${worstNhlShotDef.join(', ')} (${hr}% cat HR)`);
    } else if (worstNhlDef.length > 0) {
      leanInto.push(`🏒 ${w.category} ${w.side} vs ${worstNhlDef.join(', ')} (${hr}% cat HR)`);
    }
  });

  // Fade: cold categories + strong defenses
  const coldWeights = weights.filter(w => (w.current_hit_rate || 0) < 50 && (w.total_picks || 0) >= 10);
  coldWeights.slice(0, 3).forEach(w => {
    const cat = w.category.toUpperCase();
    const hr = (w.current_hit_rate || 0).toFixed(0);
    if (cat.includes('POINT') && bestPtsDef.length > 0) {
      fade.push(`Points ${w.side} vs ${bestPtsDef.join(', ')} (${hr}% cat HR)`);
    } else if (cat.includes('REBOUND') && bestRebDef.length > 0) {
      fade.push(`Rebounds ${w.side} vs ${bestRebDef.join(', ')} (${hr}% cat HR)`);
    } else {
      fade.push(`${w.category} ${w.side} (${hr}% cat HR — cold streak)`);
    }
  });

  if (leanInto.length > 0) {
    msg += `✅ *LEAN INTO*\n`;
    leanInto.forEach(l => msg += `• ${l}\n`);
    msg += `\n`;
  } else {
    msg += `✅ No strong lean-into signals this week.\n\n`;
  }

  if (fade.length > 0) {
    msg += `⛔ *FADE / AVOID*\n`;
    fade.forEach(f => msg += `• ${f}\n`);
  } else {
    msg += `⛔ No active fade signals.\n`;
  }

  return msg;
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
async function handleStakePlan(chatId: string) {
  return `🌾 *YOUR PROFIT PLAN — $500 Start*

📊 *Our Engine:* 28% Win Rate | +780 Avg Odds
EV per $10 bet: ($10 × 28% × 5.9) − ($10 × 72%) = *+$9.32*

━━━━━━━━━━━━━━━━━━━━

📗 *PHASE 1 — Foundation (Week 1-2)*
💵 Stake: *$5/parlay* (1% bankroll)
📈 Volume: 5 parlays/day
💰 Daily EV: *+$23* | Weekly: *+$163*
🎯 Goal: Learn the system, survive variance

📘 *PHASE 2 — Growth (Week 3-4)*
💵 Stake: *$10/parlay* (2% bankroll)
📈 Volume: 5-8 parlays/day
💰 Daily EV: *+$46 to +$74* | Weekly: *+$325-$520*
🎯 Goal: Compound winnings

📕 *PHASE 3 — Scale (Month 2+)*
💵 Stake: *2% of current bankroll*
📈 As bankroll grows, stakes grow automatically
💰 $500 → $1,000 in ~11 days at standard pace
🎯 Goal: Let compounding do the work

━━━━━━━━━━━━━━━━━━━━

⚠️ *VARIANCE WARNING*
At 28% win rate, 7 losses in a row happens ~10% of the time.
At $5 stakes that's only −$35 (7% of bankroll).
*One win at +780 odds recovers 8 losses.*

🎯 *KEY RULE:* Never stake more than 3% per parlay.

━━━━━━━━━━━━━━━━━━━━

📊 *QUICK MATH BY BANKROLL*
$300 → $3 stakes → ~$14/day EV
$500 → $5 stakes → ~$23/day EV
$1,000 → $10 stakes → ~$47/day EV
$2,500 → $25 stakes → ~$116/day EV

💬 Questions? Just ask me anything!`;
}

async function handleCustomerStart(chatId: string) {
  await logActivity("telegram_start", `Customer started bot chat`, { chatId });
  return `🌾 *Welcome to Parlay Farm!*

📊 *Our track record:* 28% Win Rate at +780 Avg Odds = *+92% ROI*
💰 *Recommended Start:* $500 bankroll, $5/parlay

We've built a step-by-step plan to grow your bankroll.
👉 Type /plan to see your full profit roadmap
👉 Type /bankroll [amount] to set your bankroll

*Commands:*
/plan — Your step-by-step profit plan
/parlays — Today's picks
/accuracy — Sweet Spot engine accuracy
/bankroll — Set/view your bankroll & stakes
/calendar — Your monthly P&L
/roi — Your ROI breakdown
/streaks — Hot & cold streaks
/help — All commands

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

// ==================== EXTRA PLAYS & ENGINE ACCURACY ====================

async function handleExtras(chatId: string): Promise<string> {
  await logActivity("telegram_extras", "Admin requested extra plays report", { chatId });
  await sendMessage(chatId, "⏳ Generating extra plays report...", "Markdown");
  try {
    const resp = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-extra-plays-report`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      return `❌ Extra plays report failed (${resp.status}): ${errText.slice(0, 200)}`;
    }
    const data = await resp.json();
    if (data.totalExtras === 0) {
      return `🎯 *Extra Plays*\n\nNo extra plays found — all quality picks are already in today's parlays!`;
    }
    return `✅ Extra plays report sent! (${data.totalExtras} picks found)`;
  } catch (err) {
    return `❌ Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function handleEngineAccuracy(chatId: string): Promise<string> {
  await logActivity("telegram_engine_accuracy", "Admin requested engine accuracy", { chatId });

  const engines: Array<{ name: string; won: number; lost: number; total: number }> = [];

  // Risk Engine
  const { data: riskPicks } = await supabase
    .from('nba_risk_engine_picks')
    .select('outcome')
    .in('outcome', ['won', 'lost']);
  if (riskPicks) {
    const won = riskPicks.filter(p => p.outcome === 'won').length;
    const lost = riskPicks.filter(p => p.outcome === 'lost').length;
    engines.push({ name: 'Risk Engine', won, lost, total: won + lost });
  }

  // Sweet Spots
  const { data: sweetPicks } = await supabase
    .from('category_sweet_spots')
    .select('outcome')
    .in('outcome', ['won', 'lost', 'hit', 'miss']);
  if (sweetPicks) {
    const won = sweetPicks.filter(p => p.outcome === 'won' || p.outcome === 'hit').length;
    const lost = sweetPicks.filter(p => p.outcome === 'lost' || p.outcome === 'miss').length;
    engines.push({ name: 'Sweet Spots', won, lost, total: won + lost });
  }

  // Mispriced Lines
  const { data: mispricedPicks } = await supabase
    .from('mispriced_lines')
    .select('outcome')
    .in('outcome', ['won', 'lost']);
  if (mispricedPicks) {
    const won = mispricedPicks.filter(p => p.outcome === 'won').length;
    const lost = mispricedPicks.filter(p => p.outcome === 'lost').length;
    engines.push({ name: 'Mispriced Lines', won, lost, total: won + lost });
  }

  // High Conviction
  const { data: hcPicks } = await supabase
    .from('high_conviction_results')
    .select('outcome')
    .in('outcome', ['won', 'lost']);
  if (hcPicks) {
    const won = hcPicks.filter(p => p.outcome === 'won').length;
    const lost = hcPicks.filter(p => p.outcome === 'lost').length;
    engines.push({ name: 'High Conviction', won, lost, total: won + lost });
  }

  // Send formatted report via bot-send-telegram
  await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/bot-send-telegram`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
    },
    body: JSON.stringify({
      type: 'engine_accuracy_report',
      data: { engines },
    }),
  });

  return null as any; // Already sent via bot-send-telegram
}

// ==================== PLAYER LOOKUP ====================

const NBA_TEAM_ABBREV: Record<string, string> = {
  'Atlanta Hawks': 'ATL', 'Boston Celtics': 'BOS', 'Brooklyn Nets': 'BKN',
  'Charlotte Hornets': 'CHA', 'Chicago Bulls': 'CHI', 'Cleveland Cavaliers': 'CLE',
  'Dallas Mavericks': 'DAL', 'Denver Nuggets': 'DEN', 'Detroit Pistons': 'DET',
  'Golden State Warriors': 'GSW', 'Houston Rockets': 'HOU', 'Indiana Pacers': 'IND',
  'Los Angeles Clippers': 'LAC', 'LA Clippers': 'LAC', 'Los Angeles Lakers': 'LAL',
  'LA Lakers': 'LAL', 'Memphis Grizzlies': 'MEM', 'Miami Heat': 'MIA',
  'Milwaukee Bucks': 'MIL', 'Minnesota Timberwolves': 'MIN', 'New Orleans Pelicans': 'NOP',
  'New York Knicks': 'NYK', 'Oklahoma City Thunder': 'OKC', 'Orlando Magic': 'ORL',
  'Philadelphia 76ers': 'PHI', 'Phoenix Suns': 'PHX', 'Portland Trail Blazers': 'POR',
  'Sacramento Kings': 'SAC', 'San Antonio Spurs': 'SAS', 'Toronto Raptors': 'TOR',
  'Utah Jazz': 'UTA', 'Washington Wizards': 'WAS',
  'Hawks': 'ATL', 'Celtics': 'BOS', 'Nets': 'BKN', 'Hornets': 'CHA', 'Bulls': 'CHI',
  'Cavaliers': 'CLE', 'Cavs': 'CLE', 'Mavericks': 'DAL', 'Mavs': 'DAL', 'Nuggets': 'DEN',
  'Pistons': 'DET', 'Warriors': 'GSW', 'Rockets': 'HOU', 'Pacers': 'IND',
  'Clippers': 'LAC', 'Lakers': 'LAL', 'Grizzlies': 'MEM', 'Heat': 'MIA', 'Bucks': 'MIL',
  'Timberwolves': 'MIN', 'Wolves': 'MIN', 'Pelicans': 'NOP', 'Knicks': 'NYK',
  'Thunder': 'OKC', 'Magic': 'ORL', '76ers': 'PHI', 'Sixers': 'PHI', 'Suns': 'PHX',
  'Trail Blazers': 'POR', 'Blazers': 'POR', 'Kings': 'SAC', 'Spurs': 'SAS',
  'Raptors': 'TOR', 'Jazz': 'UTA', 'Wizards': 'WAS',
};

function resolveTeamAbbrev(name: string): string {
  if (!name) return '';
  const trimmed = name.trim();
  if (/^[A-Z]{2,4}$/.test(trimmed)) return trimmed;
  if (NBA_TEAM_ABBREV[trimmed]) return NBA_TEAM_ABBREV[trimmed];
  const lower = trimmed.toLowerCase();
  for (const [k, v] of Object.entries(NBA_TEAM_ABBREV)) {
    if (k.toLowerCase() === lower) return v;
  }
  for (const [k, v] of Object.entries(NBA_TEAM_ABBREV)) {
    if (lower.includes(k.toLowerCase()) || k.toLowerCase().includes(lower)) return v;
  }
  return trimmed.substring(0, 3).toUpperCase();
}

function extractOpponentFromGameDesc(gameDesc: string, playerTeamAbbrev: string): string | null {
  // game_description like "Team A @ Team B" or "Team A vs Team B"
  const parts = gameDesc.split(/\s+(?:@|vs\.?|at)\s+/i);
  if (parts.length < 2) return null;
  const team1 = resolveTeamAbbrev(parts[0].trim());
  const team2 = resolveTeamAbbrev(parts[1].trim());
  if (team1 === playerTeamAbbrev) return team2;
  if (team2 === playerTeamAbbrev) return team1;
  // If we can't match, return the other team
  return team1 || team2;
}

function getRankEmoji(rank: number): string {
  if (rank <= 5) return '⚠️';
  if (rank >= 20) return '🔥';
  return '';
}

function getRankTier(rank: number): string {
  if (rank <= 5) return 'Elite';
  if (rank <= 10) return 'Strong';
  if (rank <= 15) return 'Avg';
  if (rank <= 20) return 'Weak';
  return 'Poor';
}

const PROP_TO_STAT: Record<string, string> = {
  'player_points': 'points',
  'player_rebounds': 'rebounds',
  'player_assists': 'assists',
  'player_threes': 'threes_made',
  'player_steals': 'steals',
  'player_blocks': 'blocks',
  'player_pts': 'points',
  'player_reb': 'rebounds',
  'player_ast': 'assists',
};

// === /sweetspots — Show today's active sweet spot picks with live lines ===
async function handleSweetSpots(chatId: string, page = 1): Promise<void> {
  const PER_PAGE = 10;
  try {
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());

    // Fetch ALL of today's sweet spots — no hard filters
    const { data: spots, error: ssErr } = await supabase
      .from('category_sweet_spots')
      .select('player_name, prop_type, recommended_side, actual_line, recommended_line, l10_hit_rate, confidence_score, category, is_active')
      .eq('analysis_date', today)
      .order('l10_hit_rate', { ascending: false })
      .limit(200);

    if (ssErr) { await sendMessage(chatId, `❌ Error fetching sweet spots: ${ssErr.message}`); return; }
    if (!spots || spots.length === 0) { await sendMessage(chatId, '📭 No sweet spot picks analyzed for today.'); return; }

    // Cross-reference with unified_props for LIVE tags
    const { data: activeProps } = await supabase
      .from('unified_props')
      .select('player_name, prop_type')
      .eq('is_active', true);

    const activePropSet = new Set(
      (activeProps || []).map(p => `${p.player_name?.toLowerCase().trim()}|${p.prop_type?.toLowerCase().trim()}`)
    );

    const total = spots.length;
    const totalPages = Math.ceil(total / PER_PAGE);
    const safePage = Math.max(1, Math.min(page, totalPages));
    const start = (safePage - 1) * PER_PAGE;
    const pageSpots = spots.slice(start, start + PER_PAGE);
    const liveCount = spots.filter(s => {
      const key = `${s.player_name?.toLowerCase().trim()}|${s.prop_type?.toLowerCase().trim()}`;
      return activePropSet.has(key);
    }).length;

    const lines: string[] = [
      `🎯 *Sweet Spots* — ${today}`,
      `${total} picks analyzed | ${liveCount} with live lines`,
      `Page ${safePage}/${totalPages}\n`,
    ];

    for (const s of pageSpots) {
      const key = `${s.player_name?.toLowerCase().trim()}|${s.prop_type?.toLowerCase().trim()}`;
      const isLive = activePropSet.has(key);
      const tag = isLive ? '🟢LIVE' : '⚫--';
      const line = s.actual_line ?? s.recommended_line ?? '?';
      const hitPct = s.l10_hit_rate ? `${(s.l10_hit_rate * 100).toFixed(0)}%` : '?';
      const conf = s.confidence_score ? `${(s.confidence_score * 10).toFixed(1)}` : '?';
      const side = (s.recommended_side || '?').toUpperCase();
      const cat = s.category || '';
      lines.push(`[${tag}] *${s.player_name}* ${s.prop_type.replace(/_/g, ' ')} ${side} ${line}\n  💎${hitPct} L10 | 🎯${conf} conf | ${cat}`);
    }

    await sendLongMessage(chatId, lines.join('\n'));

    // Pagination buttons
    if (totalPages > 1) {
      const buttons: Array<{ text: string; callback_data: string }> = [];
      if (safePage > 1) buttons.push({ text: `⬅️ Prev`, callback_data: `sweetspots_page:${safePage - 1}` });
      if (safePage < totalPages) buttons.push({ text: `Next ➡️`, callback_data: `sweetspots_page:${safePage + 1}` });
      await sendMessage(chatId, `📄 Page ${safePage}/${totalPages}`, undefined, {
        inline_keyboard: [buttons],
      });
    }
  } catch (err) {
    await sendMessage(chatId, `❌ Sweet spots error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function handleLookup(chatId: string, playerName: string): Promise<string> {
  if (!playerName.trim()) {
    return '❓ Usage: /lookup [player name]\n\nExample: /lookup LeBron James';
  }

  await sendMessage(chatId, `🔍 Looking up *${playerName}*...`, 'Markdown');

  const today = getEasternDate();

  // Fuzzy match: search by last name ilike
  const nameParts = playerName.trim().split(/\s+/);
  const searchTerm = nameParts.length > 1 ? nameParts[nameParts.length - 1] : nameParts[0];

  // 1. Find player in game logs
  const { data: gameLogs } = await supabase
    .from('nba_player_game_logs')
    .select('*')
    .ilike('player_name', `%${searchTerm}%`)
    .order('game_date', { ascending: false })
    .limit(50);

  if (!gameLogs || gameLogs.length === 0) {
    return `❌ No game logs found for "*${playerName}*". Try the exact last name.`;
  }

  // If multiple players match, pick the one closest to full name
  const uniquePlayers = [...new Set(gameLogs.map(g => g.player_name))];
  let matchedPlayer = uniquePlayers[0];
  if (uniquePlayers.length > 1) {
    const lowerInput = playerName.toLowerCase();
    const exact = uniquePlayers.find(p => p.toLowerCase() === lowerInput);
    if (exact) {
      matchedPlayer = exact;
    } else {
      const partial = uniquePlayers.find(p => p.toLowerCase().includes(lowerInput));
      if (partial) matchedPlayer = partial;
    }
  }

  const playerLogs = gameLogs.filter(g => g.player_name === matchedPlayer).slice(0, 10);

  if (playerLogs.length === 0) {
    return `❌ No recent games found for *${matchedPlayer}*.`;
  }

  // 2. Calculate L10 averages
  const l10 = playerLogs;
  const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const avgPts = avg(l10.map(g => Number(g.points) || 0));
  const avgReb = avg(l10.map(g => Number(g.rebounds) || 0));
  const avgAst = avg(l10.map(g => Number(g.assists) || 0));
  const avg3pt = avg(l10.map(g => Number(g.threes_made) || 0));
  const avgStl = avg(l10.map(g => Number(g.steals) || 0));
  const avgBlk = avg(l10.map(g => Number(g.blocks) || 0));

  // 3. Build L10 game log lines (show all games)
  const logLines = l10.map(g => {
    const d = String(g.game_date).slice(5); // MM-DD
    return `  ${d}: ${g.points} PTS | ${g.rebounds} REB | ${g.assists} AST | ${g.threes_made} 3PT`;
  });

  // 4. Resolve opponent and player team
  let playerTeamAbbrev: string | null = null;
  let opponentAbbrev: string | null = null;
  let opponentSource = 'none';
  let defenseSection = '';

  // Priority A0: Direct from today's game log (most reliable — straight from ESPN box score)
  const todayLog = playerLogs.find(g => String(g.game_date) === today);
  if (todayLog && todayLog.opponent) {
    opponentAbbrev = resolveTeamAbbrev(todayLog.opponent);
    opponentSource = 'game_log';
    console.log(`[lookup] A0 hit: opponent=${opponentAbbrev} from game_log (opponent=${todayLog.opponent})`);
  }

  // Resolve player team from bdl_player_cache
  const { data: playerCache } = await supabase
    .from('bdl_player_cache')
    .select('team_name, is_active')
    .ilike('player_name', `%${matchedPlayer}%`)
    .order('is_active', { ascending: false })
    .limit(5);

  if (playerCache && playerCache.length > 0) {
    const active = playerCache.find(p => p.is_active);
    const bestMatch = active || playerCache[0];
    if (bestMatch.team_name) {
      playerTeamAbbrev = resolveTeamAbbrev(bestMatch.team_name);
    }
  }

  // Fallback team resolution from game logs if cache is stale/missing
  if (!playerTeamAbbrev && playerLogs.length > 0) {
    // Use the most recent game: if player was home, we can't directly get team name,
    // but we know opponent. We need a different approach: check if any game log has team info.
    // For now, log a warning — the A0 path above already resolves opponent without needing team.
    console.log(`[lookup] bdl_player_cache has no team for ${matchedPlayer}, relying on game_log opponent`);
  }

  console.log(`[lookup] player=${matchedPlayer}, playerTeam=${playerTeamAbbrev}`);

  // 5. Find today's props
  const { data: todayProps } = await supabase
    .from('unified_props')
    .select('game_description, prop_type, current_line, over_price, under_price')
    .ilike('player_name', `%${matchedPlayer}%`)
    .gte('created_at', `${today}T00:00:00`)
    .limit(20);

  console.log(`[lookup] todayProps count=${todayProps?.length || 0}`);

  // Priority A: resolve opponent from props game_description (only if A0 didn't resolve)
  if (!opponentAbbrev && todayProps && todayProps.length > 0 && todayProps[0].game_description && playerTeamAbbrev) {
    opponentAbbrev = extractOpponentFromGameDesc(todayProps[0].game_description, playerTeamAbbrev);
    if (opponentAbbrev) opponentSource = 'props';
  }

  // Priority B: fallback to game_bets schedule (noon-ET-to-noon-ET window)
  if (!opponentAbbrev && playerTeamAbbrev) {
    const [yr, mo, dy] = today.split('-').map(Number);
    const noonUtcStart = new Date(Date.UTC(yr, mo - 1, dy, 17, 0, 0));
    const noonUtcEnd = new Date(noonUtcStart.getTime() + 24 * 60 * 60 * 1000);
    const startUtc = noonUtcStart.toISOString();
    const endUtc = noonUtcEnd.toISOString();

    console.log(`[lookup] schedule window: ${startUtc} → ${endUtc}`);

    const { data: todayGames, error: schedError } = await supabase
      .from('game_bets')
      .select('game_id, home_team, away_team, commence_time')
      .eq('sport', 'basketball_nba')
      .gte('commence_time', startUtc)
      .lt('commence_time', endUtc)
      .limit(500);

    if (schedError) {
      console.error(`[lookup] game_bets query error:`, schedError.message);
    }

    console.log(`[lookup] game_bets raw rows=${todayGames?.length || 0}`);

    const seenIds = new Set<string>();
    const uniqueGames = (todayGames || []).filter(g => {
      if (!g.game_id || seenIds.has(g.game_id)) return false;
      seenIds.add(g.game_id);
      return true;
    });

    console.log(`[lookup] unique games=${uniqueGames.length}`);

    let gameBetsOpponent: string | null = null;
    for (const game of uniqueGames) {
      const home = resolveTeamAbbrev(game.home_team || '');
      const away = resolveTeamAbbrev(game.away_team || '');
      if (home === playerTeamAbbrev) {
        gameBetsOpponent = away;
        break;
      }
      if (away === playerTeamAbbrev) {
        gameBetsOpponent = home;
        break;
      }
    }

    if (gameBetsOpponent) {
      opponentAbbrev = gameBetsOpponent;
      opponentSource = 'game_bets';
    }
  }

  // Cross-validation: if A0 resolved and game_bets also has data, check for mismatch
  if (opponentSource === 'game_log' && playerTeamAbbrev) {
    // Quick cross-check against props if available
    if (todayProps && todayProps.length > 0 && todayProps[0].game_description) {
      const propsOpponent = extractOpponentFromGameDesc(todayProps[0].game_description, playerTeamAbbrev);
      if (propsOpponent && propsOpponent !== opponentAbbrev) {
        console.warn(`[lookup] CROSS-VALIDATION MISMATCH: game_log says ${opponentAbbrev}, props says ${propsOpponent}. Keeping game_log.`);
      }
    }
  }

  console.log(`[lookup] FINAL opponentAbbrev=${opponentAbbrev}, source=${opponentSource}`);

  // 6. Fetch defense rankings (independent of props)
  if (opponentAbbrev) {
    const { data: defRank } = await supabase
      .from('team_defense_rankings')
      .select('*')
      .eq('team_abbreviation', opponentAbbrev)
      .eq('is_current', true)
      .maybeSingle();

    if (defRank) {
      const or = defRank.overall_rank || 0;
      defenseSection = `\n🛡️ *Tonight's Matchup vs ${opponentAbbrev}:*
  *Defense (opp allows):*
  Overall: #${or} (${getRankTier(or)})
  vs PTS: #${defRank.opp_points_rank || '?'} ${getRankEmoji(defRank.opp_points_rank || 15)} | vs 3PT: #${defRank.opp_threes_rank || '?'} ${getRankEmoji(defRank.opp_threes_rank || 15)}
  vs REB: #${defRank.opp_rebounds_rank || '?'} ${getRankEmoji(defRank.opp_rebounds_rank || 15)} | vs AST: #${defRank.opp_assists_rank || '?'} ${getRankEmoji(defRank.opp_assists_rank || 15)}
  *Offense (opp scores):*
  PTS: #${defRank.off_points_rank || '?'} | 3PT: #${defRank.off_threes_rank || '?'}
  REB: #${defRank.off_rebounds_rank || '?'} | AST: #${defRank.off_assists_rank || '?'} | Pace: #${defRank.off_pace_rank || '?'}

ℹ️ _Defense = what opp ALLOWS (high rank = easy matchup)_
ℹ️ _Offense = opp's own scoring strength_
⚠️ _= Top 5 (tough)_ | 🔥 _= Rank 20+ (favorable)_`;
    }
  } else {
    defenseSection = '\n📭 No NBA matchup detected for today.';
  }

  // 7. Today's props with hit rates
  let propsSection = '';
  if (todayProps && todayProps.length > 0) {
    const propLines: string[] = [];
    const seen = new Set<string>();
    for (const p of todayProps) {
      if (!p.prop_type || !p.current_line) continue;
      const key = p.prop_type;
      if (seen.has(key)) continue;
      seen.add(key);

      const statField = PROP_TO_STAT[p.prop_type];
      let hitCount = 0;
      if (statField) {
        hitCount = l10.filter(g => Number((g as any)[statField] || 0) > Number(p.current_line)).length;
      }

      const label = p.prop_type.replace('player_', '').toUpperCase();
      const price = p.over_price ? `(${p.over_price > 0 ? '+' : ''}${p.over_price})` : '';
      propLines.push(`  ${label} O${p.current_line} ${price} | L10 hit: ${hitCount}/${l10.length}`);

      if (propLines.length >= 6) break;
    }
    if (propLines.length > 0) {
      propsSection = `\n📋 *Today's Props:*\n${propLines.join('\n')}`;
    }
  }

  // 8. Format final message
  const msg = `🔍 *PLAYER LOOKUP — ${matchedPlayer}*
━━━━━━━━━━━━━━━━━━━━━

📊 *L10 Game Log:*
${logLines.join('\n')}

📈 *L10 Averages:*
  PTS: ${avgPts.toFixed(1)} | REB: ${avgReb.toFixed(1)} | AST: ${avgAst.toFixed(1)} | 3PT: ${avg3pt.toFixed(1)}
  STL: ${avgStl.toFixed(1)} | BLK: ${avgBlk.toFixed(1)}${defenseSection}${propsSection}`;

  return msg;
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
/extras — Extra plays (not in parlays)
/lookup [player] — Player cross-reference report
/engineaccuracy — Engine standalone accuracy
/backtest — Run backtest
/watch — Watch picks
/pause / /resume — Pause/resume bot
/bankroll — Set bankroll
/force-settle — Force settle
/subscribe / /unsubscribe — Alerts
/export — Export data
/digest — Weekly summary
/weekly — Full weekly rundown + forward leans
/rankings — Team OFF/DEF rankings
/rankings [TEAM] — Single team profile

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
/sweetspots — Active sweet spot picks
/scanlines — Run & view mispriced line scan
/legresults — Individual leg wins/losses
/pipeline — Today's parlay pipeline summary
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
    // Admin dashboard
    if (cmd === "/admin") { await handleAdminDashboard(chatId); return null; }
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
    if (cmd === "/extras") { return await handleExtras(chatId); }
    if (cmd === "/engineaccuracy") { return await handleEngineAccuracy(chatId); }
  if (cmd === "/lookup") { return await handleLookup(chatId, args); }
  if (cmd === "/rankings") return await handleRankings(chatId, args);
  if (cmd === "/weekly") return await handleWeeklyRundown(chatId);
    if (cmd === "/sweetspots") { await handleSweetSpots(chatId); return null; }
    if (cmd === "/scanlines") { await handleScanLines(chatId); return null; }
    if (cmd === "/legresults") { await handleLegResults(chatId, args); return null; }
    if (cmd === "/pipeline") { await handlePipelineSummary(chatId); return null; }
    if (cmd === "/rankings") return await handleRankings(chatId, args);
    if (cmd === "/weekly") return await handleWeeklyRundown(chatId);

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
  if (cmd === "/accuracy") return await handleCustomerAccuracy(chatId);
  if (cmd === "/bankroll") return await handleCustomerBankroll(chatId, args);
  if (cmd === "/cancel") return await handleCancelSubscription(chatId);
  if (cmd === "/lookup") { return await handleLookup(chatId, args); }
  if (cmd === "/plan") return await handleStakePlan(chatId);
  if (cmd === "/help") {
    return `📋 *Parlay Farm — Help*

*Commands:*
/plan — Your step-by-step profit plan
/parlays — Today's full pick list
/accuracy — Sweet Spot engine accuracy
/bankroll — Set/view your bankroll
/lookup [player] — Player cross-reference report
/calendar — Your monthly P&L
/roi — Your personal ROI
/streaks — Hot & cold streaks
/rankings — Team OFF/DEF rankings
/weekly — Weekly rundown + forward leans
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

    // Handle photo messages (slip analysis)
    if (update.message?.photo && update.message.photo.length > 0) {
      const chatId = update.message.chat.id.toString();
      const username = update.message.from?.username || undefined;
      
      // Auth check
      const authorized = await isAuthorized(chatId);
      if (!authorized) {
        await sendMessage(chatId, "🔒 You need to be authorized first.\n\nSend /start to begin the access process.");
        return new Response("OK", { status: 200 });
      }
      
      try {
        await sendMessage(chatId, "📸 Analyzing your slip...");
        await logActivity("telegram_photo", "User sent photo for slip analysis", { chatId, username });
        
        // Get largest photo (last in array)
        const photo = update.message.photo[update.message.photo.length - 1];
        const fileId = photo.file_id;
        
        // Download photo via Telegram API
        const fileResp = await fetch(`${TELEGRAM_API}/getFile`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file_id: fileId }),
        });
        const fileData = await fileResp.json();
        
        if (!fileData.ok || !fileData.result?.file_path) {
          await sendMessage(chatId, "❌ Could not download the photo. Please try again.");
          return new Response("OK", { status: 200 });
        }
        
        const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${fileData.result.file_path}`;
        const imageResp = await fetch(fileUrl);
        const imageBuffer = await imageResp.arrayBuffer();
        
        // Convert to base64
        const uint8Array = new Uint8Array(imageBuffer);
        let binary = '';
        for (let i = 0; i < uint8Array.length; i++) {
          binary += String.fromCharCode(uint8Array[i]);
        }
        const imageBase64 = `data:image/jpeg;base64,${btoa(binary)}`;
        
        // Call extract-parlay edge function
        const extractResp = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/extract-parlay`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ imageBase64 }),
        });
        
        if (!extractResp.ok) {
          const errText = await extractResp.text();
          console.error("[Photo] extract-parlay failed:", extractResp.status, errText);
          await sendMessage(chatId, "❌ Failed to analyze the slip. Please try again.");
          return new Response("OK", { status: 200 });
        }
        
        const extraction = await extractResp.json();
        
        if (!extraction.isBettingSlip || !extraction.legs || extraction.legs.length === 0) {
          await sendMessage(chatId, "🤔 I couldn't detect a betting slip in this image.\n\nMake sure the full slip is visible and try again!");
          return new Response("OK", { status: 200 });
        }
        
        // Format the analysis message
        const legs = extraction.legs;
        let msg = `🎯 *Slip Analysis* (${legs.length} legs)\n\n`;
        
        // Cross-reference with sweet spots
        const today = getEasternDate();
        const playerNames = legs
          .map((l: any) => l.player || l.description?.split(' ')[0] + ' ' + l.description?.split(' ')[1])
          .filter(Boolean);
        
        const { data: sweetSpots } = await supabase
          .from("category_sweet_spots")
          .select("player_name, prop_type, recommended_side, l10_hit_rate, l10_avg, actual_line, quality_tier")
          .eq("analysis_date", today)
          .eq("is_active", true);
        
        for (let i = 0; i < legs.length; i++) {
          const leg = legs[i];
          const desc = leg.description || 'Unknown';
          const odds = leg.odds && leg.odds !== 'N/A' ? ` (${leg.odds})` : '';
          
          // Try to match with sweet spots
          let ssMatch = '';
          if (sweetSpots && leg.player) {
            const playerLower = leg.player.toLowerCase();
            const match = sweetSpots.find((ss: any) => 
              ss.player_name?.toLowerCase().includes(playerLower) || 
              playerLower.includes(ss.player_name?.toLowerCase() || '')
            );
            if (match) {
              const hitPct = ((match.l10_hit_rate || 0) * 100).toFixed(0);
              const tier = match.quality_tier === 'elite' ? '🔥' : match.quality_tier === 'strong' ? '💪' : '📊';
              const sideMatch = leg.side === match.recommended_side ? '✅' : '⚠️';
              ssMatch = `\n   ${sideMatch} ${tier} L10: ${hitPct}% hit rate (avg ${match.l10_avg?.toFixed(1)})`;
            }
          }
          
          msg += `${i + 1}. ${desc}${odds}${ssMatch}\n`;
        }
        
        // Add totals
        if (extraction.totalOdds) msg += `\n*Total Odds:* ${extraction.totalOdds}`;
        if (extraction.stake) msg += `\n*Stake:* $${extraction.stake}`;
        if (extraction.potentialPayout) msg += `\n*Payout:* $${extraction.potentialPayout}`;
        if (extraction.platform) msg += `\n*Platform:* ${extraction.platform}`;
        
        // Quick EV estimate
        const legsWithSS = legs.filter((l: any) => {
          if (!sweetSpots || !l.player) return false;
          return sweetSpots.some((ss: any) => 
            ss.player_name?.toLowerCase().includes(l.player.toLowerCase())
          );
        });
        
        if (legsWithSS.length > 0) {
          msg += `\n\n📊 *Sweet Spot Coverage:* ${legsWithSS.length}/${legs.length} legs tracked`;
        }
        
        msg += `\n\n💡 _Send any betting slip photo for instant analysis!_`;
        
        await sendLongMessage(chatId, msg);
        await logActivity("telegram_photo_analyzed", `Analyzed slip with ${legs.length} legs`, { chatId, legCount: legs.length, platform: extraction.platform });
      } catch (err) {
        console.error("[Photo] Error:", err);
        await sendMessage(chatId, "❌ Something went wrong analyzing your slip. Please try again.");
      }
      
      return new Response("OK", { status: 200 });
    }

    // Handle text message
    if (update.message?.text) {
      const chatId = update.message.chat.id.toString();
      const text = update.message.text;
      const username = update.message.from?.username || undefined;

      const response = await handleMessage(chatId, text, username);
      if (response) await sendLongMessage(chatId, response);
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

    // Handle weekly rundown cron trigger (Sunday broadcast)
    if (update.cron === "weekly_rundown") {
      const { data: activeUsers } = await supabase
        .from("bot_authorized_users")
        .select("chat_id")
        .eq("is_active", true);
      const users = activeUsers || [];
      for (const user of users) {
        try {
          const rundown = await handleWeeklyRundown(user.chat_id);
          await sendLongMessage(user.chat_id, rundown);
        } catch (e) {
          console.error(`Weekly rundown failed for ${user.chat_id}:`, e);
        }
      }
      return new Response("OK", { status: 200 });
    }

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("Webhook error:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
});
