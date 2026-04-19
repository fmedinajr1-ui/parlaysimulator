// _shared/pick-formatter.ts
// Renders typed Pick objects into natural-language messages.
// This is where picks "come alive" — with reasoning, recency, risk, and voice.

import type { Pick, PickSide } from './constants.ts';
import { formatPropLabel, getSportEmoji } from './constants.ts';
import {
  formatAmerican,
  recencyWarning,
  recencyTrend,
  suggestedStake,
  classifyTier,
  tierEmoji,
  tierLabel,
} from './edge-calc.ts';
import {
  MessageBuilder,
  bold,
  italic,
  escapeMd,
  pickPhrase,
  confidenceSentence,
} from './voice.ts';

// ─── Side formatting ──────────────────────────────────────────────────────

function sideWord(side: PickSide): string {
  return side === 'over' ? 'OVER' : 'UNDER';
}

function sideSymbol(side: PickSide): string {
  return side === 'over' ? 'O' : 'U';
}

// ─── Compact pick line ────────────────────────────────────────────────────
// Used inside parlay breakdowns and other crowded contexts.
// One line, no newlines.
// Example:  🏀 LeBron James O 25.5 PTS (-110) 📈 73%L10

export function renderPickLine(pick: Pick, opts: { showOdds?: boolean; showConfidence?: boolean } = {}): string {
  const emoji = getSportEmoji(pick);
  const name = escapeMd(pick.player_name);
  const side = sideSymbol(pick.side);
  const prop = formatPropLabel(pick.prop_type, 'short');
  const odds = opts.showOdds !== false && pick.american_odds != null
    ? ` (${formatAmerican(pick.american_odds)})`
    : '';
  const trend = recencyTrend(pick.recency);
  const hitRate = pick.recency?.l10_hit_rate != null
    ? ` ${trend} ${Math.round(pick.recency.l10_hit_rate)}%L10`
    : '';
  const conf = opts.showConfidence && pick.confidence != null
    ? ` · ${Math.round(pick.confidence)}%`
    : '';

  return `${emoji} ${bold(pick.player_name)} ${side}${pick.line} ${prop}${odds}${hitRate}${conf}`;
}

// ─── Full pick card ───────────────────────────────────────────────────────
// The marquee rendering. Used when dropping individual picks.
// Includes: headline, driver stats, recency, risk note, suggested stake.
//
// Example:
//
//   🏀 Jokic UNDER 27.5 points (-110)
//   Confidence: 84/100 — strong
//
//   Minnesota has held him to 24, 22, 19 in the last three.
//   Their wing defenders give him trouble in iso sets.
//
//   • L3 avg: 22.8  ➡️  L10: 27.2  ·  H2H vs MIN: 22.8 (3g)
//
//   What could kill it: Foul trouble on Gobert would open the paint up.
//
//   💰 Suggested stake: 2% of bankroll ($40 on $2,000)

export function renderPickCard(pick: Pick, bankroll?: number): string {
  const m = new MessageBuilder();
  const emoji = getSportEmoji(pick);
  const side = sideWord(pick.side);
  const prop = formatPropLabel(pick.prop_type, 'long');
  const odds = pick.american_odds != null ? ` (${formatAmerican(pick.american_odds)})` : '';
  const tier = classifyTier(pick);

  // Title line
  m.raw(`${emoji} ${bold(pick.player_name)} ${bold(side + ' ' + pick.line)} ${prop}${odds}`);
  // Confidence + tier
  m.line(`${tierEmoji(tier)} ${tierLabel(tier)} · ${confidenceSentence(pick.confidence)}`);
  m.blank();

  // Reasoning headline
  if (pick.reasoning?.headline) {
    m.line(pick.reasoning.headline);
    m.blank();
  }

  // Driver bullets (max 3, inline-ish)
  if (pick.reasoning?.drivers?.length) {
    for (const d of pick.reasoning.drivers.slice(0, 3)) {
      m.line(`• ${d}`);
    }
    m.blank();
  }

  // Recency one-liner
  if (pick.recency) {
    const parts: string[] = [];
    if (pick.recency.l3_avg != null) parts.push(`L3: ${pick.recency.l3_avg.toFixed(1)}`);
    if (pick.recency.l10_avg != null) parts.push(`L10: ${pick.recency.l10_avg.toFixed(1)}`);
    if (pick.recency.h2h_avg != null && pick.recency.h2h_games) {
      parts.push(`H2H: ${pick.recency.h2h_avg.toFixed(1)} (${pick.recency.h2h_games}g)`);
    }
    if (pick.recency.l10_hit_rate != null) {
      parts.push(`Hit rate: ${Math.round(pick.recency.l10_hit_rate)}%`);
    }
    if (parts.length) {
      const trend = recencyTrend(pick.recency);
      m.line(`📊 ${parts.join(' · ')} ${trend}`);
    }
  }

  // Recency warning (fires on extreme divergence)
  const warning = recencyWarning(pick.recency, pick.side);
  if (warning) m.line(warning);

  // Matchup context
  if (pick.reasoning?.matchup) {
    m.blank();
    m.line(`🆚 ${pick.reasoning.matchup}`);
  }

  // Risk note — always present, per our voice rules
  m.blank();
  const riskLead = pickPhrase('risk_present', pick.id);
  m.line(`${riskLead} ${pick.reasoning?.risk_note || 'standard variance applies'}`);

  // Stake suggestion
  if (bankroll && pick.american_odds && pick.confidence != null) {
    const stake = suggestedStake(pick.confidence, pick.american_odds, bankroll);
    if (stake > 0) {
      const pctOfBankroll = (stake / bankroll) * 100;
      m.blank();
      m.line(
        `💰 Suggested stake: ${italic(`$${stake}`)} (${pctOfBankroll.toFixed(1)}% of $${bankroll.toLocaleString()})`
      );
    }
  }

  return m.build();
}

// ─── Parlay card ──────────────────────────────────────────────────────────
// For multi-leg parlays. Header + leg-by-leg breakdown + combined odds.

export function renderParlayCard(params: {
  legs: Pick[];
  americanOdds: number;
  tier?: string;
  parlayId?: string;
  stakeSuggestion?: { amount: number; bankroll: number };
  reasoning?: string; // overall thesis for the parlay
}): string {
  const m = new MessageBuilder();
  const legCount = params.legs.length;
  const sportsInvolved = new Set(params.legs.map(l => getSportEmoji(l)));
  const sportEmojis = [...sportsInvolved].join('');

  m.header(`${legCount}-Leg Parlay`, sportEmojis || '🎯');
  m.line(`Combined odds: ${bold(formatAmerican(params.americanOdds))}`);
  if (params.tier) m.line(`Tier: ${escapeMd(params.tier)}`);
  m.blank();

  if (params.reasoning) {
    m.line(italic(params.reasoning));
    m.blank();
  }

  // Legs
  for (let i = 0; i < params.legs.length; i++) {
    const leg = params.legs[i];
    m.line(`${i + 1}. ${renderPickLine(leg, { showOdds: true, showConfidence: true })}`);
    if (leg.reasoning?.headline) {
      m.line(`   ${italic(leg.reasoning.headline)}`);
    }
  }

  // Stake
  if (params.stakeSuggestion) {
    const { amount, bankroll } = params.stakeSuggestion;
    const payoutMultiplier = params.americanOdds > 0
      ? 1 + params.americanOdds / 100
      : 1 + 100 / Math.abs(params.americanOdds);
    const potentialReturn = Math.round(amount * payoutMultiplier);
    m.blank();
    m.line(`💰 Stake: $${amount} → potential return $${potentialReturn.toLocaleString()}`);
  }

  return m.build();
}

// ─── Quick list (dawn brief etc.) ─────────────────────────────────────────
// Very compact list of picks for overview messages.

export function renderPickSummaryList(picks: Pick[], limit: number = 10): string {
  if (!picks.length) return italic('No qualifying picks.');
  const lines = picks.slice(0, limit).map((p, i) => {
    const emoji = getSportEmoji(p);
    const side = sideSymbol(p.side);
    const prop = formatPropLabel(p.prop_type, 'short');
    return `${i + 1}. ${emoji} ${bold(p.player_name)} ${side}${p.line} ${prop} · ${Math.round(p.confidence)}%`;
  });
  if (picks.length > limit) {
    lines.push(italic(`... and ${picks.length - limit} more`));
  }
  return lines.join('\n');
}

// ─── Settlement leg rendering ─────────────────────────────────────────────
// When a pick resolves, this renders the outcome line.

export function renderSettledLeg(leg: Pick & { outcome?: 'hit' | 'miss' | 'push'; actual_value?: number }): string {
  const icon = leg.outcome === 'hit' ? '✅' : leg.outcome === 'miss' ? '❌' : '⬜';
  const emoji = getSportEmoji(leg);
  const side = sideSymbol(leg.side);
  const prop = formatPropLabel(leg.prop_type, 'short');
  const actual = leg.actual_value != null ? ` → ${leg.actual_value}` : '';
  return `${icon} ${emoji} ${bold(leg.player_name)} ${side}${leg.line} ${prop}${actual}`;
}
