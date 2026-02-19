import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { priceId, legs } = await req.json();

    if (!priceId || !legs?.length) {
      throw new Error("Missing priceId or legs");
    }

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    // Store legs in metadata (Stripe metadata values max 500 chars, so compress)
    const legsJson = JSON.stringify(legs.map((l: any) => ({
      d: l.description?.substring(0, 60),
      o: l.odds,
      p: l.player,
      t: l.propType,
    })));

    const origin = req.headers.get("origin") || "https://parlaysimulator.lovable.app";

    const session = await stripe.checkout.sessions.create({
      line_items: [{ price: priceId, quantity: 1 }],
      mode: "payment",
      success_url: `${origin}/?analysis_paid=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/`,
      metadata: {
        type: "analysis_unlock",
        legs: legsJson.substring(0, 500),
      },
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
