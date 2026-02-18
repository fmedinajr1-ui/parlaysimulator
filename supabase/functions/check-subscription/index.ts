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

const BOT_PRICE_IDS: Record<string, 'entry' | 'pro' | 'ultimate'> = {
  "price_1T1HU99D6r1PTCBBLQaWi80Z": "entry",
  "price_1T2D1i9D6r1PTCBBSlceNbTR": "entry",
  "price_1T2D4I9D6r1PTCBB3kngnoRk": "pro",
  "price_1T2DD99D6r1PTCBBpcsPloWj": "ultimate",
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
    
    if (!authHeader) {
      logStep("No auth header, returning restricted pilot status");
      return new Response(JSON.stringify({
        subscribed: false,
        isAdmin: false,
        isPilotUser: true,
        canScan: true,
        freeScansRemaining: 5,
        freeComparesRemaining: 3,
        paidScanBalance: 0,
        scansRemaining: 5,
        phoneVerified: false,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseClient.auth.getUser(token);
    
    if (userError || !userData.user?.email) {
      logStep("Auth error or no user email, returning restricted pilot status", { error: userError?.message });
      return new Response(JSON.stringify({
        subscribed: false,
        isAdmin: false,
        isPilotUser: true,
        canScan: true,
        freeScansRemaining: 5,
        freeComparesRemaining: 3,
        paidScanBalance: 0,
        scansRemaining: 5,
        phoneVerified: false,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }
    
    const user = userData.user;
    logStep("User authenticated", { userId: user.id, email: user.email });

    // Check phone verification status from profiles
    const { data: profileData } = await supabaseClient
      .from('profiles')
      .select('phone_verified')
      .eq('user_id', user.id)
      .maybeSingle();
    
    const phoneVerified = profileData?.phone_verified ?? false;

    // Check user roles (admin, full_access, elite_access, etc.)
    const { data: rolesData } = await supabaseClient
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id);

    const roles = rolesData?.map(r => r.role) || [];
    const isAdmin = roles.includes('admin');
    const hasFullAccess = roles.includes('full_access');
    const hasEliteAccess = roles.includes('elite_access') || isAdmin;

    logStep("User roles", { roles, isAdmin, hasFullAccess, hasEliteAccess });

    // Admin gets unlimited access
    if (isAdmin) {
      logStep("User is admin, granting unlimited access");
      return new Response(JSON.stringify({
        subscribed: false,
        isAdmin: true,
        isPilotUser: false,
        canScan: true,
        scansRemaining: -1,
        phoneVerified: true,
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
    let hasBotProSubscription = false;

    if (customers.data.length > 0) {
      const customerId = customers.data[0].id;
      logStep("Found Stripe customer", { customerId });

      const subscriptions = await stripe.subscriptions.list({
        customer: customerId,
        status: "active",
        limit: 10,
      });

      if (subscriptions.data.length > 0) {
        isSubscribed = true;
        subscriptionEnd = new Date(subscriptions.data[0].current_period_end * 1000).toISOString();
        logStep("Active subscription found", { subscriptionEnd });
        
        // Check if any active subscription belongs to a bot price
        for (const sub of subscriptions.data) {
          for (const item of sub.items.data) {
            if (BOT_PRICE_IDS[item.price.id]) {
              hasBotProSubscription = true;
              break;
            }
          }
          if (hasBotProSubscription) break;
        }
        
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

    // Detect bot tier from active subscription price IDs
    let botTier: string | null = null;
    if (hasBotProSubscription && customers.data.length > 0) {
      const activeSubs = await stripe.subscriptions.list({
        customer: customers.data[0].id,
        status: "active",
        limit: 10,
      });
      for (const sub of activeSubs.data) {
        for (const item of sub.items.data) {
          if (BOT_PRICE_IDS[item.price.id]) {
            botTier = BOT_PRICE_IDS[item.price.id];
            break;
          }
        }
        if (botTier) break;
      }
    }

    // If subscribed, full access to everything
    if (isSubscribed) {
      return new Response(JSON.stringify({
        subscribed: true,
        isAdmin: false,
        isPilotUser: false,
        canScan: true,
        scansRemaining: -1,
        subscriptionEnd,
        hasBotAccess: hasBotProSubscription || isAdmin,
        botTier,
        phoneVerified,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // If user has full_access role (granted by admin), unlimited access
    if (hasFullAccess) {
      logStep("User has full_access role, granting unlimited access");
      return new Response(JSON.stringify({
        subscribed: false,
        isAdmin: false,
        isPilotUser: false,
        canScan: true,
        scansRemaining: -1,
        phoneVerified,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // DEFAULT: ALL USERS ARE RESTRICTED (PILOT MODE)
    logStep("User is restricted (pilot mode by default)");

    let { data: quotaData } = await supabaseClient
      .from('pilot_user_quotas')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!quotaData) {
      logStep("Creating pilot quota for new user");
      const { data: newQuota, error: createError } = await supabaseClient
        .from('pilot_user_quotas')
        .insert({
          user_id: user.id,
          free_scans_remaining: 5,
          free_compares_remaining: 3,
          paid_scan_balance: 0,
        })
        .select()
        .single();

      if (createError) {
        logStep("Error creating quota", { error: createError.message });
      } else {
        quotaData = newQuota;
      }
    }

    if (quotaData) {
      const totalScansAvailable = quotaData.free_scans_remaining + quotaData.paid_scan_balance;
      const canScan = totalScansAvailable > 0;
      const hasPaidAccess = quotaData.paid_scan_balance > 0;

      return new Response(JSON.stringify({
        subscribed: false,
        isAdmin: false,
        isPilotUser: !hasPaidAccess,
        canScan,
        scansRemaining: totalScansAvailable,
        freeScansRemaining: quotaData.free_scans_remaining,
        freeComparesRemaining: quotaData.free_compares_remaining,
        paidScanBalance: quotaData.paid_scan_balance,
        phoneVerified,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // Fallback
    return new Response(JSON.stringify({
      subscribed: false,
      isAdmin: false,
      isPilotUser: true,
      canScan: true,
      freeScansRemaining: 5,
      freeComparesRemaining: 3,
      paidScanBalance: 0,
      scansRemaining: 5,
      phoneVerified: false,
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
