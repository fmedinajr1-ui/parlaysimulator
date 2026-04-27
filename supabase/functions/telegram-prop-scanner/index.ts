// @ts-nocheck
// OCR Prop Scanner update handler.
// Receives one Telegram update at a time (POSTed by the telegram-poll function)
// and replies via the Telegram connector gateway (no bot token needed in code).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GATEWAY_URL = "https://connector-gateway.lovable.dev/telegram";
const ADMIN_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID");

function gatewayHeaders() {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const TELEGRAM_API_KEY = Deno.env.get("TELEGRAM_API_KEY");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");
  if (!TELEGRAM_API_KEY) throw new Error("TELEGRAM_API_KEY is not configured (link the Telegram connector)");
  return {
    Authorization: `Bearer ${LOVABLE_API_KEY}`,
    "X-Connection-Api-Key": TELEGRAM_API_KEY,
    "Content-Type": "application/json",
  } as Record<string, string>;
}

async function telegramRequest(method: string, body: Record<string, unknown>, fallbackBody?: Record<string, unknown>) {
  const send = async (payload: Record<string, unknown>) => {
    const response = await fetch(`${GATEWAY_URL}/${method}`, {
      method: "POST",
      headers: gatewayHeaders(),
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    let parsed: any = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }
    if (!response.ok || parsed?.ok === false) {
      throw new Error(parsed?.description || `Telegram ${method} failed (${response.status})`);
    }
    return parsed;
  };

  try {
    return await send(body);
  } catch (error) {
    if (!fallbackBody) throw error;
    console.error(`telegram ${method} primary failed`, error instanceof Error ? error.message : error);
    return await send(fallbackBody);
  }
}

async function sendMessage(chat_id: number, text: string) {
  await telegramRequest(
    "sendMessage",
    { chat_id, text, parse_mode: "Markdown", disable_web_page_preview: true },
    { chat_id, text, disable_web_page_preview: true },
  );
}

async function sendMessageWithButtons(chat_id: number, text: string, buttons: { text: string; data: string }[][]) {
  const reply_markup = {
    inline_keyboard: buttons.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))),
  };
  await telegramRequest(
    "sendMessage",
    { chat_id, text, parse_mode: "Markdown", disable_web_page_preview: true, reply_markup },
    { chat_id, text, disable_web_page_preview: true, reply_markup },
  );
}

async function answerCallback(callback_query_id: string, text?: string) {
  await telegramRequest("answerCallbackQuery", { callback_query_id, text: text ?? "" });
}

async function downloadTelegramPhoto(file_id: string): Promise<string> {
  const headers = gatewayHeaders();
  const res = await fetch(`${GATEWAY_URL}/getFile`, {
    method: "POST",
    headers,
    body: JSON.stringify({ file_id }),
  });
  const j = await res.json();
  if (!res.ok || !j.ok) throw new Error(`getFile failed: ${JSON.stringify(j)}`);
  const path = j.result.file_path;
  const fileRes = await fetch(`${GATEWAY_URL}/file/${path}`, {
    headers: { Authorization: headers.Authorization, "X-Connection-Api-Key": headers["X-Connection-Api-Key"] },
  });
  if (!fileRes.ok) throw new Error(`file download failed (${fileRes.status})`);
  const buf = await fileRes.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return `data:image/jpeg;base64,${btoa(bin)}`;
}

async function resolveUserForChat(supabase: any, chat_id: number) {
  const { data: sub } = await supabase
    .from("email_subscribers")
    .select("user_id, email")
    .eq("telegram_chat_id", chat_id)
    .maybeSingle();
  if (sub?.user_id) return sub.user_id as string;
  if (sub?.email) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("user_id")
      .eq("email", sub.email)
      .maybeSingle();
    if (profile?.user_id) return profile.user_id as string;
  }
  if (ADMIN_CHAT_ID && String(chat_id) === String(ADMIN_CHAT_ID)) {
    const { data: anyUser } = await supabase
      .from("profiles")
      .select("user_id")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    return anyUser?.user_id ?? null;
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

async function ensureSession(supabase: any, chat_id: number, overrides?: { sport?: string; book?: string }) {
  const active = await getActiveSession(supabase, chat_id);
  if (active) {
    const updates: Record<string, string> = {};
    if (overrides?.sport && overrides.sport !== active.sport) updates.sport = overrides.sport;
    if (overrides?.book && overrides.book !== active.book) updates.book = overrides.book;

    if (Object.keys(updates).length === 0) return active;

    const { data: updated, error } = await supabase
      .from("ocr_scan_sessions")
      .update(updates)
      .eq("id", active.id)
      .select("*")
      .single();

    if (error) throw new Error(error.message);
    return updated;
  }

  const user_id = await resolveUserForChat(supabase, chat_id);
  if (!user_id) return null;

  const { data: created, error } = await supabase
    .from("ocr_scan_sessions")
    .insert({
      user_id,
      telegram_chat_id: chat_id,
      sport: overrides?.sport ?? "nba",
      book: overrides?.book ?? "fanduel",
      capture_mode: "telegram",
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return created;
}

const REASON_LABEL: Record<string, string> = {
  unsupported_market: "no liquid market for this prop",
  no_market_data: "no live sportsbook line found",
  low_l10_sample: "not enough recent games",
  no_edge: "no edge vs market",
};

function fmtPropLine(p: any, i: number): string {
  const side = (p.recommended_side ?? p.side ?? "").toString();
  const sideStr = side ? side.toUpperCase() : "—";
  const market = side === "over" ? p.over_price : side === "under" ? p.under_price : null;
  const oddsStr = market == null ? "" : ` (${market > 0 ? "+" : ""}${market})`;

  if (p.blocked) {
    const why = REASON_LABEL[p.block_reason as string] ?? p.block_reason ?? "blocked";
    return `${i + 1}. *${p.player_name}* — ${p.prop_type} ${p.line} 🔴\n    ↳ _${why}_`;
  }

  const edgeStr = p.edge_pct != null ? ` · ✅ +${Number(p.edge_pct).toFixed(0)}% edge` : "";
  const head = `${i + 1}. *${p.player_name}* — ${p.prop_type} ${sideStr} ${p.line}${oddsStr}${edgeStr}`;
  if (p.verdict) return `${head}\n    ↳ _${p.verdict}_`;
  return head;
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
    if (j.reason === "pool_too_small") {
      const total = j.total_scanned ?? 0;
      const withEdge = j.with_edge ?? 0;
      const msg = total === 0
        ? "🤔 Pool is empty — send a screenshot first."
        : withEdge === 0
          ? `🤔 Couldn't build — none of the ${total} scanned props show a real edge vs the market right now.\n\nTry a different book or a different game.`
          : `🤔 Couldn't build — only ${withEdge} of ${total} props have a real edge. Send more screenshots to grow the pool.`;
      await sendMessage(chat_id, msg);
    } else {
      await sendMessage(chat_id, `🤔 Could not build (${j.reason ?? "unknown"}).`);
    }
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
  const raw = (args[0] ?? "").toLowerCase().replace(/\s+/g, "");
  if (!raw) {
    const session = await getActiveSession(supabase, chat_id);
    if (!session) {
      await sendMessage(chat_id, "📚 Pick a book with `/book fanduel` (or dk, hardrock, pp, ud), then send a screenshot.");
      return;
    }
    await sendMessage(chat_id, `📚 *Current book:* ${session.book}\n\nUsage: \`/scan book <fanduel|draftkings|hardrock|prizepicks|underdog>\``);
    return;
  }
  const book = BOOK_ALIASES[raw] ?? raw;
  if (!VALID_BOOKS.includes(book)) {
    await sendMessage(chat_id, `❌ Unknown book *${raw}*.\nValid: ${VALID_BOOKS.join(", ")}`);
    return;
  }
  try {
    const session = await ensureSession(supabase, chat_id, { book });
    if (!session) {
      await sendMessage(chat_id, "🚫 *Not authorized*\n\nLink your Telegram chat to your account first.");
      return;
    }
    await sendMessage(chat_id, `✅ *Book set to ${book}*\n\nNow send a screenshot and I'll scan it with the *${book}* layout.`);
  } catch (error) {
    await sendMessage(chat_id, `❌ Could not update book: ${error instanceof Error ? error.message : "unknown"}`);
    return;
  }
}

async function handleHelp(chat_id: number) {
  await sendMessageWithButtons(
    chat_id,
    `👋 *Welcome to Parlayfarm Scanner*\n\n*Step 1 — Link your account (one time):*\nSend \`/link your@email.com\` (the email you signed up with).\n\n*Step 2 — Send a screenshot* of any sportsbook prop page. We'll auto-start a session, run it through 8 engines, and tell you which legs to keep, swap or drop.\n\n*Useful commands:*\n• \`/book fanduel\` (or dk, hardrock, pp, ud)\n• \`/sport nba\` (or mlb, nfl, nhl, wnba…)\n• \`/pool\` — see captured props\n• \`/parlay 3\` — auto-build a 3-leg ticket\n• \`/end\` — finalize session\n\n_Default: NBA · FanDuel. Tap below to change anytime._`,
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

const NOT_LINKED_MSG =
  "🔗 *Link your account first*\n\nSend `/link your@email.com` using the email you signed up with at parlayfarm.com. Then you can send screenshots and I'll analyze them.";

async function handleLink(supabase: any, chat_id: number, args: string[], from?: { username?: string }) {
  const email = (args[0] ?? "").trim().toLowerCase();
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (!emailOk) {
    await sendMessage(chat_id, "Usage: `/link your@email.com`\n\nUse the email you signed up with on parlayfarm.com.");
    return;
  }

  // Find profile (real customer) for this email
  const { data: profile } = await supabase
    .from("profiles")
    .select("user_id, email")
    .eq("email", email)
    .maybeSingle();

  if (!profile?.user_id) {
    await sendMessage(
      chat_id,
      `❌ I couldn't find an account for *${email}*.\n\nMake sure you've signed up at parlayfarm.com first, then try \`/link ${email}\` again.`,
    );
    return;
  }

  // Detach this chat from any other email (rare), then upsert.
  await supabase
    .from("email_subscribers")
    .update({ telegram_chat_id: null, telegram_username: null })
    .eq("telegram_chat_id", String(chat_id))
    .neq("email", email);

  const payload = {
    email,
    user_id: profile.user_id,
    telegram_chat_id: String(chat_id),
    telegram_username: from?.username ?? null,
    source: "telegram_link",
    is_subscribed: true,
  };

  const { error } = await supabase
    .from("email_subscribers")
    .upsert(payload, { onConflict: "email" });

  if (error) {
    await sendMessage(chat_id, `❌ Couldn't link: ${error.message}`);
    return;
  }

  await sendMessage(
    chat_id,
    `✅ *Linked to ${email}*\n\nYou're all set. Send a screenshot of any sportsbook prop page (FanDuel, DraftKings, Hard Rock, PrizePicks, Underdog) and I'll run it through 8 engines.\n\nQuick start:\n• \`/book fanduel\` then send a screenshot\n• \`/parlay 3\` after you've scanned a few\n• \`/help\` anytime`,
  );
}

async function handlePhotos(supabase: any, chat_id: number, photoFileIds: string[]) {
  let session;
  try {
    session = await ensureSession(supabase, chat_id);
  } catch (error) {
    await sendMessage(chat_id, `❌ Could not start session: ${error instanceof Error ? error.message : "unknown"}`);
    return;
  }
  if (!session) {
    await sendMessage(chat_id, "🚫 *Not authorized.* Link your Telegram chat to your account first.");
    return;
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
    if (!j.ok) {
      const friendly = j.message ?? (j.error === "ai_credits_exhausted"
        ? "Scanner AI balance is exhausted right now. Add more AI balance, then try the screenshot again."
        : `OCR failed: ${j.error ?? "unknown"}`);
      await sendMessage(chat_id, `❌ ${friendly}`);
      return;
    }
    if (j.parsed === 0) { await sendMessage(chat_id, "👀 No props detected."); return; }
    const lines = (j.props as any[]).slice(0, 12).map((p, i) => fmtPropLine(p, i));
      const more = j.props.length > 12 ? `\n…and ${j.props.length - 12} more` : "";
    await sendMessageWithButtons(
      chat_id,
      `✅ *${j.parsed} prop${j.parsed > 1 ? "s" : ""} captured* (${j.inserted} new) · *${session.book}* / ${session.sport.toUpperCase()}\n\n${lines.join("\n")}${more}`,
      [
        [
          { text: "🎯 Build 3-leg", data: "parlay:3" },
          { text: "🎯 Build 5-leg", data: "parlay:5" },
        ],
        [
          { text: "📋 Show pool", data: "pool" },
          { text: "✅ End session", data: "end" },
        ],
        [
          { text: "🔄 Wrong book?", data: "switchbook" },
        ],
      ],
    );
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

    // Inline button taps
    if (update.callback_query) {
      const cq = update.callback_query;
      const cb_chat_id = cq.message?.chat?.id;
      const data: string = cq.data ?? "";
      await answerCallback(cq.id);
      if (!cb_chat_id) return new Response("ok");

        if (data.startsWith("book:")) {
        await handleBook(supabase, cb_chat_id, [data.slice(5)]);
      } else if (data.startsWith("sport:")) {
        const sport = data.slice(6);
        try {
          const session = await ensureSession(supabase, cb_chat_id, { sport });
          if (!session) {
            await sendMessage(cb_chat_id, "🚫 *Not authorized*\n\nLink your Telegram chat to your account first.");
          } else {
            await sendMessage(cb_chat_id, `✅ *Sport set to ${sport.toUpperCase()}*\n\nNow send a screenshot and I'll scan it.`);
          }
        } catch (error) {
          await sendMessage(cb_chat_id, `❌ Could not update sport: ${error instanceof Error ? error.message : "unknown"}`);
        }
      } else if (data === "switchbook") {
        await sendMessageWithButtons(cb_chat_id, "Pick the sportsbook you screenshotted from:", [
          [{ text: "FanDuel", data: "book:fanduel" }, { text: "DraftKings", data: "book:draftkings" }],
          [{ text: "Hard Rock", data: "book:hardrock" }, { text: "PrizePicks", data: "book:prizepicks" }, { text: "Underdog", data: "book:underdog" }],
        ]);
      } else if (data === "pool") {
        await handlePool(supabase, cb_chat_id);
      } else if (data === "end") {
        await handleEnd(supabase, cb_chat_id);
      } else if (data.startsWith("parlay:")) {
        await handleParlay(supabase, cb_chat_id, [data.slice(7)]);
      }
      return new Response("ok");
    }

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

    if (msg.document?.file_id && typeof msg.document?.mime_type === "string" && msg.document.mime_type.startsWith("image/")) {
      await handlePhotos(supabase, chat_id, [msg.document.file_id]);
      return new Response("ok");
    }

    const text = (msg.text ?? "").trim();
    if (!text) return new Response("ok");
    if (text === "/start" || text === "/help" || text === "/scan") { await handleHelp(chat_id); return new Response("ok"); }

    if (text.startsWith("/link")) {
      const parts = text.split(/\s+/).slice(1);
      await handleLink(supabase, chat_id, parts, msg.from);
      return new Response("ok");
    }

    // Top-level shortcuts
    if (text.startsWith("/book")) {
      const parts = text.split(/\s+/).slice(1);
      await handleBook(supabase, chat_id, parts);
      return new Response("ok");
    }
    if (text.startsWith("/sport")) {
      const parts = text.split(/\s+/).slice(1);
      const sport = (parts[0] ?? "").toLowerCase();
      if (!sport) { await sendMessage(chat_id, "Usage: `/sport nba` (or mlb, nfl, nhl, wnba…)"); return new Response("ok"); }
      try {
        const session = await ensureSession(supabase, chat_id, { sport });
        if (!session) {
          await sendMessage(chat_id, "🚫 *Not authorized*\n\nLink your Telegram chat to your account first.");
        } else {
          await sendMessage(chat_id, `✅ *Sport set to ${sport.toUpperCase()}*\n\nNow send a screenshot and I'll scan it.`);
        }
      } catch (error) {
        await sendMessage(chat_id, `❌ Could not update sport: ${error instanceof Error ? error.message : "unknown"}`);
      }
      return new Response("ok");
    }
    if (text === "/pool") { await handlePool(supabase, chat_id); return new Response("ok"); }
    if (text === "/end") { await handleEnd(supabase, chat_id); return new Response("ok"); }
    if (text.startsWith("/parlay")) {
      const parts = text.split(/\s+/).slice(1);
      await handleParlay(supabase, chat_id, parts);
      return new Response("ok");
    }

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
      return new Response("ok");
    }

    // Any other text → show the friendly help with buttons
    await handleHelp(chat_id);
    return new Response("ok");
  } catch (e) {
    console.error("telegram-prop-scanner error", e);
    return new Response("ok", { headers: corsHeaders });
  }
});