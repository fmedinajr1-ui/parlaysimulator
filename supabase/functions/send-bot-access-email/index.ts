import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TELEGRAM_BOT_URL = "https://t.me/parlayiqbot";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[SEND-BOT-ACCESS-EMAIL] ${step}${detailsStr}`);
};

const emailHtml = (email: string) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Your ParlayIQ Bot Access</title>
</head>
<body style="margin:0;padding:0;background-color:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#0a0a0a;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table width="600" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;width:100%;background-color:#111111;border:1px solid #1f1f1f;border-radius:12px;overflow:hidden;">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#16a34a,#15803d);padding:40px 40px 32px;text-align:center;">
              <div style="font-size:32px;margin-bottom:8px;">🤖</div>
              <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:700;letter-spacing:-0.5px;">Bot Access Activated</h1>
              <p style="margin:8px 0 0;color:#bbf7d0;font-size:14px;">Your ParlayIQ subscription is live</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px;">
              <p style="margin:0 0 20px;color:#d1d5db;font-size:16px;line-height:1.6;">
                Welcome aboard! Your subscription has been confirmed and your ParlayIQ Bot is ready to use.
              </p>
              <p style="margin:0 0 32px;color:#d1d5db;font-size:16px;line-height:1.6;">
                Tap the button below to open Telegram and start the bot. It will immediately recognize your account and give you full access to daily AI-powered parlay picks.
              </p>
              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td align="center" style="padding-bottom:32px;">
                    <a href="${TELEGRAM_BOT_URL}"
                       style="display:inline-block;background:linear-gradient(135deg,#16a34a,#15803d);color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;padding:16px 40px;border-radius:8px;letter-spacing:0.3px;">
                      Open ParlayIQ Bot on Telegram →
                    </a>
                  </td>
                </tr>
              </table>
              <!-- Info Box -->
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#0d2818;border:1px solid #166534;border-radius:8px;">
                <tr>
                  <td style="padding:20px 24px;">
                    <p style="margin:0 0 8px;color:#4ade80;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">What you get</p>
                    <ul style="margin:0;padding-left:20px;color:#d1d5db;font-size:14px;line-height:1.8;">
                      <li>Daily AI-generated parlay picks</li>
                      <li>Real-time alerts via Telegram</li>
                      <li>Multi-sport coverage (NBA, NFL, MLB, NHL)</li>
                      <li>Confidence scores & reasoning for every pick</li>
                    </ul>
                  </td>
                </tr>
              </table>
              <p style="margin:32px 0 0;color:#6b7280;font-size:13px;line-height:1.6;">
                If you have any questions, reply to this email and we'll help you get started.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:24px 40px;border-top:1px solid #1f1f1f;text-align:center;">
              <p style="margin:0;color:#4b5563;font-size:12px;">
                ParlayIQ · AI-Powered Sports Betting Intelligence
              </p>
              <p style="margin:4px 0 0;color:#374151;font-size:11px;">
                This email was sent to ${email}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    if (!RESEND_API_KEY) {
      throw new Error("RESEND_API_KEY is not set");
    }

    const { email } = await req.json();

    if (!email || !email.includes("@")) {
      throw new Error("A valid email address is required");
    }

    logStep("Sending bot access email", { email });

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "ParlayIQ <noreply@parlaysimulator.lovable.app>",
        to: [email],
        subject: "🤖 Your ParlayIQ Bot Access is Ready",
        html: emailHtml(email),
      }),
    });

    if (!res.ok) {
      const errorBody = await res.text();
      throw new Error(`Resend API error ${res.status}: ${errorBody}`);
    }

    const data = await res.json();
    logStep("Email sent successfully", { id: data.id, email });

    return new Response(
      JSON.stringify({ success: true, emailId: data.id }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
