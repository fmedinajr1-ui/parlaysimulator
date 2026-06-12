// Pushes Soccer Sharp alerts (STRONG / HAMMER / STEAM) to the admin Telegram chat.
// Marks telegram_sent_at so each alert delivers exactly once.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CLASS_EMOJI: Record<string, string> = {
  STRONG: "🔥",
  HAMMER: "💣",
  STEAM: "🚂",
};

const MARKET_LABEL: Record<string, string> = {
  moneyline: "Moneyline",
  asian_handicap: "Asian Handicap",
  totals: "Total",
};

const LEAGUE_LABEL: Record<string, string> = {
  soccer_fifa_world_cup_qualifiers: "World Cup Qual",
  soccer_usa_mls: "MLS",
  soccer_epl: "EPL",
  soccer_spain_la_liga: "La Liga",
  soccer_italy_serie_a: "Serie A",
  soccer_uefa_champs_league: "UCL",
  soccer_conmebol_copa_libertadores: "Copa Libertadores",
};

function fmtPct(n: number) { return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`; }
function fmtProb(n: number) { return `${(n * 100).toFixed(1)}%`; }

function buildMessage(a: any): string {
  const emoji = CLASS_EMOJI[a.classification] ?? "📈";
  const league = LEAGUE_LABEL[a.league] ?? (a.league ?? "Soccer");
  const market = MARKET_LABEL[a.market] ?? a.market;
  const lineTxt = a.line != null ? ` ${a.line}` : "";
  const ev = a.expected_value != null ? `${(Number(a.expected_value) * 100).toFixed(1)}%` : "—";
  const flags = Array.isArray(a.risk_flags) && a.risk_flags.length
    ? `\n⚠️ ${a.risk_flags.join(", ")}`
    : "";
  return [
    `${emoji} <b>Soccer Sharp — ${a.classification}</b>`,
    `<b>${a.home_team}</b> vs <b>${a.away_team}</b> · ${league}`,
    `${market}${lineTxt} · ${String(a.sportsbook).toUpperCase()}`,
    `Recommended: <b>${a.recommended_side}</b>`,
    `Edge: <b>${fmtPct(Number(a.edge_percent))}</b> · CHESS: <b>${Math.round(Number(a.chess_score))}</b> · EV: <b>${ev}</b>`,
    `Sharp ${fmtProb(Number(a.sharp_probability))} vs Book ${fmtProb(Number(a.sportsbook_probability))}${flags}`,
  ].join("\n");
}

async function sendTelegram(botToken: string, chatId: string, text: string) {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
  const json = await res.json();
  if (!res.ok || !json.ok) {
    throw new Error(`Telegram ${res.status}: ${JSON.stringify(json)}`);
  }
  return json.result?.message_id ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const adminChatId = Deno.env.get("TELEGRAM_CHAT_ID");
  if (!botToken || !adminChatId) {
    return json({ ok: false, error: "TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not configured" }, 500);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: alerts, error } = await supabase
    .from("soccer_sharp_alerts")
    .select("*")
    .in("classification", ["STRONG", "HAMMER", "STEAM"])
    .eq("status", "open")
    .is("telegram_sent_at", null)
    .order("created_at", { ascending: true })
    .limit(20);

  if (error) return json({ ok: false, error: error.message }, 500);

  const stats = { found: alerts?.length ?? 0, sent: 0, failed: 0, errors: [] as string[] };
  for (const a of alerts ?? []) {
    try {
      await sendTelegram(botToken, adminChatId, buildMessage(a));
      await supabase
        .from("soccer_sharp_alerts")
        .update({ telegram_sent_at: new Date().toISOString() })
        .eq("id", a.id);
      stats.sent++;
    } catch (e) {
      stats.failed++;
      stats.errors.push(`${a.id}: ${(e as Error).message}`);
    }
  }

  return json({ ok: true, stats });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}