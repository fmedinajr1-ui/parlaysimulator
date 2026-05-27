// ============================================================================
// sb-unders-daily-report
// Daily 10:00 AM ET cron-fed job that pulls today's MLB Batter Stolen Bases
// UNDER props from unified_props, filters out games that have already started,
// and broadcasts the list to the admin Telegram chat.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GATEWAY_URL = "https://connector-gateway.lovable.dev/telegram";
const PREFERRED_BOOKS = ["fanduel", "hardrockbet", "draftkings", "betmgm", "caesars"];

function etDateString(d = new Date()): string {
  // YYYY-MM-DD in America/New_York
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  return fmt.format(d);
}

function fmtEtTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric", minute: "2-digit", hour12: true,
  }).format(new Date(iso));
}

function pickBest<T extends { bookmaker: string }>(rows: T[]): T {
  for (const want of PREFERRED_BOOKS) {
    const hit = rows.find(r => (r.bookmaker || "").toLowerCase() === want);
    if (hit) return hit;
  }
  return rows[0];
}

function americanToImplied(odds: number): number {
  if (odds < 0) return -odds / (-odds + 100);
  return 100 / (odds + 100);
}

function riskTag(implied: number): string {
  if (implied >= 0.98) return "🟣 EXTREME (lottery-grade juice)";
  if (implied >= 0.965) return "🔴 VERY HIGH";
  if (implied >= 0.95) return "🟠 HIGH";
  if (implied >= 0.90) return "🟡 ELEVATED";
  return "🟢 MODERATE";
}

async function sendTelegram(chatId: string, text: string) {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const TELEGRAM_API_KEY = Deno.env.get("TELEGRAM_API_KEY");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");
  if (!TELEGRAM_API_KEY) throw new Error("TELEGRAM_API_KEY not configured");

  const res = await fetch(`${GATEWAY_URL}/sendMessage`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": TELEGRAM_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Telegram ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const today = etDateString();
    const nowIso = new Date().toISOString();

    // Pull all SB props for today's unstarted games
    const { data, error } = await sb
      .from("unified_props")
      .select("player_name, prop_type, current_line, under_price, over_price, bookmaker, commence_time, game_description, event_id")
      .eq("sport", "baseball_mlb")
      .ilike("prop_type", "%stolen%base%")
      .gte("commence_time", nowIso)
      .eq("is_active", true)
      .not("under_price", "is", null);

    if (error) throw error;

    // Group by player+event, pick best book
    const byPlayer = new Map<string, typeof data>();
    for (const r of data ?? []) {
      const k = `${r.event_id}::${r.player_name}::${r.current_line}`;
      if (!byPlayer.has(k)) byPlayer.set(k, []);
      byPlayer.get(k)!.push(r);
    }

    const picks = Array.from(byPlayer.values())
      .map(rows => pickBest(rows))
      // sort by best (least-negative) under price first
      .sort((a, b) => (b.under_price ?? -99999) - (a.under_price ?? -99999));

    // Build chat list
    const { data: chats } = await sb
      .from("telegram_bot_state")
      .select("chat_id")
      .limit(50);

    const targetChatIds = (chats ?? [])
      .map((c: any) => String(c.chat_id))
      .filter(Boolean);
    if (targetChatIds.length === 0) targetChatIds.push("7705141526");

    if (picks.length === 0) {
      const msg = `⚾ <b>SB Unders Report</b> — ${today}\n\nNo unstarted SB Under props posted right now.`;
      for (const id of targetChatIds) await sendTelegram(id, msg);
      return new Response(JSON.stringify({ success: true, picks: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Group picks by game (event_id)
    const byGame = new Map<string, typeof picks>();
    for (const p of picks) {
      const k = String(p.event_id).split("_")[0]; // strip suffixes
      if (!byGame.has(k)) byGame.set(k, []);
      byGame.get(k)!.push(p);
    }

    // Order games by first pitch
    const gameOrder = Array.from(byGame.entries()).sort((a, b) => {
      const ta = new Date(a[1][0].commence_time).getTime();
      const tb = new Date(b[1][0].commence_time).getTime();
      return ta - tb;
    });

    // Header card
    const header =
      `⚾ <b>MLB Stolen Bases — Unders</b>\n` +
      `📅 ${today} • ${picks.length} props across ${gameOrder.length} games\n` +
      `⚠️ <i>All SB Unders are heavily juiced. Read the break-even on every card before betting.</i>`;
    for (const id of targetChatIds) await sendTelegram(id, header);

    // One card per game
    for (const [, gamePicks] of gameOrder) {
      const first = gamePicks[0];
      const start = fmtEtTime(first.commence_time);
      const game = first.game_description;

      const propLines = gamePicks
        .sort((a, b) => (b.under_price ?? -99999) - (a.under_price ?? -99999))
        .map((p) => {
          const odds = p.under_price ?? 0;
          const implied = americanToImplied(odds);
          const price = odds > 0 ? `+${odds}` : `${odds}`;
          const book = (p.bookmaker || "").toUpperCase();
          const breakEven = (implied * 100).toFixed(1);
          const risk = riskTag(implied);
          return (
            `👤 <b>${p.player_name}</b>\n` +
            `   • Line: Under ${p.current_line} Stolen Bases\n` +
            `   • Odds: <b>${price}</b> (${book})\n` +
            `   • Implied / Break-Even: <b>${breakEven}%</b>\n` +
            `   • Risk: ${risk}`
          );
        });

      const card =
        `🏟️ <b>${game}</b>\n` +
        `🕒 First pitch: ${start} ET\n` +
        `📊 ${gamePicks.length} SB Under prop${gamePicks.length === 1 ? "" : "s"}\n` +
        `━━━━━━━━━━━━━━━\n` +
        propLines.join("\n\n");

      // Telegram 4096 cap — chunk if needed (rare per-game)
      if (card.length <= 3900) {
        for (const id of targetChatIds) await sendTelegram(id, card);
      } else {
        const head = `🏟️ <b>${game}</b>\n🕒 ${start} ET\n━━━━━━━━━━━━━━━`;
        let buf = head;
        for (const ln of propLines) {
          if ((buf + "\n\n" + ln).length > 3900) {
            for (const id of targetChatIds) await sendTelegram(id, buf);
            buf = head + "\n" + ln;
          } else {
            buf = buf + "\n\n" + ln;
          }
        }
        if (buf) for (const id of targetChatIds) await sendTelegram(id, buf);
      }
    }

    return new Response(JSON.stringify({ success: true, picks: picks.length, chats: targetChatIds.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[sb-unders-daily-report]", e);
    return new Response(JSON.stringify({ success: false, error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});