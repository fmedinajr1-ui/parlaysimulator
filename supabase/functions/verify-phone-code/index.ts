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

    // Get the verification code from database
    const { data: verificationRecord, error: fetchError } = await supabase
      .from('phone_verification_codes')
      .select('*')
      .eq('user_id', user_id)
      .eq('phone_number', phone_number)
      .eq('verified', false)
      .single();

    if (fetchError || !verificationRecord) {
      logStep('No verification code found', { fetchError });
      return new Response(
        JSON.stringify({ 
          error: 'No verification code found. Please request a new code.',
          needsNewCode: true
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    logStep('Found verification record', { 
      expiresAt: verificationRecord.expires_at,
      attempts: verificationRecord.attempts
    });

    // Check if code has expired
    if (new Date(verificationRecord.expires_at) < new Date()) {
      logStep('Code expired');
      
      // Delete expired code
      await supabase
        .from('phone_verification_codes')
        .delete()
        .eq('id', verificationRecord.id);

      return new Response(
        JSON.stringify({ 
          error: 'Verification code has expired. Please request a new code.',
          needsNewCode: true
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check attempts limit (max 5 attempts)
    if (verificationRecord.attempts >= 5) {
      logStep('Too many attempts');
      
      // Delete the code after too many attempts
      await supabase
        .from('phone_verification_codes')
        .delete()
        .eq('id', verificationRecord.id);

      return new Response(
        JSON.stringify({ 
          error: 'Too many failed attempts. Please request a new code.',
          needsNewCode: true
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify the code
    if (verificationRecord.code !== code) {
      logStep('Invalid code', { attempts: verificationRecord.attempts + 1 });
      
      // Increment attempts
      await supabase
        .from('phone_verification_codes')
        .update({ attempts: verificationRecord.attempts + 1 })
        .eq('id', verificationRecord.id);

      const attemptsRemaining = 5 - (verificationRecord.attempts + 1);
      
      return new Response(
        JSON.stringify({ 
          error: `Invalid verification code. ${attemptsRemaining} attempts remaining.`,
          attemptsRemaining
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    logStep('Code verified successfully');

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

    // Mark verification code as used and delete it
    await supabase
      .from('phone_verification_codes')
      .delete()
      .eq('id', verificationRecord.id);

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
