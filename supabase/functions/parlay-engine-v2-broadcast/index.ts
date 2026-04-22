// ============================================================================
// parlay-engine-v2-broadcast — Phase C
// Broadcasts parlays from bot_daily_parlays to a Telegram chat (@parlayiqbot).
// Optionally generates first via parlay-engine-v2, dedupes via
// bot_parlay_broadcasts, and respects HTML / rate limits.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { etDateKey } from "../_shared/date-et.ts";
import { BOOK_TAG } from "../_shared/parlay-engine-v2/config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ----- Types ----------------------------------------------------------------

interface Leg {
  player_name?: string | null;
  player?: string | null;
  prop_type?: string | null;
  prop?: string | null;
  side?: string | null;
  line?: number | string | null;
  current_line?: number | string | null;
  threshold?: number | string | null;
  american_odds?: number | string | null;
  price?: number | string | null;
  odds?: number | string | null;
  sport?: string | null;
  confidence?: number | null;
  signal_source?: string | null;
  projected?: number | null;
  selected_book?: string | null;
}

interface ParlayRow {
  id: string;
  parlay_date: string;
  strategy_name: string;
  tier: string | null;
  legs: Leg[];
  leg_count: number;
  combined_probability: number | null;
  expected_odds: number | null;
  simulated_stake: number | null;
  simulated_edge: number | null;
  selection_rationale: string | null;
  // v2.5 (optional, may not be persisted yet)
  adjusted_combined_probability?: number | null;
  correlation_warnings?: Array<{ pair: string; lift: number; same_game: boolean }>;
}

// ----- Prop-name standardization (mem://telegram/ui-standardization) --------

const PROP_LABELS: Record<string, string> = {
  PTS: "Points", POINTS: "Points",
  REB: "Rebounds", REBOUNDS: "Rebounds",
  AST: "Assists", ASSISTS: "Assists",
  STL: "Steals", STEALS: "Steals",
  BLK: "Blocks", BLOCKS: "Blocks",
  "3PM": "3-Pointers Made", THREES: "3-Pointers Made",
  "R+A": "Rebounds + Assists",
  PRA: "Points + Rebounds + Assists",
  TO: "Turnovers",
  RBI: "RBIs", HITS: "Hits", TB: "Total Bases",
  SOG: "Shots on Goal", SAVES: "Saves",
};

function fullPropName(raw: string | null | undefined): string {
  if (!raw) return "Unknown";
  const k = raw.trim().toUpperCase();
  return PROP_LABELS[k] ?? raw;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function fmtAmerican(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "n/a";
  const v = Math.round(Number(n));
  return v >= 0 ? `+${v}` : `${v}`;
}

function fmtUnits(n: number | null | undefined): string {
  if (n == null) return "0u";
  return `${Number(n).toFixed(2)}u`;
}

function legNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pickLegPlayer(l: Leg): string {
  return (l.player_name ?? l.player ?? "Unknown player") as string;
}
function pickLegProp(l: Leg): string {
  return fullPropName(l.prop_type ?? l.prop);
}
function pickLegLine(l: Leg): number | null {
  return legNum(l.line ?? l.current_line ?? l.threshold);
}
function pickLegOdds(l: Leg): number | null {
  return legNum(l.american_odds ?? l.price ?? l.odds);
}
function pickLegBookTag(l: Leg): string {
  const b = (l.selected_book ?? "").toString().toLowerCase();
  if (!b) return "";
  const tag = BOOK_TAG[b];
  return tag ? ` [${tag}]` : "";
}

function humanizeSignalSource(raw: string | null | undefined): string {
  if (!raw) return "Model pick";

  const normalized = raw.trim().toUpperCase();
  const labelMap: Record<string, string> = {
    UNKNOWN: "Model pick",
    UNCATEGORIZED: "Model pick",
    VOLUME_SCORER: "Volume scorer",
    BIG_REBOUNDER: "Big rebounder",
    HIGH_ASSIST: "Playmaking edge",
    ASSISTS: "Assist edge",
    STEALS: "Steals edge",
    BLOCKS: "Blocks edge",
    STAR_FLOOR_OVER: "Star floor over",
    THREE_POINT_SHOOTER: "3-point shooter",
    THREES: "3-point angle",
    MID_SCORER_UNDER: "Mid-scorer under",
    ROLE_PLAYER_REB: "Role rebound edge",
    SWEET_SPOT: "Sweet Spot",
    SWEET_SPOTS: "Sweet Spot",
    MANUAL_CURATED: "Manual curate",
    LADDER_CHALLENGE: "Ladder challenge",
  };

  if (labelMap[normalized]) return labelMap[normalized];

  return normalized
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

const TELEGRAM_LIMIT = 4096;
const TELEGRAM_SOFT_LIMIT = 3800;

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, "");
}

function splitTelegramMessage(text: string, limit: number = TELEGRAM_SOFT_LIMIT): string[] {
  if (text.length <= limit) return [text];

  const sections = text.split(/\n\n+/);
  const chunks: string[] = [];
  let current = "";

  const pushCurrent = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };

  for (const section of sections) {
    const candidate = current ? `${current}\n\n${section}` : section;
    if (candidate.length <= limit) {
      current = candidate;
      continue;
    }

    if (current) pushCurrent();

    if (section.length <= limit) {
      current = section;
      continue;
    }

    const lines = section.split("\n");
    let partial = "";
    for (const line of lines) {
      const next = partial ? `${partial}\n${line}` : line;
      if (next.length <= limit) {
        partial = next;
        continue;
      }

      if (partial) chunks.push(partial.trim());

      if (line.length <= limit) {
        partial = line;
        continue;
      }

      let remaining = line;
      while (remaining.length > limit) {
        let splitAt = remaining.lastIndexOf(" ", limit);
        if (splitAt < Math.floor(limit * 0.6)) splitAt = limit;
        chunks.push(remaining.slice(0, splitAt).trim());
        remaining = remaining.slice(splitAt).trim();
      }
      partial = remaining;
    }
    current = partial;
  }

  pushCurrent();
  return chunks;
}

// ----- Message builder ------------------------------------------------------

export function buildMessage(p: ParlayRow): string {
  const tier = p.tier ?? "CORE";
  const legCount = p.leg_count ?? p.legs?.length ?? 0;
  const odds = fmtAmerican(p.expected_odds);
  const stake = fmtUnits(p.simulated_stake);

  const dec = p.expected_odds != null
    ? (Number(p.expected_odds) >= 0
        ? 1 + Number(p.expected_odds) / 100
        : 1 + 100 / Math.abs(Number(p.expected_odds)))
    : null;
  const prob = p.adjusted_combined_probability ?? p.combined_probability ?? null;
  const ev = (dec != null && prob != null && p.simulated_stake != null)
    ? prob * (Number(p.simulated_stake) * (dec - 1)) - (1 - prob) * Number(p.simulated_stake)
    : null;

  const header =
    `🎯 <b>ParlayIQ — ${escapeHtml(p.strategy_name)}</b> (${escapeHtml(tier)})\n` +
    `${legCount} legs · ${odds} · ${stake}` +
    (ev != null ? ` · EV ${ev >= 0 ? "+" : ""}${ev.toFixed(2)}u` : "");

  const legLines = (p.legs ?? []).map((l, i) => {
    const player = escapeHtml(pickLegPlayer(l));
    const prop = escapeHtml(pickLegProp(l));
    const side = (l.side ?? "").toString().toUpperCase();
    const line = pickLegLine(l);
    const odds = pickLegOdds(l);
    const bookTag = pickLegBookTag(l);
    const conf = l.confidence != null ? ` · conf ${Number(l.confidence).toFixed(2)}` : "";
    const sig = escapeHtml(humanizeSignalSource(l.signal_source));
    const proj = l.projected != null ? ` · proj ${Number(l.projected).toFixed(1)}` : "";
    return `${i + 1}. ${player} — ${prop} ${side} ${line ?? "?"} (${fmtAmerican(odds)})${bookTag}\n   <i>${sig}${conf}${proj}</i>`;
  }).join("\n\n");

  let footer = "";
  if (p.selection_rationale) {
    footer += `\n\n<b>Why this hits:</b> ${escapeHtml(p.selection_rationale)}`;
  }
  const warnings = p.correlation_warnings ?? [];
  if (warnings.length > 0) {
    const w = warnings[0];
    footer += `\n⚠️ <b>Correlation note:</b> ${escapeHtml(w.pair.replace("||", " × "))} same-game (lift ${w.lift.toFixed(2)}x) — heads up.`;
  }

  return `${header}\n\n${legLines}${footer}`;
}

// ----- Telegram I/O ---------------------------------------------------------

async function sendTelegram(
  botToken: string,
  chatId: string,
  text: string,
): Promise<{ ok: boolean; message_id?: number; error?: string }> {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const rawChunks = splitTelegramMessage(text, TELEGRAM_SOFT_LIMIT);
  const numberedChunks = rawChunks.length > 1
    ? rawChunks.map((chunk, index) => `<b>(${index + 1}/${rawChunks.length})</b>\n${chunk}`)
    : rawChunks;

  let firstMessageId: number | undefined;

  for (const chunk of numberedChunks) {
    if (chunk.length > TELEGRAM_LIMIT) {
      return { ok: false, error: "chunk_exceeds_telegram_limit" };
    }

    let r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId, text: chunk, parse_mode: "HTML", disable_web_page_preview: true,
      }),
    });
    let body = await r.json().catch(() => ({}));
    if (!r.ok || body?.ok === false) {
      r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId, text: stripHtml(chunk), disable_web_page_preview: true,
        }),
      });
      body = await r.json().catch(() => ({}));
      if (!r.ok || body?.ok === false) {
        return { ok: false, error: body?.description ?? `http_${r.status}` };
      }
    }

    if (firstMessageId == null) firstMessageId = body?.result?.message_id;
  }

  return { ok: true, message_id: firstMessageId };
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

// ----- Handler --------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const defaultChatId = Deno.env.get("TELEGRAM_CHAT_ID");

    let body: {
      date?: string;
      parlay_ids?: string[];
      preset?: string;
      generate_first?: boolean;
      dry_run?: boolean;
      chat_id?: string;
    } = {};
    try { body = await req.json(); } catch { /* allow empty */ }

    const dryRun = body.dry_run === true;
    const targetDate = body.date ?? etDateKey();
    const chatId = body.chat_id ?? defaultChatId ?? "";
    const errors: string[] = [];
    let generated = 0;

    // Phase D: kill switch via bot_owner_rules
    const { data: killRow } = await sb
      .from("bot_owner_rules")
      .select("rule_logic, is_active")
      .eq("rule_key", "parlay_iq_autobroadcast_enabled")
      .maybeSingle();
    if (killRow) {
      const enabled = killRow.is_active !== false
        && (killRow.rule_logic as any)?.enabled !== false;
      if (!enabled) {
        return new Response(JSON.stringify({
          success: true, paused: true, generated: 0, sent: 0,
          skipped_duplicates: 0, errors: [],
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    if (!dryRun && !botToken) {
      return new Response(JSON.stringify({
        success: true, generated: 0, sent: 0, skipped_duplicates: 0,
        errors: ["telegram_not_configured"],
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!dryRun && !chatId) {
      return new Response(JSON.stringify({
        success: true, generated: 0, sent: 0, skipped_duplicates: 0,
        errors: ["telegram_chat_id_missing"],
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Step 1: optionally generate first
    if (body.generate_first) {
      const { data: genData, error: genErr } = await sb.functions.invoke("parlay-engine-v2", {
        body: { dry_run: false, date: targetDate, preset: body.preset ?? "live" },
      });
      if (genErr) errors.push(`generate_failed:${genErr.message}`);
      else generated = (genData as any)?.inserted ?? 0;
    }

    // Step 2: pull parlays
    let q = sb.from("bot_daily_parlays")
      .select("id, parlay_date, strategy_name, tier, legs, leg_count, combined_probability, expected_odds, simulated_stake, simulated_edge, selection_rationale")
      .eq("parlay_date", targetDate);
    if (body.parlay_ids?.length) q = q.in("id", body.parlay_ids);
    const { data: parlays, error: pErr } = await q;
    if (pErr) throw pErr;

    // Step 3: filter out already-broadcast
    const ids = (parlays ?? []).map((p) => p.id);
    let alreadySent = new Set<string>();
    if (chatId && ids.length > 0) {
      const { data: prior } = await sb.from("bot_parlay_broadcasts")
        .select("parlay_id").eq("chat_id", chatId).in("parlay_id", ids);
      alreadySent = new Set((prior ?? []).map((r) => r.parlay_id));
    }

    let sent = 0;
    let skipped = 0;
    const previews: string[] = [];

    for (const p of (parlays as ParlayRow[] ?? [])) {
      if (alreadySent.has(p.id)) { skipped += 1; continue; }
      const text = buildMessage(p);
      if (dryRun) {
        previews.push(text);
        continue;
      }
      const res = await sendTelegram(botToken!, chatId, text);
      if (!res.ok) {
        errors.push(`send_failed:${p.id}:${res.error}`);
      } else {
        await sb.from("bot_parlay_broadcasts").insert({
          parlay_id: p.id, chat_id: chatId, telegram_message_id: res.message_id ?? null,
        });
        sent += 1;
      }
      await sleep(1200); // global rate limit guard
    }

    return new Response(JSON.stringify({
      success: true,
      target_date: targetDate,
      generated, sent, skipped_duplicates: skipped, errors,
      ...(dryRun ? { previews } : {}),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[parlay-engine-v2-broadcast] Error:", msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});