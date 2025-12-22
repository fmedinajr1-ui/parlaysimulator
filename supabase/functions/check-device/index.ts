import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const logStep = (step: string, details?: any) => {
  console.log(`[CHECK-DEVICE] ${step}`, details ? JSON.stringify(details) : '');
};

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { action, deviceFingerprint, userAgent, userId } = await req.json();
    
    // Get IP address from request headers
    const ipAddress = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 
                     req.headers.get('cf-connecting-ip') ||
                     req.headers.get('x-real-ip') ||
                     'unknown';

    logStep('Processing request', { action, deviceFingerprint: deviceFingerprint?.slice(0, 8), ipAddress });

    // Get device limits from database
    const { data: limits } = await supabase
      .from('device_limits')
      .select('*')
      .eq('is_active', true);

    const fingerprintLimit = limits?.find(l => l.limit_type === 'fingerprint')?.max_accounts || 2;
    const ipLimit = limits?.find(l => l.limit_type === 'ip_address')?.max_accounts || 5;

    if (action === 'check') {
      // Check how many accounts exist for this fingerprint
      const { data: fingerprintRegistrations, error: fpError } = await supabase
        .from('device_registrations')
        .select('id, user_id, is_blocked')
        .eq('device_fingerprint', deviceFingerprint);

      if (fpError) {
        logStep('Error checking fingerprint', fpError);
        throw new Error('Failed to check device registration');
      }

      // Check for blocked registrations
      const blockedRegistration = fingerprintRegistrations?.find(r => r.is_blocked);
      if (blockedRegistration) {
        logStep('Device is blocked', { fingerprint: deviceFingerprint?.slice(0, 8) });
        return new Response(
          JSON.stringify({
            allowed: false,
            reason: 'This device has been blocked from creating new accounts.',
            code: 'DEVICE_BLOCKED'
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const uniqueUsersByFingerprint = new Set(fingerprintRegistrations?.map(r => r.user_id) || []);
      
      if (uniqueUsersByFingerprint.size >= fingerprintLimit) {
        logStep('Fingerprint limit exceeded', { 
          count: uniqueUsersByFingerprint.size, 
          limit: fingerprintLimit 
        });
        return new Response(
          JSON.stringify({
            allowed: false,
            reason: `This device has reached the maximum number of accounts (${fingerprintLimit}). Contact support if you need assistance.`,
            code: 'FINGERPRINT_LIMIT'
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Check how many accounts exist for this IP (if IP is known)
      if (ipAddress && ipAddress !== 'unknown') {
        const { data: ipRegistrations, error: ipError } = await supabase
          .from('device_registrations')
          .select('id, user_id')
          .eq('ip_address', ipAddress);

        if (!ipError) {
          const uniqueUsersByIp = new Set(ipRegistrations?.map(r => r.user_id) || []);
          
          if (uniqueUsersByIp.size >= ipLimit) {
            logStep('IP limit exceeded', { 
              count: uniqueUsersByIp.size, 
              limit: ipLimit,
              ip: ipAddress 
            });
            return new Response(
              JSON.stringify({
                allowed: false,
                reason: `Too many accounts have been created from your network. Contact support if you need assistance.`,
                code: 'IP_LIMIT'
              }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
        }
      }

      logStep('Device check passed', { 
        fingerprintAccounts: uniqueUsersByFingerprint.size 
      });

      return new Response(
        JSON.stringify({
          allowed: true,
          fingerprintAccounts: uniqueUsersByFingerprint.size,
          remainingAccounts: fingerprintLimit - uniqueUsersByFingerprint.size
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'register') {
      if (!userId) {
        throw new Error('User ID is required for registration');
      }

      // Check if this user already has a registration
      const { data: existingReg } = await supabase
        .from('device_registrations')
        .select('id')
        .eq('user_id', userId)
        .eq('device_fingerprint', deviceFingerprint)
        .single();

      if (existingReg) {
        logStep('Device already registered for this user');
        return new Response(
          JSON.stringify({ success: true, message: 'Device already registered' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Register the device
      const { error: insertError } = await supabase
        .from('device_registrations')
        .insert({
          user_id: userId,
          device_fingerprint: deviceFingerprint,
          ip_address: ipAddress !== 'unknown' ? ipAddress : null,
          user_agent: userAgent
        });

      if (insertError) {
        logStep('Error registering device', insertError);
        throw new Error('Failed to register device');
      }

      logStep('Device registered successfully', { userId, fingerprint: deviceFingerprint?.slice(0, 8) });

      return new Response(
        JSON.stringify({ success: true, message: 'Device registered' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    throw new Error('Invalid action');

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logStep('Error', { message: errorMessage });
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
