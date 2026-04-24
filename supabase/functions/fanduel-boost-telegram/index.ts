// @ts-nocheck
// FanDuel Boost Telegram Sender
// Pulls fanduel_boost_fades rows that have not yet been sent to Telegram,
// renders a human message, and posts via the bot. Stamps telegram_sent_at
// to ensure each boost ticket is delivered exactly once.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function fmtAmerican(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "n/a";
  return n > 0 ? `+${n}` : `${n}`;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "n/a";
  return `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)}%`;
}

function legSummary(leg: any): string {
  const player = leg.player_name ?? leg.team ?? "Unknown";
  const market = (leg.market_type ?? "")
    .replace(/^player_/, "")
    .replace(/^batter_/, "")
    .replace(/^pitcher_/, "")
    .replace(/_/g, " ");
  const side = (leg.fade_side ?? "").toUpperCase();
  const line = leg.line;
  const price = fmtAmerican(leg.fade_price);
  const sample = leg.l10_sample ?? 0;
  const hits = leg.l10_hits_fade_side ?? 0;
  const edge = fmtPct(leg.edge_pct);
  return `${side} ${line} ${player} ${market} (${price})\n   ↳ L10: ${hits}/${sample} on this side · edge ${edge}`;
}

function skippedLineFor(leg: any): string {
  const player = leg.player_name ?? leg.team ?? "Unknown";
  const market = (leg.market_type ?? "").replace(/_/g, " ");
  const reason = String(leg.skip_reason ?? "no_data").replace(/_/g, " ");
  return `(skipped — ${player} ${market}: ${reason})`;
}

function buildMessage(boost: any, fade: any): string {
  const title = boost.title ?? "FanDuel Boost";
  const original = fmtAmerican(boost.original_odds);
  const boosted = fmtAmerican(boost.boosted_odds);
  const pays = boost.pays_text ? `\n${boost.pays_text}` : "";

  if (fade.verdict === "skip") {
    return [
      `ℹ️ *FanDuel Boost — looks fair, no clean fade*`,
      `*${title}*`,
      `Was ${original} → boosted ${boosted}${pays}`,
      ``,
      `Not enough fade legs cleared the +4% edge bar. Skipped.`,
    ].join("\n");
  }

  const fadeLegs = Array.isArray(fade.fade_legs) ? fade.fade_legs : [];
  const skipped = Array.isArray(fade.skipped_legs) ? fade.skipped_legs : [];
  const combined = fmtAmerican(fade.combined_american_odds);
  const edge = fmtPct(fade.combined_fade_edge_pct);

  const lines: string[] = [];
  lines.push(`🚫 *FanDuel Boost Fade — "${title}"* 🔥`);
  lines.push(`Was ${original} → boosted ${boosted}${pays}`);
  lines.push(`*Our fade:* ${combined} (${fadeLegs.length}-leg ticket)`);
  lines.push(`*Combined fade edge:* ${edge}`);
  lines.push("");
  fadeLegs.forEach((leg: any, idx: number) => {
    lines.push(`${idx + 1}. ${legSummary(leg)}`);
  });
  if (skipped.length > 0) {
    lines.push("");
    skipped.slice(0, 4).forEach((leg: any) => lines.push(skippedLineFor(leg)));
  }
  return lines.join("\n");
}

async function sendTelegram(supabaseUrl: string, anonKey: string, message: string) {
  const res = await fetch(`${supabaseUrl}/functions/v1/bot-send-telegram`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${anonKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message,
      parse_mode: "Markdown",
      admin_only: true,
      type: "fanduel_boost_fade",
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.success === false) {
    throw new Error(`bot-send-telegram_${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const url = new URL(req.url);
    const includeSkips = url.searchParams.get("include_skips") === "1";

    const { data: pending, error } = await supabase
      .from("fanduel_boost_fades")
      .select(
        "id, boost_id, fade_legs, skipped_legs, combined_american_odds, combined_fade_edge_pct, verdict, telegram_sent_at, fanduel_boosts(title, sport, original_odds, boosted_odds, pays_text, category)",
      )
      .is("telegram_sent_at", null)
      .order("created_at", { ascending: true })
      .limit(20);
    if (error) throw error;

    let sent = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const fade of pending ?? []) {
      try {
        if (fade.verdict === "skip" && !includeSkips) {
          // Mark as "handled" so we don't re-evaluate every cron tick
          await supabase
            .from("fanduel_boost_fades")
            .update({ telegram_sent_at: new Date().toISOString() })
            .eq("id", fade.id);
          skipped++;
          continue;
        }
        const boost = (fade as any).fanduel_boosts ?? {};
        const message = buildMessage(boost, fade);
        await sendTelegram(supabaseUrl, anonKey, message);
        await supabase
          .from("fanduel_boost_fades")
          .update({ telegram_sent_at: new Date().toISOString() })
          .eq("id", fade.id);
        sent++;
      } catch (e) {
        errors.push(`${fade.id}:${e instanceof Error ? e.message : "unknown"}`);
      }
    }

    return new Response(
      JSON.stringify({ ok: true, candidates: pending?.length ?? 0, sent, silently_skipped: skipped, errors }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("fanduel-boost-telegram error", e);
    return new Response(
      JSON.stringify({ ok: false, error: e instanceof Error ? e.message : "unknown" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});