import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DEFAULT_PRICE_ID = "price_1T1HU99D6r1PTCBBLQaWi80Z";
const SCOUT_PRICE_ID = "price_1T2br19D6r1PTCBBfrDD4opY";

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
    const { email, priceId } = await req.json();
    if (!email || !email.includes("@")) {
      throw new Error("A valid email is required");
    }

    const resolvedPriceId = priceId || DEFAULT_PRICE_ID;
    const isScoutTier = resolvedPriceId === SCOUT_PRICE_ID;

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    // Generate a one-time password and insert into DB (only for non-scout tier)
    let passwordId: string | undefined;
    if (!isScoutTier) {
      const password = generatePassword();
      const { data, error } = await supabaseClient
        .from("bot_access_passwords")
        .insert({
          password,
          created_by: "stripe_checkout",
          is_active: true,
          max_uses: 1,
        })
        .select("id")
        .single();

      if (error) throw new Error(`Failed to create password: ${error.message}`);
      passwordId = data.id;
    }

    const customers = await stripe.customers.list({ email, limit: 1 });
    let customerId: string | undefined;
    if (customers.data.length > 0) {
      customerId = customers.data[0].id;
    }

    const origin = req.headers.get("origin") || "https://parlaysimulator.lovable.app";

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
      metadata: passwordId ? { password_id: passwordId } : undefined,
      success_url: isScoutTier
        ? `${origin}/scout`
        : `${origin}/bot-success?session_id={CHECKOUT_SESSION_ID}`,
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
