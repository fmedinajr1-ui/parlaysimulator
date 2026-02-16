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

  const latestCreatedAt = parlays[0].created_at;
  const latestBatchTime = new Date(latestCreatedAt).getTime();
  const batchWindow = 5 * 60 * 1000;
  const latestBatch = parlays.filter(
    (p) => Math.abs(new Date(p.created_at).getTime() - latestBatchTime) < batchWindow
  );

  const distribution: Record<number, number> = {};
  latestBatch.forEach((p) => {
    const legCount = p.leg_count || 3;
    distribution[legCount] = (distribution[legCount] || 0) + 1;
  });

  const tierGroups: Record<string, typeof latestBatch> = { exploration: [], validation: [], execution: [] };
  latestBatch.forEach((p) => {
    const name = (p.strategy_name || '').toLowerCase();
    if (name.includes('exploration') || name.includes('explore') || name.includes('cross_sport') || name.includes('team_') || name.includes('props_') || name.includes('tennis_') || name.includes('nhl_') || name.includes('max_diversity')) {
      tierGroups.exploration.push(p);
    } else if (name.includes('validation') || name.includes('validated')) {
      tierGroups.validation.push(p);
    } else if (name.includes('execution') || name.includes('elite')) {
      tierGroups.execution.push(p);
    } else {
      tierGroups.exploration.push(p);
    }
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
    count: latestBatch.length,
    parlays: latestBatch.slice(0, 5).map((p) => ({
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
  const totalStaked = settled.length * 10;

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
    return `📅 *${new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(now)} P&L*\n\nNo data recorded yet this month.\n\n📊 View full calendar:\nhttps://parlaysimulator.lovable.app/`;
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
*Bankroll:* $${lastBankroll.toLocaleString()}

📊 View full calendar:
https://parlaysimulator.lovable.app/`;
}

async function handleStart(chatId: string) {
  await logActivity("telegram_start", `User started bot chat`, { chatId });

  return `🤖 *ParlayIQ Bot v3*

*Core:*
/status /parlays /parlay /performance /weights /calendar

*Actions:*
/generate /settle /force-settle [date]

*Analytics:*
/roi /streaks /compare /sharp /avoid /backtest [strategy]

*Learning:*
/learning /tiers /explore /validate

*Multi-Sport:*
/nhl /tennis /spreads /totals

*Intelligence:*
/research /watch [player]

*Control:*
/pause /resume /bankroll [amt] /subscribe /export [date]

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

async function handleParlays(chatId: string) {
  await logActivity("telegram_parlays", `User requested parlays`, { chatId });

  const parlays = await getParlays();

  if (parlays.count === 0) {
    return "📭 No parlays generated today yet.\n\nUse /generate to create new parlays!";
  }

  let message = `🎯 *Today's Parlays* (${parlays.count} total)\n\n`;

  const tierLabels: Record<string, string> = {
    exploration: '🔍 Exploration',
    validation: '✅ Validation',
    execution: '💰 Execution',
  };
  const tierDescriptions: Record<string, string> = {
    exploration: '$0 stake',
    validation: 'simulated',
    execution: 'Kelly stakes',
  };

  // Build inline buttons for "View Legs"
  const inlineButtons: any[][] = [];

  if (parlays.tierSummary) {
    for (const tier of ['exploration', 'validation', 'execution']) {
      const info = parlays.tierSummary[tier];
      if (!info) continue;
      message += `${tierLabels[tier]} (${info.count}) — _${tierDescriptions[tier]}_\n`;
      info.topParlays.forEach((p, i) => {
        const outcomeEmoji = p.outcome === 'won' ? '✅' : p.outcome === 'lost' ? '❌' : '⏳';
        message += `  ${i + 1}. ${p.strategy} (${p.legs}-leg) ${p.odds > 0 ? '+' : ''}${p.odds} ${outcomeEmoji}\n`;
        // Add inline button for viewing legs
        inlineButtons.push([{ text: `📋 View Legs: ${p.strategy.slice(0, 20)}`, callback_data: `legs:${p.id}` }]);
      });
      if (info.count > 2) {
        message += `  ... +${info.count - 2} more\n`;
      }
      message += `\n`;
    }
  }

  message += `*Distribution:*\n`;
  message += Object.entries(parlays.distribution)
    .map(([legs, count]) => `• ${legs}-Leg: ${count}`)
    .join("\n");

  const replyMarkup = inlineButtons.length > 0 ? { inline_keyboard: inlineButtons } : undefined;
  await sendMessage(chatId, message, "Markdown", replyMarkup);
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

// Format a parlay leg for display in Telegram
function formatLegDisplay(leg: any): string {
  if (leg.type === 'team') {
    const matchup = `${leg.away_team || ''} @ ${leg.home_team || ''}`.trim();
    const betLabel = (leg.bet_type || '').charAt(0).toUpperCase() + (leg.bet_type || '').slice(1);
    const sideLabel = leg.side === 'home' ? (leg.home_team || 'HOME') :
                      leg.side === 'away' ? (leg.away_team || 'AWAY') :
                      (leg.side || '').toUpperCase();
    const line = leg.line !== null && leg.line !== undefined ? ` ${leg.line}` : '';
    const odds = leg.american_odds ? (leg.american_odds > 0 ? ` (+${leg.american_odds})` : ` (${leg.american_odds})`) : '';
    return `${matchup} ${betLabel} ${sideLabel}${line}${odds}`;
  }
  const propLabels: Record<string, string> = {
    threes: '3PT', points: 'PTS', assists: 'AST', rebounds: 'REB',
    steals: 'STL', blocks: 'BLK', turnovers: 'TO', pra: 'PRA',
    pts_rebs: 'P+R', pts_asts: 'P+A', rebs_asts: 'R+A',
    three_pointers_made: '3PT', fantasy_score: 'FPTS',
  };
  const name = leg.player_name || 'Player';
  const side = (leg.side || 'over').toUpperCase();
  const line = leg.line || leg.selected_line || '';
  const propType = leg.prop_type ? ` ${propLabels[leg.prop_type] || leg.prop_type.toUpperCase()}` : '';
  const odds = leg.american_odds ? (leg.american_odds > 0 ? ` (+${leg.american_odds})` : ` (${leg.american_odds})`) : '';
  return `${name} ${side} ${line}${propType}${odds}`;
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

// ==================== CALLBACK QUERY HANDLER ====================

async function handleCallbackQuery(callbackQueryId: string, data: string, chatId: string) {
  if (data.startsWith('legs:')) {
    const parlayId = data.slice(5);

    const { data: parlay } = await supabase
      .from("bot_daily_parlays")
      .select("legs, strategy_name, leg_count, expected_odds, outcome")
      .eq("id", parlayId)
      .maybeSingle();

    if (!parlay) {
      await answerCallbackQuery(callbackQueryId, "Parlay not found");
      return;
    }

    const legs = Array.isArray(parlay.legs) ? parlay.legs : JSON.parse(parlay.legs || '[]');
    let msg = `📋 *${parlay.strategy_name}* (${parlay.leg_count}-leg)\n\n`;
    legs.forEach((leg: any, i: number) => {
      msg += `${i + 1}. ${formatLegDisplay(leg)}\n`;
    });
    msg += `\nOdds: ${parlay.expected_odds > 0 ? '+' : ''}${parlay.expected_odds}`;
    if (parlay.outcome) msg += ` | ${parlay.outcome === 'won' ? '✅ WON' : parlay.outcome === 'lost' ? '❌ LOST' : '⏳ PENDING'}`;

    await answerCallbackQuery(callbackQueryId);
    await sendMessage(chatId, msg);
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

  msg += `\n📊 View dashboard: https://parlaysimulator.lovable.app/`;

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

// ==================== ADMIN CHECK ====================

const ADMIN_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID");
const isAdmin = (chatId: string) => chatId === ADMIN_CHAT_ID;

// Customer-facing /start message
async function handleCustomerStart(chatId: string) {
  await logActivity("telegram_start", `Customer started bot chat`, { chatId });
  return `🌾 *Welcome to Parlay Farm!*

💰 *Recommended Starter Balance:* $200–$400
📊 *Stake $10–$20 per parlay*

*Commands:*
/parlays — Today's picks
/parlay — Pending summary
/performance — Win rate & ROI
/calendar — Monthly P&L
/roi — Detailed ROI breakdown
/streaks — Hot & cold streaks
/help — All commands

One winning day can return 10x your investment. 🚀`;
}

// ==================== MAIN ROUTER ====================

async function handleMessage(chatId: string, text: string) {
  const parts = text.trim().split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1).join(' ');

  // Customer commands (available to everyone)
  if (cmd === "/start") {
    if (isAdmin(chatId)) return await handleStart(chatId);
    return await handleCustomerStart(chatId);
  }
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
/calendar — Monthly P&L
/roi — Detailed ROI breakdown
/streaks — Hot & cold streaks
/help — This list`;
  }

  // All other commands: admin only
  if (!isAdmin(chatId)) {
    return "🔒 This command is only available to admins.\n\nUse /help to see available commands!";
  }

  // Admin commands
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

  // Natural language fallback (admin only)
  await saveConversation(chatId, "user", text);
  await logActivity("telegram_message", `User sent message`, {
    chatId,
    messagePreview: text.slice(0, 50),
  });
  const response = await handleNaturalLanguage(text, chatId);
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

      const response = await handleMessage(chatId, text);
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
