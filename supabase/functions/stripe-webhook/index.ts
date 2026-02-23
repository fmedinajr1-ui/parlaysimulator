import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const logStep = (step: string, details?: Record<string, unknown>) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[STRIPE-WEBHOOK] ${step}${detailsStr}`);
};

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
const ADMIN_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID");
const TELEGRAM_API = TELEGRAM_BOT_TOKEN ? `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}` : null;

async function notifyAdmin(message: string) {
  if (!TELEGRAM_API || !ADMIN_CHAT_ID) {
    logStep("Cannot notify admin - missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID");
    return;
  }
  try {
    await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: ADMIN_CHAT_ID, text: message, parse_mode: "Markdown" }),
    });
  } catch (e) {
    logStep("Failed to notify admin via Telegram", { error: String(e) });
  }
}

serve(async (req) => {
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");

  if (!stripeKey || !webhookSecret) {
    logStep("ERROR: Missing environment variables", { 
      hasStripeKey: !!stripeKey, 
      hasWebhookSecret: !!webhookSecret 
    });
    return new Response(
      JSON.stringify({ error: "Server configuration error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    logStep("Webhook received");

    const body = await req.text();
    const signature = req.headers.get("stripe-signature");

    if (!signature) {
      logStep("ERROR: No stripe-signature header");
      return new Response(
        JSON.stringify({ error: "No signature" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
      logStep("Signature verified", { eventType: event.type, eventId: event.id });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logStep("ERROR: Signature verification failed", { error: errorMessage });
      return new Response(
        JSON.stringify({ error: "Invalid signature" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      
      logStep("Processing checkout session", { 
        sessionId: session.id,
        metadata: session.metadata 
      });

      const userId = session.metadata?.user_id;
      const scansToCredit = session.metadata?.scans_to_credit;

      if (!userId || !scansToCredit) {
        logStep("No scan credit metadata, skipping credit step", { userId, scansToCredit });
      } else {
        const { data, error } = await supabaseClient.rpc("add_paid_scans", {
          p_user_id: userId,
          p_amount: parseInt(scansToCredit, 10),
        });

        if (error) {
          logStep("ERROR: Failed to credit scans", { error: error.message });
        } else {
          logStep("Successfully credited scans", { userId, scansToCredit, result: data });
        }
      }
    } else if (event.type === "customer.subscription.updated") {
      const subscription = event.data.object as Stripe.Subscription;
      logStep("Subscription updated", { 
        subId: subscription.id, 
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        status: subscription.status 
      });

      if (subscription.cancel_at_period_end) {
        const endDate = new Date(subscription.current_period_end * 1000);
        const endStr = endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const customerEmail = typeof subscription.customer === 'string' ? subscription.customer : '';
        
        await notifyAdmin(`⚠️ *Subscription Cancelling*\n\nCustomer ID: ${subscription.customer}\nStatus: ${subscription.status}\nAccess ends: ${endStr}`);
      }
    } else if (event.type === "customer.subscription.deleted") {
      const subscription = event.data.object as Stripe.Subscription;
      logStep("Subscription deleted", { subId: subscription.id, customerId: subscription.customer });

      // Try to find and deactivate the user
      // Look up email from Stripe customer
      try {
        const customer = await stripe.customers.retrieve(subscription.customer as string);
        if (customer && !customer.deleted && customer.email) {
          // Find chat_id via email_subscribers
          const { data: emailSub } = await supabaseClient
            .from("email_subscribers")
            .select("telegram_chat_id")
            .eq("email", customer.email)
            .maybeSingle();

          if (emailSub?.telegram_chat_id) {
            await supabaseClient
              .from("bot_authorized_users")
              .update({ is_active: false })
              .eq("chat_id", emailSub.telegram_chat_id);
            logStep("Deactivated user after subscription deletion", { chatId: emailSub.telegram_chat_id });
          }

          await notifyAdmin(`🚫 *Subscription Expired*\n\nEmail: ${customer.email}\nCustomer ID: ${subscription.customer}\nUser has been deactivated.`);
        }
      } catch (e) {
        logStep("Error looking up customer for deactivation", { error: String(e) });
        await notifyAdmin(`🚫 *Subscription Deleted*\n\nCustomer ID: ${subscription.customer}\n⚠️ Could not auto-deactivate user.`);
      }
    } else {
      logStep("Ignoring event type", { eventType: event.type });
    }

    return new Response(
      JSON.stringify({ received: true }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR: Unexpected error", { error: errorMessage });
    return new Response(
      JSON.stringify({ error: "Webhook processing failed" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});