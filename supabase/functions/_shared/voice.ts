// _shared/voice.ts
// The bot's personality. Every customer-facing message passes through here.
// Single voice, consistent tone, time-of-day aware, references earlier messages,
// and now: form-aware (hot/cold streak), stake-aware, conviction-scaled.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { DayPhase } from './constants.ts';
import { etTime, timeOfDay, TimeOfDay } from './date-et.ts';

// ─── Core identity ────────────────────────────────────────────────────────
// Rules of the voice:
//   1. First person. "I like", "I'm watching", "I was wrong."
//   2. Contractions. "I'm", "don't", "that's."
//   3. Specific over vague. "averaging 28.4" not "trending up."
//   4. Acknowledge uncertainty. Every pick has a risk note.
//   5. Time-aware. Morning is energetic, settlement is honest.
//   6. No corporate words: "leverage", "utilize", "optimize."
//   7. Short sentences mixed with longer explanatory ones.
//   8. Form-aware. Hot streak → confident swagger. Cold → tightened up.
//   9. Stake-honest. Says exactly how much real money is on the line.

// ─── Greetings by time of day ────────────────────────────────────────────

const GREETINGS: Record<TimeOfDay, string[]> = {
  late_night: ['Late check-in.', 'Burning the midnight oil.', 'Quiet hours, but still scanning.'],
  early_morning: ['Morning.', 'Good morning.', 'Up early.', 'Coffee on, screens up.'],
  morning: ['Morning.', 'Alright, here we go.', "Let's get into it.", 'Slate is cooking.'],
  midday: ["Mid-day check.", 'Slate update.', "Here's where we are.", 'Lines are settling.'],
  afternoon: ['Afternoon read.', 'Heads up.', 'Quick note.', 'Tip-off creeping up.'],
  evening: ['Evening.', "Pre-game thoughts.", 'Games up soon.', 'Almost showtime.'],
  night: ['Wrap-up time.', "End of day.", "Here's how it went.", 'Books are closing.'],
};

/** Returns a context-appropriate greeting. Rotates to feel varied. */
export function greeting(at: Date = new Date()): string {
  const tod = timeOfDay(at);
  const options = GREETINGS[tod];
  const idx = Math.floor((at.getTime() / 1000 / 60) % options.length); // rotates every minute
  return options[idx];
}

// ─── Form-aware openings ──────────────────────────────────────────────────
// Threaded into dawn brief and pick drops so the bot acknowledges its current run.

export type BotForm = 'hot' | 'neutral' | 'cold' | 'ice_cold';

const FORM_OPENERS: Record<BotForm, string[]> = {
  hot: [
    "Riding hot. Last week's been kind.",
    "Last 7 days have been clean. Pressing slightly.",
    "On a run. Sticking with what's working.",
    "Numbers are popping. Don't get cute — just keep playing the model.",
  ],
  neutral: [
    "Standard day. Playing it as it comes.",
    "Neither hot nor cold. Flat-sized.",
    "Even keel. The slate decides.",
  ],
  cold: [
    "Tightening up after a rough patch.",
    "Cold lately. Cutting stake size, not skipping the day.",
    "Down a bit on the week. Playing smaller until things turn.",
    "Recent variance hasn't been kind. Staying disciplined.",
  ],
  ice_cold: [
    "Ugly stretch. Stakes way down, ego way down.",
    "Bleeding. Tiny tickets only until I'm proven right again.",
    "Worst run in a while. Survival mode — small bets, sharp picks.",
  ],
};

export function formOpener(form: BotForm, seed: string = ''): string {
  const options = FORM_OPENERS[form];
  let h = 0;
  const s = seed || new Date().toISOString().slice(0, 10);
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return options[Math.abs(h) % options.length];
}

/** Bankroll one-liner for dawn brief. */
export function bankrollLine(state: {
  current_bankroll: number;
  starting_bankroll: number;
  last_7d_pnl: number;
}): string {
  const pnl = state.last_7d_pnl;
  const sign = pnl >= 0 ? '+' : '';
  const dir = pnl >= 0 ? 'up' : 'down';
  const abs = Math.abs(Math.round(pnl));
  if (Math.abs(pnl) < 50) {
    return `Sitting at $${Math.round(state.current_bankroll).toLocaleString()}. Roughly flat on the week.`;
  }
  return `Sitting at $${Math.round(state.current_bankroll).toLocaleString()}, ${dir} $${abs.toLocaleString()} on the week (${sign}${pnl.toFixed(0)}).`;
}

// ─── Verdict language for settlements ────────────────────────────────────

/** A richer verdict than "won X, lost Y". Takes a win-rate and context. */
export function settlementVerdict(winRate: number, totalParlays: number): string {
  if (totalParlays === 0) return "Quiet day — nothing settled.";
  if (winRate >= 75) return "Outstanding. Nearly everything hit.";
  if (winRate >= 60) return "Strong day. System is working.";
  if (winRate >= 50) return "Grinder. We came out on top.";
  if (winRate >= 40) return "Mixed bag. Some edges landed, some didn't.";
  if (winRate >= 25) return "Rough. Variance caught up with us.";
  return "Ugly day. Let's learn from it and move on.";
}

// ─── Confidence language (conviction-scaled) ──────────────────────────────
// Replaces flat label with something a customer actually internalizes.

export function confidenceWord(confidence: number): string {
  if (confidence >= 90) return 'highest-conviction';
  if (confidence >= 85) return 'lock-level';
  if (confidence >= 75) return 'strong';
  if (confidence >= 65) return 'solid';
  if (confidence >= 55) return 'lean';
  return 'dart throw';
}

export function confidenceSentence(confidence: number): string {
  const word = confidenceWord(confidence);
  return `${Math.round(confidence)}/100 — ${word}`;
}

/** Conviction-scaled opinion line. Drops into pick cards. */
export function convictionLine(confidence: number, seed: string = ''): string {
  const buckets: Array<[number, string[]]> = [
    [90, [
      "This is the highest conviction play I've had in a week.",
      "If I'm wrong on this, my model is broken.",
      "Top of the card. Period.",
    ]],
    [80, [
      "I'm all over this.",
      "Big confidence. Sized it accordingly.",
      "This is the one I like most today.",
      "Free money until the line moves.",
    ]],
    [70, [
      "Strong lean. Sized accordingly.",
      "Solid spot. Worth a real stake.",
      "I like this one — enough to size up.",
    ]],
    [60, [
      "Worth a small stake to track.",
      "Lower conviction — sizing reflects that.",
      "Toe in the water. Just enough to care.",
      "Small dart. Not betting the house.",
    ]],
    [0, [
      "Tiny shot. Mostly a tracker.",
      "Just enough to follow the result.",
    ]],
  ];
  const bucket = buckets.find(([t]) => confidence >= t)!;
  const options = bucket[1];
  let h = 0;
  const s = seed || String(Math.round(confidence));
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return options[Math.abs(h) % options.length];
}

// ─── Stake language ───────────────────────────────────────────────────────
// Translates a raw dollar stake into a one-line description with attitude.

export function stakeDescription(amount: number, tier: 'execution' | 'validation' | 'exploration'): string {
  const dollar = `$${amount}`;
  switch (tier) {
    case 'execution':
      return `Putting real money behind it — ${bold(dollar)} on this one.`;
    case 'validation':
      return `Mid-tier stake at ${bold(dollar)}. Confident, not reckless.`;
    case 'exploration':
      return `Small dart at ${bold(dollar)} — testing the read, not betting the house.`;
  }
}

// ─── Skip explanations ────────────────────────────────────────────────────
// Honest one-liners for picks the curator passed on.

export function passReasonPhrase(reason: string): string {
  const r = reason.toLowerCase();
  if (r.includes('correlated')) return `🔁 ${reason} — didn't want to double-up.`;
  if (r.includes('exposure cap')) return `🛡️ ${reason} — risk budget already spent.`;
  if (r.includes('tier full')) return `📦 ${reason} — saving a slot for sharper spots.`;
  if (r.includes('below exploration')) return `🚫 ${reason} — not enough edge to justify.`;
  if (r.includes('cold')) return `🥶 ${reason}`;
  return `⏭️ ${reason}`;
}

// ─── Signature signoffs by time of day ────────────────────────────────────

const SIGNOFFS: Record<TimeOfDay, string[]> = {
  late_night: ['Stay sharp.', 'Catch you tomorrow.'],
  early_morning: ['Let\'s eat.', 'Good luck out there.'],
  morning: ['Let\'s eat.', 'Game on.', 'Make it a day.'],
  midday: ['Track it live.', 'Holding the line.'],
  afternoon: ['Lock it in.', 'Game time approaching.'],
  evening: ['Lights out.', 'Lock and load.', 'Ride or die.'],
  night: ['GG.', 'Onto tomorrow.', 'See you at sunrise.'],
};

export function signoff(at: Date = new Date()): string {
  const tod = timeOfDay(at);
  const options = SIGNOFFS[tod];
  const idx = Math.floor((at.getTime() / 1000 / 60 / 7) % options.length);
  return options[idx];
}

// ─── Callback to earlier messages ────────────────────────────────────────
// Pulls a recent message by reference_key so the bot can say
// "remember this morning I said X? well..."

export async function loadCallback(
  sb: SupabaseClient,
  referenceKey: string,
  withinHours: number = 24
): Promise<{ text_preview: string; sent_at: string } | null> {
  const cutoff = new Date(Date.now() - withinHours * 3600 * 1000).toISOString();
  const { data } = await sb
    .from('bot_message_log')
    .select('text_preview, sent_at')
    .eq('reference_key', referenceKey)
    .eq('success', true)
    .gte('sent_at', cutoff)
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

/** Renders a "callback sentence" if a prior message exists for this key. */
export async function callbackPhrase(
  sb: SupabaseClient,
  referenceKey: string,
  template: (priorTime: string) => string
): Promise<string> {
  const prior = await loadCallback(sb, referenceKey);
  if (!prior) return '';
  const priorTime = etTime(new Date(prior.sent_at));
  return template(priorTime);
}

// ─── Markdown safety ─────────────────────────────────────────────────────

/** Escape a string so it's safe to drop into Telegram *Markdown* mode. */
export function escapeMd(s: string | null | undefined): string {
  if (s == null) return '';
  return String(s).replace(/([_*`\[\]])/g, '\\$1');
}

/** Wraps text in bold, auto-escaping inner content. */
export function bold(s: string | null | undefined): string {
  return `*${escapeMd(s)}*`;
}

/** Wraps text in italics, auto-escaping inner content. */
export function italic(s: string | null | undefined): string {
  return `_${escapeMd(s)}_`;
}

// ─── Structured message builder ──────────────────────────────────────────

export class MessageBuilder {
  private parts: string[] = [];
  private parseMode: 'Markdown' | 'HTML' = 'Markdown';

  header(text: string, emoji?: string): this {
    const line = emoji ? `${emoji} *${escapeMd(text)}*` : `*${escapeMd(text)}*`;
    this.parts.push(line);
    this.parts.push('━━━━━━━━━━━━━━━━━━━');
    return this;
  }

  /** Short label-value line like `*Label:* value`. */
  kv(label: string, value: string | number | null | undefined): this {
    if (value === null || value === undefined || value === '') return this;
    this.parts.push(`*${escapeMd(label)}:* ${escapeMd(String(value))}`);
    return this;
  }

  line(text: string): this {
    this.parts.push(text);
    return this;
  }

  /** Adds a blank line separator. */
  blank(): this {
    this.parts.push('');
    return this;
  }

  /** Adds an italic aside. */
  aside(text: string): this {
    this.parts.push(italic(text));
    return this;
  }

  /** Appends a section with heading. */
  section(heading: string, body: string | string[]): this {
    this.parts.push('');
    this.parts.push(`*${escapeMd(heading)}*`);
    const lines = Array.isArray(body) ? body : [body];
    for (const l of lines) this.parts.push(l);
    return this;
  }

  raw(s: string): this {
    this.parts.push(s);
    return this;
  }

  build(): string {
    return this.parts.join('\n').replace(/\n{3,}/g, '\n\n');
  }
}

// ─── Narrative-phase prefixes ────────────────────────────────────────────

export function phasePrefix(phase: DayPhase, at: Date = new Date()): string {
  const time = etTime(at);
  switch (phase) {
    case 'dawn_brief': return `${greeting(at)} ${time}.`;
    case 'slate_lock': return `Slate's locked in at ${time}.`;
    case 'pick_drops': return ``; // no prefix — picks speak for themselves
    case 'pre_game_pulse': return `Pre-game update, ${time}.`;
    case 'live_tracker': return `Live update, ${time}.`;
    case 'settlement_story': return `Day's done, ${time}.`;
    case 'tomorrow_tease': return `One last note before bed.`;
  }
}

// ─── Short phrases for reuse ─────────────────────────────────────────────

export const PHRASES = {
  confidence_high: [
    "I'm all over this",
    "This is the one I like most today",
    "Free money until the line moves",
    "Highest conviction on the card",
  ],
  confidence_mid: [
    "I like this one",
    "Solid spot",
    "Enough edge to play",
    "Worth a stake",
  ],
  confidence_low: [
    "Small dart",
    "Worth a look",
    "Lower conviction — size accordingly",
    "If you want action",
  ],
  risk_present: [
    "One thing I'm watching:",
    "What could kill it:",
    "Be aware:",
    "Risk note:",
  ],
  admit_wrong: [
    "Pulling this — was wrong.",
    "This one's off — new info.",
    "Scratch that.",
    "Changed my mind:",
  ],
};

/** Deterministic phrase picker — same input always yields same phrase. */
export function pickPhrase(bucket: keyof typeof PHRASES, seed: string): string {
  const options = PHRASES[bucket];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
  return options[Math.abs(h) % options.length];
}

/** Deterministic random pick from a generic array — same seed → same item. */
export function pickRandom<T>(options: T[], seed: string = ''): T {
  if (options.length === 0) throw new Error('pickRandom: empty options');
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
  return options[Math.abs(h) % options.length];
}

// ─── Humor layer ──────────────────────────────────────────────────────────
// Wraps every alert with personality. Deterministic per seed so retries match.

const HUMOR_OPENERS: string[] = [
  "Bookies hate this one trick.",
  "Found another mispricing while you were sleeping.",
  "The line moved. I noticed. You're welcome.",
  "Saw this from a mile away.",
  "Here's one the market hasn't caught up to yet.",
  "Buckle in.",
  "Pen's out, ink's wet.",
  "The model just lit up.",
  "Numbers don't lie. Sometimes. Mostly.",
  "Caught one cooking.",
  "This one's been brewing all morning.",
  "Sometimes the bookmakers blink. This is one of those times.",
  "Tape doesn't lie.",
  "Edge spotted. Filing the paperwork.",
  "Hot off the algorithm.",
  "If I'm wrong, I'll buy the next round.",
  "Betting against the public again. Sue me.",
  "The sharp side just showed itself.",
  "Stop me if you've heard this one before — actually, don't.",
  "Math says yes. Vibes say yes. We're good.",
  "Quick one before the line moves.",
  "Keeping it short. Action's about to start.",
  "This is the kind of spot I live for.",
  "Trust the process. Or don't. Either way, here it is.",
  "I'd write a longer note but the line is moving.",
  "Every dog has its day. This dog has today.",
  "The fade is on the public. As usual.",
  "Lining up the sharps with the data.",
  "Three coffees in. Seeing things clearly.",
  "Numbers cleaned up. Picks loaded.",
];

const HUMOR_CLOSERS: string[] = [
  "Cash it.",
  "This one's free. The next one costs.",
  "Don't tell your accountant.",
  "I'll be here all night.",
  "Tell your friends. Or don't — keep the edge.",
  "Onto the next.",
  "Ride it out.",
  "Lock and load.",
  "Nothing to see here. Move along to the betting slip.",
  "Tip your bot.",
  "Confidence: high. Sleep: optional.",
  "Worst case: I was wrong. Best case: tacos.",
  "If this hits, we're going to dinner.",
  "Saved you the homework. Place the bet.",
  "Variance is real. So is this edge.",
  "Books are fading. Press the advantage.",
  "Cashier's open.",
  "Run it.",
  "Bet small enough that you can keep playing tomorrow.",
  "Process over results. But also: results.",
  "I do my best work between coffees.",
  "Books closing soon. Move.",
  "Don't bet what you can't afford. Then bet a little more.",
  "Sleep is for people who don't have edges.",
  "Tomorrow's recap will be fun either way.",
  "The model has spoken.",
  "Let the slate cook.",
  "Make it count.",
  "Stay sharp out there.",
  "GLHF.",
];

const HUMOR_COLD: string[] = [
  "Last 3 days: rough. Doubling the homework, halving the stakes.",
  "Even the algorithm has bad nights. Sizing down.",
  "Rough patch. Trusting the process, shrinking the bets.",
  "Bleeding a bit. Tiny tickets only.",
  "Cold streak. The math still works — variance just doesn't care this week.",
  "Down week. Cutting size, not corners.",
  "Tightening the screws after a tough run.",
  "Survival mode. Small bets, sharp picks.",
  "Bad week, smaller week. That's the discipline.",
  "Fading my own enthusiasm until the wins come back.",
  "Variance is undefeated this week. Respecting it.",
  "Three losing days. Staying patient, staying small.",
  "Don't chase. The model knows. The variance is temporary.",
  "Rough stretch. Treating every dollar like the last one.",
  "Discipline beats panic. Small stakes until the run breaks.",
];

const HUMOR_HOT: string[] = [
  "5 of 6 yesterday. Pressing the advantage.",
  "Riding it until the wheels fall off.",
  "Hot week. Not getting cute though.",
  "Numbers popping. Stakes following.",
  "Best week in a while. Compounding while it lasts.",
  "Up big. Sticking to the process — no ego adds.",
  "On a heater. Sized up but not stupid.",
  "Streak's alive. Riding it.",
  "Books are paying. I'm cashing.",
  "Three winning days running. Press, but smart.",
  "Every leg cashing. I won't ask why, just keep playing.",
  "Hot hand. Not jinxing it.",
  "Edge widened. Stake widened.",
  "Money's coming in. Calling it, sizing up.",
  "Tape's been kind. Pressing the bet.",
];

/** Deterministic humor opener — same seed → same line. */
export function humorOpener(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
  return HUMOR_OPENERS[Math.abs(h) % HUMOR_OPENERS.length];
}

/** Deterministic humor closer, with form-aware tilt. */
export function humorCloser(seed: string, form: BotForm = 'neutral'): string {
  if (form === 'cold' || form === 'ice_cold') {
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
    return HUMOR_COLD[Math.abs(h) % HUMOR_COLD.length];
  }
  if (form === 'hot') {
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
    return HUMOR_HOT[Math.abs(h) % HUMOR_HOT.length];
  }
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
  return HUMOR_CLOSERS[Math.abs(h) % HUMOR_CLOSERS.length];
}

/** One-line accuracy badge for a hit rate. Used in pick cards + alert headers. */
export function accuracyPhrase(hitRate: number, sampleSize: number = 0): string {
  const pct = Math.round(hitRate * 100);
  const ss = sampleSize > 0 ? ` (${sampleSize})` : '';
  if (hitRate >= 0.70) return `🔥 hitting ${pct}% L7${ss} — sizing up territory`;
  if (hitRate >= 0.60) return `📈 ${pct}% L7${ss} — solid signal type`;
  if (hitRate >= 0.50) return `📊 ${pct}% L7${ss} — middle of the road`;
  if (hitRate >= 0.42) return `⚠️ ${pct}% L7${ss} — fade-only territory`;
  return `🚫 ${pct}% L7${ss} — bleeding signal, sit out`;
}

/** Form-aware verdict for the daily accuracy pulse message. */
export function pulseVerdict(hotCount: number, coldCount: number, totalTracked: number): string {
  if (totalTracked === 0) return "Not enough data to call it. Playing the slate as it comes.";
  if (hotCount >= 3 && coldCount === 0) return "Green light across the board. Press the advantage.";
  if (hotCount >= 2) return "Mostly green. Lean into the hot signal types, fade the rest.";
  if (coldCount >= 3) return "Tap the brakes today. Most signals are cooling off.";
  if (hotCount > coldCount) return "More hot than cold. Standard size, slight lean to the hot ones.";
  if (coldCount > hotCount) return "More cold than hot. Sizing down across the board.";
  return "Mixed bag. Standard size, sharp picks only.";
}
