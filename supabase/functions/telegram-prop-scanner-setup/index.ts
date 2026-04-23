// One-shot: registers the Telegram webhook so the bot path activates.
// Invoke once (POST). Safe to re-run; Telegram replaces the existing webhook.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    if (!token) {
      return new Response(JSON.stringify({ ok: false, error: "TELEGRAM_BOT_TOKEN missing" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!supabaseUrl) {
      return new Response(JSON.stringify({ ok: false, error: "SUPABASE_URL missing" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const webhookUrl = `${supabaseUrl}/functions/v1/telegram-prop-scanner`;
    const secretToken = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") || undefined;

    const body: Record<string, unknown> = {
      url: webhookUrl,
      allowed_updates: ["message", "edited_message"],
      drop_pending_updates: true,
    };
    if (secretToken) body.secret_token = secretToken;

    const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await res.json();

    const infoRes = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
    const info = await infoRes.json();

    return new Response(JSON.stringify({
      ok: !!j.ok,
      set_webhook: j,
      webhook_url: webhookUrl,
      webhook_info: info?.result ?? info,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});