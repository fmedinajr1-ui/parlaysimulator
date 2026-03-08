import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

function getEasternDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function sendMessage(chatId: string, text: string, replyMarkup?: object) {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: "Markdown",
  };
  if (replyMarkup) body.reply_markup = replyMarkup;

  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  try {
    const today = getEasternDate();

    // Get all active users who haven't confirmed today
    const { data: users, error } = await supabase
      .from("bot_authorized_users")
      .select("chat_id, username, bankroll, bankroll_confirmed_date")
      .eq("is_active", true);

    if (error) throw error;

    const needsPrompt = (users || []).filter(
      (u) => u.bankroll_confirmed_date !== today
    );

    let prompted = 0;

    for (const user of needsPrompt) {
      const currentBankroll = user.bankroll || 500;
      const execStake = Math.round(currentBankroll * 0.05);
      const valStake = Math.round(currentBankroll * 0.025);
      const expStake = Math.round(currentBankroll * 0.01);

      const msg =
        `☀️ *Good Morning!*\n\n` +
        `Your current bankroll is *$${currentBankroll.toLocaleString()}*\n\n` +
        `Today's stake sizes:\n` +
        `• Execution: $${execStake}\n` +
        `• Validation: $${valStake}\n` +
        `• Exploration: $${expStake}\n\n` +
        `Tap below to confirm or reply with /bankroll [amount] to update.`;

      const replyMarkup = {
        inline_keyboard: [
          [
            {
              text: `✅ Keep $${currentBankroll.toLocaleString()}`,
              callback_data: `bankroll_keep:${currentBankroll}`,
            },
            {
              text: "✏️ Update",
              callback_data: "bankroll_update_prompt",
            },
          ],
        ],
      };

      try {
        await sendMessage(user.chat_id, msg, replyMarkup);
        prompted++;
      } catch (e) {
        console.warn(`Failed to prompt ${user.chat_id}:`, e);
      }
    }

    const summary = `Bankroll check-in: ${prompted} users prompted, ${(users || []).length - needsPrompt.length} already confirmed`;
    console.log(summary);

    // Log activity
    await supabase.from("bot_activity_log").insert({
      event_type: "bankroll_checkin",
      message: summary,
      metadata: { prompted, already_confirmed: (users || []).length - needsPrompt.length },
    });

    return new Response(JSON.stringify({ success: true, prompted, total: users?.length }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Bankroll check-in error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
