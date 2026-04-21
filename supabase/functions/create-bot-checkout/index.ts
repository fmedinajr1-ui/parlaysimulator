import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DEFAULT_PRICE_ID = "price_1T1HU99D6r1PTCBBLQaWi80Z";
const SCOUT_PRICE_ID = "price_1T2br19D6r1PTCBBfrDD4opY";
const TOP_DOG_PRICE_ID = "price_1TOffv9D6r1PTCBBnKoRUEYs";    // ParlayFarm — Top Dog $29.99/mo
const KENNEL_CLUB_PRICE_ID = "price_1TOg2P9D6r1PTCBBzjJHrNmg"; // ParlayFarm — Kennel Club $99/mo

const TIER_TO_PRICE: Record<string, string> = {
  top_dog: TOP_DOG_PRICE_ID,
  kennel_club: KENNEL_CLUB_PRICE_ID,
};

const TIER_TRIAL_DAYS: Record<string, number> = {
  top_dog: 7,
  kennel_club: 3,
};

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

    // Resolve price: explicit priceId wins, else map tier, else legacy default
    const resolvedPriceId = priceId || (tier && TIER_TO_PRICE[tier]) || DEFAULT_PRICE_ID;
    const isScoutTier = resolvedPriceId === SCOUT_PRICE_ID;
    const isTopDogTier = resolvedPriceId === TOP_DOG_PRICE_ID;
    const isKennelClubTier = resolvedPriceId === KENNEL_CLUB_PRICE_ID;
    const trialDays = (tier && TIER_TRIAL_DAYS[tier]) || (isScoutTier ? 1 : 3);

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    // Generate a one-time password for ALL tiers (bot + scout)
    const password = generatePassword();
    const { data, error } = await supabaseClient
      .from("bot_access_passwords")
      .insert({
        password,
        created_by: "stripe_checkout",
        is_active: true,
        max_uses: 1,
        email: email,
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
          message: isScoutTier
            ? "By subscribing, you agree to a 1-day free trial. A $50 card authentication hold will be charged now. Your card will be charged after the trial unless you cancel."
            : "By subscribing, you agree to a 3-day free trial. A $50 card authentication hold will be charged now. Your card will be charged after the trial unless you cancel.",
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
      metadata: { password_id: passwordId, tier: tier || "legacy" },
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
