/**
 * bot-send-telegram
 * 
 * Sends Telegram notifications for bot events:
 * - Parlay generation complete
 * - Daily settlement results
 * - Activation status changes
 * - Category weight updates
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const TELEGRAM_API = 'https://api.telegram.org/bot';

type NotificationType = 
  | 'parlays_generated'
  | 'tiered_parlays_generated'
  | 'settlement_complete'
  | 'activation_ready'
  | 'daily_summary'
  | 'weight_change'
  | 'strategy_update'
  | 'diagnostic_report'
  | 'integrity_alert'
  | 'preflight_alert'
  | 'test';

interface NotificationData {
  type: NotificationType;
  data: Record<string, any>;
}

async function formatMessage(type: NotificationType, data: Record<string, any>): Promise<string | { text: string; reply_markup?: object }> {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });

  switch (type) {
    case 'parlays_generated':
      return formatParlaysGenerated(data, dateStr);
    case 'tiered_parlays_generated':
      return await formatTieredParlaysGenerated(data, dateStr);
    case 'settlement_complete':
      return formatSettlement(data, dateStr);
    case 'activation_ready':
      return formatActivation(data);
    case 'daily_summary':
      return formatDailySummary(data, dateStr);
    case 'weight_change':
      return formatWeightChange(data);
    case 'strategy_update':
      return formatStrategyUpdate(data);
    case 'diagnostic_report':
      return formatDiagnosticReport(data, dateStr);
    case 'integrity_alert':
      return formatIntegrityAlert(data, dateStr);
    case 'preflight_alert':
      return formatPreflightAlert(data, dateStr);
    case 'test':
      return `🤖 *ParlayIQ Bot Test*\n\nConnection successful! You'll receive notifications here.\n\n_Sent ${dateStr}_`;
    default:
      return `📌 Bot Update: ${JSON.stringify(data)}`;
  }
}

function formatParlaysGenerated(data: Record<string, any>, dateStr: string): string {
  const { count, distribution, topPick, realLinePercentage, oddsRange, validPicks } = data;
  
  let msg = `📊 *PARLAY GENERATION COMPLETE*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `Generated: *${count} parlays* for ${dateStr}\n\n`;
  
  if (distribution) {
    msg += `Distribution:\n`;
    if (distribution['3']) msg += `• 3-Leg (Conservative): ${distribution['3']} parlays\n`;
    if (distribution['4']) msg += `• 4-Leg (Balanced): ${distribution['4']} parlays\n`;
    if (distribution['5']) msg += `• 5-Leg (Standard): ${distribution['5']} parlays\n`;
    if (distribution['6']) msg += `• 6-Leg (Aggressive): ${distribution['6']} parlays\n`;
    msg += `\n`;
  }
  
  if (topPick) {
    msg += `🎯 *Top Pick:* ${topPick.player_name}\n`;
    msg += `${topPick.prop_type} ${topPick.side?.toUpperCase() || 'OVER'} ${topPick.line} @ ${formatOdds(topPick.american_odds)}\n\n`;
  }
  
  if (realLinePercentage !== undefined) {
    msg += `📍 *${realLinePercentage}% REAL lines* verified`;
    if (validPicks) msg += ` (${validPicks} picks)`;
    msg += `\n`;
  }
  
  if (oddsRange) {
    msg += `📈 Odds Range: ${oddsRange.min} to ${oddsRange.max}\n`;
  }
  
  // Dashboard link removed - all info delivered in Telegram
  
  return msg;
}

async function formatTieredParlaysGenerated(data: Record<string, any>, dateStr: string): Promise<string> {
  const { totalCount, exploration, validation, execution, poolSize, topPicks } = data;
  
  let msg = `📊 *TIERED PARLAY GENERATION COMPLETE*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  
  // If totalCount is 0, look up actual parlays for today
  let displayCount = totalCount || 0;
  let countLabel = 'Generated';
  if (displayCount === 0) {
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const sb = createClient(supabaseUrl, supabaseKey);
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
      const { count } = await sb
        .from('bot_daily_parlays')
        .select('*', { count: 'exact', head: true })
        .eq('parlay_date', today);
      if (count && count > 0) {
        displayCount = count;
        countLabel = 'Active';
      }
    } catch (e) {
      console.error('[Telegram] Failed to lookup existing parlays:', e);
    }
  }
  
  msg += `✅ *${displayCount} parlays ${countLabel.toLowerCase()}* for ${dateStr}\n\n`;
  
  msg += `🔬 Exploration: ${exploration || 0} parlays\n`;
  msg += `✅ Validation: ${validation || 0} parlays\n`;
  msg += `🎯 Execution: ${execution || 0} parlays\n\n`;
  
  if (poolSize) {
    msg += `📍 Pool Size: ${poolSize} picks\n\n`;
  }
  
  // Top Picks Preview
  if (topPicks && Array.isArray(topPicks) && topPicks.length > 0) {
    msg += `🔥 *Top Picks Preview:*\n`;
    for (const pick of topPicks.slice(0, 5)) {
      const propLabels: Record<string, string> = {
        threes: '3PT', points: 'PTS', assists: 'AST', rebounds: 'REB',
        steals: 'STL', blocks: 'BLK', pra: 'PRA', goals: 'G',
        shots: 'SOG', saves: 'SVS', aces: 'ACES',
      };
      const oddsStr = pick.american_odds ? (pick.american_odds > 0 ? `(+${pick.american_odds})` : `(${pick.american_odds})`) : '';
      
      // Detect team-based legs: explicit type OR player_name contains " @ "
      const isTeamLeg = pick.type === 'team' || (pick.player_name && pick.player_name.includes(' @ ') && !pick.type);
      
      if (isTeamLeg) {
        let away = pick.away_team || '';
        let home = pick.home_team || '';
        // Parse from player_name if missing
        if ((!away || !home) && pick.player_name && pick.player_name.includes(' @ ')) {
          const parts = pick.player_name.split(' @ ');
          away = parts[0]?.trim() || away;
          home = parts[1]?.trim() || home;
        }
        const betType = (pick.bet_type || pick.prop_type || '').toLowerCase();
        if (betType.includes('total')) {
          msg += `📈 Take ${(pick.side || 'over').toUpperCase()} ${pick.line} ${oddsStr}\n`;
        } else if (betType.includes('spread')) {
          const team = pick.side === 'home' ? home : away;
          const line = pick.line > 0 ? `+${pick.line}` : `${pick.line}`;
          msg += `📊 Take ${team} ${line} ${oddsStr}\n`;
        } else {
          const team = pick.side === 'home' ? home : away;
          msg += `💎 Take ${team} ML ${oddsStr}\n`;
        }
      } else {
        const side = (pick.side || 'over').toUpperCase();
        const prop = propLabels[pick.prop_type] || (pick.prop_type || '').toUpperCase();
        msg += `🏀 Take ${pick.player_name || 'Player'} ${side} ${pick.line} ${prop} ${oddsStr}\n`;
      }
      if (pick.composite_score || pick.hit_rate) {
        msg += `  🎯${Math.round(pick.composite_score || 0)} | 💎${Math.round(pick.hit_rate || 0)}%\n`;
      }
    }
  }
  
  msg += `\nUse /parlays to see all picks with full details`;
  
  return msg;
}

function formatSettlement(data: Record<string, any>, dateStr: string): string {
  const { parlaysWon, parlaysLost, profitLoss, consecutiveDays, bankroll, isRealModeReady, weightChanges, strategyName, strategyWinRate, blockedCategories, unblockedCategories, parlayDetails } = data;
  const totalParlays = (parlaysWon || 0) + (parlaysLost || 0);
  const winRate = totalParlays > 0 ? ((parlaysWon / totalParlays) * 100).toFixed(0) : 0;
  
  let msg = `DAILY SETTLEMENT REPORT\n`;
  msg += `========================\n\n`;
  msg += `Date: ${dateStr}\n`;
  msg += `Result: ${parlaysWon || 0}/${totalParlays} parlays hit (${winRate}%)\n\n`;
  
  const plSign = profitLoss >= 0 ? '+' : '';
  msg += `P/L: ${plSign}$${profitLoss?.toFixed(0) || 0} (simulation)\n`;
  
  if (bankroll !== undefined) {
    const prevBankroll = bankroll - (profitLoss || 0);
    msg += `Bankroll: $${prevBankroll.toFixed(0)} -> $${bankroll.toFixed(0)}\n\n`;
  }
  
  if (consecutiveDays !== undefined) {
    if (consecutiveDays > 0) {
      msg += `Streak: ${consecutiveDays} consecutive profitable days\n`;
      if (!isRealModeReady && consecutiveDays < 3) {
        msg += `${3 - consecutiveDays} MORE DAY${3 - consecutiveDays > 1 ? 'S' : ''} until Real Mode!\n`;
      }
    } else {
      msg += `Streak reset - rebuilding momentum\n`;
    }
  }
  
  if (isRealModeReady) {
    msg += `\nREAL MODE READY!\n`;
  }
  
  // Tomorrow's Strategy section
  if (strategyName) {
    msg += `\nTomorrow's Strategy\n`;
    msg += `Active: ${strategyName}\n`;
    if (strategyWinRate !== undefined && strategyWinRate !== null) {
      msg += `Win Rate: ${(strategyWinRate * 100).toFixed(1)}%\n`;
    }
    if (blockedCategories && blockedCategories.length > 0) {
      msg += `Blocked: ${blockedCategories.slice(0, 5).join(', ')}\n`;
    }
    if (unblockedCategories && unblockedCategories.length > 0) {
      msg += `Unblocked: ${unblockedCategories.join(', ')}\n`;
    }
  }
  
  if (weightChanges && weightChanges.length > 0) {
    msg += `\nWeight Changes:\n`;
    for (const change of weightChanges.slice(0, 8)) {
      const arrow = change.delta > 0 ? '+' : '';
      msg += `${change.category}: ${change.oldWeight.toFixed(2)} -> ${change.newWeight.toFixed(2)} (${arrow}${change.delta.toFixed(2)})\n`;
    }
  }

  // --- LEG BREAKDOWN ---
  if (parlayDetails && Array.isArray(parlayDetails) && parlayDetails.length > 0) {
    msg += `\n--- LEG BREAKDOWN ---\n`;
    
    const propLabels: Record<string, string> = {
      threes: '3PT', points: 'PTS', assists: 'AST', rebounds: 'REB',
      steals: 'STL', blocks: 'BLK', pra: 'PRA', goals: 'G',
      shots: 'SOG', saves: 'SVS', aces: 'ACES', spread: 'SPR',
      total: 'TOT', moneyline: 'ML', h2h: 'ML',
    };
    
    for (let i = 0; i < parlayDetails.length; i++) {
      const p = parlayDetails[i];
      const tierLabel = (p.tier || 'exploration').charAt(0).toUpperCase() + (p.tier || 'exploration').slice(1);
      const outcomeLabel = p.outcome === 'won' ? 'WON' : 'LOST';
      msg += `\nParlay #${i + 1} (${tierLabel}) - ${outcomeLabel}\n`;
      
      for (const leg of (p.legs || [])) {
        const icon = leg.outcome === 'hit' ? '[hit] ' : leg.outcome === 'miss' ? '[miss]' : '[void]';
        const side = (leg.side || 'over').charAt(0).toUpperCase();
        const prop = propLabels[leg.prop_type] || (leg.prop_type || '').toUpperCase();
        const actualStr = leg.actual_value !== null && leg.actual_value !== undefined ? ` (actual: ${leg.actual_value})` : '';
        msg += `  ${icon} ${leg.player_name} ${side}${leg.line} ${prop}${actualStr}\n`;
      }
    }
    
    // --- TOP BUSTERS ---
    const missMap = new Map<string, { count: number; actual_value: number | null }>();
    for (const p of parlayDetails) {
      if (p.outcome !== 'lost') continue;
      for (const leg of (p.legs || [])) {
        if (leg.outcome !== 'miss') continue;
        const side = (leg.side || 'over').charAt(0).toUpperCase();
        const prop = propLabels[leg.prop_type] || (leg.prop_type || '').toUpperCase();
        const key = `${leg.player_name} ${side}${leg.line} ${prop}`;
        const existing = missMap.get(key);
        if (existing) {
          existing.count++;
        } else {
          missMap.set(key, { count: 1, actual_value: leg.actual_value });
        }
      }
    }
    
    if (missMap.size > 0) {
      const busters = [...missMap.entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 5);
      
      msg += `\n--- TOP BUSTERS ---\n`;
      for (const [key, { count, actual_value }] of busters) {
        const actualStr = actual_value !== null && actual_value !== undefined ? ` (actual: ${actual_value})` : '';
        msg += `${key}: missed in ${count} parlay${count > 1 ? 's' : ''}${actualStr}\n`;
      }
    }
  }
  
  return msg;
}

function formatActivation(data: Record<string, any>): string {
  const { winRate, bankroll, consecutiveDays } = data;
  
  let msg = `🚀 *BOT ACTIVATED FOR REAL MODE*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `Status: *REAL MODE UNLOCKED!*\n\n`;
  msg += `Achievement:\n`;
  msg += `✅ ${consecutiveDays || 3} consecutive profitable days\n`;
  msg += `✅ ${winRate || 60}%+ win rate\n`;
  msg += `✅ Bankroll growth: $1,000 → $${bankroll?.toFixed(0) || 'N/A'}\n\n`;
  msg += `Next: Bot will generate parlays with Kelly-sized stakes\n\n`;
  msg += `Configure your bankroll in settings.`;
  
  return msg;
}

function formatDailySummary(data: Record<string, any>, dateStr: string): string {
  const { parlaysCount, winRate, edge, bankroll, mode } = data;
  
  let msg = `📈 *DAILY SUMMARY* - ${dateStr}\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `Parlays: ${parlaysCount || 0}\n`;
  msg += `Win Rate: ${winRate || 0}%\n`;
  msg += `Avg Edge: ${edge || 0}%\n`;
  msg += `Bankroll: $${bankroll?.toFixed(0) || 1000}\n`;
  msg += `Mode: ${mode || 'Simulation'}\n`;
  
  return msg;
}

function formatWeightChange(data: Record<string, any>): string {
  const { category, oldWeight, newWeight, reason } = data;
  const arrow = newWeight > oldWeight ? '📈' : '📉';
  
  let msg = `${arrow} *Weight Update*\n\n`;
  msg += `Category: ${category}\n`;
  msg += `Weight: ${oldWeight?.toFixed(2)} -> ${newWeight?.toFixed(2)}\n`;
  if (reason) msg += `Reason: ${reason}`;
  
  return msg;
}

function formatStrategyUpdate(data: Record<string, any>): string {
  const { strategyName, action, reason, winRate } = data;
  
  let msg = `⚠️ *Strategy Update*\n\n`;
  msg += `Strategy: ${strategyName}\n`;
  msg += `Action: ${action}\n`;
  if (winRate !== undefined) msg += `Win Rate: ${(winRate * 100).toFixed(1)}%\n`;
  if (reason) msg += `Reason: ${reason}`;
  
  return msg;
}

function formatDiagnosticReport(data: Record<string, any>, dateStr: string): { text: string; reply_markup?: object } {
  const { checks, improvementMetrics, passed, warned, failed, overall } = data;
  
  let msg = `BOT DAILY DIAGNOSTIC\n`;
  msg += `=======================\n`;
  msg += `Date: ${dateStr}\n\n`;
  
  msg += `HEALTH CHECKS\n`;
  if (Array.isArray(checks)) {
    for (const c of checks) {
      const label = (c.name || '').padEnd(24, '.');
      const status = c.status === 'pass' ? 'PASS' : c.status === 'warn' ? 'WARN' : 'FAIL';
      const detail = c.detail && c.status !== 'pass' ? ` (${c.detail})` : '';
      msg += `  ${label} ${status}${detail}\n`;
    }
  }
  
  if (improvementMetrics) {
    msg += `\nIMPROVEMENT TRENDS\n`;
    if (improvementMetrics.win_rate?.current !== null && improvementMetrics.win_rate?.current !== undefined) {
      const wr = improvementMetrics.win_rate;
      const delta = wr.delta !== null ? ` (${wr.delta >= 0 ? '+' : ''}${wr.delta}%)` : '';
      msg += `  Win Rate: ${wr.prior ?? '?'}% -> ${wr.current}%${delta}\n`;
    }
    if (improvementMetrics.bankroll?.current !== null && improvementMetrics.bankroll?.current !== undefined) {
      const br = improvementMetrics.bankroll;
      const delta = br.delta !== null ? ` (${br.delta >= 0 ? '+' : ''}$${br.delta})` : '';
      msg += `  Bankroll: $${br.prior ?? '?'} -> $${Math.round(br.current)}${delta}\n`;
    }
    if (improvementMetrics.weight_stability !== undefined) {
      msg += `  Weight Stability: ${improvementMetrics.weight_stability} std dev\n`;
    }
  }
  
  msg += `\nOverall: ${passed || 0}/7 PASS, ${warned || 0} WARN, ${failed || 0} FAIL`;
  if (overall === 'critical') msg += ` ⚠️`;

  // Build inline keyboard for failed/warned checks
  const fixMap: Record<string, { label: string; action: string }> = {
    'Data Freshness': { label: '🔄 Fix: Refresh Props', action: 'fix:refresh_props' },
    'Weight Calibration': { label: '⚖️ Fix: Calibrate', action: 'fix:calibrate' },
    'Parlay Generation': { label: '📊 Fix: Generate Parlays', action: 'fix:generate' },
    'Settlement Pipeline': { label: '💰 Fix: Settle Parlays', action: 'fix:settle' },
    'Cron Jobs': { label: '⚙️ Fix: Run All Jobs', action: 'fix:run_crons' },
  };

  const buttons: Array<{ text: string; callback_data: string }[]> = [];
  if (Array.isArray(checks)) {
    for (const c of checks) {
      if ((c.status === 'fail' || c.status === 'warn') && fixMap[c.name]) {
        buttons.push([{ text: fixMap[c.name].label, callback_data: fixMap[c.name].action }]);
      }
    }
  }

  const reply_markup = buttons.length > 0 ? { inline_keyboard: buttons } : undefined;

  return { text: msg, reply_markup };
}

function formatIntegrityAlert(data: Record<string, any>, dateStr: string): string {
  const { oneLegCount, twoLegCount, total, strategyCounts } = data;

  let msg = `⚠️ *PARLAY INTEGRITY ALERT — ${dateStr}*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `🚨 Leak detected in today's parlays:\n`;
  if (oneLegCount > 0) msg += `  • 1-leg singles: *${oneLegCount} parlays*\n`;
  if (twoLegCount > 0) msg += `  • 2-leg minis:   *${twoLegCount} parlays*\n`;
  msg += `  Total violations: *${total}*\n\n`;

  if (strategyCounts && Object.keys(strategyCounts).length > 0) {
    msg += `Strategies involved:\n`;
    for (const [name, count] of Object.entries(strategyCounts)) {
      msg += `  • ${name} (×${count})\n`;
    }
    msg += `\n`;
  }

  msg += `⚡ *Action required:* Review bot-generate-daily-parlays\n`;
  msg += `Run /admin cleanup to remove bad parlays`;

  return msg;
}

function formatPreflightAlert(data: Record<string, any>, dateStr: string): string {
  const { blockers, checks } = data;
  
  let msg = `⚠️ PIPELINE PREFLIGHT FAILED\n`;
  msg += `========================\n`;
  msg += `Date: ${dateStr}\n\n`;
  msg += `${(blockers || []).length} blocker(s) detected before generation:\n`;
  
  for (const b of (blockers || [])) {
    msg += `  • ${b}\n`;
  }
  
  msg += `\nAction required before next generation cycle.`;
  
  if (checks && Array.isArray(checks)) {
    const passed = checks.filter((c: any) => c.passed).length;
    msg += `\n\nChecks: ${passed}/${checks.length} passed`;
  }
  
  return msg;
}

function formatOdds(odds?: number): string {
  if (!odds) return '-110';
  return odds > 0 ? `+${odds}` : `${odds}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
    const chatId = Deno.env.get('TELEGRAM_CHAT_ID');

    if (!botToken || !chatId) {
      console.error('[Telegram] Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID');
      return new Response(
        JSON.stringify({ success: false, error: 'Telegram not configured' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { type, data }: NotificationData = await req.json();
    
    console.log(`[Telegram] Sending ${type} notification`);

    // Check notification preferences (skip for test, integrity_alert, preflight_alert — these always fire)
    if (type !== 'test' && type !== 'integrity_alert' && type !== 'preflight_alert') {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const supabase = createClient(supabaseUrl, supabaseKey);

      const { data: settings } = await supabase
        .from('bot_notification_settings')
        .select('*')
        .eq('telegram_enabled', true)
        .limit(1)
        .maybeSingle();

      if (settings) {
        // Check if this notification type is enabled
        const notifyMap: Record<string, string> = {
          'parlays_generated': 'notify_parlays_generated',
          'tiered_parlays_generated': 'notify_parlays_generated',
          'settlement_complete': 'notify_settlement',
          'activation_ready': 'notify_activation_ready',
          'weight_change': 'notify_weight_changes',
          'strategy_update': 'notify_strategy_updates',
        };

        const settingKey = notifyMap[type];
        if (settingKey && settings[settingKey] === false) {
          console.log(`[Telegram] Notification type ${type} disabled by user`);
          return new Response(
            JSON.stringify({ success: true, skipped: true, reason: 'disabled' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Check quiet hours (ET timezone)
        const now = new Date();
        const etHour = parseInt(now.toLocaleString('en-US', { 
          timeZone: 'America/New_York', 
          hour: 'numeric', 
          hour12: false 
        }));
        
        const quietStart = settings.quiet_start_hour || 23;
        const quietEnd = settings.quiet_end_hour || 7;
        
        if (quietStart > quietEnd) {
          // Quiet hours span midnight
          if (etHour >= quietStart || etHour < quietEnd) {
            console.log(`[Telegram] Quiet hours (${quietStart}:00 - ${quietEnd}:00 ET)`);
            return new Response(
              JSON.stringify({ success: true, skipped: true, reason: 'quiet_hours' }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
        } else {
          if (etHour >= quietStart && etHour < quietEnd) {
            console.log(`[Telegram] Quiet hours (${quietStart}:00 - ${quietEnd}:00 ET)`);
            return new Response(
              JSON.stringify({ success: true, skipped: true, reason: 'quiet_hours' }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
        }
      }
    }

    // Format message - diagnostic_report returns { text, reply_markup }
    const formatted = await formatMessage(type, data);
    let message: string;
    let replyMarkup: object | undefined;
    
    if (typeof formatted === 'object' && formatted !== null && 'text' in formatted) {
      message = (formatted as { text: string; reply_markup?: object }).text;
      replyMarkup = (formatted as { text: string; reply_markup?: object }).reply_markup;
    } else {
      message = formatted as string;
    }
    
    // Send via Telegram API - use sendLongMessage for settlement reports
    const sendToTelegram = async (text: string, markup?: object) => {
      const body: Record<string, any> = {
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      };
      if (markup) body.reply_markup = markup;

      let resp = await fetch(`${TELEGRAM_API}${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      let result = await resp.json();

      // If too long, split by double newline
      if (!resp.ok && result?.description?.includes('message is too long')) {
        const chunks: string[] = [];
        let current = '';
        for (const line of text.split('\n')) {
          if ((current + '\n' + line).length > 4000 && current.length > 0) {
            chunks.push(current);
            current = line;
          } else {
            current += (current ? '\n' : '') + line;
          }
        }
        if (current) chunks.push(current);

        for (let i = 0; i < chunks.length; i++) {
          const chunkBody: Record<string, any> = {
            chat_id: chatId,
            text: chunks[i],
            disable_web_page_preview: true,
          };
          if (i === chunks.length - 1 && markup) chunkBody.reply_markup = markup;
          resp = await fetch(`${TELEGRAM_API}${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(chunkBody),
          });
          result = await resp.json();
        }
      }

      return { resp, result };
    };

    const { resp: telegramResponse, result: telegramResult } = await sendToTelegram(message, replyMarkup);

    if (!telegramResponse.ok) {
      console.error('[Telegram] API error:', telegramResult);
      return new Response(
        JSON.stringify({ success: false, error: telegramResult }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[Telegram] Message sent successfully`);

    return new Response(
      JSON.stringify({ success: true, messageId: telegramResult.result?.message_id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Telegram] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
