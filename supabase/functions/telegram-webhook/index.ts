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

// Helper: Send message via Telegram API
async function sendMessage(chatId: string, text: string, parseMode = "Markdown") {
  const response = await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: parseMode,
    }),
  });
  return response.json();
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
  const today = getEasternDate();

  const { data: activation } = await supabase
    .from("bot_activation_status")
    .select("*")
    .eq("check_date", today)
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

  // Only show the most recent generation batch
  const latestCreatedAt = parlays[0].created_at;
  const latestBatchTime = new Date(latestCreatedAt).getTime();
  // Include parlays within 5 minutes of the latest one (same batch)
  const batchWindow = 5 * 60 * 1000;
  const latestBatch = parlays.filter(
    (p) => Math.abs(new Date(p.created_at).getTime() - latestBatchTime) < batchWindow
  );

  const distribution: Record<number, number> = {};
  latestBatch.forEach((p) => {
    const legCount = p.leg_count || 3;
    distribution[legCount] = (distribution[legCount] || 0) + 1;
  });

  // Group by tier parsed from strategy_name
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
      tierGroups.exploration.push(p); // default
    }
  });

  const tierSummary: Record<string, { count: number; topParlays: Array<{ strategy: string; legs: number; odds: number; outcome: string | null }> }> = {};
  for (const [tier, group] of Object.entries(tierGroups)) {
    if (group.length === 0) continue;
    tierSummary[tier] = {
      count: group.length,
      topParlays: group.slice(0, 2).map((p) => ({
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
  const { data: settled } = await supabase
    .from("bot_daily_parlays")
    .select("outcome, profit_loss, expected_odds")
    .not("outcome", "is", null);

  if (!settled || settled.length === 0) {
    return { winRate: 0, roi: 0, totalSettled: 0, wins: 0, losses: 0 };
  }

  const wins = settled.filter((p) => p.outcome === "won").length;
  const losses = settled.filter((p) => p.outcome === "lost").length;
  const totalProfit = settled.reduce((sum, p) => sum + (p.profit_loss || 0), 0);
  const totalStaked = settled.length * 10; // Assuming $10 per parlay

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

  // Get conversation history for context
  const history = await getConversationHistory(chatId, 6);

  // Fetch current data for context
  const [status, parlays, performance, weights] = await Promise.all([
    getStatus(),
    getParlays(),
    getPerformance(),
    getWeights(),
  ]);

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

GUIDELINES:
- Keep responses concise for Telegram (under 500 chars when possible)
- Use Telegram Markdown formatting (*bold*, _italic_)
- Use emojis for visual appeal
- Be helpful and conversational
- If asked about specific parlays, summarize the top ones
- For recommendations, suggest based on current weights and hit rates`;

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

// Command handlers
async function handleStart(chatId: string) {
  await logActivity("telegram_start", `User started bot chat`, { chatId });

  return `🤖 *ParlayIQ Bot v2*

Welcome! I'm your autonomous betting assistant with tiered learning.

*Core Commands:*
/status - Bot mode, bankroll, streak
/parlays - Today's generated parlays
/performance - Win rate, ROI, stats
/weights - Top category weights
/generate - Generate tiered parlays (65-75)
/settle - Settle & learn from results

*Tiered Learning:*
/learning - Learning velocity & confidence
/tiers - Today's tier breakdown
/explore - Exploration tier picks (50/day)
/validate - Validation tier picks (15/day)

*Multi-Sport:*
/nhl - NHL player props
/tennis - ATP/WTA picks
/spreads - Team spread signals
/totals - Over/Under signals

Or *ask me anything* naturally!
• "How's the bot learning?"
• "Show me validation picks"
• "What's performing best?"`;
}

async function handleStatus(chatId: string) {
  await logActivity("telegram_status", `User requested status`, { chatId });

  const status = await getStatus();
  const parlays = await getParlays();

  return `📊 *Bot Status*

*Mode:* ${status.mode === "Real" ? "🟢 Real" : "🟡 Simulation"}
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

  if (parlays.tierSummary) {
    for (const tier of ['exploration', 'validation', 'execution']) {
      const info = parlays.tierSummary[tier];
      if (!info) continue;
      message += `${tierLabels[tier]} (${info.count}) — _${tierDescriptions[tier]}_\n`;
      info.topParlays.forEach((p, i) => {
        const outcomeEmoji = p.outcome === 'won' ? '✅' : p.outcome === 'lost' ? '❌' : '⏳';
        message += `  ${i + 1}. ${p.strategy} (${p.legs}-leg) ${p.odds > 0 ? '+' : ''}${p.odds} ${outcomeEmoji}\n`;
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

  return message;
}

async function handlePerformance(chatId: string) {
  await logActivity("telegram_performance", `User requested performance`, {
    chatId,
  });

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
    const hitRate = w.current_hit_rate
      ? `(${(w.current_hit_rate * 100).toFixed(0)}% hit)`
      : "";
    message += `${i + 1}. *${w.category}* ${w.side}\n`;
    message += `   Weight: ${(w.weight * 100).toFixed(0)}% ${hitRate}\n`;
  });

  return message;
}

async function handleGenerate(chatId: string) {
  await logActivity("telegram_generate", `User triggered generation`, {
    chatId,
  });

  try {
    const response = await fetch(
      `${Deno.env.get("SUPABASE_URL")}/functions/v1/bot-generate-daily-parlays`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
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
          Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      }
    );

    if (!response.ok) {
      throw new Error(`Settlement failed: ${response.status}`);
    }

    const result = await response.json();

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

// Multi-sport data fetchers
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

// Multi-sport command handlers
async function handleNHL(chatId: string) {
  await logActivity("telegram_nhl", `User requested NHL picks`, { chatId });
  
  const picks = await getNHLPicks();
  
  if (picks.length === 0) {
    return "🏒 *NHL Picks*\n\nNo active NHL signals right now.\n\nCheck back closer to game time!";
  }
  
  let message = "🏒 *NHL Sharp Signals*\n\n";
  picks.forEach((p, i) => {
    const grade = p.sharp_score >= 80 ? 'A' : p.sharp_score >= 65 ? 'B' : 'C';
    message += `${i + 1}. *${p.player_name}* ${p.stat_type}\n`;
    message += `   ${p.recommended_side} ${p.pp_line} (Grade ${grade})\n`;
    message += `   📍 ${p.matchup}\n\n`;
  });
  
  return message;
}

async function handleTennis(chatId: string) {
  await logActivity("telegram_tennis", `User requested Tennis picks`, { chatId });
  
  const picks = await getTennisPicks();
  
  if (picks.length === 0) {
    return "🎾 *Tennis Picks*\n\nNo active tennis signals right now.\n\nCheck back when tournaments are in play!";
  }
  
  let message = "🎾 *Tennis Sharp Signals*\n\n";
  picks.forEach((p, i) => {
    const grade = p.sharp_score >= 80 ? 'A' : p.sharp_score >= 65 ? 'B' : 'C';
    const tour = p.sport === 'tennis_atp' ? 'ATP' : 'WTA';
    message += `${i + 1}. *${p.player_name}* ${p.stat_type} [${tour}]\n`;
    message += `   ${p.recommended_side} ${p.pp_line} (Grade ${grade})\n`;
    message += `   📍 ${p.matchup}\n\n`;
  });
  
  return message;
}

async function handleSpreads(chatId: string) {
  await logActivity("telegram_spreads", `User requested spread signals`, { chatId });
  
  const bets = await getTeamBets('spread');
  
  if (bets.length === 0) {
    return "📊 *Spread Signals*\n\nNo active spread signals right now.\n\nCheck back closer to game time!";
  }
  
  let message = "📊 *Sharp Spread Signals*\n\n";
  bets.forEach((b: any, i: number) => {
    const grade = (b.sharp_score || 0) >= 80 ? 'A' : (b.sharp_score || 0) >= 65 ? 'B' : 'C';
    const line = b.line > 0 ? `+${b.line}` : b.line;
    message += `${i + 1}. *${b.away_team} @ ${b.home_team}*\n`;
    message += `   ${b.recommended_side || 'TBD'} ${line} (Grade ${grade})\n\n`;
  });
  
  return message;
}

async function handleTotals(chatId: string) {
  await logActivity("telegram_totals", `User requested totals signals`, { chatId });
  
  const bets = await getTeamBets('total');
  
  if (bets.length === 0) {
    return "🎯 *Totals Signals*\n\nNo active O/U signals right now.\n\nCheck back closer to game time!";
  }
  
  let message = "🎯 *Sharp Totals Signals*\n\n";
  bets.forEach((b: any, i: number) => {
    const grade = (b.sharp_score || 0) >= 80 ? 'A' : (b.sharp_score || 0) >= 65 ? 'B' : 'C';
    message += `${i + 1}. *${b.away_team} @ ${b.home_team}*\n`;
    message += `   ${b.recommended_side || 'TBD'} ${b.line} (Grade ${grade})\n\n`;
  });
  
  return message;
}

// Tier-specific handlers
async function handleLearning(chatId: string) {
  await logActivity("telegram_learning", `User requested learning metrics`, { chatId });
  
  const { data: parlays } = await supabase
    .from('bot_daily_parlays')
    .select('strategy_name, outcome')
    .not('outcome', 'is', null);
  
  const tierStats: Record<string, { total: number; won: number; lost: number }> = {
    exploration: { total: 0, won: 0, lost: 0 },
    validation: { total: 0, won: 0, lost: 0 },
    execution: { total: 0, won: 0, lost: 0 },
  };
  
  (parlays || []).forEach((p: any) => {
    const sn = (p.strategy_name || '').toLowerCase();
    const tier = sn.includes('exploration') ? 'exploration' : sn.includes('validation') ? 'validation' : 'execution';
    if (tierStats[tier]) {
      tierStats[tier].total++;
      if (p.outcome === 'won') tierStats[tier].won++;
      if (p.outcome === 'lost') tierStats[tier].lost++;
    }
  });
  
  let message = `📊 *Learning Velocity*\n\n`;
  
  for (const [tier, stats] of Object.entries(tierStats)) {
    const winRate = stats.total > 0 ? (stats.won / stats.total * 100).toFixed(1) : '0';
    const target = tier === 'exploration' ? 500 : 300;
    const progress = Math.min(100, (stats.total / target) * 100).toFixed(0);
    const emoji = tier === 'exploration' ? '🔬' : tier === 'validation' ? '✓' : '🚀';
    
    message += `${emoji} *${tier.charAt(0).toUpperCase() + tier.slice(1)}*\n`;
    message += `   ${stats.total}/${target} samples (${progress}%)\n`;
    message += `   ${stats.won}W-${stats.lost}L (${winRate}% WR)\n\n`;
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
  const { data: todayParlays } = await supabase
    .from('bot_daily_parlays')
    .select('strategy_name, leg_count, outcome, expected_odds')
    .eq('parlay_date', today);
  
  const tiers: Record<string, any[]> = {
    exploration: [],
    validation: [],
    execution: [],
  };
  
  (todayParlays || []).forEach((p: any) => {
    const sn = (p.strategy_name || '').toLowerCase();
    const tier = sn.includes('exploration') ? 'exploration' : sn.includes('validation') ? 'validation' : 'execution';
    if (tiers[tier]) tiers[tier].push(p);
  });
  
  let message = `🎯 *Today's Tier Summary*\n\n`;
  
  const tierEmoji = { exploration: '🔬', validation: '✓', execution: '🚀' };
  const tierDesc = { 
    exploration: 'Edge discovery ($0)', 
    validation: 'Pattern confirm ($50)', 
    execution: 'Best bets (Kelly)' 
  };
  
  for (const [tier, parlays] of Object.entries(tiers)) {
    const emoji = tierEmoji[tier as keyof typeof tierEmoji];
    const desc = tierDesc[tier as keyof typeof tierDesc];
    
    if (parlays.length === 0) {
      message += `${emoji} *${tier}:* 0 parlays\n\n`;
    } else {
      const legDist = parlays.reduce((acc, p) => {
        acc[p.leg_count] = (acc[p.leg_count] || 0) + 1;
        return acc;
      }, {} as Record<number, number>);
      
      message += `${emoji} *${tier}* (${parlays.length})\n`;
      message += `   ${desc}\n`;
      message += `   ${Object.entries(legDist).map(([l, c]) => `${l}-leg: ${c}`).join(', ')}\n\n`;
    }
  }
  
  const total = Object.values(tiers).reduce((s, t) => s + t.length, 0);
  message += `📊 *Total:* ${total} parlays generated today`;
  
  return message;
}

async function handleExplore(chatId: string) {
  await logActivity("telegram_explore", `User requested exploration tier`, { chatId });
  
  const today = getEasternDate();
  const { data: exploreParlays } = await supabase
    .from('bot_daily_parlays')
    .select('*')
    .eq('parlay_date', today)
    .ilike('strategy_name', '%exploration%')
    .order('combined_probability', { ascending: false })
    .limit(5);
  
  if (!exploreParlays || exploreParlays.length === 0) {
    return "🔬 *Exploration Tier*\n\nNo exploration parlays generated today.\n\nUse /generate to create tiered parlays!";
  }
  
  let message = `🔬 *Exploration Tier Highlights*\n\n`;
  message += `_Edge discovery parlays ($0 stake)_\n\n`;
  
  exploreParlays.forEach((p: any, i: number) => {
    const legs = Array.isArray(p.legs) ? p.legs : JSON.parse(p.legs || '[]');
    const topLegs = legs.slice(0, 2).map((l: any) => l.player_name || l.home_team || 'Team').join(', ');
    
    message += `${i + 1}. *${p.leg_count}-leg* +${p.expected_odds}\n`;
    message += `   ${topLegs}${legs.length > 2 ? ` +${legs.length - 2}` : ''}\n`;
    message += `   Win Rate: ${(p.combined_probability * 100).toFixed(1)}%\n\n`;
  });
  
  return message;
}

async function handleValidate(chatId: string) {
  await logActivity("telegram_validate", `User requested validation tier`, { chatId });
  
  const today = getEasternDate();
  const { data: validateParlays } = await supabase
    .from('bot_daily_parlays')
    .select('*')
    .eq('parlay_date', today)
    .ilike('strategy_name', '%validation%')
    .order('simulated_edge', { ascending: false })
    .limit(5);
  
  if (!validateParlays || validateParlays.length === 0) {
    return "✓ *Validation Tier*\n\nNo validation parlays generated today.\n\nUse /generate to create tiered parlays!";
  }
  
  let message = `✓ *Validation Tier Picks*\n\n`;
  message += `_Pattern confirmation ($50 stake)_\n\n`;
  
  validateParlays.forEach((p: any, i: number) => {
    const legs = Array.isArray(p.legs) ? p.legs : JSON.parse(p.legs || '[]');
    const topLegs = legs.slice(0, 2).map((l: any) => l.player_name || l.home_team || 'Team').join(', ');
    
    message += `${i + 1}. *${p.leg_count}-leg* +${p.expected_odds}\n`;
    message += `   ${topLegs}${legs.length > 2 ? ` +${legs.length - 2}` : ''}\n`;
    message += `   Edge: ${((p.simulated_edge || 0) * 100).toFixed(1)}%\n\n`;
  });
  
  return message;
}

// Main handler
async function handleMessage(chatId: string, text: string) {
  const command = text.toLowerCase().trim();

  // Handle commands
  if (command === "/start") {
    return await handleStart(chatId);
  } else if (command === "/status") {
    return await handleStatus(chatId);
  } else if (command === "/parlays") {
    return await handleParlays(chatId);
  } else if (command === "/performance") {
    return await handlePerformance(chatId);
  } else if (command === "/weights") {
    return await handleWeights(chatId);
  } else if (command === "/generate") {
    return await handleGenerate(chatId);
  } else if (command === "/settle") {
    return await handleSettle(chatId);
  } else if (command === "/nhl") {
    return await handleNHL(chatId);
  } else if (command === "/tennis") {
    return await handleTennis(chatId);
  } else if (command === "/spreads") {
    return await handleSpreads(chatId);
  } else if (command === "/totals") {
    return await handleTotals(chatId);
  } else if (command === "/learning") {
    return await handleLearning(chatId);
  } else if (command === "/tiers") {
    return await handleTiers(chatId);
  } else if (command === "/explore") {
    return await handleExplore(chatId);
  } else if (command === "/validate") {
    return await handleValidate(chatId);
  } else {
    // Natural language - save and process
    await saveConversation(chatId, "user", text);
    await logActivity("telegram_message", `User sent message`, {
      chatId,
      messagePreview: text.slice(0, 50),
    });

    const response = await handleNaturalLanguage(text, chatId);
    await saveConversation(chatId, "assistant", response);
    return response;
  }
}

// Main server
Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Verify webhook secret
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

    // Handle message
    if (update.message?.text) {
      const chatId = update.message.chat.id.toString();
      const text = update.message.text;

      const response = await handleMessage(chatId, text);
      await sendMessage(chatId, response);
    }

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("Webhook error:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
});
