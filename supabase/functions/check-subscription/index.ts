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

// Subscription price IDs
const ODDS_TRACKER_PRICE_ID = "price_1Sb7Tk9D6r1PTCBBmJ3jYBxo";
const ELITE_HITTER_PRICE_ID = "price_1SiyaG9D6r1PTCBBC4zJBRE5";
const BOT_PRO_PRICE_ID = "price_1T1HU99D6r1PTCBBLQaWi80Z";

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
    
    // If no auth header, return restricted status (pilot mode)
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
        hasOddsAccess: false,
        phoneVerified: false,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseClient.auth.getUser(token);
    
    // If auth error, return restricted status (pilot mode)
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
        hasOddsAccess: false,
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
    logStep("Phone verification status", { phoneVerified });

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
        hasOddsAccess: true,
        hasEliteAccess: true,
        phoneVerified: true, // Admins bypass phone verification
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // Check if user is in approved_odds_users table
    const { data: approvedUser } = await supabaseClient
      .from('approved_odds_users')
      .select('is_active')
      .eq('email', (user.email || '').toLowerCase())
      .eq('is_active', true)
      .maybeSingle();

    const isApprovedOddsUser = !!approvedUser;
    logStep("Approved odds user check", { isApprovedOddsUser });

    // Check Stripe subscription
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });

    let isSubscribed = false;
    let subscriptionEnd = null;
    let hasOddsSubscription = false;
    let hasEliteHitterSubscription = false;
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
        
        // Check if user has Odds Tracker Pro subscription
        hasOddsSubscription = subscriptions.data.some((sub: any) => 
          sub.items.data.some((item: any) => item.price.id === ODDS_TRACKER_PRICE_ID)
        );
        logStep("Odds Tracker subscription check", { hasOddsSubscription });
        
        // Check if user has Elite Hitter Pro subscription
        hasEliteHitterSubscription = subscriptions.data.some((sub: any) => 
          sub.items.data.some((item: any) => item.price.id === ELITE_HITTER_PRICE_ID)
        );
        logStep("Elite Hitter subscription check", { hasEliteHitterSubscription });
        
        // Check if user has Bot Pro subscription
        hasBotProSubscription = subscriptions.data.some((sub: any) => 
          sub.items.data.some((item: any) => item.price.id === BOT_PRO_PRICE_ID)
        );
        logStep("Bot Pro subscription check", { hasBotProSubscription });
        
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

    // Determine odds access: approved user OR has odds subscription
    const hasOddsAccess = isApprovedOddsUser || hasOddsSubscription;
    
    // Determine elite hitter access: subscription OR elite_access role OR admin
    const hasEliteHitterAccess = hasEliteHitterSubscription || hasEliteAccess;
    
    // Determine bot pro access
    const hasBotAccess = hasBotProSubscription || isAdmin;

    // If subscribed, unlimited access
    if (isSubscribed) {
      return new Response(JSON.stringify({
        subscribed: true,
        isAdmin: false,
        isPilotUser: false,
        canScan: true,
        scansRemaining: -1,
        subscriptionEnd,
        hasOddsAccess,
        hasEliteAccess,
        hasEliteHitterAccess,
        hasBotAccess,
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
        hasOddsAccess,
        hasEliteAccess,
        hasEliteHitterAccess: true, // full_access grants elite hitter
        phoneVerified,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // ========================================
    // DEFAULT: ALL USERS ARE RESTRICTED (PILOT MODE)
    // ========================================
    logStep("User is restricted (pilot mode by default)");

    // Check or create pilot quota for user
    let { data: quotaData } = await supabaseClient
      .from('pilot_user_quotas')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    // Auto-create quota if doesn't exist
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
      
      // Users who purchased scans get full feature access
      const hasPaidAccess = quotaData.paid_scan_balance > 0;

      logStep("Pilot user quota status", { 
        freeScansRemaining: quotaData.free_scans_remaining,
        freeComparesRemaining: quotaData.free_compares_remaining,
        paidScanBalance: quotaData.paid_scan_balance,
        hasPaidAccess,
        canScan 
      });

      return new Response(JSON.stringify({
        subscribed: false,
        isAdmin: false,
        isPilotUser: !hasPaidAccess, // Unlock features if they have paid scans
        canScan,
        scansRemaining: totalScansAvailable,
        freeScansRemaining: quotaData.free_scans_remaining,
        freeComparesRemaining: quotaData.free_compares_remaining,
        paidScanBalance: quotaData.paid_scan_balance,
        hasOddsAccess: false,
        hasEliteAccess,
        hasEliteHitterAccess: hasEliteAccess, // Elite access role grants hitter
        phoneVerified,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // Fallback - shouldn't reach here but return restricted status
    return new Response(JSON.stringify({
      subscribed: false,
      isAdmin: false,
      isPilotUser: true,
      canScan: true,
      freeScansRemaining: 5,
      freeComparesRemaining: 3,
      paidScanBalance: 0,
      scansRemaining: 5,
      hasOddsAccess: false,
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
