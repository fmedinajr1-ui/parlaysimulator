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

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get the most recent valid code for this phone
    const { data: verificationCode, error: fetchError } = await supabase
      .from('phone_verification_codes')
      .select('*')
      .eq('phone_number', phone_number)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (fetchError || !verificationCode) {
      logStep('No valid code found');
      return new Response(
        JSON.stringify({ error: 'Verification code expired or not found. Please request a new code.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check max attempts
    if (verificationCode.attempts >= 5) {
      logStep('Max attempts exceeded');
      return new Response(
        JSON.stringify({ error: 'Too many failed attempts. Please request a new code.' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Increment attempts
    await supabase
      .from('phone_verification_codes')
      .update({ attempts: verificationCode.attempts + 1 })
      .eq('id', verificationCode.id);

    // Verify code
    if (verificationCode.code !== code) {
      logStep('Invalid code');
      const attemptsLeft = 5 - (verificationCode.attempts + 1);
      return new Response(
        JSON.stringify({ 
          error: `Invalid code. ${attemptsLeft} attempts remaining.`,
          attemptsLeft 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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

    // Delete used and expired codes for this phone
    await supabase
      .from('phone_verification_codes')
      .delete()
      .eq('phone_number', phone_number);

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
