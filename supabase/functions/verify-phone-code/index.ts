import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const logStep = (step: string, details?: any) => {
  console.log(`[VERIFY-PHONE-CODE] ${step}`, details ? JSON.stringify(details) : '');
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { phone_number, code, user_id } = await req.json();
    
    logStep('Received request', { phone_number: phone_number?.substring(0, 6) + '***', user_id });

    if (!phone_number || !code || !user_id) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get Twilio credentials
    const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
    const authToken = Deno.env.get('TWILIO_AUTH_TOKEN');
    const verifyServiceSid = Deno.env.get('TWILIO_VERIFY_SERVICE_SID');

    if (!accountSid || !authToken || !verifyServiceSid) {
      logStep('Missing Twilio credentials');
      return new Response(
        JSON.stringify({ error: 'SMS service not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    logStep('Verifying code via Twilio Verify API');

    // Use Twilio Verify API to check the code
    const twilioUrl = `https://verify.twilio.com/v2/Services/${verifyServiceSid}/VerificationChecks`;
    
    const formData = new URLSearchParams();
    formData.append('To', phone_number);
    formData.append('Code', code);

    const twilioResponse = await fetch(twilioUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${btoa(`${accountSid}:${authToken}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });

    const twilioResult = await twilioResponse.json();
    logStep('Twilio Verify check response', { status: twilioResponse.status, verificationStatus: twilioResult.status });

    if (!twilioResponse.ok) {
      logStep('Twilio Verify API error', twilioResult);
      
      // Handle specific Twilio errors
      if (twilioResult.code === 20404) {
        return new Response(
          JSON.stringify({ error: 'Verification code expired or not found. Please request a new code.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      return new Response(
        JSON.stringify({ error: twilioResult.message || 'Failed to verify code' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if verification was approved
    if (twilioResult.status !== 'approved') {
      logStep('Invalid code', { status: twilioResult.status });
      return new Response(
        JSON.stringify({ error: 'Invalid verification code. Please try again.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    logStep('Code verified successfully');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check if phone is already verified by another user
    const { data: existingProfile } = await supabase
      .from('profiles')
      .select('phone_number')
      .eq('phone_number', phone_number)
      .eq('phone_verified', true)
      .neq('user_id', user_id)
      .single();

    if (existingProfile) {
      logStep('Phone already verified by another user');
      return new Response(
        JSON.stringify({ error: 'This phone number is already registered to another account' }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update profile with verified phone
    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        phone_number,
        phone_verified: true,
      })
      .eq('user_id', user_id);

    if (updateError) {
      logStep('Error updating profile', updateError);
      throw new Error('Failed to verify phone number');
    }

    logStep('Phone verified successfully');

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Phone number verified successfully'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    logStep('Error', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to verify code';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
