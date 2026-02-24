import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { session_id } = await req.json();
    if (!session_id) throw new Error("session_id is required");

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    const session = await stripe.checkout.sessions.retrieve(session_id);

    if (session.payment_status !== "paid" && session.status !== "complete") {
      throw new Error("Payment has not been completed");
    }

    const passwordId = session.metadata?.password_id;
    if (!passwordId) {
      throw new Error("No password associated with this session");
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    // Check if already retrieved
    const { data: pw, error: fetchError } = await supabaseClient
      .from("bot_access_passwords")
      .select("password, retrieved")
      .eq("id", passwordId)
      .single();

    if (fetchError || !pw) {
      throw new Error("Password not found");
    }

    if (pw.retrieved) {
      return new Response(
        JSON.stringify({ already_retrieved: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // Mark as retrieved
    await supabaseClient
      .from("bot_access_passwords")
      .update({ retrieved: true })
      .eq("id", passwordId);

    return new Response(
      JSON.stringify({ password: pw.password, already_retrieved: false }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
