// Soft-angle linter — ported from external repo. Deterministic rules + auto-rewrite.
import type { VideoScript } from "./tiktok-types.ts";

type Severity = "hard_fail" | "auto_rewrite" | "warn";
interface LintRule { pattern: RegExp; replacement: string | null; severity: Severity; reason: string; }

const RULES: LintRule[] = [
  { pattern: /\b(draftkings|fanduel|caesars|betmgm|bovada|pointsbet|bet365|unibet|barstool sportsbook)\b/gi,
    replacement: null, severity: "hard_fail", reason: "Named sportsbook triggers TikTok gambling filter" },
  { pattern: /\bplace a (bet|wager)\b/gi, replacement: "look at this number", severity: "auto_rewrite", reason: "Explicit betting action" },
  { pattern: /\b(bet|wager) (on|the)\b/gi, replacement: "look at the", severity: "auto_rewrite", reason: "Explicit betting action" },
  { pattern: /\b(betting|wagering)\b/gi, replacement: "picking", severity: "auto_rewrite", reason: "Betting terminology" },
  { pattern: /\b(sportsbook|sportsbooks)\b/gi, replacement: "the number", severity: "auto_rewrite", reason: "Sportsbook reference" },
  { pattern: /\bparlay(s)?\b/gi, replacement: "combo", severity: "auto_rewrite", reason: "Parlay is a betting-specific term" },
  { pattern: /\b(lock|locks)\b/gi, replacement: "strong read", severity: "auto_rewrite", reason: "Lock implies guaranteed bet" },
  { pattern: /\bguaranteed\b/gi, replacement: "high-confidence", severity: "auto_rewrite", reason: "Guarantees are regulated" },
  { pattern: /\b(sure thing|can'?t lose|free money|money in the bank)\b/gi, replacement: "standout pattern", severity: "auto_rewrite", reason: "Implied guarantee" },
  { pattern: /[+\-]\d{3,4}\b/g, replacement: "", severity: "auto_rewrite", reason: "American odds trigger gambling filters" },
  { pattern: /\b\d+\/\d+ odds?\b/gi, replacement: "", severity: "auto_rewrite", reason: "Fractional odds format" },
  { pattern: /\b(\d+)\s*units?\b/gi, replacement: "$1% conviction", severity: "auto_rewrite", reason: "Units are betting-specific sizing" },
  { pattern: /\bhammer this\b/gi, replacement: "back this pattern", severity: "auto_rewrite", reason: "Hammer implies heavy bet" },
  { pattern: /\bfade (him|her|them|this|that)\b/gi, replacement: "stay away from $1", severity: "auto_rewrite", reason: "Fade is betting terminology" },
  { pattern: /\b(dm me|dm for picks|message for picks)\b/gi, replacement: "check the link in bio", severity: "auto_rewrite", reason: "DM-for-picks is a classic promo flag" },
  { pattern: /\bmy picks\b/gi, replacement: "what the data shows", severity: "auto_rewrite", reason: "Framing as personal picks triggers filters" },
  { pattern: /\btailing\b/gi, replacement: "following the pattern", severity: "auto_rewrite", reason: "Tailing = copying bets" },
  { pattern: /\bgambling\b/gi, replacement: null, severity: "warn", reason: "Gambling mentioned directly" },
  { pattern: /\baction\b/gi, replacement: null, severity: "warn", reason: "Action may mean betting action" },
];

export interface LintResult {
  rejected: boolean;
  rejection_reasons: string[];
  score: number;
  transforms: Array<{ from: string; to: string; beat_index: number; reason: string }>;
  warnings: Array<{ text: string; beat_index: number; reason: string }>;
}

export function lintAndRewrite(script: VideoScript): LintResult {
  const result: LintResult = { rejected: false, rejection_reasons: [], score: 100, transforms: [], warnings: [] };
  const surfaces: Array<{ label: string; get: () => string; set: (v: string) => void; beat_index: number }> = [
    { label: "hook", get: () => script.hook.vo_text, set: (v) => { script.hook.vo_text = v; }, beat_index: -1 },
    { label: "cta_vo", get: () => script.cta.vo_text, set: (v) => { script.cta.vo_text = v; }, beat_index: -2 },
    { label: "cta_ost", get: () => script.cta.on_screen_text, set: (v) => { script.cta.on_screen_text = v; }, beat_index: -2 },
    { label: "caption", get: () => script.caption_seed, set: (v) => { script.caption_seed = v; }, beat_index: -3 },
  ];
  for (let i = 0; i < script.beats.length; i++) {
    const beat = script.beats[i];
    surfaces.push({ label: `beat_${i}_vo`, get: () => beat.vo_text, set: (v) => { beat.vo_text = v; }, beat_index: i });
    if (beat.on_screen_text) {
      surfaces.push({ label: `beat_${i}_ost`, get: () => beat.on_screen_text || "", set: (v) => { beat.on_screen_text = v; }, beat_index: i });
    }
  }

  for (const surface of surfaces) {
    let text = surface.get();
    for (const rule of RULES) {
      const matches = text.match(rule.pattern);
      if (!matches || matches.length === 0) continue;
      if (rule.severity === "hard_fail") {
        result.rejected = true;
        result.rejection_reasons.push(`${surface.label}: ${rule.reason} ("${matches[0]}")`);
        continue;
      }
      if (rule.severity === "auto_rewrite" && rule.replacement !== null) {
        const before = text;
        text = text.replace(rule.pattern, rule.replacement);
        if (before !== text) {
          for (const match of matches) {
            result.transforms.push({ from: match, to: rule.replacement, beat_index: surface.beat_index, reason: rule.reason });
            result.score -= 5;
          }
        }
      }
      if (rule.severity === "warn") {
        for (const match of matches) {
          result.warnings.push({ text: match, beat_index: surface.beat_index, reason: rule.reason });
          result.score -= 2;
        }
      }
    }
    text = text.replace(/\s+/g, " ").trim();
    text = text.replace(/\s+([.,!?])/g, "$1");
    text = text.replace(/\(\s*\)/g, "");
    surface.set(text);
  }
  result.score = Math.max(0, result.score);
  return result;
}

export function softAnglePromptAddendum(): string {
  return `
STRICT LANGUAGE RULES — violating these will cause rejection:
- NEVER name any sportsbook (DraftKings, FanDuel, Caesars, BetMGM, etc.)
- NEVER use: "bet", "wager", "betting", "sportsbook", "parlay", "lock", "guaranteed", "sure thing"
- NEVER use explicit odds like "+150" or "-110"
- NEVER use "my picks" — say "what the data shows" or "the pattern the model surfaced"
- NEVER say "DM me" or "tail my plays"

USE INSTEAD:
- "combo" or "stack" instead of "parlay"
- "the number looks low/high" instead of "bet the over/under"
- "high confidence" instead of "lock" or "guaranteed"
- "stay away from" instead of "fade"
- "look at the data on" instead of "bet on"
- "check the link in bio" instead of "DM me"

The framing is: you are a DATA ANALYST sharing a pattern you noticed, NOT a bettor sharing a pick.
You describe what the NUMBERS say about a player or game — the viewer decides what to do with that.`;
}
