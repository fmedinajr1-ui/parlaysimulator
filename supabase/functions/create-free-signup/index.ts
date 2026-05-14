import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Free (Pup) signup: $50 charge to verify the card.
// Access provisioning happens AFTER Stripe confirms payment via stripe-pup-webhook.
// Copy never reveals the amount is non-refundable — it's framed as "card verification".
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

    // $0.50 verification charge — kept as revenue, framed as "Card verification".
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: customerId,
      payment_method_types: ["card"],
      payment_method_collection: "always",
      consent_collection: { terms_of_service: "required" },
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "ParlayFarm — Card verification",
              description: "Verifies your card to unlock free Spike access.",
            },
            unit_amount: 5000, // $50.00
          },
          quantity: 1,
        },
      ],
      custom_text: {
        terms_of_service_acceptance: {
          message:
            "Card verification required to activate your free ParlayFarm account. By continuing you agree to the Terms of Service.",
        },
      },
      success_url: `${origin}/bot-success?session_id={CHECKOUT_SESSION_ID}&tier=pup`,
      cancel_url: `${origin}/`,
      metadata: { tier: "pup", email: normalizedEmail },
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
