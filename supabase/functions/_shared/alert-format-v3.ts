// _shared/alert-format-v3.ts
//
// The v3 alert renderer. Every customer-facing alert flows through this so
// the entire bot speaks in one consistent visual rhythm:
//
//   🏀 STRIKE · 87% · LeBron O25.5 PTS         ← glance line
//   ━━━━━━━━━━━━━━━━━
//   {body, max ~5 lines, voice + drivers + recency}
//   ━━━━━━━━━━━━━━━━━
//   📈 L7: 73% (12) · Line: -110 → -118 · Tip: 2h14m
//   💵 $150 · 3% bankroll · validation tier
//   _Closer line._
//
// Inputs are intentionally loose — every field is optional so legacy
// generators that only have a raw string still get a usable card.

import type { AlertAccuracy, StakeAdvice } from './accuracy-lookup.ts';
import type { LineContext, GameContext } from './alert-context.ts';
import type { BotForm } from './voice.ts';
import { humorCloser, escapeMd } from './voice.ts';
import { formatPriceMove, formatLineMove } from './alert-context.ts';

export type AlertTier = 'STRIKE' | 'WATCH' | 'DART' | 'FADE' | 'SKIP';

export interface AlertCardV3Input {
  /** Required free-form body text (the actual alert content). */
  body: string;
  /** Sport key/name. Used for emoji + accent. e.g. 'NBA', 'basketball_nba'. */
  sport?: string | null;
  /** Short headline shown on the glance line. e.g. "LeBron O25.5 PTS". */
  headline?: string | null;
  /** Confidence 0-100. */
  confidence?: number | null;
  /** Tier override. If omitted, derived from stake.tier or confidence. */
  tier?: AlertTier;

  accuracy?: AlertAccuracy | null;
  stake?: StakeAdvice | null;
  bankroll?: number | null;

  line?: LineContext | null;
  game?: GameContext | null;

  /** Bot's current form for mood emoji + closer voice. */
  form?: BotForm;
  /** Stable seed so retries render identical text. */
  seed?: string;
}

const SPORT_EMOJI: Record<string, string> = {
  nba: '🏀', basketball: '🏀', basketball_nba: '🏀', wnba: '🏀', basketball_wnba: '🏀',
  ncaab: '🏀', basketball_ncaab: '🏀',
  nfl: '🏈', americanfootball_nfl: '🏈', ncaaf: '🏈', americanfootball_ncaaf: '🏈',
  mlb: '⚾', baseball_mlb: '⚾',
  nhl: '🏒', icehockey_nhl: '🏒',
  soccer: '⚽', mls: '⚽',
  tennis: '🎾', tennis_atp: '🎾', tennis_wta: '🎾',
  golf: '⛳', pga: '⛳',
  mma: '🥊', mma_mixed_martial_arts: '🥊', ufc: '🥊',
  boxing: '🥊',
  esports: '🎮',
};

const FORM_EMOJI: Record<BotForm, string> = {
  hot: '🔥',
  neutral: '✅',
  cold: '⚠️',
  ice_cold: '🥶',
};

const TIER_LABEL: Record<AlertTier, string> = {
  STRIKE: 'STRIKE',
  WATCH: 'WATCH',
  DART: 'DART',
  FADE: 'FADE',
  SKIP: 'SKIP',
};

/** Map raw tier strings + confidence to a v3 tier verb. */
export function deriveTier(input: {
  tier?: AlertTier | string;
  stakeTier?: string;
  confidence?: number | null;
}): AlertTier {
  if (input.tier && (TIER_LABEL as any)[input.tier]) return input.tier as AlertTier;
  const t = (input.stakeTier || input.tier || '').toLowerCase();
  if (t === 'execution') return 'STRIKE';
  if (t === 'validation') return 'WATCH';
  if (t === 'exploration') return 'DART';
  if (t === 'skip') return 'SKIP';
  if (t === 'fade') return 'FADE';
  const c = input.confidence ?? 0;
  if (c >= 80) return 'STRIKE';
  if (c >= 65) return 'WATCH';
  if (c >= 50) return 'DART';
  return 'WATCH';
}

function sportEmoji(sport: string | null | undefined): string {
  if (!sport) return '🎯';
  const k = sport.toLowerCase().replace(/[^a-z_]/g, '');
  // Try direct, then strip trailing tokens
  if (SPORT_EMOJI[k]) return SPORT_EMOJI[k];
  for (const key of Object.keys(SPORT_EMOJI)) {
    if (k.includes(key)) return SPORT_EMOJI[key];
  }
  return '🎯';
}

/** Zone 1 — single line, scan-readable. */
export function glanceLine(input: {
  tier: AlertTier;
  sport?: string | null;
  confidence?: number | null;
  headline?: string | null;
  form?: BotForm;
}): string {
  const sEmoji = sportEmoji(input.sport);
  const fEmoji = input.form ? FORM_EMOJI[input.form] : '';
  const conf = input.confidence != null ? `${Math.round(input.confidence)}%` : '—';
  const head = (input.headline || '').trim().slice(0, 42); // hard truncate
  const lead = fEmoji ? `${sEmoji}${fEmoji}` : sEmoji;
  const parts = [`${lead} *${input.tier}*`, conf];
  if (head) parts.push(escapeMd(head));
  return parts.join(' · ');
}

/** Zone 3 — context strip (accuracy + line move + tip). */
export function contextStrip(input: {
  accuracy?: AlertAccuracy | null;
  line?: LineContext | null;
  game?: GameContext | null;
}): string | null {
  const bits: string[] = [];

  const a = input.accuracy;
  if (a && a.l7_hit_rate != null && (a.sample_size_l7 ?? 0) >= 3) {
    bits.push(`📈 L7 ${Math.round(a.l7_hit_rate * 100)}% (${a.sample_size_l7})`);
  }

  const l = input.line;
  if (l) {
    const lineMove = formatLineMove(l.openLine, l.currentLine);
    const priceMove = formatPriceMove(l.openPrice, l.currentPrice);
    if (lineMove) bits.push(`Line ${lineMove}`);
    else if (priceMove) bits.push(`Price ${priceMove}`);
  }

  const g = input.game;
  if (g?.tipDisplay) bits.push(`⏱ ${g.tipDisplay}`);

  if (bits.length === 0) return null;
  return bits.join(' · ');
}

/** Zone 4 — stake strip ($X · Y% bankroll · tier). */
export function stakeStrip(stake: StakeAdvice | null | undefined, bankroll: number | null | undefined): string | null {
  if (!stake) return null;
  if (stake.tier === 'skip' || stake.stake === 0) {
    return `⏭️ *Skip* — ${escapeMd(stake.reasoning)}`;
  }
  const pct = bankroll && bankroll > 0
    ? `${((stake.stake / bankroll) * 100).toFixed(1)}% bankroll`
    : null;
  const right = [pct, `${stake.tier} tier`].filter(Boolean).join(' · ');
  return `💵 *$${stake.stake}*${right ? ` · ${right}` : ''}\n_${escapeMd(stake.reasoning)}_`;
}

const DIVIDER = '━━━━━━━━━━━━━━━━━';

/** The full 4-zone renderer. Always returns a usable Markdown string. */
export function renderAlertCardV3(input: AlertCardV3Input): string {
  const tier = deriveTier({
    tier: input.tier,
    stakeTier: input.stake?.tier,
    confidence: input.confidence ?? undefined,
  });

  const glance = glanceLine({
    tier,
    sport: input.sport,
    confidence: input.confidence,
    headline: input.headline,
    form: input.form,
  });

  const ctx = contextStrip({
    accuracy: input.accuracy,
    line: input.line,
    game: input.game,
  });
  const stk = stakeStrip(input.stake, input.bankroll);

  const closer = `_${humorCloser(input.seed || input.body.slice(0, 40), input.form ?? 'neutral')}_`;

  const sections: string[] = [glance, DIVIDER, input.body.trim()];
  if (ctx || stk) {
    sections.push(DIVIDER);
    if (ctx) sections.push(ctx);
    if (stk) sections.push(stk);
  }
  sections.push(closer);

  return sections.join('\n').replace(/\n{3,}/g, '\n\n');
}

// ─── Headline extraction (for legacy raw-text alerts) ──────────────────────
//
// Best-effort regex parser that pulls a 6–8-token headline out of an arbitrary
// alert body. Looks for player + side + line + prop. If nothing matches, just
// returns the first sentence trimmed to ~42 chars.

const PROP_TOKEN = /\b(PTS|REB|AST|3PT|TPT|PRA|PR|PA|RA|HITS|TB|HR|RBI|SO|K|YDS|TD|REC|RUSH|PASS|SOG|SAVES|GOALS|ASSISTS|ACES|GAMES|SETS)\b/i;
const LINE_TOKEN = /\b([oOuU]|OVER|UNDER)\s*(\d+\.?\d*)\b/;

export function extractHeadline(raw: string): string | null {
  if (!raw) return null;
  const flat = raw.replace(/\*|_|`|\[|\]/g, '').replace(/\s+/g, ' ').trim();

  // Pattern: "Player Name OVER 25.5 PTS"
  const lineMatch = flat.match(LINE_TOKEN);
  const propMatch = flat.match(PROP_TOKEN);
  if (lineMatch && propMatch) {
    // Look back for 1–3 capitalized words before the line token
    const beforeIdx = flat.indexOf(lineMatch[0]);
    const before = flat.slice(0, beforeIdx).trim().split(/\s+/);
    const nameTokens: string[] = [];
    for (let i = before.length - 1; i >= 0 && nameTokens.length < 3; i--) {
      const t = before[i].replace(/[^A-Za-z\.\-']/g, '');
      if (!t) break;
      if (/^[A-Z][a-z]+|^[A-Z]\.?$/.test(t)) nameTokens.unshift(t);
      else break;
    }
    const name = nameTokens.join(' ');
    const side = lineMatch[1].toUpperCase().startsWith('O') ? 'O' : 'U';
    const out = `${name} ${side}${lineMatch[2]} ${propMatch[0].toUpperCase()}`.trim();
    if (out.length >= 6) return out;
  }

  // Fallback: first sentence
  const first = flat.split(/[.!?\n]/)[0].trim();
  return first ? first.slice(0, 42) : null;
}

/** Best-effort sport extraction from raw text. */
export function extractSport(raw: string): string | null {
  const flat = raw.toUpperCase();
  const order = ['NBA', 'WNBA', 'NCAAB', 'NCAAF', 'NFL', 'MLB', 'NHL', 'MMA', 'UFC', 'PGA', 'GOLF', 'TENNIS', 'SOCCER'];
  for (const s of order) if (flat.includes(s)) return s;
  return null;
}