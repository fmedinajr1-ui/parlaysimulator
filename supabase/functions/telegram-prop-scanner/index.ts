// @ts-nocheck
// Telegram webhook for the OCR Prop Scanner.
// One-time setup: set the bot's webhook URL to this function's URL via Telegram's setWebhook API.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const FILE_API = `https://api.telegram.org/file/bot${BOT_TOKEN}`;
const ADMIN_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID");

async function sendMessage(chat_id: number, text: string) {
  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id, text, parse_mode: "Markdown", disable_web_page_preview: true }),
  });
}

async function sendMessageWithButtons(chat_id: number, text: string, buttons: { text: string; data: string }[][]) {
  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id, text, parse_mode: "Markdown", disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: buttons.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))),
      },
    }),
  });
}

async function answerCallback(callback_query_id: string, text?: string) {
  await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id, text: text ?? "" }),
  });
}

async function downloadTelegramPhoto(file_id: string): Promise<string> {
  const res = await fetch(`${TELEGRAM_API}/getFile?file_id=${file_id}`);
  const j = await res.json();
  if (!j.ok) throw new Error(`getFile failed`);
  const path = j.result.file_path;
  const fileRes = await fetch(`${FILE_API}/${path}`);
  const buf = await fileRes.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return `data:image/jpeg;base64,${btoa(bin)}`;
}

async function resolveUserForChat(supabase: any, chat_id: number) {
  const { data: sub } = await supabase
    .from("email_subscribers")
    .select("user_id")
    .eq("telegram_chat_id", chat_id)
    .maybeSingle();
  if (sub?.user_id) return sub.user_id as string;
  if (ADMIN_CHAT_ID && String(chat_id) === String(ADMIN_CHAT_ID)) {
    const { data: anyUser } = await supabase
      .from("profiles")
      .select("id")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    return anyUser?.id ?? null;
  }
  return null;
}

async function getActiveSession(supabase: any, chat_id: number) {
  const { data } = await supabase
    .from("ocr_scan_sessions")
    .select("*")
    .eq("telegram_chat_id", chat_id)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

function fmtPropLine(p: any, i: number): string {
  const odds = p.side === "over" ? p.over_price : p.under_price;
  const oddsStr = odds == null ? "" : ` (${odds > 0 ? "+" : ""}${odds})`;
  const dna = p.dna_score != null ? ` · DNA ${p.dna_score}` : "";
  const flag = p.blocked ? " 🔴" : (p.dna_score ?? 0) >= 70 ? " 🟢" : " 🟡";
  const reason = p.blocked ? `\n    ↳ _${p.block_reason}_` : "";
  return `${i + 1}. *${p.player_name}* — ${p.prop_type} ${p.side.toUpperCase()} ${p.line}${oddsStr}${dna}${flag}${reason}`;
}

async function handleStart(supabase: any, chat_id: number, args: string[]) {
  // Smart arg parsing — users type things like:
  //   /scan start hardrock bet      → book="hardrock bet" (Hard Rock), sport=nba
  //   /scan start fanduel           → book="fanduel", sport=nba
  //   /scan start nba fanduel       → sport=nba, book=fanduel
  //   /scan start fanduel nba       → book=fanduel, sport=nba (reversed)
  const VALID_SPORTS = ["nba", "nfl", "mlb", "nhl", "ncaab", "ncaaf", "wnba", "tennis", "soccer", "mma", "ufc", "golf", "pga"];
  const raw = args.map((a) => a.toLowerCase());
  const joined = raw.join(" ").replace(/\s+/g, " ").trim();

  // Try to detect a book in the full joined string (handles "hardrock bet", "hard rock", "draft kings")
  const compact = joined.replace(/\s+/g, "");
  const bookFromJoined = BOOK_ALIASES[compact] ?? (VALID_BOOKS.includes(compact) ? compact : null);

  let sport = "nba";
  let book = "fanduel";

  if (bookFromJoined) {
    // Whole arg list resolved to a book — keep default sport
    book = bookFromJoined;
  } else {
    // Try positional: token0 = sport or book, token1 = the other
    const t0 = raw[0];
    const t1 = raw[1];
    const t0Book = t0 ? (BOOK_ALIASES[t0] ?? (VALID_BOOKS.includes(t0) ? t0 : null)) : null;
    const t1Book = t1 ? (BOOK_ALIASES[t1] ?? (VALID_BOOKS.includes(t1) ? t1 : null)) : null;
    const t0Sport = t0 && VALID_SPORTS.includes(t0) ? t0 : null;
    const t1Sport = t1 && VALID_SPORTS.includes(t1) ? t1 : null;

    if (t0Sport && t1Book) { sport = t0Sport; book = t1Book; }
    else if (t0Book && t1Sport) { book = t0Book; sport = t1Sport; }
    else if (t0Book) { book = t0Book; if (t1Sport) sport = t1Sport; }
    else if (t0Sport) { sport = t0Sport; if (t1Book) book = t1Book; }
    else if (t0) {
      // Couldn't recognize — bail with help
      await sendMessage(
        chat_id,
        `❌ Couldn't recognize \`${joined}\`.\n\nUsage: \`/scan start <sport> <book>\`\n*Sports:* ${VALID_SPORTS.slice(0, 6).join(", ")}…\n*Books:* ${VALID_BOOKS.join(", ")}\n\nExamples:\n\`/scan start hardrock\`\n\`/scan start nba fanduel\``,
      );
      return;
    }
  }

  const user_id = await resolveUserForChat(supabase, chat_id);
  if (!user_id) {
    await sendMessage(chat_id, "🚫 *Not authorized*\n\nLink your Telegram chat to your account first.");
    return;
  }
  await supabase
    .from("ocr_scan_sessions")
    .update({ status: "archived" })
    .eq("telegram_chat_id", chat_id)
    .eq("status", "active");
  const { data: created, error } = await supabase
    .from("ocr_scan_sessions")
    .insert({ user_id, telegram_chat_id: chat_id, sport, book, capture_mode: "telegram" })
    .select("*")
    .single();
  if (error) {
    await sendMessage(chat_id, `❌ Could not create session: ${error.message}`);
    return;
  }
  await sendMessage(
    chat_id,
    `✅ *Scan session started*\n\n*Sport:* ${sport.toUpperCase()}\n*Book:* ${book}\n*Session:* \`${created.id.slice(0, 8)}\`\n\nNow send screenshots of props. Use \`/scan pool\`, \`/scan parlay 3\`, \`/scan end\`.`,
  );
}

async function handlePool(supabase: any, chat_id: number) {
  const session = await getActiveSession(supabase, chat_id);
  if (!session) { await sendMessage(chat_id, "ℹ️ No active session. `/scan start nba fanduel`"); return; }
  const { data: props } = await supabase
    .from("ocr_scanned_props").select("*").eq("session_id", session.id)
    .order("composite_score", { ascending: false }).limit(40);
  if (!props || props.length === 0) { await sendMessage(chat_id, "📭 Pool empty — send screenshots."); return; }
  const lines = props.map((p: any, i: number) => fmtPropLine(p, i));
  const usable = props.filter((p: any) => !p.blocked).length;
  await sendMessage(chat_id, `📋 *Pool* — ${props.length} captured · ${usable} usable\n\n${lines.join("\n")}`);
}

async function handleParlay(supabase: any, chat_id: number, args: string[]) {
  const session = await getActiveSession(supabase, chat_id);
  if (!session) { await sendMessage(chat_id, "ℹ️ No active session."); return; }
  const target = Math.min(6, Math.max(2, Number(args[0]) || 3));
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/ocr-pool-build-parlays`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
    body: JSON.stringify({ session_id: session.id, target_legs: target, mode: "auto" }),
  });
  const j = await res.json();
  if (!j.ok || !j.parlays?.length) {
    await sendMessage(chat_id, `🤔 Could not build (${j.reason ?? "unknown"}).`);
    return;
  }
  const blocks = j.parlays.map((p: any, i: number) => {
    const legs = p.legs.map((l: any, idx: number) =>
      `  ${idx + 1}. ${l.player_name} ${l.prop_type} ${l.side.toUpperCase()} ${l.line} (${l.odds > 0 ? "+" : ""}${l.odds})\n     _${l.reasoning}_`).join("\n");
    return `*Ticket ${i + 1}* — ${p.american_odds > 0 ? "+" : ""}${p.american_odds} · composite ${p.composite_score} · ${p.distinct_games} games\n${legs}`;
  }).join("\n\n────────\n\n");
  await sendMessage(chat_id, `🎯 *Auto-parlays*\n\n${blocks}`);
}

async function handleEnd(supabase: any, chat_id: number) {
  const session = await getActiveSession(supabase, chat_id);
  if (!session) { await sendMessage(chat_id, "ℹ️ No active session."); return; }
  await supabase.from("ocr_scan_sessions")
    .update({ status: "finalized", finalized_at: new Date().toISOString() })
    .eq("id", session.id);
  await sendMessage(chat_id, `✅ Session \`${session.id.slice(0, 8)}\` finalized.`);
}

const VALID_BOOKS = ["fanduel", "draftkings", "hardrock", "prizepicks", "underdog"];
const BOOK_ALIASES: Record<string, string> = {
  fd: "fanduel", fanduel: "fanduel",
  dk: "draftkings", draftkings: "draftkings", "draft-kings": "draftkings",
  hr: "hardrock", hrb: "hardrock", hardrock: "hardrock", "hard-rock": "hardrock", "hard_rock": "hardrock",
  pp: "prizepicks", prizepicks: "prizepicks", "prize-picks": "prizepicks",
  ud: "underdog", underdog: "underdog", "under-dog": "underdog",
};

async function handleBook(supabase: any, chat_id: number, args: string[]) {
  const session = await getActiveSession(supabase, chat_id);
  if (!session) {
    await sendMessage(chat_id, "ℹ️ No active session. `/scan start <sport> <book>` first.");
    return;
  }
  const raw = (args[0] ?? "").toLowerCase().replace(/\s+/g, "");
  if (!raw) {
    await sendMessage(chat_id, `📚 *Current book:* ${session.book}\n\nUsage: \`/scan book <fanduel|draftkings|hardrock|prizepicks|underdog>\``);
    return;
  }
  const book = BOOK_ALIASES[raw] ?? raw;
  if (!VALID_BOOKS.includes(book)) {
    await sendMessage(chat_id, `❌ Unknown book *${raw}*.\nValid: ${VALID_BOOKS.join(", ")}`);
    return;
  }
  const { error } = await supabase
    .from("ocr_scan_sessions")
    .update({ book })
    .eq("id", session.id);
  if (error) {
    await sendMessage(chat_id, `❌ Could not update book: ${error.message}`);
    return;
  }
  await sendMessage(chat_id, `✅ *Book overridden* → *${book}*\n\nNext screenshots will parse with the *${book}* layout.`);
}

async function handleHelp(chat_id: number) {
  await sendMessageWithButtons(
    chat_id,
    `👋 *Welcome to Parlayfarm Scanner*\n\n*Just send a screenshot* of any sportsbook prop page — we'll auto-start a session and capture every prop.\n\nAfter scanning, tap a button to build a parlay or switch books.\n\n_Default: NBA · FanDuel. Tap below to change anytime._`,
    [
      [
        { text: "📚 FanDuel", data: "book:fanduel" },
        { text: "📚 DraftKings", data: "book:draftkings" },
      ],
      [
        { text: "📚 Hard Rock", data: "book:hardrock" },
        { text: "📚 PrizePicks", data: "book:prizepicks" },
        { text: "📚 Underdog", data: "book:underdog" },
      ],
      [
        { text: "🏀 NBA", data: "sport:nba" },
        { text: "⚾ MLB", data: "sport:mlb" },
        { text: "🏈 NFL", data: "sport:nfl" },
      ],
    ],
  );
}

async function handlePhotos(supabase: any, chat_id: number, photoFileIds: string[]) {
  let session = await getActiveSession(supabase, chat_id);
  if (!session) {
    const user_id = await resolveUserForChat(supabase, chat_id);
    if (!user_id) {
      await sendMessage(chat_id, "🚫 *Not authorized.* Link your Telegram chat to your account first.");
      return;
    }
    const { data: created, error: cErr } = await supabase
      .from("ocr_scan_sessions")
      .insert({ user_id, telegram_chat_id: chat_id, sport: "nba", book: "fanduel", capture_mode: "telegram" })
      .select("*")
      .single();
    if (cErr || !created) {
      await sendMessage(chat_id, `❌ Could not start session: ${cErr?.message ?? "unknown"}`);
      return;
    }
    session = created;
    await sendMessage(chat_id, `✨ *New session started* — NBA · FanDuel\n_Tap "Wrong book?" below if needed._`);
  }
  await sendMessage(chat_id, `🔎 Scanning ${photoFileIds.length} screenshot${photoFileIds.length > 1 ? "s" : ""}…`);
  try {
    const frames: string[] = [];
    for (const id of photoFileIds.slice(0, 6)) frames.push(await downloadTelegramPhoto(id));
    const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/ocr-prop-scan`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
      body: JSON.stringify({ session_id: session.id, frames, book: session.book, sport: session.sport, source_channel: "telegram" }),
    });
    const j = await res.json();
    if (!j.ok) { await sendMessage(chat_id, `❌ OCR failed: ${j.error ?? "unknown"}`); return; }
    if (j.parsed === 0) { await sendMessage(chat_id, "👀 No props detected."); return; }
    const lines = (j.props as any[]).slice(0, 12).map((p, i) => fmtPropLine(p, i));
    const more = j.props.length > 12 ? `\n…and ${j.props.length - 12} more` : "";
    await sendMessage(chat_id, `✅ *${j.parsed} prop${j.parsed > 1 ? "s" : ""} captured* (${j.inserted} new)\n\n${lines.join("\n")}${more}\n\n\`/scan parlay 3\` to build.`);
  } catch (e) {
    await sendMessage(chat_id, `❌ Capture error: ${e instanceof Error ? e.message : "unknown"}`);
  }
}

const mediaGroups = new Map<string, { ids: string[]; chat_id: number; timer: number }>();
function bufferMediaGroup(supabase: any, chat_id: number, group_id: string, file_id: string) {
  const existing = mediaGroups.get(group_id);
  if (existing) { existing.ids.push(file_id); return; }
  const entry = {
    ids: [file_id], chat_id,
    timer: setTimeout(async () => {
      const g = mediaGroups.get(group_id);
      mediaGroups.delete(group_id);
      if (g) await handlePhotos(supabase, g.chat_id, g.ids);
    }, 1500) as unknown as number,
  };
  mediaGroups.set(group_id, entry);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const update = await req.json();
    const msg = update.message ?? update.edited_message;
    if (!msg) return new Response("ok");
    const chat_id = msg.chat?.id;
    if (!chat_id) return new Response("ok");

    if (msg.photo && Array.isArray(msg.photo) && msg.photo.length > 0) {
      const largest = msg.photo[msg.photo.length - 1];
      if (msg.media_group_id) bufferMediaGroup(supabase, chat_id, msg.media_group_id, largest.file_id);
      else await handlePhotos(supabase, chat_id, [largest.file_id]);
      return new Response("ok");
    }

    const text = (msg.text ?? "").trim();
    if (!text) return new Response("ok");
    if (text === "/start" || text === "/help" || text === "/scan") { await handleHelp(chat_id); return new Response("ok"); }
    if (text.startsWith("/scan ")) {
      const parts = text.split(/\s+/).slice(1);
      const sub = parts[0];
      const args = parts.slice(1);
      if (sub === "start") await handleStart(supabase, chat_id, args);
      else if (sub === "book") await handleBook(supabase, chat_id, args);
      else if (sub === "pool") await handlePool(supabase, chat_id);
      else if (sub === "parlay") await handleParlay(supabase, chat_id, args);
      else if (sub === "end") await handleEnd(supabase, chat_id);
      else await handleHelp(chat_id);
    }
    return new Response("ok");
  } catch (e) {
    console.error("telegram-prop-scanner error", e);
    return new Response("ok", { headers: corsHeaders });
  }
});