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

// Shared prop labels for all formatters
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
  const sportKey = (leg.sport || leg.category || '').toLowerCase();
  if (sportKey.includes('nhl') || sportKey.includes('hockey')) return '🏒';
  if (sportKey.includes('mlb') || sportKey.includes('baseball') || sportKey.includes('pitcher') || sportKey.includes('hitter') || sportKey.includes('batter')) return '⚾';
  if (sportKey.includes('nfl') || sportKey.includes('ncaaf') || sportKey.includes('football')) return '🏈';
  return '🏀';
}

// v11.0: Recency decline warning helper
// Checks if a leg has l3_avg and l10_avg, returns 📉 warning if moderate decline (15-25%)
function getRecencyWarning(leg: any): string {
  const l3 = leg.l3_avg ?? leg.l3Avg;
  const l10 = leg.l10_avg ?? leg.l10Avg ?? leg.l10_average;
  const side = (leg.side || 'over').toLowerCase();
  if (l3 == null || l10 == null || l10 <= 0) return '';
  const ratio = l3 / l10;
  if (side === 'over' && ratio < 0.85 && ratio >= 0.75) {
    return ` 📉L3:${l3}`;
  }
  if (side === 'under' && ratio > 1.15 && ratio <= 1.25) {
    return ` 📈L3:${l3}`;
  }
  return '';
}

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
  | 'daily_winners'
  | 'mispriced_lines_report'
  | 'high_conviction_report'
  | 'fresh_slate_report'
  | 'double_confirmed_report'
  | 'mega_parlay_scanner'
  | 'mega_lottery_v2'
  | 'daily_winners_recap'
  | 'slate_rebuild_alert'
  | 'slate_status_update'
  | 'longshot_announcement'
  | 'pipeline_failure_alert'
  | 'doctor_report'
  | 'quality_regen_report'
  | 'hit_rate_evaluation'
  | 'ladder_challenge'
  | 'ladder_challenge_result'
  | 'parlay_approval_request'
  | 'extra_plays_report'
  | 'engine_accuracy_report'
  | 'leg_settled_alert'
  | 'parlay_settled_alert'
  | 'dd_td_candidates'
  | 'new_strategies_broadcast'
  | 'leg_swap_report'
  | 'hedge_pregame_scout'
  | 'hedge_live_update'
  | 'composite_conflict_report'
  | 'bench_picks_digest'
  | 'straight_bets'
  | 'hedge_accuracy'
  | 'pick_dna'
  | 'sweet_spots_broadcast'
  | 'custom'
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
    case 'daily_winners':
      return formatDailyWinnersReport(data, dateStr);
    case 'mispriced_lines_report':
      return formatMispricedLinesReport(data, dateStr);
    case 'high_conviction_report':
      return formatHighConvictionReport(data, dateStr);
    case 'fresh_slate_report':
      return formatFreshSlateReport(data, dateStr);
    case 'double_confirmed_report':
      return formatDoubleConfirmedReport(data, dateStr);
    case 'mega_parlay_scanner':
      return formatMegaParlayScanner(data, dateStr);
    case 'mega_lottery_v2':
      return formatMegaLotteryV2(data, dateStr);
    case 'daily_winners_recap':
      return formatDailyWinnersRecap(data, dateStr);
    case 'slate_rebuild_alert':
      return formatSlateRebuildAlert(dateStr);
    case 'slate_status_update':
      return formatSlateStatusUpdate(data, dateStr);
    case 'longshot_announcement':
      return formatLongshotAnnouncement(data, dateStr);
    case 'pipeline_failure_alert':
      return formatPipelineFailureAlert(data, dateStr);
    case 'doctor_report':
      return formatDoctorReport(data, dateStr);
    case 'quality_regen_report':
      return formatQualityRegenReport(data, dateStr);
    case 'hit_rate_evaluation':
      return formatHitRateEvaluation(data, dateStr);
    case 'ladder_challenge':
      return data.message || `🪜 Ladder Challenge pick generated`;
    case 'ladder_challenge_result':
      return formatLadderChallengeResult(data);
    case 'parlay_approval_request':
      return formatParlayApprovalRequest(data, dateStr);
    case 'extra_plays_report':
      return formatExtraPlaysReport(data, dateStr);
    case 'engine_accuracy_report':
      return formatEngineAccuracyReport(data, dateStr);
    case 'leg_settled_alert':
      return formatLegSettledAlert(data, dateStr);
    case 'parlay_settled_alert':
      return formatParlaySettledAlert(data, dateStr);
    case 'dd_td_candidates':
      return formatDDTDCandidates(data, dateStr);
    case 'new_strategies_broadcast':
      return formatNewStrategiesBroadcast(data, dateStr);
    case 'leg_swap_report':
      return formatLegSwapReport(data, dateStr);
    case 'hedge_pregame_scout':
      return data.message || '🏀 Pre-game scout update';
    case 'hedge_live_update':
      return data.message || '🎯 Hedge status update';
    case 'hedge_accuracy':
      return data.message || '📊 Hedge accuracy report';
    case 'composite_conflict_report':
      return formatCompositeConflictReport(data, dateStr);
    case 'bench_picks_digest':
      return formatBenchPicksDigest(data, dateStr);
    case 'straight_bets':
      return data.message || '📊 Straight bets generated';
    case 'pick_dna':
      return data.message || '🧬 Pick DNA report';
    case 'custom':
      // Extract clean message from adaptive intelligence and other custom senders
      return data.message || data.text || data.summary || '📌 Bot update received';
    case 'test':
      return `🤖 *ParlayIQ Bot Test*\n\nConnection successful! You'll receive notifications here.\n\n_Sent ${dateStr}_`;
    default:
      // Suppress raw JSON dumps — show a clean one-liner or skip
      console.log(`[Telegram] Unknown notification type: ${type}`, JSON.stringify(data).slice(0, 200));
      return `📌 Bot Update (${type})`;
  }
}

function formatCompositeConflictReport(data: Record<string, any>, dateStr: string): string {
  const conflicts = data.conflicts || [];
  if (conflicts.length === 0) return '';
  
  const parlayCount = new Set(conflicts.map((c: any) => c.parlay_id)).size;
  let msg = `⚠️ *COMPOSITE CONFLICT REPORT* — ${dateStr}\n\n`;
  msg += `📋 *${conflicts.length} legs flagged* across ${parlayCount} parlays\n\n`;

  for (let i = 0; i < conflicts.length; i++) {
    const c = conflicts[i];
    const num = i + 1;
    const direction = c.side === 'OVER' ? '<' : '>';
    const h2hStr = c.h2h_avg != null ? `H2H: ${c.h2h_avg} (${c.h2h_games}g)` : `H2H: N/A`;
    
    msg += `${num}️⃣ *${c.player_name}* ${c.prop_type} ${c.side} ${c.line}\n`;
    msg += `   L10: ${c.l10_avg} | L5: ${c.l5_avg} | L3: ${c.l3_avg} | ${h2hStr}\n`;
    msg += `   Composite: ${c.composite} ${direction} line ${c.line} ❌\n`;
    msg += `   Parlay: #${c.parlay_id} (${c.parlay_tier}) vs ${c.opponent}\n\n`;
  }

  return msg.trim();
}

function formatBenchPicksDigest(data: Record<string, any>, dateStr: string): string {
  const benchPicks = data.benchPicks || [];
  const totalPool = data.totalPool || 0;
  const usedCount = data.usedCount || 0;
  const benchCount = data.benchCount || 0;

  let msg = `📋 *BENCH PICKS DIGEST* — ${dateStr}\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `Pool: ${totalPool} total | ✅ ${usedCount} used | 🪑 ${benchCount} bench\n\n`;

  if (benchPicks.length === 0) {
    msg += `No bench picks available today.\n`;
  } else {
    msg += `*Top ${benchPicks.length} Unused Picks:*\n\n`;
    for (let i = 0; i < benchPicks.length; i++) {
      const pick = benchPicks[i];
      const propLabel = PROP_LABELS[(pick.prop_type || '').toLowerCase()] || pick.prop_type || '?';
      const side = (pick.recommended_side || 'over').toUpperCase().charAt(0);
      const line = pick.recommended_line != null ? pick.recommended_line : '?';
      const conf = pick.confidence_score ? `${(pick.confidence_score * 100).toFixed(0)}%` : '?';
      const l10 = pick.l10_avg ? `L10: ${pick.l10_avg}` : '';
      const reason = pick.rejection_reason ? ` (${pick.rejection_reason})` : '';

      msg += `${i + 1}. *${pick.player_name}* ${propLabel} ${side}${line}\n`;
      msg += `   🎯 Conf: ${conf} | ${l10}${reason}\n`;
    }
  }

  msg += `\n_These picks passed quality gates but weren't selected for parlays._`;
  return msg;
}


function formatLadderChallengeResult(data: Record<string, any>): string {
  const { outcome, playerName, propLabel, line, side, actualValue, stake, profitLoss, odds, dayNumber, wins, losses, runningPnl, winRate } = data;

  const won = outcome === 'won';
  const resultIcon = won ? '🟢' : '🔴';
  const resultText = won ? 'WON' : 'LOST';
  const sideStr = (side || 'OVER').toUpperCase().charAt(0);
  const actualStr = actualValue !== null && actualValue !== undefined ? `\nActual: ${actualValue} ${won ? '✅' : '❌'}` : '';
  const pnlSign = profitLoss >= 0 ? '+' : '';
  const runningPnlSign = runningPnl >= 0 ? '+' : '';
  const oddsStr = odds > 0 ? `+${odds}` : `${odds}`;

  let msg = `🔒 *LADDER LOCK RESULT — Day ${dayNumber} of 7*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `${resultIcon} *${resultText}* — ${playerName} ${propLabel} ${sideStr}${line} (${oddsStr})${actualStr}\n\n`;
  msg += `💰 Stake: $${stake} | ${won ? 'Profit' : 'Loss'}: ${pnlSign}$${Math.abs(profitLoss).toFixed(0)}\n\n`;
  msg += `📊 *7-Day Challenge:* ${wins}W-${losses}L\n`;
  msg += `💵 Running P&L: ${runningPnlSign}$${Math.abs(runningPnl).toFixed(0)}\n`;
  msg += `🎯 Win Rate: ${winRate}%\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━`;

  return msg;
}

function formatLegSwapReport(data: Record<string, any>, dateStr: string): string {
  const swaps = data.swaps || [];
  const drops = data.drops || [];
  const voids = data.voids || [];
  const totalChecked = data.totalParlaysChecked || 0;

  let msg = `🔄 *PRE-GAME LEG VERIFICATION — ${dateStr}*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `Checked ${totalChecked} parlays\n\n`;

  if (swaps.length > 0) {
    msg += `✅ *SWAPS MADE (${swaps.length}):*\n`;
    for (const s of swaps) {
      const origProp = PROP_LABELS[(s.originalLeg?.prop || '').toLowerCase()] || (s.originalLeg?.prop || '').toUpperCase();
      const newProp = PROP_LABELS[(s.newLeg?.prop || '').toLowerCase()] || (s.newLeg?.prop || '').toUpperCase();
      const origSide = (s.originalLeg?.side || 'over').toUpperCase().charAt(0);
      const newSide = (s.newLeg?.side || 'over').toUpperCase().charAt(0);
      msg += `\n🔁 *${s.originalLeg?.player}* → *${s.newLeg?.player}*\n`;
      msg += `   ${origProp} ${origSide}${s.originalLeg?.line} → ${newProp} ${newSide}${s.newLeg?.line}\n`;
      msg += `   Reason: ${s.reason}\n`;
      if (s.newLeg?.confidence) msg += `   New confidence: ${Math.round(s.newLeg.confidence)}%\n`;
    }
    msg += `\n`;
  }

  if (drops.length > 0) {
    msg += `🗑 *LEGS DROPPED (${drops.length}):*\n`;
    for (const d of drops) {
      const strategy = (d.parlayStrategy || 'unknown').replace(/_/g, ' ');
      msg += `• *${d.droppedPlayer}* — ${d.reason}\n`;
      msg += `   _${strategy} → reduced to fewer legs, stake raised_\n`;
    }
    msg += `\n`;
  }

  if (voids.length > 0) {
    msg += `🚫 *PARLAYS VOIDED (${voids.length}):*\n`;
    for (const v of voids) {
      const strategy = (v.parlayStrategy || 'unknown').replace(/_/g, ' ');
      msg += `• ${strategy} — ${v.reason}\n`;
    }
    msg += `\n`;
  }

  if (swaps.length === 0 && drops.length === 0 && voids.length === 0) {
    msg += `✅ All legs clear — no changes needed`;
  }

  return msg;
}

function formatDDTDCandidates(data: Record<string, any>, dateStr: string): string {
  const ddCandidates = data.ddCandidates || [];
  const tdCandidates = data.tdCandidates || [];

  let msg = `🔮 *DD/TD WATCH — ${dateStr}*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

  if (ddCandidates.length > 0) {
    msg += `🏀 *Double-Double Candidates (${ddCandidates.length}):*\n`;
    for (let i = 0; i < ddCandidates.length; i++) {
      const c = ddCandidates[i];
      const pct = Math.round(c.composite_score * 100);
      const l10 = Math.round(c.l10_rate * 100);
      const loc = c.is_home ? 'Home' : 'Away';
      const nm = c.near_miss_rate > 0.15 ? ' 👀' : '';
      const matchup = c.matchup_label ? ` ${c.matchup_label}` : '';

      // Defense rank details
      let defLine = '';
      const weakStats: string[] = [];
      if (c.defense_pts_rank && c.defense_pts_rank >= 20) weakStats.push(`PTS ${c.defense_pts_rank}th`);
      if (c.defense_reb_rank && c.defense_reb_rank >= 20) weakStats.push(`REB ${c.defense_reb_rank}th`);
      if (c.defense_ast_rank && c.defense_ast_rank >= 20) weakStats.push(`AST ${c.defense_ast_rank}th`);
      if (weakStats.length > 0) defLine = `\n   DEF: ${weakStats.join(' | ')}`;

      msg += `${i + 1}. *${c.player_name}* vs ${c.opponent} (${loc}) — ${pct}% | L10: ${l10}%${nm}${matchup}${defLine}\n`;
    }
    msg += `\n`;
  }

  if (tdCandidates.length > 0) {
    msg += `🌟 *Triple-Double Watch (${tdCandidates.length}):*\n`;
    for (let i = 0; i < tdCandidates.length; i++) {
      const c = tdCandidates[i];
      const pct = Math.round(c.season_rate * 100);
      const l10 = Math.round(c.l10_rate * 100);
      const trend = l10 > pct ? '📈' : l10 < pct ? '📉' : '➡️';
      const matchup = c.matchup_label ? ` ${c.matchup_label}` : '';
      msg += `${i + 1}. *${c.player_name}* vs ${c.opponent} — ${pct}% season | L10: ${l10}% ${trend}${matchup}\n`;
    }
    msg += `\n`;
  }

  msg += `📊 Based on ${data.totalPlayersAnalyzed || '?'} players, ${data.totalGamesLogged || '?'} game logs`;
  return msg;
}

function formatExtraPlaysReport(data: Record<string, any>, dateStr: string): string {
  const mispriced = data.mispriced || [];
  const sweetSpots = data.sweetSpots || [];
  const totalExtras = data.totalExtras || 0;

  const propLabels = PROP_LABELS;

  let msg = `🎯 *EXTRA PLAYS — ${dateStr}*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `Picks engines found but NOT in any parlay\n\n`;

  if (mispriced.length > 0) {
    msg += `🔥 *Mispriced Lines (${mispriced.length}):*\n`;
    for (const m of mispriced.slice(0, 10)) {
      const prop = propLabels[(m.prop_type || '').toLowerCase()] || (m.prop_type || '').toUpperCase();
      const side = (m.signal || 'OVER').charAt(0);
      const edge = m.edge_pct ? `${Math.round(m.edge_pct)}%` : '?';
      msg += `• ${m.player_name} ${prop} ${side}${m.book_line} | Edge: ${edge} | ${m.tier || 'HIGH'}\n`;
    }
    if (mispriced.length > 10) msg += `  ... and ${mispriced.length - 10} more\n`;
    msg += `\n`;
  }

  if (sweetSpots.length > 0) {
    msg += `💎 *Sweet Spots (${sweetSpots.length}):*\n`;
    for (const s of sweetSpots.slice(0, 10)) {
      const prop = propLabels[(s.prop_type || '').toLowerCase()] || (s.prop_type || '').toUpperCase();
      const side = (s.recommended_side || 'OVER').charAt(0);
      const hit = s.actual_hit_rate ? `${Math.round(s.actual_hit_rate)}%` : '?';
      const score = s.confidence_score ? Math.round(s.confidence_score) : '?';
      msg += `• ${s.player_name} ${prop} ${side}${s.recommended_line || '?'} | Hit: ${hit} | Score: ${score}\n`;
    }
    if (sweetSpots.length > 10) msg += `  ... and ${sweetSpots.length - 10} more\n`;
    msg += `\n`;
  }

  msg += `📊 *Total:* ${totalExtras} extra plays available`;
  return msg;
}

function formatEngineAccuracyReport(data: Record<string, any>, dateStr: string): string {
  const engines = data.engines || [];

  let msg = `🔬 *ENGINE ACCURACY — ${dateStr}*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `Standalone pick accuracy (not parlay-based)\n\n`;

  if (engines.length === 0) {
    msg += `No settled engine picks found yet.`;
    return msg;
  }

  for (const e of engines) {
    const wr = e.total > 0 ? ((e.won / e.total) * 100).toFixed(1) : '0.0';
    const icon = parseFloat(wr) >= 55 ? '🟢' : parseFloat(wr) >= 50 ? '🟡' : '🔴';
    msg += `${icon} *${e.name}*\n`;
    msg += `  ${e.won}W - ${e.lost}L (${wr}%) | ${e.total} settled\n`;
  }

  const totalWon = engines.reduce((s: number, e: any) => s + (e.won || 0), 0);
  const totalSettled = engines.reduce((s: number, e: any) => s + (e.total || 0), 0);
  const overallWr = totalSettled > 0 ? ((totalWon / totalSettled) * 100).toFixed(1) : '0.0';
  msg += `\n📊 *Overall:* ${totalWon}/${totalSettled} (${overallWr}%)`;

  return msg;
}

function formatParlayApprovalRequest(data: Record<string, any>, dateStr: string): { text: string; reply_markup?: object } | string {
  const parlays = data.parlays || [];

  const propLabels = PROP_LABELS;

  if (parlays.length === 0) {
    return `🔍 *REVIEW PARLAYS — ${dateStr}*\n\nNo execution parlays to review.`;
  }

  // Send first parlay with buttons; remaining as follow-up messages handled by the send logic
  // We'll format all parlays into one message with approve-all at the bottom
  let msg = `🔍 *REVIEW PARLAYS — ${dateStr}*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `${parlays.length} execution parlays pending approval\n\n`;

  for (let i = 0; i < Math.min(parlays.length, 5); i++) {
    const p = parlays[i];
    const legs = Array.isArray(p.legs) ? p.legs : JSON.parse(p.legs || '[]');
    const oddsStr = p.expected_odds > 0 ? `+${p.expected_odds}` : `${p.expected_odds}`;
    const strategy = (p.strategy_name || 'unknown').replace(/_/g, ' ');

    msg += `*Parlay #${i + 1}* (${strategy}) ${oddsStr}\n`;
    for (let j = 0; j < legs.length; j++) {
      const leg = legs[j];
      const side = (leg.side || 'over').toUpperCase();
      const prop = propLabels[leg.prop_type] || (leg.prop_type || '').toUpperCase();
      const hitRate = leg.hit_rate_l10 || leg.hit_rate ? ` (${Math.round(leg.hit_rate_l10 || leg.hit_rate)}% L10)` : '';
      const recencyWarn = getRecencyWarning(leg);
      msg += `  ${j + 1}. ${leg.player_name || 'Player'} ${side} ${leg.line} ${prop}${hitRate}${recencyWarn}\n`;
    }
    msg += `\n`;
  }

  if (parlays.length > 5) {
    msg += `... and ${parlays.length - 5} more parlays\n\n`;
  }

  msg += `Tap buttons below to review each parlay:`;

  // Build inline keyboard: one row per parlay with Approve/Edit/Reject
  const inline_keyboard: any[][] = [];
  for (let i = 0; i < parlays.length; i++) {
    const p = parlays[i];
    const shortId = p.id.slice(0, 8);
    inline_keyboard.push([
      { text: `✅ #${i + 1}`, callback_data: `approve_parlay:${p.id}` },
      { text: `✏️ #${i + 1}`, callback_data: `edit_parlay:${p.id}` },
      { text: `❌ #${i + 1}`, callback_data: `reject_parlay:${p.id}` },
    ]);
  }
  // Add approve-all button
  inline_keyboard.push([{ text: '✅ APPROVE ALL', callback_data: 'approve_all_parlays' }]);

  return { text: msg, reply_markup: { inline_keyboard } };
}

function formatPipelineFailureAlert(data: Record<string, any>, dateStr: string): string {
  const { runner, failedSteps, successCount, totalSteps, totalDuration, trigger } = data;

  const mins = Math.floor((totalDuration || 0) / 60000);
  const secs = Math.round(((totalDuration || 0) % 60000) / 1000);
  const durationStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  let msg = `🚨 *PIPELINE ALERT — ${dateStr}*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `${(failedSteps || []).length}/${totalSteps || '?'} steps failed in *${runner || 'unknown'}*\n\n`;

  msg += `❌ *FAILED:*\n`;
  for (const step of (failedSteps || [])) {
    const stepSecs = step.duration_ms ? `${(step.duration_ms / 1000).toFixed(1)}s` : '?';
    const errShort = (step.error || 'unknown error').substring(0, 80);
    msg += `  • ${step.name} — ${errShort} (${stepSecs})\n`;
  }

  msg += `\n✅ *SUCCEEDED:* ${successCount || 0}/${totalSteps || '?'}\n`;
  msg += `⏱ *Duration:* ${durationStr}\n`;
  msg += `🔄 *Trigger:* ${trigger || 'unknown'}\n`;

  if (data.critical) {
    msg += `\n⚠️ *CRITICAL STEP FAILURE* — downstream steps may produce no output`;
  }

  return msg;
}

function formatDoctorReport(data: Record<string, any>, dateStr: string): string {
  const { diagnoses, autoFixedCount, failureDayWinRate, cleanDayWinRate, estimatedImpact, triggerSource } = data;

  let msg = `🩺 *PIPELINE DOCTOR — ${dateStr}*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `${(diagnoses || []).length} problems detected, ${autoFixedCount || 0} auto-fixed\n\n`;

  msg += `*DIAGNOSED:*\n`;
  for (let i = 0; i < (diagnoses || []).length; i++) {
    const d = diagnoses[i];
    const severityIcon = d.severity === 'critical' ? '🔴' : d.severity === 'warning' ? '🟡' : '🔵';
    msg += `\n${severityIcon} *${i + 1}. ${d.problem}*\n`;
    msg += `  Cause: ${d.rootCause}\n`;
    msg += `  Fix: ${d.suggestedFix}\n`;
    msg += `  Impact: ${d.impact}\n`;
  }

  if (failureDayWinRate !== null && cleanDayWinRate !== null) {
    msg += `\n📊 Win rate on failure days: ${failureDayWinRate}% vs ${cleanDayWinRate}% clean days\n`;
  }
  if (estimatedImpact !== null) {
    msg += `💰 Est. daily profit impact: ${estimatedImpact >= 0 ? '+' : ''}$${estimatedImpact}\n`;
  }

  msg += `\n🔄 Trigger: ${triggerSource || 'unknown'}`;
  return msg;
}

function formatQualityRegenReport(data: Record<string, any>, dateStr: string): string {
  const { attempts, bestAttempt, bestHitRate, targetHitRate, targetMet, hoursBeforeDeadline, totalParlaysKept } = data;

  let msg = `🔄 *QUALITY REGEN REPORT — ${dateStr}*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `Target: ${targetHitRate}% projected hit rate\n`;
  msg += `Result: ${targetMet ? '✅ TARGET MET' : '⚠️ BEST EFFORT'}\n\n`;

  msg += `*ATTEMPTS:*\n`;
  for (const att of (attempts || [])) {
    const icon = att.meetsTarget ? '✅' : att.parlayCount === 0 ? '⏭️' : '❌';
    const boost = att.regenBoost === 0 ? 'Standard' : att.regenBoost === 1 ? 'Tight (+5)' : 'Elite (+10)';
    msg += `${icon} #${att.attempt} [${boost}]: ${att.avgProjectedHitRate}% avg | ${att.parlayCount} parlays\n`;
  }

  msg += `\n🏆 *Kept:* Attempt #${bestAttempt} (${bestHitRate}%)\n`;
  msg += `📊 *Parlays Active:* ${totalParlaysKept}\n`;
  msg += `⏰ *Hours before deadline:* ${hoursBeforeDeadline}h\n`;

  return msg;
}

function formatHitRateEvaluation(data: Record<string, any>, dateStr: string): string {
  const { actualHitRate, targetHitRate, parlaysWon, parlaysSettled, thresholdMaintained } = data;

  let msg = `📈 *HIT RATE EVALUATION — ${dateStr}*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `*Actual:* ${actualHitRate}% (${parlaysWon}/${parlaysSettled} exec parlays won)\n`;
  msg += `*Target:* ${targetHitRate}%\n\n`;

  if (thresholdMaintained) {
    msg += `✅ *Threshold maintained* — 60% minimum confirmed\n`;
    msg += `Model weights unchanged for tomorrow.`;
  } else {
    msg += `⚠️ *Below target* — gap of ${(targetHitRate - actualHitRate).toFixed(1)}%\n`;
    msg += `🔧 Triggering weight recalibration for tomorrow's generation.`;
  }

  return msg;
}

function formatSlateStatusUpdate(data: Record<string, any>, dateStr: string): string {
  const { activeParlays, totalStake } = data;

  const propLabels = PROP_LABELS;

  const active = activeParlays || [];
  const riskDisplay = totalStake ? `$${totalStake}` : 'N/A';

  let msg = `📋 *DAILY SLATE STATUS — ${dateStr}*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `✅ *${active.length} ACTIVE PARLAYS* | Total Risk: ${riskDisplay}\n\n`;

  for (let i = 0; i < active.length; i++) {
    const p = active[i];
    const strategy = (p.strategy_name || 'unknown').replace(/_/g, ' ');
    const legs = p.legs || [];
    msg += `*Parlay #${i + 1}* (${strategy}) — ${legs.length} legs\n`;

    for (const leg of legs) {
      const side = (leg.side || 'over').toUpperCase();
      const prop = propLabels[leg.prop_type] || (leg.prop_type || '').toUpperCase();
      const hitRate = leg.hit_rate_l10 ? ` (${Math.round(leg.hit_rate_l10)}% L10)` : '';
      const recencyWarn = getRecencyWarning(leg);
      msg += ` Take ${leg.player_name || 'Player'} ${side} ${leg.line} ${prop}${hitRate}${recencyWarn}\n`;
    }
    msg += `\n`;
  }

  msg += `Use /parlays for full details`;
  return msg;
}

function formatLongshotAnnouncement(data: Record<string, any>, dateStr: string): string {
  const legs = data.legs || [];
  const expectedOdds = data.expected_odds || 4700;
  const stakeAmount = data.stake || 20;
  const payout = Math.round((expectedOdds / 100) * stakeAmount + stakeAmount);

  const propLabels = PROP_LABELS;

  let msg = `🚀 *LONGSHOT PARLAY — ${dateStr}*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `🏆 *LAST LONGSHOT: +$4,741 on Feb 9*\n`;
  msg += `3 legs hit, 3 voided — full payout!\n`;
  msg += `We're going for *TWO IN A ROW* 🔥\n\n`;
  msg += `🎯 *${legs.length}-LEG EXPLORER | ~+${expectedOdds}*\n\n`;

  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    const prop = propLabels[leg.prop_type] || (leg.prop_type || '').toUpperCase();
    const side = (leg.side || 'over').toUpperCase();
    msg += `*Leg ${i + 1}: ${leg.player_name}*\n`;
    msg += `  Take ${side} ${leg.line} ${prop}\n`;
    msg += `  💎 ${leg.edge_note || ''}\n\n`;
  }

  msg += `💰 $${stakeAmount} → ~$${payout.toLocaleString()}\n`;
  msg += `⚠️ HIGH RISK / HIGH REWARD\n`;
  msg += `🎲 Good luck — let's eat!`;
  return msg;
}

function formatSlateRebuildAlert(dateStr: string): string {
  let msg = `🔄 *SLATE UPDATE — ${dateStr}*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `We're regenerating today's parlays with upgraded defensive intelligence.\n\n`;
  msg += `*What's new:*\n`;
  msg += `• Per-stat defense matchup analysis (points, 3PT, rebounds, assists)\n`;
  msg += `• Weak opponent targeting — focusing on exploitable matchups\n`;
  msg += `• Tighter exposure controls\n\n`;
  msg += `New picks will be sent shortly. Stay tuned! 🎯`;
  return msg;
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
  
  // If all tier counts are 0, look up actual parlays and classify them
  let displayCount = totalCount || 0;
  let displayExploration = exploration || 0;
  let displayValidation = validation || 0;
  let displayExecution = execution || 0;
  let countLabel = 'Generated';

  if (displayCount === 0 || (displayExploration === 0 && displayValidation === 0 && displayExecution === 0)) {
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const sb = createClient(supabaseUrl, supabaseKey);
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
      const { data: todayParlays } = await sb
        .from('bot_daily_parlays')
        .select('strategy_name')
        .eq('parlay_date', today)
        .eq('outcome', 'pending');
      if (todayParlays && todayParlays.length > 0) {
        displayCount = todayParlays.length;
        countLabel = 'Active';
        // Classify by strategy name
        displayExploration = 0;
        displayValidation = 0;
        displayExecution = 0;
        for (const p of todayParlays) {
          const name = (p.strategy_name || '').toLowerCase();
          if (name.includes('validation') || name.includes('validated') || name.includes('proving')) {
            displayValidation++;
          } else if (name.includes('execution') || name.includes('elite') || name.includes('cash_lock') ||
              name.includes('boosted_cash') || name.includes('golden_lock') || name.includes('hybrid_exec') ||
              name.includes('team_exec') || name.includes('mispriced') || name.includes('conviction') ||
              name.startsWith('force_')) {
            displayExecution++;
          } else {
            displayExploration++;
          }
        }
      }
    } catch (e) {
      console.error('[Telegram] Failed to lookup existing parlays:', e);
    }
  }
  
  msg += `✅ *${displayCount} parlays ${countLabel.toLowerCase()}* for ${dateStr}\n\n`;
  
  msg += `🔬 Exploration: ${displayExploration} parlays\n`;
  msg += `✅ Validation: ${displayValidation} parlays\n`;
  msg += `🎯 Execution: ${displayExecution} parlays\n\n`;
  
  if (poolSize) {
    msg += `📍 Pool Size: ${poolSize} picks\n\n`;
  }
  
  // Top Picks Preview
  if (topPicks && Array.isArray(topPicks) && topPicks.length > 0) {
    msg += `🔥 *Top Picks Preview:*\n`;
    for (const pick of topPicks.slice(0, 5)) {
      const propLabels = PROP_LABELS;
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
        const emoji = getSportEmoji(pick);
        msg += `${emoji} Take ${pick.player_name || 'Player'} ${side} ${pick.line} ${prop} ${oddsStr}\n`;
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
    
    const propLabels = PROP_LABELS;
    
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
    
    // --- PROP TYPE BREAKDOWN ---
    const propTypeStats = new Map<string, { hits: number; total: number }>();
    for (const p of parlayDetails) {
      for (const leg of (p.legs || [])) {
        if (leg.outcome !== 'hit' && leg.outcome !== 'miss') continue;
        const prop = propLabels[leg.prop_type] || (leg.prop_type || '').toUpperCase();
        const existing = propTypeStats.get(prop) || { hits: 0, total: 0 };
        existing.total++;
        if (leg.outcome === 'hit') existing.hits++;
        propTypeStats.set(prop, existing);
      }
    }
    
    if (propTypeStats.size > 0) {
      const sorted = [...propTypeStats.entries()]
        .sort((a, b) => (a[1].hits / a[1].total) - (b[1].hits / b[1].total));
      
      msg += `\n--- PROP TYPE BREAKDOWN ---\n`;
      for (const [prop, { hits, total }] of sorted) {
        const pct = Math.round((hits / total) * 100);
        msg += `${prop}: ${hits}/${total} hit (${pct}%)\n`;
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

function formatIntegrityAlert(data: Record<string, any>, dateStr: string): { text: string; reply_markup?: object } {
  const { oneLegCount, twoLegCount, duplicateLegCount, total, strategyCounts, topDuplicates } = data;

  let msg = `⚠️ *PARLAY INTEGRITY ALERT — ${dateStr}*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `🚨 Leak detected in today's parlays:\n`;
  if (oneLegCount > 0) msg += `  • 1-leg singles: *${oneLegCount} parlays*\n`;
  if (twoLegCount > 0) msg += `  • 2-leg minis:   *${twoLegCount} parlays*\n`;
  if (duplicateLegCount > 0) msg += `  • Duplicate legs: *${duplicateLegCount} combos*\n`;
  msg += `  Total violations: *${total}*\n\n`;

  if (strategyCounts && Object.keys(strategyCounts).length > 0) {
    msg += `Strategies involved:\n`;
    for (const [name, count] of Object.entries(strategyCounts)) {
      msg += `  • ${name} (×${count})\n`;
    }
    msg += `\n`;
  }

  if (topDuplicates && Array.isArray(topDuplicates) && topDuplicates.length > 0) {
    msg += `Top duplicates:\n`;
    for (const d of topDuplicates.slice(0, 3)) {
      msg += `  • ${d}\n`;
    }
    msg += `\n`;
  }

  msg += `⚡ *Action required:* Tap below to fix`;

  const inline_keyboard = [
    [
      { text: '🗑 Void Bad Parlays', callback_data: 'integrity_void_bad' },
      { text: '📋 View Admin', callback_data: 'admin_status' },
    ],
  ];

  return { text: msg, reply_markup: { inline_keyboard } };
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

function formatDailyWinnersReport(data: Record<string, any>, dateStr: string): string {
  const { winners, totalHits, totalPicks, hitRate, propBreakdown, date } = data;
  const displayDate = date || dateStr;

  const propIcons: Record<string, string> = {
    POINTS: '🏀', PTS: '🏀', REBOUNDS: '💪', REB: '💪',
    ASSISTS: '🎯', AST: '🎯', THREES: '🔥', THREE_POINTERS: '🔥', '3PT': '🔥',
    STEALS: '🖐️', STL: '🖐️', BLOCKS: '🛡️', BLK: '🛡️', PRA: '⭐',
  };
  const propLabels: Record<string, string> = {
    POINTS: 'PTS', PTS: 'PTS', REBOUNDS: 'REB', REB: 'REB',
    ASSISTS: 'AST', AST: 'AST', THREES: '3PT', THREE_POINTERS: '3PT', '3PT': '3PT',
    STEALS: 'STL', STL: 'STL', BLOCKS: 'BLK', BLK: 'BLK', PRA: 'PRA',
  };

  let msg = `🏆 DAILY WINNERS REPORT — ${displayDate}\n`;
  msg += `================================\n\n`;
  msg += `✅ ${totalHits}/${totalPicks} Picks Hit (${hitRate}%)\n\n`;

  if (winners && winners.length > 0) {
    msg += `Top Hits:\n`;
    for (const w of winners.slice(0, 15)) {
      const prop = propLabels[w.propType?.toUpperCase()] || w.propType;
      const icon = propIcons[w.propType?.toUpperCase()] || '📊';
      const side = (w.side || 'over').charAt(0).toUpperCase();
      msg += `  ✅ ${w.playerName} ${side}${w.line} ${icon}${prop} (actual: ${w.actualValue})\n`;
    }
    if (winners.length > 15) {
      msg += `  ... +${winners.length - 15} more winners\n`;
    }
  }

  if (propBreakdown && Object.keys(propBreakdown).length > 0) {
    msg += `\nProp Breakdown:\n`;
    const sorted = Object.entries(propBreakdown).sort((a: any, b: any) => b[1].rate - a[1].rate);
    for (const [prop, stats] of sorted) {
      const icon = propIcons[prop] || '📊';
      const label = propLabels[prop] || prop;
      msg += `  ${icon} ${label}: ${(stats as any).hits}/${(stats as any).total} (${(stats as any).rate}%)\n`;
    }
  }

  return msg;
}

function formatMispricedLinesReport(data: Record<string, any>, dateStr: string): string {
  const { nbaCount, mlbCount, overCount, underCount, totalCount, topByTier } = data;

  let msg = `🔍 MISPRICED LINES REPORT — ${dateStr}\n`;
  msg += `================================\n\n`;
  msg += `🏀 NBA: ${nbaCount || 0} lines | ⚾ MLB: ${mlbCount || 0} lines\n`;
  msg += `🟢 ${overCount || 0} OVER | 🔴 ${underCount || 0} UNDER\n`;
  msg += `Total: ${totalCount || 0} mispriced lines detected\n`;

  const tiers = [
    { key: 'ELITE', label: '🏆 ELITE EDGES', max: 10 },
    { key: 'HIGH', label: '🔥 HIGH CONFIDENCE', max: 15 },
    { key: 'MEDIUM', label: '📊 MEDIUM CONFIDENCE', max: 10 },
  ];

  for (const tier of tiers) {
    const picks = topByTier?.[tier.key];
    if (!picks || picks.length === 0) continue;

    msg += `\n${tier.label}:\n`;
    for (const p of picks.slice(0, tier.max)) {
      const icon = p.signal === 'OVER' ? '📈' : '📉';
      const side = p.signal === 'OVER' ? 'O' : 'U';
      const sportIcon = p.sport === 'baseball_mlb' ? '⚾' : '🏀';
      const edgeSign = p.edge_pct > 0 ? '+' : '';
      const avgLabel = p.sport === 'baseball_mlb' ? 'Szn' : 'L10';
      msg += `  ${icon} ${sportIcon} ${p.player_name} — ${formatPropLabel(p.prop_type)} ${side} ${p.book_line} | ${avgLabel}: ${p.player_avg?.toFixed(1) ?? '?'} | Edge: ${edgeSign}${Math.round(p.edge_pct)}%\n`;
    }
    if (picks.length > tier.max) {
      msg += `  ... +${picks.length - tier.max} more\n`;
    }
  }

  return msg;
}

function formatHighConvictionReport(data: Record<string, any>, dateStr: string): string {
  const { plays, stats } = data;
  const total = stats?.total || 0;
  const allAgree = stats?.allAgree || 0;

  let msg = `🎯 HIGH CONVICTION PLAYS — ${dateStr}\n`;
  msg += `================================\n\n`;
  msg += `🔥 ${total} cross-engine overlaps found\n`;
  msg += `✅ ${allAgree} with full side agreement\n`;

  if (stats?.engineCounts) {
    const engines = Object.entries(stats.engineCounts)
      .map(([e, c]) => `${e}: ${c}`)
      .join(' | ');
    msg += `⚙️ Engines: ${engines}\n`;
  }

  if (!plays || plays.length === 0) {
    msg += `\nNo cross-engine overlaps detected today.`;
    return msg;
  }

  msg += `\n🏆 TOP PLAYS (by conviction score):\n\n`;

  for (let i = 0; i < Math.min(plays.length, 15); i++) {
    const p = plays[i];
    const side = (p.signal || 'OVER').charAt(0);
    const propLabel = formatPropLabel(p.displayPropType || p.prop_type);
    const edgeSign = p.edge_pct > 0 ? '+' : '';
    const tierEmoji = p.confidence_tier === 'ELITE' ? '🏆' : p.confidence_tier === 'HIGH' ? '🔥' : '📊';

    msg += `${i + 1}. 🏀 ${p.player_name} — ${propLabel} ${side} ${p.current_line}\n`;
    msg += `   📈 Edge: ${edgeSign}${Math.round(p.edge_pct)}% (${p.confidence_tier}) ${tierEmoji}\n`;

    // Engine agreement details
    const engineNames = (p.engines || []).map((e: any) => e.engine).join(' + ');
    if (p.sideAgreement) {
      msg += `   ✅ ${engineNames} agree ${p.signal}\n`;
    } else {
      msg += `   ⚠️ ${engineNames} (mixed sides)\n`;
    }
    msg += `   🎯 Score: ${p.convictionScore.toFixed(1)}/30\n\n`;
  }

  if (plays.length > 15) {
    msg += `... +${plays.length - 15} more plays\n`;
  }

  return msg;
}

function formatFreshSlateReport(data: Record<string, any>, dateStr: string): string {
  const { parlays, totalParlays, voidedCount, totalPicks } = data;

  let msg = `🔥 FRESH CONVICTION SLATE — ${dateStr}\n`;
  msg += `==================================\n\n`;
  
  if (voidedCount > 0) {
    msg += `🗑️ Cleared ${voidedCount} old pending parlays\n`;
  }
  msg += `✅ ${totalParlays} high-conviction 3-leg parlays\n`;
  msg += `📊 Built from ${totalPicks} ELITE/HIGH mispriced picks\n\n`;

  const propLabels: Record<string, string> = {
    player_points: 'PTS', player_rebounds: 'REB', player_assists: 'AST',
    player_threes: '3PT', player_blocks: 'BLK', player_steals: 'STL',
    player_turnovers: 'TO', player_points_rebounds_assists: 'PRA',
    batter_hits: 'Hits', batter_rbis: 'RBI', batter_total_bases: 'TB',
    pitcher_strikeouts: 'K',
  };

  if (parlays && Array.isArray(parlays)) {
    for (const p of parlays) {
      const scoreEmoji = p.avgScore >= 80 ? '🔥' : p.avgScore >= 60 ? '✨' : '📊';
      msg += `${scoreEmoji} PARLAY ${p.index} (Score: ${p.avgScore.toFixed(0)}/100)\n`;
      if (p.riskConfirmedCount > 0) {
        msg += `  ✅ ${p.riskConfirmedCount}/3 risk-engine confirmed\n`;
      }
      
      for (const leg of (p.legs || [])) {
        const side = leg.signal === 'OVER' ? 'O' : 'U';
        const prop = propLabels[leg.prop_type] || leg.prop_type.replace(/^(player_|batter_|pitcher_)/, '').toUpperCase();
        const edgeSign = leg.edge_pct > 0 ? '+' : '';
        const tierEmoji = leg.confidence_tier === 'ELITE' ? '🏆' : '🔥';
        const riskTag = leg.risk_confirmed ? ' ✅' : '';
        msg += `  📈 ${leg.player_name} ${prop} ${side} ${leg.book_line} | Edge: ${edgeSign}${Math.round(leg.edge_pct)}% ${tierEmoji}${riskTag}\n`;
      }
      msg += `\n`;
    }
  }

  msg += `Strategy: force_mispriced_conviction\n`;
  msg += `Focus: 3-leg only | UNDER bias | ELITE/HIGH edges`;

  return msg;
}

function formatDoubleConfirmedReport(data: Record<string, any>, dateStr: string): string {
  const { picks, totalSweetSpots, totalMispriced, date } = data;
  const displayDate = date || dateStr;
  const count = picks?.length || 0;

  let msg = `✅ ${count} Double-Confirmed Picks Found:\n`;
  msg += `================================\n\n`;

  if (!picks || picks.length === 0) {
    msg += `No picks qualified today (need 70%+ L10 AND 15%+ edge with direction agreement).\n`;
  } else {
    const propLabels: Record<string, string> = {
      player_points: 'Points', player_rebounds: 'Rebounds', player_assists: 'Assists',
      player_threes: 'Threes', player_blocks: 'Blocks', player_steals: 'Steals',
      player_turnovers: 'Turnovers', player_points_rebounds_assists: 'PRA',
      player_points_rebounds: 'Pts+Reb', player_points_assists: 'Pts+Ast',
      player_rebounds_assists: 'Reb+Ast',
      batter_hits: 'Hits', batter_rbis: 'RBI', batter_runs_scored: 'Runs',
      batter_total_bases: 'Total Bases', batter_home_runs: 'Home Runs',
      batter_stolen_bases: 'Stolen Bases',
      pitcher_strikeouts: 'Strikeouts', pitcher_outs: 'Outs',
      player_fantasy_score: 'Fantasy Score', player_hitter_fantasy_score: 'Hitter Fantasy',
    };

    for (const p of picks) {
      const propLabel = propLabels[p.prop_type] || p.prop_type.replace(/^(player_|batter_|pitcher_)/, '').replace(/_/g, ' ');
      const side = (p.side || 'OVER').toUpperCase();
      const hitRate = Math.round(p.l10_hit_rate || 0);
      const edgeSign = p.edge_pct > 0 ? '+' : '';
      const edge = Math.round(p.edge_pct || 0);
      msg += `🎯 ${p.player_name}  ${propLabel} ${side} -- ${hitRate}% L10, ${edgeSign}${edge}% edge\n`;
    }
  }

  // Footer
  msg += `\n${displayDate}`;
  
  // Sport breakdown
  const sportCounts: Record<string, number> = {};
  for (const p of (picks || [])) {
    const sport = p.sport === 'basketball_nba' ? 'NBA' : p.sport === 'icehockey_nhl' ? 'NHL' : p.sport === 'baseball_mlb' ? 'MLB' : p.sport || '?';
    sportCounts[sport] = (sportCounts[sport] || 0) + 1;
  }
  const sportStr = Object.entries(sportCounts).map(([s, c]) => `${s}: ${c}`).join(' | ');
  if (sportStr) msg += ` | ${sportStr}`;
  
  msg += ` | Sweet spots: ${totalSweetSpots || 0} | Mispriced: ${totalMispriced || 0}`;

  return msg;
}


function formatMegaParlayScanner(data: Record<string, any>, dateStr: string): string {
  const { date, scanned, events, qualified, legs, combinedOdds, payout25 } = data;
  const displayDate = date || dateStr;

  let msg = `🎰 DAILY LOTTERY PARLAY\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `${displayDate} | +100 Odds Only\n\n`;
  msg += `⚠️ HIGH RISK / HIGH REWARD\n`;
  msg += `This is a lottery-style parlay — slight risk involved.\n`;
  msg += `Bet only what you can afford to lose.\n\n`;
  msg += `📊 Scanned: ${scanned || '?'} props across ${events || '?'} games\n`;
  msg += `✅ ${qualified || '?'} qualified\n\n`;

  if (legs && Array.isArray(legs) && legs.length > 0) {
    msg += `🎯 RECOMMENDED PARLAY (${legs.length} legs)\n`;
    msg += `💰 Combined: +${combinedOdds || '?'}\n`;
    msg += `💵 $25 bet → $${payout25 || '?'}\n\n`;

    for (const leg of legs) {
      msg += `Leg ${leg.leg}: ${leg.player}\n`;
      msg += `  ${leg.side} ${leg.line} ${leg.prop} (${leg.odds}) [${leg.book}]\n`;
      msg += `  Hit: ${leg.hit_rate} | Edge: ${leg.edge} | Score: ${leg.composite}\n`;
      msg += `  L10 Med: ${leg.l10_median ?? 'N/A'} | Avg: ${leg.l10_avg ?? 'N/A'}\n\n`;
    }
  } else {
    msg += `⚠️ No qualifying parlay legs found today.\n`;
  }

  msg += `🎲 Good luck! Play responsibly.`;

  return msg;
}

function formatMegaLotteryV2(data: Record<string, any>, dateStr: string): string {
  const { date, tickets, ticketCount, scanned, events, exoticProps, teamBets } = data;
  const displayDate = date || dateStr;

  const tierEmoji: Record<string, string> = {
    standard: '🎟️',
    high_roller: '🎲',
    mega_jackpot: '🎰',
  };
  const tierLabel: Record<string, string> = {
    standard: 'STANDARD',
    high_roller: 'HIGH ROLLER',
    mega_jackpot: 'MEGA JACKPOT',
  };

  let msg = `🎰 LOTTERY TICKETS (${ticketCount || 0} Tickets)\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `${displayDate} | V2 3-Ticket System\n`;
  msg += `📊 ${scanned || '?'} props | ${events || '?'} games | ${exoticProps || 0} exotic | ${teamBets || 0} team bets\n\n`;
  msg += `⚠️ LOTTERY — High risk, high reward.\n`;
  msg += `Bet only what you can afford to lose.\n\n`;

  if (tickets && Array.isArray(tickets)) {
    for (const ticket of tickets) {
      const emoji = tierEmoji[ticket.tier] || '🎟️';
      const label = tierLabel[ticket.tier] || ticket.tier.toUpperCase();
      msg += `${emoji} Ticket — ${label} (+${ticket.combinedOdds?.toLocaleString()}) | $${ticket.stake} stake\n`;
      msg += `💵 Potential: $${ticket.payout}\n`;

      for (const leg of (ticket.legs || [])) {
        const propLabel = (leg.prop || '').replace(/_/g, ' ').toUpperCase();
        const defStr = leg.defense_rank ? ` | Def: ${leg.defense_rank}` : '';
        const hrStr = leg.hit_rate ? ` | HR: ${leg.hit_rate}%` : '';
        const typeTag = leg.market_type === 'exotic_player' ? ' 🌟' : leg.market_type === 'team_bet' ? ' 🏀' : '';
        msg += `  L${leg.leg}: ${leg.player} ${leg.side} ${leg.line || ''} ${propLabel} (${leg.odds})${typeTag}${defStr}${hrStr}\n`;
      }
      msg += `\n`;
    }
  } else {
    msg += `⚠️ No qualifying tickets found today.\n`;
  }

  msg += `🎲 Good luck! Play responsibly.`;
  return msg;
}

function formatDailyWinnersRecap(data: Record<string, any>, dateStr: string): string {
  const { date, rating, winnerCount, totalProfit, totalStaked, winners, lotteryWinners, tierContext, keyPlayers } = data;
  const displayDate = date || dateStr;

  let msg = `🏆 YESTERDAY'S WINS — ${displayDate}\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;

  // Lottery Hits section (shown first when present)
  if (lotteryWinners && Array.isArray(lotteryWinners) && lotteryWinners.length > 0) {
    msg += `🎰 LOTTERY HITS! 🎰\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    for (const lw of lotteryWinners) {
      const profit = lw.payout - lw.stake;
      msg += `🎟️ ${(lw.tier || 'STANDARD').toUpperCase()} (${lw.odds}) — $${lw.stake.toLocaleString()} stake → $${lw.payout.toLocaleString()} payout (+$${profit.toLocaleString()})\n`;
      for (const leg of (lw.legs || [])) {
        const actualStr = leg.actual !== null && leg.actual !== undefined ? ` (actual: ${leg.actual})` : '';
        msg += `  ✅ ${leg.player} ${leg.prop} ${leg.side}${leg.line}${actualStr}\n`;
      }
      msg += `\n`;
    }
  }

  msg += `${rating || 'Solid Day'} — ${winnerCount || 0} Winner${winnerCount !== 1 ? 's' : ''}\n\n`;

  // Regular winners (exclude lottery since they're shown above)
  if (winners && Array.isArray(winners)) {
    const regularWinners = winners.filter((w: any) => !w.isLottery);
    for (const w of regularWinners) {
      msg += `#${w.rank} | ${w.tier} | ${w.odds} | $${w.stake?.toLocaleString()} stake → +$${w.profit?.toLocaleString()} profit\n`;
      for (const leg of (w.legs || [])) {
        const actualStr = leg.actual !== null && leg.actual !== undefined ? ` (actual: ${leg.actual})` : '';
        msg += `  ✅ ${leg.player} ${leg.prop} ${leg.side}${leg.line}${actualStr}\n`;
      }
      msg += `\n`;
    }
  }

  const roi = totalStaked > 0 ? Math.round((totalProfit / totalStaked) * 100) : 0;
  msg += `💰 Total: $${(totalStaked || 0).toLocaleString()} staked → +$${(totalProfit || 0).toLocaleString()} profit (${roi}% ROI) across ${winnerCount || 0} winners\n\n`;

  if (keyPlayers && keyPlayers.length > 0) {
    msg += `🔑 Key Players: ${keyPlayers.join(', ')}\n\n`;
  }

  // Tier performance context
  if (tierContext && typeof tierContext === 'object' && Object.keys(tierContext).length > 0) {
    msg += `📈 Lottery Tier Trends:\n`;
    for (const [tier, context] of Object.entries(tierContext)) {
      const label = tier.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      msg += `  ${label}: ${context}\n`;
    }
    msg += `\n`;
  }

  msg += `📊 Powered by ParlayIQ Engine`;

  return msg;
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

function formatLegSettledAlert(data: Record<string, any>, dateStr: string): string {
  const legs = data.legs || [];
  if (legs.length === 0) return '';

  const propLabels = PROP_LABELS;

  let msg = `📊 *LEG UPDATES — ${dateStr}*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

  for (const leg of legs.slice(0, 30)) {
    const icon = leg.outcome === 'hit' ? '✅' : '❌';
    const label = leg.outcome === 'hit' ? 'HIT' : 'MISS';
    const prop = propLabels[(leg.prop_type || '').toLowerCase()] || (leg.prop_type || '').toUpperCase();
    const side = (leg.side || 'over').charAt(0).toUpperCase();
    const actual = leg.actual_value !== null && leg.actual_value !== undefined ? ` — Actual: ${leg.actual_value}` : '';
    msg += `${icon} *LEG ${label}*\n`;
    msg += `${leg.player_name} ${prop} ${side}${leg.line}${actual}\n`;
    if (leg.strategy) {
      const oddsStr = leg.parlay_odds ? ` (${formatOdds(leg.parlay_odds)})` : '';
      const progress = leg.legs_settled && leg.total_legs ? ` | ${leg.legs_settled}/${leg.total_legs} settled` : '';
      msg += `Parlay: ${leg.strategy.replace(/_/g, ' ')}${oddsStr}${progress}\n`;
    }
    msg += `\n`;
  }

  if (legs.length > 30) {
    msg += `... and ${legs.length - 30} more legs\n`;
  }

  return msg;
}

function formatParlaySettledAlert(data: Record<string, any>, dateStr: string): string {
  const { outcome, strategy, odds, legs, stake, profitLoss, dailyWon, dailyLost, dailyPnl } = data;

  const propLabels = PROP_LABELS;

  const won = outcome === 'won';
  const icon = won ? '🟢' : '🔴';
  const label = won ? 'WON' : 'LOST';
  const oddsStr = formatOdds(odds);
  const strat = (strategy || 'unknown').replace(/_/g, ' ');

  let msg = `${icon} *PARLAY ${label}* — ${strat} (${oddsStr})\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;

  const parlayLegs = legs || [];
  for (let i = 0; i < parlayLegs.length; i++) {
    const leg = parlayLegs[i];
    const prop = propLabels[(leg.prop_type || '').toLowerCase()] || (leg.prop_type || '').toUpperCase();
    const side = (leg.side || 'over').charAt(0).toUpperCase();
    const actualStr = leg.actual_value !== null && leg.actual_value !== undefined ? `${leg.actual_value}` : '?';
    const legIcon = leg.outcome === 'hit' ? '✅' : leg.outcome === 'miss' ? '❌' : '⏳';
    msg += `${i + 1}. ${leg.player_name} ${prop} ${side}${leg.line} — ${actualStr} ${legIcon}\n`;
  }

  msg += `\n`;
  const stakeVal = stake || 100;
  if (won) {
    const decimalOdds = odds > 0 ? (odds / 100) + 1 : (100 / Math.abs(odds)) + 1;
    const payout = Math.round(stakeVal * decimalOdds);
    const profit = payout - stakeVal;
    msg += `💰 Stake: $${stakeVal} | Payout: $${payout.toLocaleString()} | Profit: +$${profit.toLocaleString()}\n`;
  } else {
    msg += `💸 Stake: $${stakeVal} | Lost: -$${stakeVal}\n`;
  }

  if (dailyWon !== undefined && dailyLost !== undefined) {
    const pnlStr = (dailyPnl || 0) >= 0 ? `+$${Math.round(dailyPnl || 0).toLocaleString()}` : `-$${Math.abs(Math.round(dailyPnl || 0)).toLocaleString()}`;
    msg += `📊 Today: ${dailyWon}W-${dailyLost}L | ${pnlStr}\n`;
  }

  return msg;
}

function getStrategyStakePercent(strategyName: string): number {
  const s = (strategyName || '').toLowerCase();
  if (s.includes('floor_lock') || s.includes('optimal_combo') || s.includes('manual_curated')) return 0.05;
  if (s.includes('ceiling_shot') || s.includes('cross_sport') || s.includes('nhl_ceiling')) return 0.01;
  if (s.includes('lottery') || s.includes('longshot')) return 0.005;
  return 0.025; // validation default
}

function formatNewStrategiesBroadcast(data: Record<string, any>, dateStr: string, customerBankroll?: number): string {
  const parlays = data.parlays || [];
  if (parlays.length === 0) return `🤖 No new strategy parlays to broadcast.`;

  const strategyConfig: Record<string, { emoji: string; label: string; tagline: string }> = {
    optimal_combo: { emoji: '🎲', label: 'OPTIMAL COMBO', tagline: 'Highest combined L10 probability' },
    floor_lock: { emoji: '🔒', label: 'FLOOR LOCK', tagline: 'Player floors clear the line' },
    ceiling_shot: { emoji: '🚀', label: 'CEILING SHOT', tagline: 'Alt lines near player ceilings' },
  };

  let msg = `🤖✨ NEW STRATEGY PARLAYS — ${dateStr}\n\n`;
  msg += `Three new AI strategies just dropped:\n`;
  msg += `🎲 Optimal Combo — best math combos\n`;
  msg += `🔒 Floor Lock — safest picks\n`;
  msg += `🚀 Ceiling Shot — high upside\n\n`;

  // Group parlays by strategy
  const groups: Record<string, any[]> = {};
  for (const p of parlays) {
    const strat = p.strategy_name || 'unknown';
    const key = strat.replace(/_nba_.*|_all_.*|_\d+l.*/g, '');
    if (!groups[key]) groups[key] = [];
    groups[key].push(p);
  }

  let parlayNum = 0;
  for (const [stratKey, stratParlays] of Object.entries(groups)) {
    const cfg = strategyConfig[stratKey] || { emoji: '📌', label: stratKey.toUpperCase(), tagline: '' };
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `${cfg.emoji} ${cfg.label}\n`;
    if (cfg.tagline) msg += `${cfg.tagline}\n`;
    msg += `\n`;

    for (const p of stratParlays) {
      parlayNum++;
      const legs = Array.isArray(p.legs) ? p.legs : [];
      const odds = p.expected_odds || 0;
      const oddsStr = odds > 0 ? `+${odds}` : `${odds}`;
      const decOdds = odds > 0 ? (odds / 100) + 1 : (100 / Math.abs(odds || 110)) + 1;

      // Use customer bankroll if available, otherwise fall back to bot stake
      let stake: number;
      let payout: number;
      if (customerBankroll && customerBankroll > 0) {
        const pct = getStrategyStakePercent(p.strategy_name || '');
        stake = Math.round(customerBankroll * pct);
        payout = Math.round(stake * decOdds);
      } else {
        stake = p.simulated_stake || 10;
        payout = Math.round(stake * decOdds);
      }

      msg += `#${parlayNum} · ${legs.length}L · ${oddsStr} · $${stake}→$${payout}\n`;

      for (const leg of legs) {
        const player = leg.player_name || leg.player || 'Unknown';
        const prop = PROP_LABELS[leg.prop_type] || (leg.prop_type || 'prop').toUpperCase();
        const side = (leg.side || 'over').toUpperCase();
        const line = leg.line ?? leg.selected_line ?? '?';
        const hr = leg.l10_hit_rate ? `${Math.round(leg.l10_hit_rate <= 1 ? leg.l10_hit_rate * 100 : leg.l10_hit_rate)}%` : '';
        const legOdds = leg.american_odds ? (leg.american_odds > 0 ? `+${leg.american_odds}` : `${leg.american_odds}`) : '';
        const emoji = getSportEmoji(leg);
        msg += `  ${emoji} ${player} ${prop} ${side} ${line}`;
        if (legOdds) msg += ` (${legOdds})`;
        if (hr) msg += ` · L10: ${hr}`;
        msg += `\n`;
      }
      msg += `\n`;
    }
  }

  msg += `━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `💡 These are AI-optimized picks.\nTrack results in real-time!\n`;

  return msg;
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

    const reqBody = await req.json();
    const adminOnly = reqBody.admin_only === true;

    // Handle raw message passthrough (used by matchup broadcast, nhl floor lock, etc.)
    if (reqBody.message && !reqBody.type) {
      const rawMessage = reqBody.message as string;
      const parseMode = reqBody.parse_mode as string | undefined;
      console.log(`[Telegram] Raw message passthrough (${rawMessage.length} chars, parse_mode=${parseMode || 'none'})`);

      const sendRaw = async (text: string, targetChatId: string) => {
        const body: Record<string, any> = {
          chat_id: targetChatId,
          text,
          disable_web_page_preview: true,
        };
        if (parseMode) body.parse_mode = parseMode;
        let resp = await fetch(`${TELEGRAM_API}${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        let result = await resp.json();

        // Split if too long
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
          for (const chunk of chunks) {
            const chunkBody: Record<string, any> = { chat_id: targetChatId, text: chunk, disable_web_page_preview: true };
            if (parseMode) chunkBody.parse_mode = parseMode;
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

      // Send to admin
      const { resp, result } = await sendRaw(rawMessage, chatId);
      if (!resp.ok) {
        console.error('[Telegram] Raw message API error:', result);
        return new Response(JSON.stringify({ success: false, error: result }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Broadcast to customers if not admin_only and bypass_quiet_hours
      if (!adminOnly && reqBody.bypass_quiet_hours) {
        try {
          const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
          const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
          const sb = createClient(supabaseUrl, supabaseKey);
          const { data: customers } = await sb
            .from('bot_authorized_users')
            .select('chat_id, username, bankroll')
            .eq('is_active', true);
          if (customers && customers.length > 0) {
            // Determine tier stake percent from message content
            let stakePercent = 0;
            const msgLower = rawMessage.toLowerCase();
            if (msgLower.includes('execution') || msgLower.includes('cash lock') || msgLower.includes('elite')) {
              stakePercent = 0.05;
            } else if (msgLower.includes('validation') || msgLower.includes('proving')) {
              stakePercent = 0.025;
            } else if (msgLower.includes('exploration') || msgLower.includes('explorer')) {
              stakePercent = 0.01;
            } else if (msgLower.includes('lottery') || msgLower.includes('longshot')) {
              stakePercent = 0.005;
            }

            for (const customer of customers) {
              if (customer.chat_id === chatId) continue;
              try {
                let customerMsg = rawMessage;
                if (stakePercent > 0 && customer.bankroll && customer.bankroll > 0) {
                  const personalStake = Math.round(customer.bankroll * stakePercent);
                  customerMsg += `\n\n💰 Your stake: $${personalStake} (based on $${customer.bankroll.toLocaleString()} bankroll)`;
                }
                await sendRaw(customerMsg, customer.chat_id);
              } catch (e) {
                console.error(`[Telegram] Failed to send raw to ${customer.chat_id}:`, e);
              }
            }
          }
        } catch (e) { console.error('[Telegram] Customer broadcast error:', e); }
      }

      console.log('[Telegram] Raw message sent successfully');
      return new Response(JSON.stringify({ success: true, raw_passthrough: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { type, data: rawData }: NotificationData = reqBody;

    let data = rawData;

    // Self-fetch daily winners data if not provided
    if (type === 'daily_winners' && (!data || Object.keys(data).length === 0)) {
      console.log('[Telegram] No data provided for daily_winners, self-fetching...');
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const resp = await fetch(`${supabaseUrl}/functions/v1/bot-daily-winners`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });
      data = await resp.json();
      console.log(`[Telegram] Fetched daily winners: ${data?.totalHits}/${data?.totalPicks}`);
    }

    console.log(`[Telegram] Sending ${type} notification`);

    // Suppress noisy internal notification types that don't need admin attention
    const SUPPRESSED_TYPES = ['weight_change', 'quality_regen_report', 'hit_rate_evaluation'];
    if (SUPPRESSED_TYPES.includes(type)) {
      console.log(`[Telegram] Suppressed ${type} notification (internal-only)`);
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: 'suppressed_type' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Only send doctor_report if problems were detected
    if (type === 'doctor_report' && data.problems_detected === 0) {
      console.log(`[Telegram] Suppressed clean doctor_report (0 problems)`);
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: 'clean_doctor_report' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check notification preferences (skip for test, integrity_alert, preflight_alert — these always fire)
    if (type !== 'test' && type !== 'integrity_alert' && type !== 'preflight_alert' && type !== 'daily_winners' && type !== 'mispriced_lines_report' && type !== 'high_conviction_report' && type !== 'fresh_slate_report' && type !== 'double_confirmed_report' && type !== 'mega_parlay_scanner' && type !== 'mega_lottery_v2' && type !== 'daily_winners_recap' && type !== 'leg_settled_alert' && type !== 'parlay_settled_alert') {
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

    console.log(`[Telegram] Message sent successfully to admin`);

    // Broadcast to all authorized customers for certain notification types
    // Skip customer broadcast when admin_only mode is active
    if (!adminOnly && (type === 'mega_parlay_scanner' || type === 'mega_lottery_v2' || type === 'daily_winners_recap' || type === 'slate_rebuild_alert' || type === 'slate_status_update' || type === 'longshot_announcement' || type === 'dd_td_candidates' || type === 'double_confirmed_report' || type === 'new_strategies_broadcast')) {
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const sb = createClient(supabaseUrl, supabaseKey);

        const { data: customers } = await sb
          .from('bot_authorized_users')
          .select('chat_id, username, bankroll')
          .eq('is_active', true);

        if (customers && customers.length > 0) {
          console.log(`[Telegram] Broadcasting ${type} to ${customers.length} customers`);

          // Determine tier from notification type for stake calculation
          const tierStakePercent: Record<string, number> = {
            'mega_parlay_scanner': 0.05,     // Execution: 5%
            'double_confirmed_report': 0.05,  // Execution: 5%
            'mega_lottery_v2': 0.005,         // Lottery: 0.5%
            'longshot_announcement': 0.005,    // Lottery: 0.5%
          };
          const stakePercent = tierStakePercent[type] || 0;

          for (const customer of customers) {
            if (customer.chat_id === chatId) continue; // skip admin, already sent

            // Build personalized message with stake recommendation
            let customerMessage: string;
            if (type === 'new_strategies_broadcast' && customer.bankroll && customer.bankroll > 0) {
              // Regenerate the full message with personalized stakes per parlay
              const etNow = new Date();
              const custDateStr = etNow.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' });
              customerMessage = formatNewStrategiesBroadcast(reqBody.data || {}, custDateStr, customer.bankroll);
            } else if (stakePercent > 0 && customer.bankroll && customer.bankroll > 0) {
              customerMessage = message;
              const personalStake = Math.round(customer.bankroll * stakePercent);
              customerMessage += `\n\n💰 *Your stake:* $${personalStake} (based on $${customer.bankroll.toLocaleString()} bankroll)`;
            } else {
              customerMessage = message;
            }

            try {
              const custBody: Record<string, any> = {
                chat_id: customer.chat_id,
                text: customerMessage,
                disable_web_page_preview: true,
              };
              const custResp = await fetch(`${TELEGRAM_API}${botToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(custBody),
              });
              const custResult = await custResp.json();
              if (!custResp.ok) {
                console.warn(`[Telegram] Failed to send to ${customer.username || customer.chat_id}:`, custResult?.description);
              }
            } catch (e) {
              console.warn(`[Telegram] Error sending to ${customer.chat_id}:`, e);
            }
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

  } catch (error) {
    console.error('[Telegram] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
