import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CHECK-SUBSCRIPTION] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );

  try {
    logStep("Function started");

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

    const authHeader = req.headers.get("Authorization");
    
    // If no auth header, return free tier status
    if (!authHeader) {
      logStep("No auth header, returning free tier status");
      return new Response(JSON.stringify({
        subscribed: false,
        isAdmin: false,
        canScan: true,
        scansRemaining: 3,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseClient.auth.getUser(token);
    
    // If auth error, return free tier status
    if (userError || !userData.user?.email) {
      logStep("Auth error or no user email, returning free tier status", { error: userError?.message });
      return new Response(JSON.stringify({
        subscribed: false,
        isAdmin: false,
        canScan: true,
        scansRemaining: 3,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }
    
    const user = userData.user;
    logStep("User authenticated", { userId: user.id, email: user.email });

    // Check if user is admin
    const { data: roleData } = await supabaseClient
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .maybeSingle();

    if (roleData) {
      logStep("User is admin, granting unlimited access");
      return new Response(JSON.stringify({
        subscribed: false,
        isAdmin: true,
        canScan: true,
        scansRemaining: -1,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // Check Stripe subscription
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });

    let isSubscribed = false;
    let subscriptionEnd = null;

    if (customers.data.length > 0) {
      const customerId = customers.data[0].id;
      logStep("Found Stripe customer", { customerId });

      const subscriptions = await stripe.subscriptions.list({
        customer: customerId,
        status: "active",
        limit: 1,
      });

      if (subscriptions.data.length > 0) {
        isSubscribed = true;
        subscriptionEnd = new Date(subscriptions.data[0].current_period_end * 1000).toISOString();
        logStep("Active subscription found", { subscriptionEnd });
        
        // Update local subscription record
        await supabaseClient.from('subscriptions').upsert({
          user_id: user.id,
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptions.data[0].id,
          status: 'active',
          current_period_end: subscriptionEnd,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });
      }
    }

    // If subscribed, unlimited access
    if (isSubscribed) {
      return new Response(JSON.stringify({
        subscribed: true,
        isAdmin: false,
        canScan: true,
        scansRemaining: -1,
        subscriptionEnd,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // Check scan usage for free users
    const { data: usageData } = await supabaseClient
      .from('scan_usage')
      .select('scan_count')
      .eq('user_id', user.id)
      .maybeSingle();

    const scanCount = usageData?.scan_count || 0;
    const scansRemaining = Math.max(0, 3 - scanCount);
    const canScan = scansRemaining > 0;

    logStep("Free user scan status", { scanCount, scansRemaining, canScan });

    return new Response(JSON.stringify({
      subscribed: false,
      isAdmin: false,
      canScan,
      scansRemaining,
      scanCount,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
