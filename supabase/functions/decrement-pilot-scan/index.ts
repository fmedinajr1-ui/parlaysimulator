import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[DECREMENT-PILOT-SCAN] ${step}${detailsStr}`);
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

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError || !userData.user) throw new Error("User not authenticated");

    const user = userData.user;
    const { quotaType = 'scan' } = await req.json().catch(() => ({ quotaType: 'scan' }));

    logStep("Decrementing quota", { userId: user.id, quotaType });

    // Check if user is admin or subscribed (they have unlimited)
    const { data: roleData } = await supabaseClient
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id);

    const roles = roleData?.map(r => r.role) || [];
    
    if (roles.includes('admin')) {
      logStep("Admin user - no quota decrement needed");
      return new Response(JSON.stringify({ success: true, unlimited: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // Check subscription status
    const { data: subData } = await supabaseClient
      .from('subscriptions')
      .select('status')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .maybeSingle();

    if (subData) {
      logStep("Subscribed user - no quota decrement needed");
      return new Response(JSON.stringify({ success: true, unlimited: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // For pilot users, use the quota system
    if (roles.includes('pilot')) {
      const { data: result, error } = await supabaseClient.rpc('decrement_pilot_quota', {
        p_user_id: user.id,
        p_quota_type: quotaType
      });

      if (error) {
        logStep("Error decrementing pilot quota", { error: error.message });
        throw new Error(`Failed to decrement quota: ${error.message}`);
      }

      logStep("Pilot quota decremented", { result });

      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // For regular free users, use the old scan_usage system
    const { error: incrementError } = await supabaseClient.rpc('increment_scan_count', {
      p_user_id: user.id
    });

    if (incrementError) {
      logStep("Error incrementing scan count", { error: incrementError.message });
      throw new Error(`Failed to increment scan: ${incrementError.message}`);
    }

    logStep("Free user scan incremented");

    return new Response(JSON.stringify({ success: true, used: 'free' }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(JSON.stringify({ error: errorMessage, success: false }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
