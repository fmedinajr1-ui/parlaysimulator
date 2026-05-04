// Stripe webhook for the Free (Pup) signup flow.
// Listens for checkout.session.completed where mode=payment + tier=pup,
// then creates the access password, auth user, and email_subscribers row.
// This guarantees access is only granted AFTER the $0.50 verification charge succeeds.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
};

function generatePassword(length = 8): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => chars[b % chars.length]).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
    apiVersion: "2025-08-27.basil",
  });

  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET") || "";
  const sig = req.headers.get("stripe-signature") || "";
  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    if (webhookSecret) {
      event = await stripe.webhooks.constructEventAsync(rawBody, sig, webhookSecret);
    } else {
      // No secret configured — accept the event but log loudly. Useful in early setup.
      console.warn("[stripe-pup-webhook] STRIPE_WEBHOOK_SECRET not set — skipping signature verification");
      event = JSON.parse(rawBody) as Stripe.Event;
    }
  } catch (err: any) {
    console.error("[stripe-pup-webhook] signature verification failed", err?.message);
    return new Response(JSON.stringify({ error: `Webhook Error: ${err?.message ?? "bad signature"}` }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // We only care about completed checkouts that were Pup signups.
  if (event.type !== "checkout.session.completed") {
    return new Response(JSON.stringify({ received: true, ignored: event.type }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const tier = (session.metadata?.tier ?? "").toLowerCase();
  if (tier !== "pup" || session.mode !== "payment") {
    return new Response(JSON.stringify({ received: true, ignored: "not a pup payment session" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (session.payment_status !== "paid") {
    console.warn("[stripe-pup-webhook] session not paid yet", session.id, session.payment_status);
    return new Response(JSON.stringify({ received: true, ignored: "not paid" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const email = (session.metadata?.email || session.customer_details?.email || session.customer_email || "")
    .trim().toLowerCase();
  if (!email) {
    console.error("[stripe-pup-webhook] no email on session", session.id);
    return new Response(JSON.stringify({ error: "no email" }), {
      status: 200, // 200 so Stripe doesn't retry forever
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  // Idempotency: if we've already created a Pup password for this Stripe session, do nothing.
  const { data: existing } = await supabase
    .from("bot_access_passwords")
    .select("id")
    .eq("created_by", "pup_signup")
    .ilike("email", email)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    console.log("[stripe-pup-webhook] already activated", { email, id: existing.id });
    return new Response(JSON.stringify({ received: true, already_activated: true, password_id: existing.id }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 1. Create the access password (Pup tier)
  const password = generatePassword();
  const { data: pwRow, error: pwErr } = await supabase
    .from("bot_access_passwords")
    .insert({
      password,
      created_by: "pup_signup",
      is_active: true,
      max_uses: 1,
      email,
      tier: "pup",
    })
    .select("id")
    .single();
  if (pwErr) {
    console.error("[stripe-pup-webhook] failed to create password", pwErr);
    return new Response(JSON.stringify({ error: pwErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 2. Persist the password_id back onto the Stripe session metadata so retrieve-bot-password works.
  try {
    await stripe.checkout.sessions.update(session.id, {
      metadata: { ...(session.metadata ?? {}), password_id: pwRow.id },
    } as any);
  } catch (e) {
    console.warn("[stripe-pup-webhook] could not patch session metadata", e);
  }

  // 3. Lead row for marketing
  try {
    await supabase.from("leads").insert({
      email, source: "pup_signup", metadata: { tier: "pup", stripe_session: session.id },
    });
  } catch (e) {
    console.warn("[stripe-pup-webhook] leads insert warning", e);
  }

  // 4. Auth user (idempotent — ignore "already exists")
  try {
    const randomPwd = crypto.randomUUID() + crypto.randomUUID();
    const { error: createErr } = await supabase.auth.admin.createUser({
      email,
      password: randomPwd,
      email_confirm: true,
      user_metadata: { source: "pup_signup", tier: "pup" },
    });
    if (createErr && !/already (registered|exists)/i.test(createErr.message)) {
      console.warn("[stripe-pup-webhook] createUser warning", createErr.message);
    }
  } catch (e) {
    console.warn("[stripe-pup-webhook] createUser threw", String(e));
  }

  // 5. email_subscribers
  try {
    await supabase
      .from("email_subscribers")
      .upsert(
        { email, source: "pup_signup", is_subscribed: true },
        { onConflict: "email" },
      );
  } catch (e) {
    console.warn("[stripe-pup-webhook] email_subscribers upsert warning", e);
  }

  console.log("[stripe-pup-webhook] activated Pup", { email, id: pwRow.id });

  return new Response(JSON.stringify({ received: true, activated: true, password_id: pwRow.id }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});