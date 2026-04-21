// _shared/parlayfarm-format.ts
//
// ParlayFarm Telegram message renderer — "Track Sharps. Tail Winners. 🐕"
//
// All output is MarkdownV2. Every helper here escapes user-supplied data via
// mdv2Escape() before splicing it into the body.
//
// Templates:
//   #1 renderWelcome           /start landing
//   #2 renderSharpSteam        velocity_spike / cascade / line_about_to_move
//   #3 renderTrapFlag          trap_warning, sharp/public split
//   #4 renderRLM               reverse line movement
//   #5 renderSlipVerdict       grade-slip result
//   #6 renderDailyDigest       morning recap cron
//   #7 renderBatchDigest       >3 alerts in 60s
//   #8 renderStickyHeader      pinned channel status
//   #9 renderErrorNoRead       OCR / engine bailout
//   #10 renderCTAFooter        free-tier upsell
//   #11 renderSettings         /settings
//
// Plus a back-compat `renderAlertCardV3()` shim so existing call sites that
// passed AlertCardV3Input keep working — the shim routes by signal_type.

export type SignalType =
  | 'velocity_spike' | 'live_velocity_spike'
  | 'cascade' | 'live_cascade'
  | 'line_about_to_move'
  | 'trap_warning'
  | 'reverse_line_movement'
  | string;

const MDV2_SPECIALS = /[_*\[\]()~`>#+\-=|{}.!\\]/g;

/** Escape a single string segment for MarkdownV2. */
export function mdv2Escape(s: string | number | null | undefined): string {
  if (s == null) return '';
  return String(s).replace(MDV2_SPECIALS, (ch) => `\\${ch}`);
}

/** 10-char █/▒ progress bar (0–100). */
export function confBar(pct: number): string {
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  const filled = Math.round(p / 10);
  return '█'.repeat(filled) + '▒'.repeat(10 - filled);
}

export function divider(): string {
  return '━'.repeat(23);
}

/** "🐕 *TYPE* · SPORT · STATE" */
export function headerLine(opts: {
  emoji?: string;
  type: string;
  sport?: string | null;
  state?: string | null;
}): string {
  const emoji = opts.emoji ?? '🐕';
  const parts = [`${emoji} *${mdv2Escape(opts.type.toUpperCase())}*`];
  if (opts.sport) parts.push(mdv2Escape(opts.sport.toUpperCase()));
  if (opts.state) parts.push(opts.state); // pre-escaped emoji+text like "🔴 LIVE"
  return parts.join(' · ');
}

// ─── Inline keyboard taxonomy (matches the spec's Button copy library) ─────

export interface InlineButton {
  text: string;
  callback_data?: string;
  url?: string;
}
export type InlineKeyboard = InlineButton[][];

export const Buttons = {
  tail: (id: string, price?: string | number): InlineButton =>
    ({ text: price != null ? `🐕 Tail (${price})` : '🐕 Tail it', callback_data: `tail:${id}` }),
  fade: (id: string): InlineButton => ({ text: '❌ Fade', callback_data: `fade:${id}` }),
  fullScan: (id: string): InlineButton => ({ text: '📊 Full scan', callback_data: `scan:${id}` }),
  mutePlayer: (playerId: string): InlineButton => ({ text: '🔕 Mute player', callback_data: `mute:player:${playerId}` }),
  muteMarket: (marketId: string): InlineButton => ({ text: '🔕 Mute this market', callback_data: `mute:market:${marketId}` }),
  muteBatch: (batchId: string): InlineButton => ({ text: '🔕 Mute batch', callback_data: `mute:batch:${batchId}` }),
  openTracker: (): InlineButton => ({ text: '🐕 Open the Tracker', callback_data: 'open:tracker' }),
  uploadSlip: (): InlineButton => ({ text: '📤 Upload my slip', callback_data: 'slip:upload' }),
  uploadAnother: (): InlineButton => ({ text: '📤 Upload another', callback_data: 'slip:upload' }),
  useSharperPlay: (slipId: string): InlineButton => ({ text: '🐕 Use sharper play', callback_data: `slip:swap:${slipId}` }),
  alertOn: (key: string, label: string): InlineButton => ({ text: `🔔 Alert me on ${label}`, callback_data: `alert:${key}` }),
  startTrial: (): InlineButton => ({ text: '🐕 Start 7-day free trial', callback_data: 'plan:trial' }),
  comparePlans: (): InlineButton => ({ text: '📊 Compare plans', callback_data: 'plan:compare' }),
  settings: (): InlineButton => ({ text: '⚙️ Settings', callback_data: 'settings:open' }),
  liveSharpAction: (): InlineButton => ({ text: '🐕 See live sharp action', callback_data: 'feed:live' }),
  gradeSlip: (): InlineButton => ({ text: '📤 Grade a slip', callback_data: 'slip:upload' }),
  pasteLegs: (): InlineButton => ({ text: '⌨️ Paste legs as text', callback_data: 'slip:paste' }),
  human: (): InlineButton => ({ text: '💬 Talk to a human', callback_data: 'support:human' }),
  tailAll: (ids: string[]): InlineButton => ({ text: `🐕 Tail all ${ids.length}`, callback_data: `tail:bulk:${ids.join(',')}` }),
  pauseToday: (): InlineButton => ({ text: '🔕 Pause for today', callback_data: 'pause:today' }),
  expandBatch: (batchId: string, n: number): InlineButton => ({ text: `📋 See all ${n}`, callback_data: `batch:expand:${batchId}` }),
  tailTop3: (batchId: string): InlineButton => ({ text: '🐕 Tail top 3', callback_data: `batch:tail3:${batchId}` }),
  tryAnother: (): InlineButton => ({ text: '📤 Try another screenshot', callback_data: 'slip:retry' }),
  // settings sub-menus
  sportsCfg: (): InlineButton => ({ text: '🏀 Sports', callback_data: 'settings:sports' }),
  booksCfg: (): InlineButton => ({ text: '📚 Books', callback_data: 'settings:books' }),
  thresholdsCfg: (): InlineButton => ({ text: '📊 Thresholds', callback_data: 'settings:thresholds' }),
  quietHoursCfg: (): InlineButton => ({ text: '🌙 Quiet hours', callback_data: 'settings:quiet' }),
  digestTimeCfg: (): InlineButton => ({ text: '📬 Digest time', callback_data: 'settings:digest' }),
  batchRulesCfg: (): InlineButton => ({ text: '🧱 Batch rules', callback_data: 'settings:batch' }),
  deleteData: (): InlineButton => ({ text: '❌ Delete my data', callback_data: 'settings:delete' }),
};

export interface RenderedMessage {
  message: string;
  parse_mode: 'MarkdownV2';
  reply_markup?: { inline_keyboard: InlineKeyboard };
}

function withKeyboard(message: string, kb?: InlineKeyboard): RenderedMessage {
  return {
    message,
    parse_mode: 'MarkdownV2',
    reply_markup: kb && kb.length > 0 ? { inline_keyboard: kb } : undefined,
  };
}

// ─── #1 Welcome ────────────────────────────────────────────────────────────

export function renderWelcome(): RenderedMessage {
  const body = [
    '🐕 *Welcome to the pack*',
    '',
    '_Track Sharps · Tail Winners_',
    '',
    "You're in\\. The farm will ping you when:",
    ' ▸ Sharps move a line against the public',
    ' ▸ A trap prop gets flagged',
    ' ▸ Steam hits a market you follow',
    ' ▸ Your uploaded slip gets graded',
    '',
    divider(),
    '*Quick commands*',
    ' 📤  Send any slip screenshot — we grade it',
    ' 🐕  /tail    live sharp action',
    ' 📊  /today   top dog picks today',
    ' 📥  /slip    submit a slip',
    ' ⚙️  /settings  sports, books, noise level',
    '',
    '_Farm rules: 21\\+\\. Nothing here is a guarantee\\. Bet smart\\._',
  ].join('\n');
  return withKeyboard(body, [
    [Buttons.liveSharpAction(), Buttons.gradeSlip()],
    [Buttons.settings()],
  ]);
}

// ─── #2 Sharp steam ────────────────────────────────────────────────────────

export interface SharpSteamInput {
  id: string;
  player: string;
  market: string;        // e.g. "PTS + AST"
  book: string;
  league: string;
  state?: string;        // "🔴 LIVE", "PREGAME", "FINAL", or ET tipoff
  lineOpen: number | string;
  lineNow: number | string;
  direction: '↑' | '↓' | '→';
  speed?: number | string;
  windowMin?: number;
  confidence: number;
  play: string;          // e.g. "UNDER 21.5"
  altLine?: string | null;
  reasoning: string;
  price?: string | number;
  playerId?: string;
}

export function renderSharpSteam(s: SharpSteamInput): RenderedMessage {
  const state = s.state ?? '🔴 LIVE';
  const speedTxt = s.speed != null
    ? `${s.speed}/hr · ${s.windowMin ?? 10} min`
    : '—';
  const altTxt = s.altLine ? mdv2Escape(s.altLine) : '—';

  // Aligned monospace block. Bold inside backticks requires close/reopen.
  const body = [
    headerLine({ emoji: '🐕', type: 'SHARP STEAM', sport: s.league, state }),
    divider(),
    `*${mdv2Escape(s.player)}* · ${mdv2Escape(s.market)}`,
    `_${mdv2Escape(s.book)}_`,
    '',
    '`Line        ' + mdv2Escape(s.lineOpen) + '  →  `*`' + mdv2Escape(s.lineNow) + '`*` ' + s.direction + '`',
    '`Speed       ' + mdv2Escape(speedTxt) + '`',
    '`Confidence  ' + mdv2Escape(s.confidence) + '%   ' + confBar(s.confidence) + '`',
    '`Play        `*`' + mdv2Escape(s.play) + '`*',
    '`Alt line    ' + altTxt + '`',
    '',
    `🐾 _${mdv2Escape(s.reasoning)}_`,
  ].join('\n');

  const kb: InlineKeyboard = [
    [Buttons.tail(s.id, s.price), Buttons.fade(s.id)],
    [Buttons.fullScan(s.id), s.playerId ? Buttons.mutePlayer(s.playerId) : Buttons.muteMarket(s.id)],
  ];
  return withKeyboard(body, kb);
}

// ─── #3 Trap flag ──────────────────────────────────────────────────────────

export interface TrapFlagInput {
  id: string;
  player: string;
  market: string;        // "O 1.5 HR"
  book: string;
  league: string;
  state?: string;        // "PREGAME"
  publicPct: number;
  sharpPct: number;
  cashRatePct: number;
  cashRateLabel?: string; // "at this price, 30-day"
  reasoning: string;
}

export function renderTrapFlag(t: TrapFlagInput): RenderedMessage {
  const body = [
    headerLine({ emoji: '❌', type: 'TRAP FLAG', sport: t.league, state: t.state ?? 'PREGAME' }),
    divider(),
    `*${mdv2Escape(t.player)}* · ${mdv2Escape(t.market)}`,
    `_${mdv2Escape(t.book)}_`,
    '',
    '`Public     ' + mdv2Escape(t.publicPct) + '%   ' + confBar(t.publicPct) + '`',
    '`Sharp      ' + mdv2Escape(t.sharpPct) + '%   ' + confBar(t.sharpPct) + '`',
    '`Cash rate  ' + mdv2Escape(t.cashRatePct) + '%   ' + mdv2Escape(t.cashRateLabel ?? 'at this price') + '`',
    '',
    `🐾 _${mdv2Escape(t.reasoning)}_`,
  ].join('\n');
  const kb: InlineKeyboard = [
    [{ text: '❌ Fade', callback_data: `fade:${t.id}` }, Buttons.tail(t.id)],
    [Buttons.fullScan(t.id)],
  ];
  return withKeyboard(body, kb);
}

// ─── #4 Reverse line movement ──────────────────────────────────────────────

export interface RLMInput {
  id: string;
  matchup: string;       // "Cowboys @ Eagles · Total"
  league: string;
  state?: string;        // "Sun 4:25 ET"
  lineOpen: number | string;
  lineNow: number | string;
  direction: '↑' | '↓';
  publicPct: number;
  publicSide: string;    // "OVER"
  actionLine: string;    // "The book lowered against the public."
  reasoning: string;
  tailLabel: string;     // "Under 48.5"
}

export function renderRLM(r: RLMInput): RenderedMessage {
  const body = [
    headerLine({ emoji: '⚡', type: 'REVERSE LINE MOVEMENT', sport: r.league, state: r.state ?? null }),
    divider(),
    `*${mdv2Escape(r.matchup)}*`,
    '',
    '`Line       ' + mdv2Escape(r.lineOpen) + '  →  `*`' + mdv2Escape(r.lineNow) + '`*`    ' + r.direction + '`',
    '`Public     ' + mdv2Escape(r.publicPct) + '% on ' + mdv2Escape(r.publicSide) + '`',
    '`Action    ' + mdv2Escape(r.actionLine) + '`',
    '',
    `🐾 _${mdv2Escape(r.reasoning)}_`,
  ].join('\n');
  const kb: InlineKeyboard = [
    [{ text: `🐕 Tail ${r.tailLabel}`, callback_data: `tail:${r.id}` }, Buttons.fullScan(r.id)],
  ];
  return withKeyboard(body, kb);
}

// ─── #4b Cascade ────────────────────────────────────────────────────────────

export interface CascadeInput {
  id: string;
  player: string;
  league: string;
  state?: string;
  movedProps: string[];      // already-moved markets
  pendingProps: string[];    // markets expected to follow
  confidence: number;
  reasoning: string;
  playerId?: string;
}

export function renderCascade(c: CascadeInput): RenderedMessage {
  const moved = c.movedProps.length ? c.movedProps.map(mdv2Escape).join(', ') : '—';
  const pending = c.pendingProps.length ? c.pendingProps.map(mdv2Escape).join(', ') : '—';
  const body = [
    headerLine({ emoji: '🌊', type: 'CASCADE', sport: c.league, state: c.state ?? '🔴 LIVE' }),
    divider(),
    `*${mdv2Escape(c.player)}*`,
    '',
    '`Moved       ' + moved + '`',
    '`Pending     ' + pending + '`',
    '`Confidence  ' + mdv2Escape(c.confidence) + '%   ' + confBar(c.confidence) + '`',
    '`Play        `*`Grab pending props NOW`*',
    '',
    `🐾 _${mdv2Escape(c.reasoning)}_`,
  ].join('\n');
  const kb: InlineKeyboard = [
    [Buttons.tail(c.id), Buttons.fade(c.id)],
    [Buttons.fullScan(c.id), c.playerId ? Buttons.mutePlayer(c.playerId) : Buttons.muteMarket(c.id)],
  ];
  return withKeyboard(body, kb);
}

// ─── #4c Correlated movement / team news shift ─────────────────────────────

export interface CorrelatedMoveInput {
  id: string;
  matchup: string;        // "Lakers @ Celtics — POINTS"
  league: string;
  state?: string;
  isNews?: boolean;       // true → 📰 TEAM NEWS SHIFT, false → 🔗 CORRELATED
  itemsMoving: number;
  itemsLabel: string;     // "players" | "games"
  direction: 'dropping' | 'rising';
  correlationPct: number;
  topMoves: string[];     // 3-4 lines, plain text — escaped here
  confidence: number;
  play: string;           // e.g. "UNDER 8.5"
  reasoning: string;
}

export function renderCorrelatedMove(c: CorrelatedMoveInput): RenderedMessage {
  const emoji = c.isNews ? '📰' : '🔗';
  const label = c.isNews ? 'TEAM NEWS SHIFT' : 'CORRELATED MOVEMENT';
  const dirArrow = c.direction === 'dropping' ? '↓' : '↑';
  const lines = [
    headerLine({ emoji, type: label, sport: c.league, state: c.state ?? null }),
    divider(),
    `*${mdv2Escape(c.matchup)}*`,
    '',
    '`' + mdv2Escape(c.itemsMoving) + ' ' + mdv2Escape(c.itemsLabel) + ' moving ' + dirArrow + '   ' + mdv2Escape(c.correlationPct) + '% aligned`',
    '`Confidence  ' + mdv2Escape(c.confidence) + '%   ' + confBar(c.confidence) + '`',
    '`Play        `*`' + mdv2Escape(c.play) + '`*',
    '',
  ];
  for (const m of c.topMoves.slice(0, 4)) lines.push(`▸ ${mdv2Escape(m)}`);
  lines.push('', `🐾 _${mdv2Escape(c.reasoning)}_`);
  const kb: InlineKeyboard = [
    [Buttons.tail(c.id), Buttons.fade(c.id)],
    [Buttons.fullScan(c.id), Buttons.muteMarket(c.id)],
  ];
  return withKeyboard(lines.join('\n'), kb);
}

// ─── Behavior alert router ────────────────────────────────────────────────
//
// Given a raw `behavior_alerts` row (the in-memory shape produced by
// fanduel-behavior-analyzer / fanduel-prediction-alerts), pick the right
// ParlayFarm template and return a fully-rendered MarkdownV2 message + kb.

export interface BehaviorAlertLike {
  id?: string;
  type: string;
  sport?: string | null;
  player_name?: string | null;
  event_description?: string | null;
  event_id?: string | null;
  prop_type?: string | null;
  line_from?: number | string | null;
  line_to?: number | string | null;
  opening_line?: number | string | null;
  current_line?: number | string | null;
  direction?: 'dropping' | 'rising' | string | null;
  velocity?: number | string | null;
  time_span_min?: number | null;
  consistencyRate?: number | null;
  confidence?: number | null;
  is_live?: boolean | null;
  moved_props?: string[];
  pending_props?: string[];
  players_moving?: Array<{ name: string; direction?: string; magnitude?: string }>;
  dominant_direction?: 'dropping' | 'rising' | string | null;
  correlation_rate?: number | null;
  derived_from?: string | null;
}

function prettyProp(p?: string | null): string {
  if (!p) return '';
  return String(p).replace(/^player[_\s]/i, '').replace(/_/g, ' ').toUpperCase();
}

export function renderBehaviorAlert(a: BehaviorAlertLike, idOverride?: string): RenderedMessage {
  const id = idOverride ?? a.id ?? `${a.event_id ?? 'evt'}_${a.player_name ?? 'p'}_${a.prop_type ?? 'pt'}`.replace(/\s+/g, '_');
  const league = a.sport ?? null;
  const state = a.is_live ? '🔴 LIVE' : 'PREGAME';
  const conf = Math.round(Number(a.confidence ?? 50));
  const player = a.player_name ?? a.event_description ?? 'Unknown';
  const market = prettyProp(a.prop_type);
  const direction = (a.direction === 'dropping' || a.direction === 'rising') ? a.direction : 'dropping';
  const arrow: '↑' | '↓' | '→' = direction === 'dropping' ? '↓' : direction === 'rising' ? '↑' : '→';
  const isTeamMarket = ['h2h', 'moneyline', 'spreads', 'totals'].includes(String(a.prop_type ?? '').toLowerCase());

  // Action / play computation matches the legacy analyzer logic
  const computePlay = (): string => {
    if (isTeamMarket && (a.prop_type === 'h2h' || a.prop_type === 'moneyline')) {
      return direction === 'dropping' ? `BACK ${player}` : `FADE ${player}`;
    }
    if (isTeamMarket && a.prop_type === 'spreads') {
      return direction === 'dropping' ? `TAKE ${player} SPREAD` : `FADE ${player} SPREAD`;
    }
    if (isTeamMarket && a.prop_type === 'totals') {
      return direction === 'dropping' ? `UNDER ${a.line_to ?? a.current_line ?? ''}`.trim() : `OVER ${a.line_to ?? a.current_line ?? ''}`.trim();
    }
    const lineNow = a.line_to ?? a.current_line ?? '';
    return direction === 'dropping' ? `UNDER ${lineNow}`.trim() : `OVER ${lineNow}`.trim();
  };

  switch (a.type) {
    case 'cascade':
    case 'live_cascade':
      return renderCascade({
        id,
        player,
        league: league ?? '',
        state,
        movedProps: (a.moved_props ?? []).map(prettyProp),
        pendingProps: (a.pending_props ?? []).map(prettyProp),
        confidence: conf,
        reasoning: 'Related props follow within 5–15 min. Grab the pending side now.',
      });

    case 'correlated_movement':
    case 'team_news_shift': {
      const isNews = a.type === 'team_news_shift';
      const moves = (a.players_moving ?? []).slice(0, 4).map((p: any) => `${p.name}: ${p.direction ?? ''} ${p.magnitude ?? ''}`.trim());
      const dir = (a.dominant_direction === 'rising' ? 'rising' : 'dropping') as 'dropping' | 'rising';
      const itemsLabel = isTeamMarket || a.derived_from === 'team_market_cross_game' ? 'games' : 'players';
      const play = dir === 'dropping' ? (isNews ? 'UNDER (follow news)' : 'OVER (fade trap)') : (isNews ? 'OVER (follow news)' : 'UNDER (fade trap)');
      const reasoning = isNews
        ? `${a.players_moving?.length ?? 0} ${itemsLabel} shifting ${dir} = likely real news. Following the move.`
        : `Coordinated ${dir} move below news threshold — fade as potential public trap.`;
      return renderCorrelatedMove({
        id,
        matchup: `${a.event_description ?? player} — ${prettyProp(a.prop_type)}`,
        league: league ?? '',
        state,
        isNews,
        itemsMoving: a.players_moving?.length ?? 0,
        itemsLabel,
        direction: dir,
        correlationPct: Number(a.correlation_rate ?? 0),
        topMoves: moves,
        confidence: conf,
        play,
        reasoning,
      });
    }

    case 'trap_warning':
      return renderTrapFlag({
        id,
        player,
        market,
        book: 'FanDuel',
        league: league ?? '',
        state,
        publicPct: Math.round(Number((a as any).public_pct ?? 70)),
        sharpPct: Math.round(Number((a as any).sharp_pct ?? 25)),
        cashRatePct: Math.round(Number((a as any).cash_rate_pct ?? 0)),
        cashRateLabel: 'at this price, 30-day',
        reasoning: 'Public-heavy with low historical cash rate — trap risk.',
      });

    case 'reverse_line_movement':
      return renderRLM({
        id,
        matchup: `${a.event_description ?? player} · ${prettyProp(a.prop_type)}`,
        league: league ?? '',
        state: a.is_live ? '🔴 LIVE' : undefined,
        lineOpen: a.line_from ?? a.opening_line ?? '—',
        lineNow: a.line_to ?? a.current_line ?? '—',
        direction: arrow === '→' ? '↓' : (arrow as '↑' | '↓'),
        publicPct: Math.round(Number((a as any).public_pct ?? 70)),
        publicSide: direction === 'dropping' ? 'OVER' : 'UNDER',
        actionLine: 'Book moved against the public.',
        reasoning: 'Reverse line movement — sharps overriding public flow.',
        tailLabel: computePlay(),
      });

    // Sharp steam family — velocity / line-about-to-move / take-it-now / snapback
    default: {
      const speed = a.velocity ?? null;
      const win = a.time_span_min ?? null;
      let reasoning = '';
      if (a.type === 'velocity_spike' || a.type === 'live_velocity_spike') {
        reasoning = direction === 'dropping' ? 'Line dropping fast. Sharps are on the under.' : 'Line rising fast. Sharps are on the over.';
      } else if (a.type === 'line_about_to_move' || a.type === 'live_line_about_to_move') {
        reasoning = direction === 'dropping' ? 'Steady drift down — sharps building UNDER.' : 'Steady drift up — sharps building OVER.';
      } else if (a.type === 'take_it_now') {
        reasoning = 'Drift exceeds typical range — grab this price before correction.';
      } else if (a.type === 'snapback') {
        reasoning = 'Line moved too far — expect reversion.';
      } else {
        reasoning = `Sharp signal: ${a.type}.`;
      }
      return renderSharpSteam({
        id,
        player,
        market,
        book: 'FanDuel',
        league: league ?? '',
        state,
        lineOpen: a.line_from ?? a.opening_line ?? '—',
        lineNow: a.line_to ?? a.current_line ?? '—',
        direction: arrow,
        speed: speed ?? undefined,
        windowMin: win ?? undefined,
        confidence: conf,
        play: computePlay(),
        reasoning,
      });
    }
  }
}

// ─── #5 Slip verdict ───────────────────────────────────────────────────────

export type LegStatus = 'green' | 'yellow' | 'red';
export interface SlipLeg {
  status: LegStatus;
  text: string;
  note?: string;
}
export interface SlipVerdictInput {
  slipId: string;
  legCount: number;
  book: string;
  stake: number | string;
  payout: number | string;
  verdict: 'TOP DOG' | 'MIXED' | 'TRAP' | string;
  verdictEmoji?: string;     // "✅" / "⚠️" / "❌"
  verdictTagline: string;    // "keep with swaps"
  score: number;             // 0-100
  legs: SlipLeg[];
  sharperPlayLines: string[];
}

const LEG_EMOJI: Record<LegStatus, string> = {
  green: '✅',
  yellow: '⚠️',
  red: '❌',
};

export function renderSlipVerdict(v: SlipVerdictInput): RenderedMessage {
  const verdictEmoji = v.verdictEmoji ?? (v.verdict === 'TOP DOG' ? '✅' : v.verdict === 'TRAP' ? '❌' : '⚠️');
  const headerStr = `${v.legCount}-leg parlay · ${v.book} · $${v.stake} → $${v.payout}`;
  const lines = [
    '🐕 *The farm read your slip*',
    '',
    `_${mdv2Escape(headerStr)}_`,
    `Verdict  ${verdictEmoji} *${mdv2Escape(v.verdict)}* — ${mdv2Escape(v.verdictTagline)}`,
    '`Score    ' + mdv2Escape(Math.round(v.score)) + ' / 100   ' + confBar(v.score) + '`',
    '',
    '━━━  *LEGS*  ━━━',
  ];
  for (const leg of v.legs) {
    const noteSuffix = leg.note ? ` · ${mdv2Escape(leg.note)}` : '';
    lines.push(`${LEG_EMOJI[leg.status]} ${mdv2Escape(leg.text)}${noteSuffix}`);
  }
  lines.push('');
  lines.push('━━━  *SHARPER PLAY*  ━━━');
  for (const l of v.sharperPlayLines) lines.push(mdv2Escape(l));

  const kb: InlineKeyboard = [
    [Buttons.useSharperPlay(v.slipId), Buttons.uploadAnother()],
    [Buttons.fullScan(v.slipId)],
  ];
  return withKeyboard(lines.join('\n'), kb);
}

// ─── #6 Daily digest ───────────────────────────────────────────────────────

export interface DailyDigestPlay {
  rank: number;
  text: string;       // "Celtics -5.5 (-108)"
  meta: string;       // "82% sharp · NBA 7:30 ET"
}
export interface DailyDigestInput {
  dateLabel: string;  // "Mon Apr 20"
  signalsFired: number;
  cashed: number;
  cashedPct: number;
  steamMoves: number;
  trapsCalled: number;
  trapsHit: number;
  topPlays: DailyDigestPlay[];
  watchlist: string[];
}

export function renderDailyDigest(d: DailyDigestInput): RenderedMessage {
  const lines = [
    `🐕 *Morning from the farm* · ${mdv2Escape(d.dateLabel)}`,
    '',
    '*Pack stats · 24 hr*',
    ` 🎯  ${mdv2Escape(d.signalsFired)} signals fired`,
    ` ✅  ${mdv2Escape(d.cashed)} cashed · ${mdv2Escape(d.cashedPct)}%`,
    ` ⚡  ${mdv2Escape(d.steamMoves)} steam moves`,
    ` ❌  ${mdv2Escape(d.trapsCalled)} traps called · ${mdv2Escape(d.trapsHit)} fell`,
    '',
    '━━━  *TOP DOG PLAYS TODAY*  ━━━',
    '',
  ];
  for (const p of d.topPlays) {
    lines.push('`' + String(p.rank).padEnd(2) + ' ' + p.text.padEnd(22).slice(0, 22) + '` · ' + mdv2Escape(p.meta));
  }
  if (d.watchlist.length) {
    lines.push('');
    lines.push('━━━  *WATCHLIST*  ━━━');
    for (const w of d.watchlist) lines.push(`• ${mdv2Escape(w)}`);
  }
  lines.push('');
  lines.push("🐾 _The farm never sleeps\\. Tap in when you're ready\\._");

  const tailIds = d.topPlays.map(p => String(p.rank));
  const kb: InlineKeyboard = [
    [Buttons.tailAll(tailIds), Buttons.openTracker()],
    [Buttons.uploadSlip(), Buttons.pauseToday()],
  ];
  return withKeyboard(lines.join('\n'), kb);
}

// ─── #7 Batch digest ───────────────────────────────────────────────────────

export interface BatchDigestEntry {
  rank: number;
  player: string;     // "Scottie Barnes U21.5"
  meta: string;       // "95% · line 23.5→21.5 ↓  NBA"
}
export interface BatchDigestInput {
  batchId: string;
  totalSignals: number;
  windowMin: number;
  velocityCount: number;
  trapCount: number;
  steamCount: number;
  correlatedCount: number;
  reverseCount: number;
  top: BatchDigestEntry[];
  reasoning: string;
}

export function renderBatchDigest(b: BatchDigestInput): RenderedMessage {
  const lines = [
    `🐕 *${mdv2Escape(b.totalSignals)} sharp moves* · last ${mdv2Escape(b.windowMin)} min`,
    divider(),
    '`⚡ ' + String(b.velocityCount).padEnd(3) + ' velocity   🎯 ' + String(b.trapCount).padEnd(3) + ' traps`',
    '`🌊 ' + String(b.steamCount).padEnd(3) + ' steam       🔗 ' + String(b.correlatedCount).padEnd(3) + ' correlated`',
    '`🔄 ' + String(b.reverseCount).padEnd(3) + ' reverses`',
    '',
    '*Top 3 right now*',
    '',
  ];
  for (const e of b.top.slice(0, 3)) {
    lines.push('`' + String(e.rank).padEnd(2) + ' ' + e.player.padEnd(22).slice(0, 22) + '` · ' + mdv2Escape(e.meta));
  }
  lines.push('');
  lines.push(`🐾 _${mdv2Escape(b.reasoning)}_`);

  const kb: InlineKeyboard = [
    [Buttons.expandBatch(b.batchId, b.totalSignals), Buttons.tailTop3(b.batchId)],
    [Buttons.muteBatch(b.batchId), Buttons.openTracker()],
  ];
  return withKeyboard(lines.join('\n'), kb);
}

// ─── #8 Sticky header ──────────────────────────────────────────────────────

export interface StickyHeaderInput {
  velocity: number;
  traps: number;
  steam: number;
  correlated: number;
  reverses: number;
  newScans: number;
  liveSports: string[];
  books: string[];
  quietHours: string;   // "2a–8a ET"
}

export function renderStickyHeader(h: StickyHeaderInput): RenderedMessage {
  const body = [
    '🐕 *ParlayFarm* · sharp feed',
    '_Track Sharps · Tail Winners_',
    '',
    '*Last 60 min*',
    '`⚡ velocity  ' + String(h.velocity).padEnd(3) + '    🎯 traps      ' + String(h.traps).padEnd(3) + '`',
    '`🌊 steam     ' + String(h.steam).padEnd(3) + '    🔗 correlated ' + String(h.correlated).padEnd(3) + '`',
    '`🔄 reverses  ' + String(h.reverses).padEnd(3) + '    📊 new scans ' + String(h.newScans).padEnd(3) + '`',
    '',
    `Live: ${mdv2Escape(h.liveSports.join(' · '))}`,
    `Books: ${mdv2Escape(h.books.join(' · '))}`,
    `Quiet hours: ${mdv2Escape(h.quietHours)}`,
  ].join('\n');
  return withKeyboard(body);
}

// ─── #9 Error / no read ────────────────────────────────────────────────────

export function renderErrorNoRead(): RenderedMessage {
  const body = [
    "🐾 *The farm couldn't read your slip*",
    '',
    'Usually one of:',
    ' • Screenshot cut off at the top or bottom',
    ' • Book not supported yet \\(DK / FD / MGM / Caesars only\\)',
    ' • Image is a photo\\-of\\-a\\-screen \\(glare\\)',
    '',
    "Try again with a full screenshot — or paste legs as text and we'll take it from there\\.",
  ].join('\n');
  const kb: InlineKeyboard = [
    [Buttons.tryAnother(), Buttons.pasteLegs()],
    [Buttons.human()],
  ];
  return withKeyboard(body, kb);
}

// ─── #10 CTA footer ────────────────────────────────────────────────────────

export function renderCTAFooter(): RenderedMessage {
  const body = [
    "🐕 *Like what the farm's catching?*",
    '',
    '*Top Dog membership* · $29/mo · 7\\-day free',
    ' ✓ Unlimited slip scans',
    ' ✓ Full live Sharp Tracker in here',
    ' ✓ Priority barn alerts',
    ' ✓ Trap \\+ correlation flags',
  ].join('\n');
  const kb: InlineKeyboard = [
    [Buttons.startTrial(), Buttons.comparePlans()],
  ];
  return withKeyboard(body, kb);
}

// ─── #11 Settings ──────────────────────────────────────────────────────────

export interface SettingsInput {
  sports: string[];
  books: string[];
  minSharpPct: number;
  minConfPct: number;
  quietHours: string;     // "2:00a – 8:00a ET"
  digestTime: string;     // "9:00a ET"
  digestOn: boolean;
  batchRule: string;      // ">3 signals / 60s → digest"
}

export function renderSettings(s: SettingsInput): RenderedMessage {
  const body = [
    '⚙️ *Farm settings*',
    '',
    '`Sports        ' + mdv2Escape(s.sports.join(' · ')) + '`',
    '`Books         ' + mdv2Escape(s.books.join(' · ')) + '`',
    '`Min sharp %   ' + mdv2Escape(s.minSharpPct) + '%`',
    '`Min conf      ' + mdv2Escape(s.minConfPct) + '%`',
    '`Quiet hours   ' + mdv2Escape(s.quietHours) + '`',
    '`Digest        ' + (s.digestOn ? 'on' : 'off') + ' · ' + mdv2Escape(s.digestTime) + '`',
    '`Batch mode    ' + mdv2Escape(s.batchRule) + '`',
  ].join('\n');
  const kb: InlineKeyboard = [
    [Buttons.sportsCfg(), Buttons.booksCfg()],
    [Buttons.thresholdsCfg(), Buttons.quietHoursCfg()],
    [Buttons.digestTimeCfg(), Buttons.batchRulesCfg()],
    [Buttons.deleteData()],
  ];
  return withKeyboard(body, kb);
}

// ─── Compatibility shim for legacy alert-format-v3 callers ────────────────
//
// The old enricher built an AlertCardV3Input and called renderAlertCardV3().
// We accept the same shape, route by signal_type / tier, and produce the
// closest ParlayFarm template. If we can't recognize the signal, we fall back
// to a minimal Sharp-Steam-styled card so generators never see an exception.

export interface AlertCardV3InputCompat {
  body: string;
  sport?: string | null;
  headline?: string | null;
  confidence?: number | null;
  tier?: string;
  signal_type?: string;
  accuracy?: any;
  stake?: any;
  bankroll?: number | null;
  line?: { openLine?: number; currentLine?: number } | null;
  game?: { tipDisplay?: string } | null;
  form?: string;
  seed?: string;
}

/**
 * Compat entry point. Returns a MarkdownV2 string (no keyboard) so existing
 * call sites that just `body.message = renderAlertCardV3(...)` keep working.
 * For the keyboard, callers should migrate to the typed renderers above.
 */
export function renderAlertCardV3(input: AlertCardV3InputCompat): string {
  const sig = (input.signal_type ?? '').toLowerCase();
  const headline = (input.headline ?? '').trim();
  const conf = input.confidence ?? 50;

  // Sharp steam family
  if (
    sig.includes('velocity') ||
    sig.includes('cascade') ||
    sig === 'line_about_to_move'
  ) {
    return [
      headerLine({ emoji: '🐕', type: 'SHARP STEAM', sport: input.sport, state: '🔴 LIVE' }),
      divider(),
      headline ? `*${mdv2Escape(headline)}*` : '',
      `\`Confidence  ${conf}%   ${confBar(conf)}\``,
      '',
      mdv2Escape(input.body.trim()),
    ].filter(Boolean).join('\n');
  }

  if (sig.includes('trap')) {
    return [
      headerLine({ emoji: '❌', type: 'TRAP FLAG', sport: input.sport, state: 'PREGAME' }),
      divider(),
      headline ? `*${mdv2Escape(headline)}*` : '',
      '',
      mdv2Escape(input.body.trim()),
    ].filter(Boolean).join('\n');
  }

  if (sig.includes('reverse')) {
    return [
      headerLine({ emoji: '⚡', type: 'REVERSE LINE MOVEMENT', sport: input.sport }),
      divider(),
      headline ? `*${mdv2Escape(headline)}*` : '',
      '',
      mdv2Escape(input.body.trim()),
    ].filter(Boolean).join('\n');
  }

  // Generic fallback — use ParlayFarm chrome but keep the original body
  return [
    headerLine({ emoji: '🐕', type: input.tier?.toUpperCase() ?? 'SIGNAL', sport: input.sport }),
    divider(),
    headline ? `*${mdv2Escape(headline)}*` : '',
    `\`Confidence  ${conf}%   ${confBar(conf)}\``,
    '',
    mdv2Escape(input.body.trim()),
  ].filter(Boolean).join('\n');
}

/** Legacy helpers kept so existing imports don't explode. */
export function extractHeadline(raw: string): string | null {
  if (!raw) return null;
  const flat = raw.replace(/\*|_|`|\[|\]/g, '').replace(/\s+/g, ' ').trim();
  const first = flat.split(/[.!?\n]/)[0].trim();
  return first ? first.slice(0, 60) : null;
}

export function extractSport(raw: string): string | null {
  const flat = raw.toUpperCase();
  for (const s of ['NBA', 'WNBA', 'NCAAB', 'NCAAF', 'NFL', 'MLB', 'NHL', 'MMA', 'UFC', 'PGA', 'GOLF', 'TENNIS', 'SOCCER']) {
    if (flat.includes(s)) return s;
  }
  return null;
}

export function deriveTier(input: { tier?: string; stakeTier?: string; confidence?: number }): string {
  if (input.tier) return input.tier;
  if (input.stakeTier) {
    if (input.stakeTier === 'execution') return 'STRIKE';
    if (input.stakeTier === 'validation') return 'WATCH';
    if (input.stakeTier === 'exploration') return 'DART';
    if (input.stakeTier === 'skip') return 'SKIP';
  }
  const c = input.confidence ?? 0;
  if (c >= 80) return 'STRIKE';
  if (c >= 65) return 'WATCH';
  return 'DART';
}
