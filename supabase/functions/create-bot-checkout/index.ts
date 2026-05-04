import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// All-Access — ParlayFarm $99/mo, 3-day free trial.
// Legacy Top Dog / Kennel Club price IDs are kept so existing subs keep billing,
// but new signups always go through ALL_ACCESS_PRICE_ID.
const ALL_ACCESS_PRICE_ID = "price_1TOg2P9D6r1PTCBBzjJHrNmg"; // $99/mo
const LEGACY_TOP_DOG_PRICE_ID = "price_1TOffv9D6r1PTCBBnKoRUEYs"; // existing $29.99/mo subs
const LEGACY_KENNEL_PRICE_ID = "price_1TOg2P9D6r1PTCBBzjJHrNmg";  // existing $99/mo subs
const LEGACY_DEFAULT_PRICE_ID = "price_1T1HU99D6r1PTCBBLQaWi80Z";
const LEGACY_SCOUT_PRICE_ID = "price_1T2br19D6r1PTCBBfrDD4opY";

const TRIAL_DAYS = 3;

function generatePassword(length = 8): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => chars[b % chars.length]).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, priceId, tier } = await req.json();
    if (!email || !email.includes("@")) {
      throw new Error("A valid email is required");
    }

    // New signups always land on All-Access. priceId param kept for legacy callers
    // (e.g. an existing customer-portal flow) but ignored unless it matches a known legacy price.
    const knownLegacy =
      priceId === LEGACY_TOP_DOG_PRICE_ID ||
      priceId === LEGACY_KENNEL_PRICE_ID ||
      priceId === LEGACY_DEFAULT_PRICE_ID ||
      priceId === LEGACY_SCOUT_PRICE_ID;
    const resolvedPriceId = knownLegacy ? priceId : ALL_ACCESS_PRICE_ID;
    // Every paid signup is treated as all_access for tier gating downstream.
    const resolvedTier = "all_access";
    const trialDays = TRIAL_DAYS;

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    // Generate a one-time password and tag it as all_access so the Telegram redeem
    // step can propagate the tier into bot_authorized_users.
    const password = generatePassword();
    const { data, error } = await supabaseClient
      .from("bot_access_passwords")
      .insert({
        password,
        created_by: "stripe_checkout",
        is_active: true,
        max_uses: 1,
        email: email,
        tier: resolvedTier,
      })
      .select("id")
      .single();

    if (error) throw new Error(`Failed to create password: ${error.message}`);
    const passwordId = data.id;

    const customers = await stripe.customers.list({ email, limit: 1 });
    let customerId: string | undefined;
    if (customers.data.length > 0) {
      customerId = customers.data[0].id;
    }

    const origin = req.headers.get("origin") || "https://parlaysimulator.lovable.app";

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      customer_email: customerId ? undefined : email,
      line_items: [
        { price: resolvedPriceId, quantity: 1 },
        {
          price_data: {
            currency: "usd",
            product_data: { name: "Card authentication hold" },
            unit_amount: 5000, // $50.00
          },
          quantity: 1,
        },
      ],
      mode: "subscription",
      payment_method_types: ["card"],
      payment_method_collection: "always",
      consent_collection: {
        terms_of_service: "required",
      },
      custom_text: {
        terms_of_service_acceptance: {
          message:
            "By subscribing you agree to a 3-day free trial. A $50 card authentication hold will be placed now. Your card will be charged $99/month after the trial unless you cancel.",
        },
      },
      subscription_data: {
        trial_period_days: trialDays,
        trial_settings: {
          end_behavior: {
            missing_payment_method: "cancel",
          },
        },
      },
      metadata: { password_id: passwordId, tier: resolvedTier, requested_tier: tier || "all_access" },
      success_url: `${origin}/bot-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/`,
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
