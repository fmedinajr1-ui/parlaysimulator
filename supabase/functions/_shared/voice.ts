// _shared/voice.ts
// The bot's personality. Every customer-facing message passes through here.
// Single voice, consistent tone, time-of-day aware, references earlier messages.

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

// ─── Greetings by time of day ────────────────────────────────────────────

const GREETINGS: Record<TimeOfDay, string[]> = {
  late_night: ['Late check-in.', 'Burning the midnight oil.'],
  early_morning: ['Morning.', 'Good morning.', 'Up early.'],
  morning: ['Morning.', 'Alright, here we go.', "Let's get into it."],
  midday: ["Mid-day check.", 'Slate update.', "Here's where we are."],
  afternoon: ['Afternoon read.', 'Heads up.', 'Quick note.'],
  evening: ['Evening.', "Pre-game thoughts.", 'Games up soon.'],
  night: ['Wrap-up time.', "End of day.", "Here's how it went."],
};

/** Returns a context-appropriate greeting. Rotates to feel varied. */
export function greeting(at: Date = new Date()): string {
  const tod = timeOfDay(at);
  const options = GREETINGS[tod];
  const idx = Math.floor((at.getTime() / 1000 / 60) % options.length); // rotates every minute
  return options[idx];
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

// ─── Confidence language ─────────────────────────────────────────────────
// Convert a 0-100 score into words a customer actually internalizes.

export function confidenceWord(confidence: number): string {
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
// Telegram Markdown is fussy. Player names with underscores or asterisks
// crash parsing. We escape defensively for user-generated content.

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
// Rather than free-form concatenation, use `msg()` to build up sections
// with consistent spacing. Every major message uses this.

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
// Every major message starts with something that situates the reader in the
// day. These are small but they sell the "this is a person who's been here
// all day" effect.

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
