// Polled by /bot-success while we wait for the Stripe webhook to provision
// the Pup account. Returns { activated, password? } based on the Stripe
// session_id that came back from checkout.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { session_id } = await req.json();
    if (!session_id) throw new Error("session_id required");

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });
    const session = await stripe.checkout.sessions.retrieve(session_id);

    const tier = (session.metadata?.tier ?? "").toLowerCase();
    if (tier !== "pup") {
      return new Response(JSON.stringify({ activated: false, reason: "not_pup" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (session.payment_status !== "paid") {
      return new Response(JSON.stringify({ activated: false, reason: "payment_pending", payment_status: session.payment_status }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    // Prefer password_id metadata (set by webhook), fall back to email lookup.
    const passwordId = session.metadata?.password_id;
    let pw: any = null;
    if (passwordId) {
      const { data } = await supabase
        .from("bot_access_passwords")
        .select("id, password, retrieved")
        .eq("id", passwordId)
        .maybeSingle();
      pw = data;
    } else {
      const email = (session.metadata?.email || session.customer_details?.email || session.customer_email || "")
        .trim().toLowerCase();
      if (email) {
        const { data } = await supabase
          .from("bot_access_passwords")
          .select("id, password, retrieved")
          .eq("created_by", "pup_signup")
          .ilike("email", email)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        pw = data;
      }
    }

    if (!pw) {
      // Webhook hasn't fired yet — keep polling.
      return new Response(JSON.stringify({ activated: false, reason: "webhook_pending" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      activated: true,
      password: pw.password,
      already_retrieved: !!pw.retrieved,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("[check-pup-activation] error", e);
    return new Response(JSON.stringify({ activated: false, error: e?.message ?? "error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});