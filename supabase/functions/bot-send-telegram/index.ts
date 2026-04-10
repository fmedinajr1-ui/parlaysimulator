/**
 * bot-send-telegram  (REWRITTEN)
 *
 * FIXES APPLIED:
 *  BUG 9  — parse_mode now forwarded to Telegram API in every request
 *  BUG 8  — formatSettlement converted to Markdown, consistent with all other formatters
 *  BUG 10 — formatBenchPicksDigest confidence_score no longer multiplied by 100
 *  BUG 11 — formatSweetSpotsBroadcast uses distinct emojis per prop category
 *  BUG 12 — formatHighConvictionReport uses sport-aware emoji from getSportEmoji()
 *  BUG 13 — formatDoubleConfirmedReport gets proper bold header + dateStr
 *  BUG 14 — Quiet hours check uses reliable ET hour extraction (no parseInt on "24")
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const TELEGRAM_API = 'https://api.telegram.org/bot';

const PROP_LABELS: Record<string, string> = {
  threes: '3PT', points: 'PTS', assists: 'AST', rebounds: 'REB',
  steals: 'STL', blocks: 'BLK', turnovers: 'TO', pra: 'PRA',
  pts_rebs: 'P+R', pts_asts: 'P+A', rebs_asts: 'R+A',
  three_pointers_made: '3PT', fantasy_score: 'FPTS',
  goals: 'G', shots: 'SOG', saves: 'SVS', aces: 'ACES',
  spread: 'SPR', total: 'TOT', moneyline: 'ML', h2h: 'ML',
  player_points: 'PTS', player_rebounds: 'REB', player_assists: 'AST',
  player_threes: '3PT', player_blocks: 'BLK', player_steals: 'STL',
  player_turnovers: 'TO', player_pra: 'PRA', player_pts_rebs: 'P+R',
  player_pts_asts: 'P+A', player_rebs_asts: 'R+A',
  player_double_double: 'DD', player_triple_double: 'TD',
  player_goals: 'G', player_shots_on_goal: 'SOG', player_blocked_shots: 'BLK',
  player_power_play_points: 'PPP', player_points_nhl: 'PTS',
  player_assists_nhl: 'A', player_saves: 'SVS', assists_nhl: 'A',
  pitcher_strikeouts: 'Ks', total_bases: 'TB', hits: 'H',
  runs: 'R', rbis: 'RBI', stolen_bases: 'SB', walks: 'BB',
  hitter_fantasy_score: 'FPTS', batter_home_runs: 'HR',
  player_fantasy_score: 'FPTS',
};

function getSportEmoji(leg: any): string {
  const sportKey = (leg.sport || leg.sport_key || leg.category || '').toLowerCase();
  if (sportKey.includes('nhl') || sportKey.includes('hockey')) return '🏒';
  if (sportKey.includes('mlb') || sportKey.includes('baseball') ||
      sportKey.includes('pitcher') || sportKey.includes('hitter') ||
      sportKey.includes('batter')) return '⚾';
  if (sportKey.includes('nfl') || sportKey.includes('ncaaf') ||
      sportKey.includes('football')) return '🏈';
  return '🏀';
}

function getRecencyWarning(leg: any): string {
  const l3  = leg.l3_avg  ?? leg.l3Avg;
  const l10 = leg.l10_avg ?? leg.l10Avg ?? leg.l10_average;
  const side = (leg.side || 'over').toLowerCase();
  if (l3 == null || l10 == null || l10 <= 0) return '';
  const ratio = l3 / l10;
  if (side === 'over'  && ratio < 0.85 && ratio >= 0.75) return ` 📉L3:${l3}`;
  if (side === 'under' && ratio > 1.15 && ratio <= 1.25) return ` 📈L3:${l3}`;
  return '';
}

function formatPropLabel(pt: string): string {
  const labels: Record<string, string> = {
    player_points: 'PTS', player_rebounds: 'REB', player_assists: 'AST',
    player_threes: '3PT', player_blocks: 'BLK', player_steals: 'STL',
    player_turnovers: 'TO', player_points_rebounds_assists: 'PRA',
    player_points_rebounds: 'PR', player_points_assists: 'PA',
    player_rebounds_assists: 'RA',
    batter_hits: 'Hits', batter_rbis: 'RBI', batter_runs_scored: 'Runs',
    batter_total_bases: 'TB', batter_home_runs: 'HR', batter_stolen_bases: 'SB',
    pitcher_strikeouts: 'K', pitcher_outs: 'Outs',
  };
  return labels[pt] || pt.replace(/^(player_|batter_|pitcher_)/, '').replace(/_/g, ' ').toUpperCase();
}

function formatOdds(odds?: number): string {
  if (!odds) return '-110';
  return odds > 0 ? `+${odds}` : `${odds}`;
}

// BUG 14 FIX: reliable ET hour using Intl, avoids parseInt("24") edge case
function getETHour(): number {
  const etStr = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    hour12: false,
  }).format(new Date());
  // Returns "00"–"23" — never "24"
  return parseInt(etStr, 10) % 24;
}

type NotificationType =
  | 'parlays_generated' | 'tiered_parlays_generated' | 'settlement_complete'
  | 'activation_ready' | 'daily_summary' | 'weight_change' | 'strategy_update'
  | 'diagnostic_report' | 'integrity_alert' | 'preflight_alert' | 'daily_winners'
  | 'mispriced_lines_report' | 'high_conviction_report' | 'fresh_slate_report'
  | 'double_confirmed_report' | 'mega_parlay_scanner' | 'mega_lottery_v2'
  | 'daily_winners_recap' | 'slate_rebuild_alert' | 'slate_status_update'
  | 'longshot_announcement' | 'pipeline_failure_alert' | 'doctor_report'
  | 'quality_regen_report' | 'hit_rate_evaluation' | 'ladder_challenge'
  | 'ladder_challenge_result' | 'parlay_approval_request' | 'extra_plays_report'
  | 'engine_accuracy_report' | 'leg_settled_alert' | 'parlay_settled_alert'
  | 'dd_td_candidates' | 'new_strategies_broadcast' | 'leg_swap_report'
  | 'hedge_pregame_scout' | 'hedge_live_update' | 'composite_conflict_report'
  | 'bench_picks_digest' | 'straight_bets' | 'hedge_accuracy' | 'pick_dna'
  | 'sweet_spots_broadcast' | 'calibration_complete' | 'custom' | 'test';

async function formatMessage(
  type: NotificationType,
  data: Record<string, any>,
  dateStr: string
): Promise<string | { text: string; reply_markup?: object }> {
  switch (type) {
    case 'parlays_generated':          return formatParlaysGenerated(data, dateStr);
    case 'tiered_parlays_generated':   return await formatTieredParlaysGenerated(data, dateStr);
    case 'settlement_complete':        return formatSettlement(data, dateStr);         // BUG 8 FIX
    case 'activation_ready':           return formatActivation(data);
    case 'daily_summary':              return formatDailySummary(data, dateStr);
    case 'weight_change':              return formatWeightChange(data);
    case 'strategy_update':            return formatStrategyUpdate(data);
    case 'diagnostic_report':          return formatDiagnosticReport(data, dateStr);
    case 'integrity_alert':            return formatIntegrityAlert(data, dateStr);
    case 'preflight_alert':            return formatPreflightAlert(data, dateStr);
    case 'daily_winners':              return formatDailyWinnersReport(data, dateStr);
    case 'mispriced_lines_report':     return formatMispricedLinesReport(data, dateStr);
    case 'high_conviction_report':     return formatHighConvictionReport(data, dateStr); // BUG 12 FIX
    case 'fresh_slate_report':         return formatFreshSlateReport(data, dateStr);
    case 'double_confirmed_report':    return formatDoubleConfirmedReport(data, dateStr); // BUG 13 FIX
    case 'mega_parlay_scanner':        return formatMegaParlayScanner(data, dateStr);
    case 'mega_lottery_v2':            return formatMegaLotteryV2(data, dateStr);
    case 'daily_winners_recap':        return formatDailyWinnersRecap(data, dateStr);
    case 'slate_rebuild_alert':        return formatSlateRebuildAlert(dateStr);
    case 'slate_status_update':        return formatSlateStatusUpdate(data, dateStr);
    case 'longshot_announcement':      return formatLongshotAnnouncement(data, dateStr);
    case 'pipeline_failure_alert':     return formatPipelineFailureAlert(data, dateStr);
    case 'doctor_report':              return formatDoctorReport(data, dateStr);
    case 'quality_regen_report':       return formatQualityRegenReport(data, dateStr);
    case 'hit_rate_evaluation':        return formatHitRateEvaluation(data, dateStr);
    case 'ladder_challenge':           return data.message || `🪜 Ladder Challenge pick generated`;
    case 'ladder_challenge_result':    return formatLadderChallengeResult(data);
    case 'parlay_approval_request':    return formatParlayApprovalRequest(data, dateStr);
    case 'extra_plays_report':         return formatExtraPlaysReport(data, dateStr);
    case 'engine_accuracy_report':     return formatEngineAccuracyReport(data, dateStr);
    case 'leg_settled_alert':          return formatLegSettledAlert(data, dateStr);
    case 'parlay_settled_alert':       return formatParlaySettledAlert(data, dateStr);
    case 'dd_td_candidates':           return formatDDTDCandidates(data, dateStr);
    case 'new_strategies_broadcast':   return formatNewStrategiesBroadcast(data, dateStr);
    case 'leg_swap_report':            return formatLegSwapReport(data, dateStr);
    case 'bench_picks_digest':         return formatBenchPicksDigest(data, dateStr);  // BUG 10 FIX
    case 'sweet_spots_broadcast':      return formatSweetSpotsBroadcast(data, dateStr); // BUG 11 FIX
    case 'composite_conflict_report':  return formatCompositeConflictReport(data, dateStr);
    case 'calibration_complete':       return formatCalibrationComplete(data, dateStr);
    case 'hedge_pregame_scout':        return data.message || '🏀 Pre-game scout update';
    case 'hedge_live_update':          return data.message || '🎯 Hedge status update';
    case 'hedge_accuracy':             return data.message || '📊 Hedge accuracy report';
    case 'straight_bets':              return data.message || '📊 Straight bets generated';
    case 'pick_dna':                   return data.message || '🧬 Pick DNA report';
    case 'custom':
      return data.message || data.text || data.summary || '📌 Bot update received';
    case 'test':
      return `🤖 *ParlayIQ Bot Test*\n\nConnection successful!\n\n_Sent ${dateStr}_`;
    default:
      console.log(`[Telegram] Unknown type: ${type}`, JSON.stringify(data).slice(0, 200));
      return `📌 *Bot Update* (${type})`;
  }
}

// ─── FORMATTERS ───────────────────────────────────────────────────────────────

// BUG 11 FIX: distinct emojis per prop category
function formatSweetSpotsBroadcast(data: Record<string, any>, dateStr: string): string {
  const picks = data.picks || [];
  if (picks.length === 0) return `🎯 *Sweet Spot Picks — ${dateStr}*\n\nNo qualifying picks today.`;

  const CATEGORY_EMOJI: Record<string, string> = {
    points: '🏀', rebounds: '💪', assists: '🎯', threes: '🔥',
    steals: '🖐️', blocks: '🛡️', pra: '⭐', pts_rebs: '🔁',
    pts_asts: '🎯', rebs_asts: '💫', turnovers: '⚠️',
  };

  const groups: Record<string, typeof picks> = {};
  for (const p of picks) {
    const cat = (p.category || p.prop_type || 'other').toLowerCase().replace('player_', '');
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(p);
  }

  let msg = `🎯 *Today's Sweet Spots* — ${dateStr}\n━━━━━━━━━━━━━━━━━━━━━\n\n`;

  const catLabel = (cat: string) => {
    const labels: Record<string, string> = {
      points: 'Points', rebounds: 'Rebounds', assists: 'Assists',
      threes: '3-Pointers', pra: 'PRA', pts_rebs: 'Pts+Rebs',
      pts_asts: 'Pts+Asts', rebs_asts: 'Rebs+Asts', steals: 'Steals',
      blocks: 'Blocks', turnovers: 'Turnovers',
    };
    return labels[cat] || cat.charAt(0).toUpperCase() + cat.slice(1);
  };

  let totalConf = 0;
  let count = 0;

  for (const [cat, catPicks] of Object.entries(groups)) {
    const emoji = CATEGORY_EMOJI[cat] || '📊';
    // Category hit rate from the picks in this group
    const catHitRates = catPicks.filter((p: any) => p.l10_hit_rate != null).map((p: any) => p.l10_hit_rate);
    const avgCatHitRate = catHitRates.length > 0 ? Math.round((catHitRates.reduce((a: number, b: number) => a + b, 0) / catHitRates.length) * 100) : null;
    const catHeader = avgCatHitRate != null ? `${emoji} *${catLabel(cat)}* — ${avgCatHitRate}% avg L10 hit rate` : `${emoji} *${catLabel(cat)}*`;
    msg += `${catHeader}\n`;
    for (const p of catPicks) {
      const side = (p.recommended_side || 'over').toUpperCase();
      const line = p.recommended_line ?? '?';
      const conf = Math.round(p.confidence_score || 0);
      const l10avg = p.l10_avg != null ? p.l10_avg.toFixed(1) : null;

      // One-liner edge explanation
      let edgeLine = '';
      if (l10avg != null && line !== '?') {
        const numLine = Number(line);
        if (side === 'OVER' && Number(l10avg) > numLine) {
          edgeLine = ` — averaging ${l10avg} over L10 against a ${line} line`;
        } else if (side === 'UNDER' && Number(l10avg) < numLine) {
          edgeLine = ` — averaging ${l10avg} over L10, well under the ${line} line`;
        }
      }

      msg += `• *${p.player_name}* — ${side} ${line}${edgeLine}\n`;
      msg += `  🎯 ${conf}% confidence\n`;
      totalConf += conf;
      count++;
    }
    msg += '\n';
  }

  const avgConf = count > 0 ? Math.round(totalConf / count) : 0;
  msg += `📈 *${count} picks* | Avg confidence: *${avgConf}%*`;
  return msg;
}

// BUG 8 FIX: full Markdown formatting for settlement report
function formatSettlement(data: Record<string, any>, dateStr: string): string {
  const {
    parlaysWon, parlaysLost, profitLoss, consecutiveDays, bankroll,
    isRealModeReady, weightChanges, strategyName, strategyWinRate,
    blockedCategories, unblockedCategories, parlayDetails,
  } = data;
  const totalParlays = (parlaysWon || 0) + (parlaysLost || 0);
  const winRate = totalParlays > 0 ? Math.round((parlaysWon / totalParlays) * 100) : 0;
  const plSign = (profitLoss ?? 0) >= 0 ? '+' : '';
  const plIcon = (profitLoss ?? 0) >= 0 ? '🟢' : '🔴';

  // Narrative verdict
  let verdict = '';
  if (winRate >= 70) verdict = 'Dominant day — nearly everything hit.';
  else if (winRate >= 55) verdict = 'Solid day — system is grinding.';
  else if (winRate >= 40) verdict = 'Mixed results — some edges landed, some didn\'t.';
  else if (totalParlays > 0) verdict = 'Rough day — variance caught up with us.';

  // Find what carried us / what busted us
  const propTypeStats = new Map<string, { hits: number; total: number }>();
  if (parlayDetails?.length > 0) {
    for (const p of parlayDetails) {
      for (const leg of (p.legs || [])) {
        if (leg.outcome !== 'hit' && leg.outcome !== 'miss') continue;
        const prop = PROP_LABELS[(leg.prop_type || '').toLowerCase()] || (leg.prop_type || '').toUpperCase();
        const s = propTypeStats.get(prop) || { hits: 0, total: 0 };
        s.total++;
        if (leg.outcome === 'hit') s.hits++;
        propTypeStats.set(prop, s);
      }
    }
  }
  const sortedProps = [...propTypeStats.entries()].sort((a, b) => (b[1].hits / b[1].total) - (a[1].hits / a[1].total));
  const bestProp = sortedProps.find(([, s]) => s.total >= 2 && s.hits / s.total >= 0.7);
  const worstProp = sortedProps.reverse().find(([, s]) => s.total >= 2 && s.hits / s.total <= 0.3);
  if (bestProp) verdict += ` ${bestProp[0]} carried us.`;
  if (worstProp) verdict += ` ${worstProp[0]} busted ${worstProp[1].total - worstProp[1].hits} tickets.`;

  let msg = `${plIcon} *DAILY SETTLEMENT — ${dateStr}*\n━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  if (verdict) msg += `💬 _${verdict}_\n\n`;
  msg += `*Result:* ${parlaysWon || 0}/${totalParlays} hit (${winRate}%)\n`;
  msg += `*P/L:* ${plSign}$${(profitLoss ?? 0).toFixed(0)}\n`;

  if (bankroll !== undefined) {
    const prev = (bankroll - (profitLoss || 0)).toFixed(0);
    msg += `*Bankroll:* $${prev} → $${bankroll.toFixed(0)}\n`;
  }

  if (consecutiveDays !== undefined) {
    msg += '\n';
    if (consecutiveDays > 0) {
      msg += `🔥 *${consecutiveDays} consecutive profitable days*\n`;
      if (!isRealModeReady && consecutiveDays < 3) {
        const remaining = 3 - consecutiveDays;
        msg += `⏳ ${remaining} more day${remaining > 1 ? 's' : ''} until Real Mode\n`;
      }
    } else {
      msg += `📉 Streak reset — rebuilding\n`;
    }
  }

  if (isRealModeReady) {
    msg += `\n🚀 *REAL MODE UNLOCKED!*\n`;
  }

  if (strategyName) {
    msg += `\n*Tomorrow's Strategy:* ${strategyName}\n`;
    if (strategyWinRate != null) {
      msg += `Win Rate: ${(strategyWinRate * 100).toFixed(1)}%\n`;
    }
    if (blockedCategories?.length > 0) {
      msg += `🚫 Blocked: ${blockedCategories.slice(0, 5).join(', ')}\n`;
    }
    if (unblockedCategories?.length > 0) {
      msg += `✅ Unblocked: ${unblockedCategories.join(', ')}\n`;
    }
  }

  if (weightChanges?.length > 0) {
    msg += `\n*Weight Changes:*\n`;
    for (const change of weightChanges.slice(0, 8)) {
      const arrow = change.delta > 0 ? '📈' : '📉';
      const sign  = change.delta > 0 ? '+' : '';
      msg += `${arrow} ${change.category}: ${change.oldWeight.toFixed(2)} → ${change.newWeight.toFixed(2)} (${sign}${change.delta.toFixed(2)})\n`;
    }
  }

  if (parlayDetails?.length > 0) {
    msg += `\n*Leg Breakdown:*\n`;
    for (let i = 0; i < parlayDetails.length; i++) {
      const p = parlayDetails[i];
      const tierLabel = (p.tier || 'exploration').charAt(0).toUpperCase() + (p.tier || 'exploration').slice(1);
      const outcomeIcon = p.outcome === 'won' ? '✅' : '❌';
      msg += `\n${outcomeIcon} *Parlay #${i + 1}* (${tierLabel})\n`;
      for (const leg of (p.legs || [])) {
        const icon = leg.outcome === 'hit' ? '✅' : leg.outcome === 'miss' ? '❌' : '⬜';
        const side = (leg.side || 'over').charAt(0).toUpperCase();
        const prop = PROP_LABELS[(leg.prop_type || '').toLowerCase()] || (leg.prop_type || '').toUpperCase();
        const actual = leg.actual_value != null ? ` → ${leg.actual_value}` : '';
        msg += `  ${icon} ${leg.player_name} ${side}${leg.line} ${prop}${actual}\n`;
      }
    }

    // Top busters with context
    const missMap = new Map<string, { count: number; actual: number | null; line: number | null; side: string }>();
    for (const p of parlayDetails) {
      if (p.outcome !== 'lost') continue;
      for (const leg of (p.legs || [])) {
        if (leg.outcome !== 'miss') continue;
        const side = (leg.side || 'over').charAt(0).toUpperCase();
        const prop = PROP_LABELS[(leg.prop_type || '').toLowerCase()] || (leg.prop_type || '').toUpperCase();
        const key = `${leg.player_name} ${side}${leg.line} ${prop}`;
        const existing = missMap.get(key);
        if (existing) existing.count++;
        else missMap.set(key, { count: 1, actual: leg.actual_value, line: leg.line, side: leg.side || 'over' });
      }
    }
    const busters = [...missMap.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 5);
    if (busters.length > 0) {
      msg += `\n*Top Busters:*\n`;
      for (const [key, { count, actual, line, side }] of busters) {
        const isOver = (side || 'over').toLowerCase() === 'over';
        let context = '';
        if (actual != null && line != null) {
          const diff = isOver ? line - actual : actual - line;
          if (diff > 0) context = ` — missed by ${diff.toFixed(1)}`;
        }
        msg += `💔 ${key} — killed ${count} parlay${count > 1 ? 's' : ''}${actual != null ? ` (actual: ${actual})` : ''}${context}\n`;
      }
    }

    // Prop type breakdown
    if (propTypeStats.size > 0) {
      const sorted2 = [...propTypeStats.entries()].sort((a, b) => (b[1].hits / b[1].total) - (a[1].hits / a[1].total));
      msg += `\n*Prop Breakdown:*\n`;
      for (const [prop, { hits, total }] of sorted2) {
        const pct = Math.round((hits / total) * 100);
        const bar = pct >= 70 ? '🟢' : pct >= 50 ? '🟡' : '🔴';
        msg += `${bar} ${prop}: ${hits}/${total} (${pct}%)\n`;
      }
    }
  }

  return msg;
}

// BUG 10 FIX: confidence_score is already 0-100, don't multiply by 100
function formatBenchPicksDigest(data: Record<string, any>, dateStr: string): string {
  const benchPicks = data.benchPicks || [];
  const totalPool  = data.totalPool  || 0;
  const usedCount  = data.usedCount  || 0;
  const benchCount = data.benchCount || 0;

  let msg = `📋 *BENCH PICKS — ${dateStr}*\n━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `Pool: ${totalPool} | ✅ ${usedCount} used | 🪑 ${benchCount} bench\n\n`;

  if (benchPicks.length === 0) {
    msg += `No bench picks available today.\n`;
  } else {
    msg += `*Top ${benchPicks.length} Unused:*\n\n`;
    for (let i = 0; i < benchPicks.length; i++) {
      const pick = benchPicks[i];
      const propLabel = PROP_LABELS[(pick.prop_type || '').toLowerCase()] || pick.prop_type || '?';
      const side = (pick.recommended_side || 'over').toUpperCase().charAt(0);
      const line = pick.recommended_line != null ? pick.recommended_line : '?';
      // BUG 10 FIX: confidence_score is 0-100 scale, no * 100
      const conf = pick.confidence_score ? `${Math.round(pick.confidence_score)}%` : '?';
      const l10  = pick.l10_avg ? `L10: ${pick.l10_avg}` : '';
      const reason = pick.rejection_reason ? ` _(${pick.rejection_reason})_` : '';

      msg += `${i + 1}. *${pick.player_name}* ${propLabel} ${side}${line}\n`;
      msg += `   🎯 ${conf} conf | ${l10}${reason}\n`;
    }
  }

  msg += `\n_Passed quality gates but not selected for parlays._`;
  return msg;
}

// BUG 12 FIX: sport-aware emoji instead of hardcoded 🏀
function formatHighConvictionReport(data: Record<string, any>, dateStr: string): string {
  const { plays, stats } = data;
  const total    = stats?.total    || 0;
  const allAgree = stats?.allAgree || 0;

  let msg = `🎯 *HIGH CONVICTION PLAYS — ${dateStr}*\n━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `🔥 ${total} cross-engine overlaps | ✅ ${allAgree} full agreement\n`;

  if (stats?.engineCounts) {
    const engines = Object.entries(stats.engineCounts).map(([e, c]) => `${e}: ${c}`).join(' | ');
    msg += `⚙️ ${engines}\n`;
  }

  if (!plays?.length) {
    msg += `\nNo cross-engine overlaps today.`;
    return msg;
  }

  msg += `\n🏆 *Top Plays:*\n\n`;

  for (let i = 0; i < Math.min(plays.length, 15); i++) {
    const p = plays[i];
    const side = (p.signal || 'OVER').charAt(0);
    const propLabel = formatPropLabel(p.displayPropType || p.prop_type);
    const edgeSign  = p.edge_pct > 0 ? '+' : '';
    const tierEmoji = p.confidence_tier === 'ELITE' ? '🏆' : p.confidence_tier === 'HIGH' ? '🔥' : '📊';
    // BUG 12 FIX: sport-aware emoji
    const sportEmoji = getSportEmoji(p);

    msg += `${i + 1}. ${sportEmoji} *${p.player_name}* — ${propLabel} ${side} ${p.current_line}\n`;
    msg += `   📈 Edge: ${edgeSign}${Math.round(p.edge_pct)}% (${p.confidence_tier}) ${tierEmoji}\n`;

    const engineNames = (p.engines || []).map((e: any) => e.engine).join(' + ');
    if (p.sideAgreement) {
      msg += `   ✅ ${engineNames} agree ${p.signal}\n`;
    } else {
      msg += `   ⚠️ ${engineNames} (mixed sides)\n`;
    }

    const agreeRatio = p.agreement_ratio != null ? ` | ${p.agreement_ratio}% agree` : '';
    msg += `   🎯 Score: ${(p.convictionScore || 0).toFixed(1)}${agreeRatio}\n\n`;
  }

  if (plays.length > 15) msg += `... +${plays.length - 15} more plays\n`;
  return msg;
}

// BUG 13 FIX: proper bold header + dateStr
function formatDoubleConfirmedReport(data: Record<string, any>, dateStr: string): string {
  const { picks, totalSweetSpots, totalMispriced, date } = data;
  const displayDate = date || dateStr;
  const count = picks?.length || 0;

  // BUG 13 FIX: proper Markdown header with date
  let msg = `✅ *DOUBLE-CONFIRMED PICKS — ${displayDate}*\n━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `*${count} picks* confirmed by both sweet spots AND mispriced lines\n\n`;

  if (!picks?.length) {
    msg += `No double-confirmed picks today.`;
    return msg;
  }

  const propLabels: Record<string, string> = {
    player_points: 'Points', player_rebounds: 'Rebounds', player_assists: 'Assists',
    player_threes: '3-Pointers', player_blocks: 'Blocks', player_steals: 'Steals',
    player_turnovers: 'Turnovers', player_points_rebounds_assists: 'PRA',
    player_points_rebounds: 'Pts+Rebs', player_points_assists: 'Pts+Asts',
    player_rebounds_assists: 'Reb+Ast',
    batter_hits: 'Hits', batter_rbis: 'RBI', batter_runs_scored: 'Runs',
    batter_total_bases: 'Total Bases', batter_home_runs: 'HR', batter_stolen_bases: 'SB',
    pitcher_strikeouts: 'Strikeouts', pitcher_outs: 'Outs',
    player_fantasy_score: 'Fantasy',
  };

  for (const p of picks) {
    const propLabel = propLabels[p.prop_type] || p.prop_type.replace(/^(player_|batter_|pitcher_)/, '').replace(/_/g, ' ');
    const side      = (p.side || 'OVER').toUpperCase();
    const hitRate   = Math.round(p.l10_hit_rate || 0);
    const edgeSign  = p.edge_pct > 0 ? '+' : '';
    const edge      = Math.round(p.edge_pct || 0);
    const emoji     = getSportEmoji(p);
    msg += `${emoji} *${p.player_name}* — ${propLabel} ${side} | ${hitRate}% L10 | ${edgeSign}${edge}% edge\n`;
  }

  // Sport breakdown footer
  const sportCounts: Record<string, number> = {};
  for (const p of picks) {
    const sport = p.sport === 'basketball_nba' ? 'NBA'
      : p.sport === 'icehockey_nhl' ? 'NHL'
      : p.sport === 'baseball_mlb' ? 'MLB'
      : p.sport || '?';
    sportCounts[sport] = (sportCounts[sport] || 0) + 1;
  }
  const sportStr = Object.entries(sportCounts).map(([s, c]) => `${s}: ${c}`).join(' | ');
  msg += `\n📊 ${sportStr} | Sweet spots: ${totalSweetSpots || 0} | Mispriced: ${totalMispriced || 0}`;
  return msg;
}

// New formatter for calibration_complete (referenced from calibrate-bot-weights)
function formatCalibrationComplete(data: Record<string, any>, dateStr: string): string {
  const { totalCategories, updated, created, blocked, rehabilitated, topPerformers, worstPerformers } = data;

  let msg = `⚖️ *CALIBRATION COMPLETE — ${dateStr}*\n━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `📊 *${totalCategories}* categories calibrated\n`;
  msg += `✅ ${updated} updated | ➕ ${created} created | 🚫 ${blocked} blocked`;
  if (rehabilitated > 0) msg += ` | ♻️ ${rehabilitated} rehabilitated`;
  msg += '\n';

  if (topPerformers?.length > 0) {
    msg += `\n🏆 *Top Performers:*\n`;
    for (const p of topPerformers.slice(0, 5)) {
      msg += `• ${p.category} ${p.side}: ${p.hitRate}% (n=${p.samples}, w=${parseFloat(p.weight).toFixed(2)})\n`;
    }
  }
  if (worstPerformers?.length > 0) {
    msg += `\n⚠️ *Worst Performers:*\n`;
    for (const p of worstPerformers.slice(0, 3)) {
      const blockedTag = p.blocked ? ' 🚫' : '';
      msg += `• ${p.category} ${p.side}: ${p.hitRate}% (n=${p.samples})${blockedTag}\n`;
    }
  }
  return msg;
}

// ─── All remaining formatters (unchanged from original, cleaned up formatting) ─

function formatParlaysGenerated(data: Record<string, any>, dateStr: string): string {
  const { count, distribution, topPick, realLinePercentage, oddsRange, validPicks } = data;
  let msg = `📊 *PARLAYS GENERATED — ${dateStr}*\n━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `Generated *${count} parlays*\n\n`;
  if (distribution) {
    if (distribution['3']) msg += `• 3-Leg: ${distribution['3']}\n`;
    if (distribution['4']) msg += `• 4-Leg: ${distribution['4']}\n`;
    if (distribution['5']) msg += `• 5-Leg: ${distribution['5']}\n`;
    if (distribution['6']) msg += `• 6-Leg: ${distribution['6']}\n`;
    msg += '\n';
  }
  if (topPick) {
    msg += `🎯 *Top Pick:* ${topPick.player_name}\n`;
    msg += `${topPick.prop_type} ${topPick.side?.toUpperCase() || 'OVER'} ${topPick.line} @ ${formatOdds(topPick.american_odds)}\n\n`;
  }
  if (realLinePercentage !== undefined) {
    msg += `📍 *${realLinePercentage}% REAL lines*`;
    if (validPicks) msg += ` (${validPicks} picks)`;
    msg += '\n';
  }
  if (oddsRange) msg += `📈 Odds: ${oddsRange.min} → ${oddsRange.max}\n`;
  return msg;
}

async function formatTieredParlaysGenerated(data: Record<string, any>, dateStr: string): Promise<string> {
  const { totalCount, exploration, validation, execution, poolSize, topPicks } = data;
  let displayCount      = totalCount   || 0;
  let displayExploration = exploration || 0;
  let displayValidation  = validation  || 0;
  let displayExecution   = execution   || 0;
  let countLabel = 'Generated';

  if (displayCount === 0 || (displayExploration === 0 && displayValidation === 0 && displayExecution === 0)) {
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const sb = createClient(supabaseUrl, supabaseKey);
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
      const { data: todayParlays } = await sb
        .from('bot_daily_parlays').select('strategy_name')
        .eq('parlay_date', today).eq('outcome', 'pending');
      if (todayParlays?.length > 0) {
        displayCount = todayParlays.length;
        countLabel = 'Active';
        displayExploration = displayValidation = displayExecution = 0;
        for (const p of todayParlays) {
          const name = (p.strategy_name || '').toLowerCase();
          if (name.includes('validation') || name.includes('validated')) displayValidation++;
          else if (name.includes('execution') || name.includes('elite') || name.startsWith('force_')) displayExecution++;
          else displayExploration++;
        }
      }
    } catch (e) { console.error('[Telegram] Parlay lookup failed:', e); }
  }

  let msg = `📊 *TIERED PARLAYS — ${dateStr}*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `✅ *${displayCount} parlays ${countLabel.toLowerCase()}*\n\n`;
  msg += `🔬 Exploration: ${displayExploration}\n`;
  msg += `✅ Validation: ${displayValidation}\n`;
  msg += `🎯 Execution: ${displayExecution}\n\n`;
  if (poolSize) msg += `📍 Pool: ${poolSize} picks\n\n`;

  if (topPicks?.length > 0) {
    msg += `🔥 *Top Picks:*\n`;
    for (const pick of topPicks.slice(0, 5)) {
      const oddsStr = pick.american_odds ? ` (${formatOdds(pick.american_odds)})` : '';
      const isTeam = pick.type === 'team' || (pick.player_name?.includes(' @ ') && !pick.type);
      if (isTeam) {
        const betType = (pick.bet_type || pick.prop_type || '').toLowerCase();
        const away = pick.away_team || pick.player_name?.split(' @ ')[0] || '';
        const home = pick.home_team || pick.player_name?.split(' @ ')[1] || '';
        if (betType.includes('total')) msg += `📈 ${(pick.side || 'over').toUpperCase()} ${pick.line}${oddsStr}\n`;
        else if (betType.includes('spread')) msg += `📊 ${pick.side === 'home' ? home : away} ${pick.line > 0 ? '+' : ''}${pick.line}${oddsStr}\n`;
        else msg += `💎 ${pick.side === 'home' ? home : away} ML${oddsStr}\n`;
      } else {
        const side  = (pick.side || 'over').toUpperCase();
        const prop  = PROP_LABELS[pick.prop_type] || (pick.prop_type || '').toUpperCase();
        const emoji = getSportEmoji(pick);
        msg += `${emoji} *${pick.player_name}* ${side} ${pick.line} ${prop}${oddsStr}\n`;
        if (pick.composite_score || pick.hit_rate) {
          msg += `   🎯 ${Math.round(pick.composite_score || 0)} | 💎 ${Math.round(pick.hit_rate || 0)}%\n`;
        }
      }
    }
  }

  return msg;
}

function formatActivation(data: Record<string, any>): string {
  const { winRate, bankroll, consecutiveDays } = data;
  let msg = `🚀 *REAL MODE UNLOCKED!*\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `✅ ${consecutiveDays || 3} consecutive profitable days\n`;
  msg += `✅ ${winRate || 60}%+ win rate\n`;
  msg += `✅ Bankroll: $1,000 → $${bankroll?.toFixed(0) || 'N/A'}\n\n`;
  msg += `Bot will now generate parlays with Kelly-sized stakes.\nConfigure your bankroll in settings.`;
  return msg;
}

function formatDailySummary(data: Record<string, any>, dateStr: string): string {
  const { parlaysCount, winRate, edge, bankroll, mode } = data;
  let msg = `📈 *DAILY SUMMARY — ${dateStr}*\n━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `Parlays: ${parlaysCount || 0} | Win Rate: ${winRate || 0}%\n`;
  msg += `Edge: ${edge || 0}% | Bankroll: $${bankroll?.toFixed(0) || 1000}\n`;
  msg += `Mode: ${mode || 'Simulation'}`;
  return msg;
}

function formatWeightChange(data: Record<string, any>): string {
  const { category, oldWeight, newWeight, reason } = data;
  const arrow = newWeight > oldWeight ? '📈' : '📉';
  let msg = `${arrow} *Weight Update*\n\n`;
  msg += `*${category}:* ${oldWeight?.toFixed(2)} → ${newWeight?.toFixed(2)}\n`;
  if (reason) msg += `Reason: ${reason}`;
  return msg;
}

function formatStrategyUpdate(data: Record<string, any>): string {
  const { strategyName, action, reason, winRate } = data;
  let msg = `⚠️ *Strategy Update*\n\n`;
  msg += `*${strategyName}* — ${action}\n`;
  if (winRate !== undefined) msg += `Win Rate: ${(winRate * 100).toFixed(1)}%\n`;
  if (reason) msg += `Reason: ${reason}`;
  return msg;
}

function formatDiagnosticReport(data: Record<string, any>, dateStr: string): { text: string; reply_markup?: object } {
  const { checks, improvementMetrics, passed, warned, failed, overall } = data;
  let msg = `🔧 *DAILY DIAGNOSTIC — ${dateStr}*\n━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  if (Array.isArray(checks)) {
    for (const c of checks) {
      const icon = c.status === 'pass' ? '✅' : c.status === 'warn' ? '⚠️' : '❌';
      const detail = c.detail && c.status !== 'pass' ? ` — ${c.detail}` : '';
      msg += `${icon} ${c.name}${detail}\n`;
    }
  }

  if (improvementMetrics) {
    msg += '\n*Trends:*\n';
    if (improvementMetrics.win_rate?.current != null) {
      const wr = improvementMetrics.win_rate;
      const delta = wr.delta != null ? ` (${wr.delta >= 0 ? '+' : ''}${wr.delta}%)` : '';
      msg += `Win Rate: ${wr.prior ?? '?'}% → ${wr.current}%${delta}\n`;
    }
    if (improvementMetrics.bankroll?.current != null) {
      const br = improvementMetrics.bankroll;
      const delta = br.delta != null ? ` (${br.delta >= 0 ? '+' : ''}$${br.delta})` : '';
      msg += `Bankroll: $${br.prior ?? '?'} → $${Math.round(br.current)}${delta}\n`;
    }
  }

  msg += `\n*Overall:* ${passed || 0}/7 PASS, ${warned || 0} WARN, ${failed || 0} FAIL`;
  if (overall === 'critical') msg += ` 🚨`;

  const fixMap: Record<string, { label: string; action: string }> = {
    'Data Freshness':      { label: '🔄 Refresh Props',     action: 'fix:refresh_props' },
    'Weight Calibration':  { label: '⚖️ Calibrate',         action: 'fix:calibrate' },
    'Parlay Generation':   { label: '📊 Generate Parlays',  action: 'fix:generate' },
    'Settlement Pipeline': { label: '💰 Settle Parlays',    action: 'fix:settle' },
    'Cron Jobs':           { label: '⚙️ Run All Jobs',      action: 'fix:run_crons' },
  };

  const buttons: Array<{ text: string; callback_data: string }[]> = [];
  if (Array.isArray(checks)) {
    for (const c of checks) {
      if ((c.status === 'fail' || c.status === 'warn') && fixMap[c.name]) {
        buttons.push([{ text: fixMap[c.name].label, callback_data: fixMap[c.name].action }]);
      }
    }
  }

  return { text: msg, reply_markup: buttons.length > 0 ? { inline_keyboard: buttons } : undefined };
}

function formatIntegrityAlert(data: Record<string, any>, dateStr: string): { text: string; reply_markup?: object } {
  const { oneLegCount, twoLegCount, duplicateLegCount, total, strategyCounts, topDuplicates } = data;
  let msg = `⚠️ *INTEGRITY ALERT — ${dateStr}*\n━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  if (oneLegCount > 0)       msg += `• 1-leg singles: *${oneLegCount}*\n`;
  if (twoLegCount > 0)       msg += `• 2-leg minis: *${twoLegCount}*\n`;
  if (duplicateLegCount > 0) msg += `• Duplicate legs: *${duplicateLegCount}*\n`;
  msg += `Total violations: *${total}*\n\n`;
  if (strategyCounts && Object.keys(strategyCounts).length > 0) {
    msg += `*Strategies involved:*\n`;
    for (const [name, count] of Object.entries(strategyCounts)) msg += `• ${name} (×${count})\n`;
    msg += '\n';
  }
  if (topDuplicates?.length > 0) {
    msg += `*Top duplicates:*\n`;
    for (const d of topDuplicates.slice(0, 3)) msg += `• ${d}\n`;
    msg += '\n';
  }
  msg += `⚡ *Action required* — tap below to fix`;
  return {
    text: msg,
    reply_markup: { inline_keyboard: [[
      { text: '🗑 Void Bad Parlays', callback_data: 'integrity_void_bad' },
      { text: '📋 View Admin', callback_data: 'admin_status' },
    ]] },
  };
}

function formatPreflightAlert(data: Record<string, any>, dateStr: string): string {
  const { blockers, checks } = data;
  let msg = `⚠️ *PREFLIGHT FAILED — ${dateStr}*\n━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `*${(blockers || []).length} blocker(s):*\n`;
  for (const b of (blockers || [])) msg += `🚫 ${b}\n`;
  if (checks) {
    const passed = checks.filter((c: any) => c.passed).length;
    msg += `\nChecks: ${passed}/${checks.length} passed`;
  }
  msg += `\n\nAction required before next generation.`;
  return msg;
}

function formatDailyWinnersReport(data: Record<string, any>, dateStr: string): string {
  const { winners, totalHits, totalPicks, hitRate, propBreakdown, date } = data;
  const displayDate = date || dateStr;
  let msg = `🏆 *DAILY WINNERS — ${displayDate}*\n━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `✅ ${totalHits}/${totalPicks} Picks Hit (${hitRate}%)\n\n`;

  if (winners?.length > 0) {
    msg += `*Top Hits:*\n`;
    for (const w of winners.slice(0, 15)) {
      const prop = PROP_LABELS[(w.propType || '').toLowerCase()] || w.propType;
      const side = (w.side || 'over').charAt(0).toUpperCase();
      msg += `✅ *${w.playerName}* ${side}${w.line} ${prop} — actual: ${w.actualValue}\n`;
    }
    if (winners.length > 15) msg += `... +${winners.length - 15} more\n`;
  }

  if (propBreakdown && Object.keys(propBreakdown).length > 0) {
    const sorted = Object.entries(propBreakdown).sort((a: any, b: any) => b[1].rate - a[1].rate);
    msg += `\n*Prop Breakdown:*\n`;
    for (const [prop, stats] of sorted) {
      const s = stats as any;
      const bar = s.rate >= 70 ? '🟢' : s.rate >= 50 ? '🟡' : '🔴';
      msg += `${bar} ${PROP_LABELS[prop.toLowerCase()] || prop}: ${s.hits}/${s.total} (${s.rate}%)\n`;
    }
  }
  return msg;
}

function formatMispricedLinesReport(data: Record<string, any>, dateStr: string): string {
  const { nbaCount, mlbCount, overCount, underCount, totalCount, topByTier } = data;
  let msg = `🔍 *MISPRICED LINES — ${dateStr}*\n━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `🏀 NBA: ${nbaCount || 0} | ⚾ MLB: ${mlbCount || 0}\n`;
  msg += `📈 ${overCount || 0} OVER | 📉 ${underCount || 0} UNDER | Total: *${totalCount || 0}*\n`;

  for (const tier of [
    { key: 'ELITE',  label: '🏆 ELITE',  max: 10 },
    { key: 'HIGH',   label: '🔥 HIGH',   max: 15 },
    { key: 'MEDIUM', label: '📊 MEDIUM', max: 10 },
  ]) {
    const picks = topByTier?.[tier.key];
    if (!picks?.length) continue;
    msg += `\n*${tier.label}:*\n`;
    for (const p of picks.slice(0, tier.max)) {
      const icon     = p.signal === 'OVER' ? '📈' : '📉';
      const sport    = p.sport === 'baseball_mlb' ? '⚾' : '🏀';
      const edgeSign = p.edge_pct > 0 ? '+' : '';
      const avgLabel = p.sport === 'baseball_mlb' ? 'Szn' : 'L10';
      msg += `  ${icon}${sport} *${p.player_name}* — ${formatPropLabel(p.prop_type)} ${p.signal.charAt(0)} ${p.book_line} | ${avgLabel}: ${p.player_avg?.toFixed(1) ?? '?'} | ${edgeSign}${Math.round(p.edge_pct)}%\n`;
    }
    if (picks.length > tier.max) msg += `  ... +${picks.length - tier.max} more\n`;
  }
  return msg;
}

function formatFreshSlateReport(data: Record<string, any>, dateStr: string): string {
  const { parlays, totalParlays, voidedCount, totalPicks } = data;
  let msg = `🔥 *FRESH CONVICTION SLATE — ${dateStr}*\n━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  if (voidedCount > 0) msg += `🗑️ Cleared ${voidedCount} old parlays\n`;
  msg += `✅ ${totalParlays} high-conviction parlays | 📊 from ${totalPicks} ELITE/HIGH picks\n\n`;

  if (Array.isArray(parlays)) {
    for (const p of parlays) {
      const emoji = p.avgScore >= 80 ? '🔥' : p.avgScore >= 60 ? '✨' : '📊';
      msg += `${emoji} *Parlay ${p.index}* (Score: ${p.avgScore.toFixed(0)}/100)\n`;
      for (const leg of (p.legs || [])) {
        const side  = leg.signal === 'OVER' ? 'O' : 'U';
        const prop  = formatPropLabel(leg.prop_type);
        const edge  = leg.edge_pct > 0 ? `+${Math.round(leg.edge_pct)}%` : `${Math.round(leg.edge_pct)}%`;
        const tier  = leg.confidence_tier === 'ELITE' ? '🏆' : '🔥';
        const risk  = leg.risk_confirmed ? ' ✅' : '';
        msg += `  📈 *${leg.player_name}* ${prop} ${side} ${leg.book_line} | ${edge} ${tier}${risk}\n`;
      }
      msg += '\n';
    }
  }
  return msg;
}

function formatMegaParlayScanner(data: Record<string, any>, dateStr: string): string {
  const { date, scanned, events, qualified, legs, combinedOdds, payout25 } = data;
  const displayDate = date || dateStr;
  let msg = `🎰 *DAILY LOTTERY PARLAY — ${displayDate}*\n━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `⚠️ HIGH RISK / HIGH REWARD — bet only what you can afford to lose\n\n`;
  msg += `📊 ${scanned || '?'} props | ${events || '?'} games | ${qualified || '?'} qualified\n\n`;

  if (legs?.length > 0) {
    msg += `🎯 *${legs.length}-Leg Parlay | +${combinedOdds || '?'}*\n`;
    msg += `💵 $25 bet → $${payout25 || '?'}\n\n`;
    for (const leg of legs) {
      msg += `*Leg ${leg.leg}: ${leg.player}*\n`;
      msg += `  ${leg.side} ${leg.line} ${leg.prop} (${leg.odds}) [${leg.book}]\n`;
      msg += `  Hit: ${leg.hit_rate} | Edge: ${leg.edge} | L10 avg: ${leg.l10_avg ?? 'N/A'}\n\n`;
    }
  } else {
    msg += `⚠️ No qualifying legs found today.\n`;
  }
  msg += `🎲 Good luck! Play responsibly.`;
  return msg;
}

function formatMegaLotteryV2(data: Record<string, any>, dateStr: string): string {
  const { date, tickets, ticketCount, scanned, events, exoticProps, teamBets } = data;
  const displayDate = date || dateStr;
  const tierEmoji: Record<string, string> = { standard: '🎟️', high_roller: '🎲', mega_jackpot: '🎰' };
  const tierLabel: Record<string, string> = { standard: 'STANDARD', high_roller: 'HIGH ROLLER', mega_jackpot: 'MEGA JACKPOT' };

  let msg = `🎰 *LOTTERY TICKETS — ${displayDate}*\n━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `${ticketCount || 0} tickets | ${scanned || '?'} props | ${events || '?'} games\n`;
  msg += `⚠️ Lottery — high risk. Bet only what you can afford to lose.\n\n`;

  if (Array.isArray(tickets)) {
    for (const ticket of tickets) {
      const emoji = tierEmoji[ticket.tier] || '🎟️';
      const label = tierLabel[ticket.tier] || ticket.tier.toUpperCase();
      msg += `${emoji} *${label}* (+${ticket.combinedOdds?.toLocaleString()}) | $${ticket.stake} → $${ticket.payout}\n`;
      for (const leg of (ticket.legs || [])) {
        const defStr  = leg.defense_rank ? ` | Def #${leg.defense_rank}` : '';
        const hrStr   = leg.hit_rate ? ` | ${leg.hit_rate}% HR` : '';
        const typeTag = leg.market_type === 'exotic_player' ? ' 🌟' : leg.market_type === 'team_bet' ? ' 🏀' : '';
        msg += `  L${leg.leg}: *${leg.player}* ${leg.side} ${leg.line || ''} ${(leg.prop || '').replace(/_/g, ' ').toUpperCase()} (${leg.odds})${typeTag}${defStr}${hrStr}\n`;
      }
      msg += '\n';
    }
  } else {
    msg += `⚠️ No qualifying tickets today.\n`;
  }
  msg += `🎲 Good luck! Play responsibly.`;
  return msg;
}

function formatDailyWinnersRecap(data: Record<string, any>, dateStr: string): string {
  const { date, rating, winnerCount, totalProfit, totalStaked, winners, lotteryWinners, tierContext, keyPlayers } = data;
  const displayDate = date || dateStr;
  let msg = `🏆 *YESTERDAY'S WINS — ${displayDate}*\n━━━━━━━━━━━━━━━━━━━━\n\n`;

  if (lotteryWinners?.length > 0) {
    msg += `🎰 *LOTTERY HITS!*\n━━━━━━━━━━━━━━━━━━━━\n`;
    for (const lw of lotteryWinners) {
      const profit = lw.payout - lw.stake;
      msg += `🎟️ *${(lw.tier || 'STANDARD').toUpperCase()}* (${lw.odds}) — $${lw.stake.toLocaleString()} → $${lw.payout.toLocaleString()} (+$${profit.toLocaleString()})\n`;
      for (const leg of (lw.legs || [])) {
        const actual = leg.actual != null ? ` (actual: ${leg.actual})` : '';
        msg += `  ✅ ${leg.player} ${leg.prop} ${leg.side}${leg.line}${actual}\n`;
      }
      msg += '\n';
    }
  }

  msg += `${rating || 'Solid Day'} — *${winnerCount || 0} winner${winnerCount !== 1 ? 's' : ''}*\n\n`;

  if (Array.isArray(winners)) {
    for (const w of winners.filter((w: any) => !w.isLottery)) {
      msg += `#${w.rank} | ${w.tier} | ${w.odds} | $${w.stake?.toLocaleString()} → +$${w.profit?.toLocaleString()}\n`;
      for (const leg of (w.legs || [])) {
        const actual = leg.actual != null ? ` (actual: ${leg.actual})` : '';
        msg += `  ✅ ${leg.player} ${leg.prop} ${leg.side}${leg.line}${actual}\n`;
      }
      msg += '\n';
    }
  }

  const roi = totalStaked > 0 ? Math.round((totalProfit / totalStaked) * 100) : 0;
  msg += `💰 $${(totalStaked || 0).toLocaleString()} → +$${(totalProfit || 0).toLocaleString()} (${roi}% ROI)\n\n`;
  if (keyPlayers?.length > 0) msg += `🔑 Key Players: ${keyPlayers.join(', ')}\n\n`;
  if (tierContext && Object.keys(tierContext).length > 0) {
    msg += `📈 Tier Trends:\n`;
    for (const [tier, context] of Object.entries(tierContext)) {
      msg += `  ${tier.replace(/_/g, ' ')}: ${context}\n`;
    }
  }
  msg += `\n📊 Powered by ParlayIQ`;
  return msg;
}

function formatSlateRebuildAlert(dateStr: string): string {
  let msg = `🔄 *SLATE UPDATE — ${dateStr}*\n━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `Regenerating today's parlays with upgraded defensive intelligence.\n\n`;
  msg += `*What's new:*\n`;
  msg += `• Per-stat defense matchup analysis\n`;
  msg += `• Weak opponent targeting\n`;
  msg += `• Tighter exposure controls\n\n`;
  msg += `New picks coming shortly. Stay tuned! 🎯`;
  return msg;
}

function formatSlateStatusUpdate(data: Record<string, any>, dateStr: string): string {
  const { activeParlays, totalStake } = data;
  const active = activeParlays || [];
  let msg = `📋 *SLATE STATUS — ${dateStr}*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `✅ *${active.length} ACTIVE* | Risk: ${totalStake ? `$${totalStake}` : 'N/A'}\n\n`;
  for (let i = 0; i < active.length; i++) {
    const p = active[i];
    const strategy = (p.strategy_name || 'unknown').replace(/_/g, ' ');
    msg += `*Parlay #${i + 1}* (${strategy}) — ${(p.legs || []).length} legs\n`;
    for (const leg of (p.legs || [])) {
      const side    = (leg.side || 'over').toUpperCase();
      const prop    = PROP_LABELS[(leg.prop_type || '').toLowerCase()] || (leg.prop_type || '').toUpperCase();
      const hitRate = leg.hit_rate_l10 ? ` (${Math.round(leg.hit_rate_l10)}% L10)` : '';
      const recency = getRecencyWarning(leg);
      msg += `  ${leg.player_name || 'Player'} ${side} ${leg.line} ${prop}${hitRate}${recency}\n`;
    }
    msg += '\n';
  }
  return msg;
}

function formatLongshotAnnouncement(data: Record<string, any>, dateStr: string): string {
  const legs = data.legs || [];
  const expectedOdds = data.expected_odds || 4700;
  const stakeAmount  = data.stake || 20;
  const payout = Math.round((expectedOdds / 100) * stakeAmount + stakeAmount);
  let msg = `🚀 *LONGSHOT PARLAY — ${dateStr}*\n━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `⚠️ HIGH RISK / HIGH REWARD\n\n`;
  msg += `🎯 *${legs.length}-LEG EXPLORER | ~+${expectedOdds}*\n\n`;
  for (let i = 0; i < legs.length; i++) {
    const leg  = legs[i];
    const prop = PROP_LABELS[(leg.prop_type || '').toLowerCase()] || (leg.prop_type || '').toUpperCase();
    const side = (leg.side || 'over').toUpperCase();
    msg += `*Leg ${i + 1}: ${leg.player_name}*\n`;
    msg += `  ${side} ${leg.line} ${prop}\n`;
    if (leg.edge_note) msg += `  💎 ${leg.edge_note}\n`;
    msg += '\n';
  }
  msg += `💰 $${stakeAmount} → ~$${payout.toLocaleString()}\n🎲 Good luck!`;
  return msg;
}

function formatPipelineFailureAlert(data: Record<string, any>, dateStr: string): string {
  const { step, error, phase, critical } = data;
  let msg = `🚨 *PIPELINE FAILURE — ${dateStr}*\n━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  if (phase)    msg += `*Phase:* ${phase}\n`;
  if (step)     msg += `*Step:* ${step}\n`;
  if (error)    msg += `*Error:* ${error}\n`;
  if (critical) msg += `\n⚠️ *CRITICAL* — downstream output may be affected`;
  return msg;
}

function formatDoctorReport(data: Record<string, any>, dateStr: string): string {
  const { diagnoses, autoFixedCount, failureDayWinRate, cleanDayWinRate, estimatedImpact, triggerSource } = data;
  let msg = `🩺 *PIPELINE DOCTOR — ${dateStr}*\n━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `*${(diagnoses || []).length} problems* | *${autoFixedCount || 0} auto-fixed*\n\n`;

  for (let i = 0; i < (diagnoses || []).length; i++) {
    const d = diagnoses[i];
    const icon = d.severity === 'critical' ? '🔴' : d.severity === 'warning' ? '🟡' : '🔵';
    msg += `${icon} *${i + 1}. ${d.problem}*\n`;
    msg += `  Cause: ${d.rootCause}\n`;
    msg += `  Fix: ${d.suggestedFix}\n\n`;
  }

  if (failureDayWinRate != null && cleanDayWinRate != null) {
    msg += `📊 Failure days: ${failureDayWinRate}% | Clean days: ${cleanDayWinRate}%\n`;
  }
  if (estimatedImpact != null) {
    const sign = estimatedImpact >= 0 ? '+' : '';
    msg += `💰 Est. daily impact: ${sign}$${estimatedImpact}\n`;
  }
  msg += `\n🔄 Trigger: ${triggerSource || 'unknown'}`;
  return msg;
}

function formatQualityRegenReport(data: Record<string, any>, dateStr: string): string {
  const { attempts, bestAttempt, bestHitRate, targetHitRate, targetMet, hoursBeforeDeadline, totalParlaysKept } = data;
  let msg = `🔄 *QUALITY REGEN — ${dateStr}*\n━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `Target: ${targetHitRate}% | Result: ${targetMet ? '✅ MET' : '⚠️ BEST EFFORT'}\n\n`;
  for (const att of (attempts || [])) {
    const icon  = att.meetsTarget ? '✅' : att.parlayCount === 0 ? '⏭️' : '❌';
    const boost = att.regenBoost === 0 ? 'Standard' : att.regenBoost === 1 ? 'Tight +5' : 'Elite +10';
    msg += `${icon} #${att.attempt} [${boost}]: ${att.avgProjectedHitRate}% avg | ${att.parlayCount} parlays\n`;
  }
  msg += `\n🏆 Kept attempt #${bestAttempt} (${bestHitRate}%) | ${totalParlaysKept} parlays active`;
  msg += `\n⏰ ${hoursBeforeDeadline}h before deadline`;
  return msg;
}

function formatHitRateEvaluation(data: Record<string, any>, dateStr: string): string {
  const { actualHitRate, targetHitRate, parlaysWon, parlaysSettled, thresholdMaintained } = data;
  let msg = `📈 *HIT RATE EVALUATION — ${dateStr}*\n━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `*Actual:* ${actualHitRate}% (${parlaysWon}/${parlaysSettled})\n`;
  msg += `*Target:* ${targetHitRate}%\n\n`;
  if (thresholdMaintained) {
    msg += `✅ *Threshold maintained* — weights unchanged for tomorrow.`;
  } else {
    msg += `⚠️ *Below target* — gap of ${(targetHitRate - actualHitRate).toFixed(1)}%\n`;
    msg += `🔧 Triggering weight recalibration.`;
  }
  return msg;
}

function formatLadderChallengeResult(data: Record<string, any>): string {
  const { outcome, playerName, propLabel, line, side, actualValue, stake, profitLoss, odds, dayNumber, wins, losses, runningPnl, winRate } = data;
  const won = outcome === 'won';
  const icon = won ? '🟢' : '🔴';
  const pnlSign = profitLoss >= 0 ? '+' : '';
  const runSign = runningPnl >= 0 ? '+' : '';
  const actual = actualValue != null ? `\nActual: ${actualValue} ${won ? '✅' : '❌'}` : '';
  let msg = `🔒 *LADDER — Day ${dayNumber} of 7*\n━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `${icon} *${won ? 'WON' : 'LOST'}* — *${playerName}* ${propLabel} ${(side || 'OVER').toUpperCase().charAt(0)}${line} (${formatOdds(odds)})${actual}\n\n`;
  msg += `💰 $${stake} stake | ${won ? 'Profit' : 'Loss'}: ${pnlSign}$${Math.abs(profitLoss).toFixed(0)}\n`;
  msg += `📊 ${wins}W-${losses}L | P&L: ${runSign}$${Math.abs(runningPnl).toFixed(0)} | ${winRate}% WR\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━`;
  return msg;
}

function formatCompositeConflictReport(data: Record<string, any>, dateStr: string): string {
  const conflicts = data.conflicts || [];
  if (conflicts.length === 0) return '';
  const parlayCount = new Set(conflicts.map((c: any) => c.parlay_id)).size;
  let msg = `⚠️ *COMPOSITE CONFLICT — ${dateStr}*\n━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `*${conflicts.length} legs flagged* across ${parlayCount} parlays\n\n`;
  for (let i = 0; i < conflicts.length; i++) {
    const c = conflicts[i];
    const dir = c.side === 'OVER' ? '<' : '>';
    const h2h = c.h2h_avg != null ? `H2H: ${c.h2h_avg} (${c.h2h_games}g)` : 'H2H: N/A';
    msg += `${i + 1}. *${c.player_name}* ${c.prop_type} ${c.side} ${c.line}\n`;
    msg += `   L10: ${c.l10_avg} | L5: ${c.l5_avg} | L3: ${c.l3_avg} | ${h2h}\n`;
    msg += `   Composite ${c.composite} ${dir} line ${c.line} ❌ | vs ${c.opponent}\n\n`;
  }
  return msg.trim();
}

function formatLegSwapReport(data: Record<string, any>, dateStr: string): string {
  const { swaps, drops, voids, totalParlaysChecked } = data;
  let msg = `🔄 *PRE-GAME VERIFICATION — ${dateStr}*\n━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `Checked ${totalParlaysChecked || 0} parlays\n\n`;
  if (swaps?.length > 0) {
    msg += `✅ *SWAPS (${swaps.length}):*\n`;
    for (const s of swaps) {
      msg += `🔁 *${s.originalLeg?.player}* → *${s.newLeg?.player}*\n`;
      msg += `   ${PROP_LABELS[s.originalLeg?.prop] || s.originalLeg?.prop} → ${PROP_LABELS[s.newLeg?.prop] || s.newLeg?.prop}\n`;
      msg += `   ${s.reason}\n`;
      if (s.newLeg?.confidence) msg += `   New conf: ${Math.round(s.newLeg.confidence)}%\n`;
    }
    msg += '\n';
  }
  if (drops?.length > 0) {
    msg += `🗑 *DROPPED (${drops.length}):*\n`;
    for (const d of drops) msg += `• ${d.player_name || 'leg'} — ${d.reason || 'no replacement'}\n`;
    msg += '\n';
  }
  if (voids?.length > 0) {
    msg += `⬜ *VOIDED (${voids.length}):*\n`;
    for (const v of voids) msg += `• ${v}\n`;
  }
  return msg;
}

// Stubs for formatters referenced but not fully shown in source
function formatParlayApprovalRequest(data: Record<string, any>, dateStr: string): { text: string; reply_markup?: object } {
  return { text: `⏳ *Parlay Approval — ${dateStr}*\n\n${data.message || 'Parlay pending approval.'}` };
}
function formatExtraPlaysReport(data: Record<string, any>, dateStr: string): string {
  return `📊 *Extra Plays — ${dateStr}*\n\n${data.message || 'Extra plays generated.'}`;
}
function formatEngineAccuracyReport(data: Record<string, any>, dateStr: string): string {
  return `⚙️ *Engine Accuracy — ${dateStr}*\n\n${data.message || 'Accuracy report generated.'}`;
}
function formatLegSettledAlert(data: Record<string, any>, dateStr: string): string {
  const legs = data.legs || [];
  if (legs.length === 0) return '';
  let msg = `📊 *LEG RESULTS — ${dateStr}*\n`;
  for (const leg of legs) {
    const icon = leg.outcome === 'hit' ? '✅' : '❌';
    const prop = PROP_LABELS[(leg.prop_type || '').toLowerCase()] || leg.prop_type;
    const actual = leg.actual_value != null ? ` → ${leg.actual_value}` : '';
    msg += `${icon} *${leg.player_name}* ${(leg.side || 'OVER').toUpperCase().charAt(0)}${leg.line} ${prop}${actual}\n`;
  }
  return msg;
}
function formatParlaySettledAlert(data: Record<string, any>, dateStr: string): string {
  const { outcome, strategy, odds, profitLoss, legs } = data;
  const icon = outcome === 'won' ? '🟢' : '🔴';
  const sign = (profitLoss || 0) >= 0 ? '+' : '';
  let msg = `${icon} *PARLAY ${outcome?.toUpperCase() || 'SETTLED'}* (${(strategy || '').replace(/_/g, ' ')})\n`;
  msg += `Odds: ${formatOdds(odds)} | P/L: ${sign}$${Math.abs(profitLoss || 0).toFixed(0)}\n`;
  for (const leg of (legs || [])) {
    const icon2 = leg.outcome === 'hit' ? '✅' : leg.outcome === 'miss' ? '❌' : '⬜';
    const prop  = PROP_LABELS[(leg.prop_type || '').toLowerCase()] || leg.prop_type;
    const actual = leg.actual_value != null ? ` (${leg.actual_value})` : '';
    msg += `${icon2} ${leg.player_name} ${(leg.side || 'over').toUpperCase().charAt(0)}${leg.line} ${prop}${actual}\n`;
  }
  return msg;
}
function formatDDTDCandidates(data: Record<string, any>, dateStr: string): string {
  return `⭐ *DD/TD Candidates — ${dateStr}*\n\n${data.message || JSON.stringify(data).slice(0, 300)}`;
}
function formatNewStrategiesBroadcast(data: Record<string, any>, dateStr: string, bankroll?: number): string {
  return data.message || `📊 *New Strategies — ${dateStr}*\n\nStrategies updated.${bankroll ? `\n💰 Your bankroll: $${bankroll.toLocaleString()}` : ''}`;
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const reqBody = await req.json();
    const {
      type,
      data,
      message: directMessage,
      parse_mode: parseMode = 'Markdown',
      admin_only: adminOnly = false,
    } = reqBody;

    const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN')!;
    const adminChatId = Deno.env.get('TELEGRAM_CHAT_ID')!;

    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', timeZone: 'America/New_York',
    });

    // Direct message shortcut
    if (directMessage && !type) {
      const body: Record<string, any> = {
        chat_id: adminChatId,
        text: directMessage,
        parse_mode: parseMode,  // BUG 9 FIX: always include parse_mode
        disable_web_page_preview: true,
      };
      const resp = await fetch(`${TELEGRAM_API}${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await resp.json();
      return new Response(
        JSON.stringify({ success: resp.ok, messageId: result.result?.message_id }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!type) {
      return new Response(JSON.stringify({ error: 'Missing type' }), {
        status: 400, headers: corsHeaders,
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const sb = createClient(supabaseUrl, supabaseKey);

    // Load admin settings
    let chatId = adminChatId;
    let settings: Record<string, any> = {};
    try {
      const { data: settingsRow } = await sb
        .from('bot_settings').select('*').eq('user_id', 'admin').maybeSingle();
      if (settingsRow) {
        chatId = settingsRow.telegram_chat_id || adminChatId;
        settings = settingsRow;
      }
    } catch (_) {}

    // Notification preferences
    if (!adminOnly) {
      const notifyMap: Record<string, string> = {
        settlement_complete: 'notify_settlement',
        activation_ready: 'notify_activation_ready',
        weight_change: 'notify_weight_changes',
        strategy_update: 'notify_strategy_updates',
      };
      const settingKey = notifyMap[type];
      if (settingKey && settings[settingKey] === false) {
        return new Response(
          JSON.stringify({ success: true, skipped: true, reason: 'disabled' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // BUG 14 FIX: reliable ET hour
      const etHour = getETHour();
      const quietStart = settings.quiet_start_hour ?? 23;
      const quietEnd   = settings.quiet_end_hour   ?? 7;
      const inQuiet = quietStart > quietEnd
        ? (etHour >= quietStart || etHour < quietEnd)
        : (etHour >= quietStart && etHour < quietEnd);

      if (inQuiet) {
        return new Response(
          JSON.stringify({ success: true, skipped: true, reason: 'quiet_hours' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Format message
    const formatted = await formatMessage(type as NotificationType, data || {}, dateStr);
    let message: string;
    let replyMarkup: object | undefined;

    if (typeof formatted === 'object' && 'text' in formatted) {
      message = formatted.text;
      replyMarkup = formatted.reply_markup;
    } else {
      message = formatted as string;
    }

    // BUG 9 FIX: send with parse_mode included
    const sendToTelegram = async (text: string, markup?: object) => {
      const body: Record<string, any> = {
        chat_id: chatId,
        text,
        parse_mode: parseMode,           // BUG 9 FIX: was never included before
        disable_web_page_preview: true,
      };
      if (markup) body.reply_markup = markup;

      let resp = await fetch(`${TELEGRAM_API}${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      let result = await resp.json();

      // Split on too-long messages
      if (!resp.ok && result?.description?.includes('message is too long')) {
        const chunks: string[] = [];
        let current = '';
        for (const line of text.split('\n')) {
          if ((current + '\n' + line).length > 4000 && current.length > 0) {
            chunks.push(current); current = line;
          } else {
            current += (current ? '\n' : '') + line;
          }
        }
        if (current) chunks.push(current);

        for (let i = 0; i < chunks.length; i++) {
          const chunkBody: Record<string, any> = {
            chat_id: chatId, text: chunks[i],
            parse_mode: parseMode,
            disable_web_page_preview: true,
          };
          if (i === chunks.length - 1 && markup) chunkBody.reply_markup = markup;
          resp = await fetch(`${TELEGRAM_API}${botToken}/sendMessage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(chunkBody),
          });
          result = await resp.json();
        }
      }
      return { resp, result };
    };

    const { resp: telegramResp, result: telegramResult } = await sendToTelegram(message, replyMarkup);

    if (!telegramResp.ok) {
      console.error('[Telegram] API error:', telegramResult);
      return new Response(
        JSON.stringify({ success: false, error: telegramResult }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[Telegram] Sent ${type} to admin`);

    // Customer broadcast
    const BROADCAST_TYPES = new Set([
      'mega_parlay_scanner', 'mega_lottery_v2', 'daily_winners_recap',
      'slate_rebuild_alert', 'slate_status_update', 'longshot_announcement',
      'dd_td_candidates', 'double_confirmed_report', 'new_strategies_broadcast',
    ]);

    if (!adminOnly && BROADCAST_TYPES.has(type)) {
      try {
        const { data: customers } = await sb
          .from('bot_authorized_users').select('chat_id, username, bankroll').eq('is_active', true);

        const tierStakePercent: Record<string, number> = {
          mega_parlay_scanner: 0.05, double_confirmed_report: 0.05,
          mega_lottery_v2: 0.005, longshot_announcement: 0.005,
        };
        const stakePercent = tierStakePercent[type] || 0;

        for (const customer of (customers || [])) {
          if (customer.chat_id === chatId) continue;
          let customerMessage = message;
          if (type === 'new_strategies_broadcast' && customer.bankroll > 0) {
            customerMessage = formatNewStrategiesBroadcast(data || {}, dateStr, customer.bankroll);
          } else if (stakePercent > 0 && customer.bankroll > 0) {
            const stake = Math.round(customer.bankroll * stakePercent);
            customerMessage += `\n\n💰 *Your stake:* $${stake} (based on $${customer.bankroll.toLocaleString()} bankroll)`;
          }
          try {
            await fetch(`${TELEGRAM_API}${botToken}/sendMessage`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: customer.chat_id,
                text: customerMessage,
                parse_mode: parseMode,
                disable_web_page_preview: true,
              }),
            });
          } catch (e) {
            console.warn(`[Telegram] Failed to send to ${customer.chat_id}:`, e);
          }
        }
      } catch (e) {
        console.error('[Telegram] Customer broadcast failed:', e);
      }
    }

    return new Response(
      JSON.stringify({ success: true, messageId: telegramResult.result?.message_id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[Telegram] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
