import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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
    const { email } = await req.json();
    if (!email || !email.includes("@")) {
      throw new Error("A valid email is required");
    }
    const normalizedEmail = String(email).trim().toLowerCase();

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    // Record the lead
    await supabaseClient.from("leads").insert({
      email: normalizedEmail,
      source: "pup_signup",
      metadata: { tier: "pup" },
    });

    // Generate a one-time password the user will redeem in Telegram via /start <password>
    const password = generatePassword();
    const { data: pwRow, error: pwErr } = await supabaseClient
      .from("bot_access_passwords")
      .insert({
        password,
        created_by: "pup_signup",
        is_active: true,
        max_uses: 1,
        email: normalizedEmail,
        tier: "pup",
      })
      .select("id")
      .single();
    if (pwErr) throw new Error(`Failed to create access password: ${pwErr.message}`);
    const passwordId = pwRow.id;

    // Create (or find) a Supabase auth user so /link <email> works as a fallback
    try {
      const { data: existing } = await supabaseClient.auth.admin
        .listUsers({ page: 1, perPage: 1 } as any);
      // listUsers can't filter by email reliably; just attempt create and ignore conflict
      const randomPwd = crypto.randomUUID() + crypto.randomUUID();
      const { error: createErr } = await supabaseClient.auth.admin.createUser({
        email: normalizedEmail,
        password: randomPwd,
        email_confirm: true,
        user_metadata: { source: "pup_signup", tier: "pup" },
      });
      if (createErr && !/already (registered|exists)/i.test(createErr.message)) {
        console.warn("[create-free-signup] auth.admin.createUser warning:", createErr.message);
      }
    } catch (e) {
      console.warn("[create-free-signup] createUser threw:", String(e));
    }

    // Upsert email_subscribers so downstream broadcasts can find them
    try {
      await supabaseClient
        .from("email_subscribers")
        .upsert(
          { email: normalizedEmail, source: "pup_signup", is_subscribed: true },
          { onConflict: "email" },
        );
    } catch (e) {
      console.warn("[create-free-signup] email_subscribers upsert warning:", String(e));
    }

    // Find or create Stripe customer
    const customers = await stripe.customers.list({ email: normalizedEmail, limit: 1 });
    let customerId: string;
    if (customers.data.length > 0) {
      customerId = customers.data[0].id;
    } else {
      const customer = await stripe.customers.create({ email: normalizedEmail, metadata: { tier: "pup" } });
      customerId = customer.id;
    }

    const origin = req.headers.get("origin") || "https://parlayfarm.com";

    // Setup mode: collect & verify card, no charge
    const session = await stripe.checkout.sessions.create({
      mode: "setup",
      customer: customerId,
      payment_method_types: ["card"],
      success_url: `${origin}/bot-success?session_id={CHECKOUT_SESSION_ID}&tier=pup`,
      cancel_url: `${origin}/`,
      metadata: { tier: "pup", email: normalizedEmail, password_id: passwordId },
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
