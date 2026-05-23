import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { broadcastToRecipients, getRecipientsForTier } from "../_shared/telegram-recipients.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ParseMode = "Markdown" | "HTML";

type BotSendPayload = {
  message?: string;
  parse_mode?: ParseMode;
  reply_markup?: Record<string, unknown>;
  admin_only?: boolean;
  type?: string;
  data?: Record<string, unknown>;
  reference_key?: string;
  narrative_phase?: string | null;
  format_version?: string;
  reply_to_message_id?: number | null;
};

const TELEGRAM_LIMIT = 4096;
const TELEGRAM_SOFT_LIMIT = 3800;

function getDefaultMessage(type?: string) {
  switch (type) {
    case "test":
      return "🧪 *Telegram bot test successful*\n\nYour admin notification path is working.";
    case "slate_rebuild_alert":
      return "♻️ *Slate rebuild started*\n\nRefreshing the slate and notifying downstream systems.";
    default:
      return null;
  }
}

function splitTelegramMessage(text: string, limit: number = TELEGRAM_SOFT_LIMIT) {
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > limit) {
    let splitIndex = remaining.lastIndexOf("\n\n", limit);
    if (splitIndex < Math.floor(limit * 0.5)) {
      splitIndex = remaining.lastIndexOf("\n", limit);
    }
    if (splitIndex < Math.floor(limit * 0.5)) {
      splitIndex = limit;
    }

    chunks.push(remaining.slice(0, splitIndex).trim());
    remaining = remaining.slice(splitIndex).trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

async function sendChunksToChat(params: {
  botToken: string;
  chatId: string;
  chunks: string[];
  parseMode: ParseMode;
  replyMarkup?: Record<string, unknown>;
  replyToMessageId?: number | null;
}) {
  const messageIds: number[] = [];

  for (let index = 0; index < params.chunks.length; index += 1) {
    const chunk = params.chunks[index];
    const telegramResponse = await fetch(`https://api.telegram.org/bot${params.botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: params.chatId,
        text: chunk,
        parse_mode: params.parseMode,
        disable_web_page_preview: true,
        reply_markup: index === 0 ? params.replyMarkup : undefined,
        reply_to_message_id: index === 0 && params.replyToMessageId ? params.replyToMessageId : undefined,
      }),
    });

    const telegramData = await telegramResponse.json().catch(() => null);

    if (!telegramResponse.ok || !telegramData?.ok) {
      return {
        ok: false,
        error: telegramData?.description || `Telegram send failed (${telegramResponse.status})`,
        message_ids: messageIds,
      };
    }

    if (telegramData.result?.message_id) {
      messageIds.push(telegramData.result.message_id);
    }
  }

  return { ok: true, message_id: messageIds[0] ?? null, message_ids: messageIds };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");

    if (!botToken) {
      return new Response(JSON.stringify({ success: false, error: "Telegram is not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json().catch(() => ({}))) as BotSendPayload;
    const parseMode: ParseMode = body.parse_mode === "HTML" ? "HTML" : "Markdown";
    const message = typeof body.message === "string" && body.message.trim()
      ? body.message.trim()
      : getDefaultMessage(body.type);

    if (!message) {
      return new Response(JSON.stringify({ success: false, error: "A message or supported type is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const chunks = splitTelegramMessage(message).map((chunk, index, arr) =>
      arr.length > 1 ? `(${index + 1}/${arr.length})\n${chunk}` : chunk,
    );
    for (const chunk of chunks) {
      if (chunk.length > TELEGRAM_LIMIT) {
        return new Response(JSON.stringify({ success: false, error: "Message exceeds Telegram size limit" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (body.admin_only === false) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!supabaseUrl || !serviceRole) {
        return new Response(JSON.stringify({ success: false, error: "Recipient fanout is not configured" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const supabase = createClient(supabaseUrl, serviceRole);
      const recipients = await getRecipientsForTier(supabase, "all_access");
      const fanout = await broadcastToRecipients(recipients, async (chatId) => {
        const sent = await sendChunksToChat({
          botToken,
          chatId,
          chunks,
          parseMode,
          replyMarkup: body.reply_markup,
          replyToMessageId: body.reply_to_message_id,
        });
        return { ok: sent.ok, error: sent.error, message_id: sent.message_id };
      });

      return new Response(JSON.stringify({
        success: fanout.delivered > 0,
        delivered: fanout.delivered,
        failed: fanout.failed,
        recipients: recipients.length,
        results: fanout.results,
        chunks: chunks.length,
        reference_key: body.reference_key ?? null,
        narrative_phase: body.narrative_phase ?? null,
      }), {
        status: fanout.delivered > 0 ? 200 : 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminChatId = Deno.env.get("TELEGRAM_CHAT_ID");
    if (!adminChatId) {
      return new Response(JSON.stringify({ success: false, error: "Admin Telegram chat is not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminSend = await sendChunksToChat({
      botToken,
      chatId: adminChatId,
      chunks,
      parseMode,
      replyMarkup: body.reply_markup,
      replyToMessageId: body.reply_to_message_id,
    });

    if (!adminSend.ok) {
      return new Response(JSON.stringify({ success: false, error: adminSend.error }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      message_id: adminSend.message_id ?? null,
      message_ids: adminSend.message_ids ?? [],
      chunks: chunks.length,
      reference_key: body.reference_key ?? null,
      narrative_phase: body.narrative_phase ?? null,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});