import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DEFAULT_PRICE_ID = "price_1T1HU99D6r1PTCBBLQaWi80Z";
const SCOUT_PRICE_ID = "price_1T2br19D6r1PTCBBfrDD4opY";
const TELEGRAM_BOT_URL = "https://t.me/parlayiqbot";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, priceId } = await req.json();
    if (!email || !email.includes("@")) {
      throw new Error("A valid email is required");
    }

    const resolvedPriceId = priceId || DEFAULT_PRICE_ID;

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    const customers = await stripe.customers.list({ email, limit: 1 });
    let customerId: string | undefined;
    if (customers.data.length > 0) {
      customerId = customers.data[0].id;
    }

    const isScoutTier = resolvedPriceId === SCOUT_PRICE_ID;
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      customer_email: customerId ? undefined : email,
      line_items: [{ price: resolvedPriceId, quantity: 1 }],
      mode: "subscription",
      payment_method_collection: "always",
      subscription_data: {
        trial_period_days: isScoutTier ? 1 : 3,
        trial_settings: {
          end_behavior: {
            missing_payment_method: "cancel",
          },
        },
      },
      success_url: isScoutTier ? `${req.headers.get("origin")}/scout` : TELEGRAM_BOT_URL,
      cancel_url: `${req.headers.get("origin")}/`,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
