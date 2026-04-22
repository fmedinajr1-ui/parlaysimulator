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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const adminChatId = Deno.env.get("TELEGRAM_CHAT_ID");

    if (!botToken || !adminChatId) {
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

    if (body.admin_only === false) {
      return new Response(JSON.stringify({ success: false, skipped: true, reason: "Only admin chat delivery is configured" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const chunks = splitTelegramMessage(message).map((chunk, index, arr) =>
      arr.length > 1 ? `(${index + 1}/${arr.length})\n${chunk}` : chunk,
    );

    const messageIds: number[] = [];

    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index];
      if (chunk.length > TELEGRAM_LIMIT) {
        return new Response(JSON.stringify({ success: false, error: "Message exceeds Telegram size limit" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const telegramResponse = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: adminChatId,
          text: chunk,
          parse_mode: parseMode,
          disable_web_page_preview: true,
          reply_markup: index === 0 ? body.reply_markup : undefined,
        }),
      });

      const telegramData = await telegramResponse.json().catch(() => null);

      if (!telegramResponse.ok || !telegramData?.ok) {
        return new Response(JSON.stringify({
          success: false,
          error: telegramData?.description || `Telegram send failed (${telegramResponse.status})`,
        }), {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (telegramData.result?.message_id) {
        messageIds.push(telegramData.result.message_id);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      message_id: messageIds[0] ?? null,
      message_ids: messageIds,
      chunks: messageIds.length,
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