import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const logStep = (step: string, details?: any) => {
  console.log(`[SEND-PHONE-VERIFICATION] ${step}`, details ? JSON.stringify(details) : '');
};

// Generate a 6-digit code
function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { phone_number } = await req.json();
    
    logStep('Received request', { phone_number: phone_number?.substring(0, 6) + '***' });

    if (!phone_number) {
      return new Response(
        JSON.stringify({ error: 'Phone number is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate phone number format (E.164)
    const phoneRegex = /^\+[1-9]\d{1,14}$/;
    if (!phoneRegex.test(phone_number)) {
      return new Response(
        JSON.stringify({ error: 'Invalid phone number format. Please use E.164 format (e.g., +14155551234)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get authenticated user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Authorization required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    
    if (userError || !user) {
      logStep('User auth error', userError);
      return new Response(
        JSON.stringify({ error: 'Invalid authentication' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    logStep('User authenticated', { userId: user.id });

    // Check if phone is already verified by another user
    const { data: existingProfile } = await supabase
      .from('profiles')
      .select('phone_number, user_id')
      .eq('phone_number', phone_number)
      .eq('phone_verified', true)
      .neq('user_id', user.id)
      .single();

    if (existingProfile) {
      logStep('Phone already registered to another user');
      return new Response(
        JSON.stringify({ error: 'This phone number is already registered to another account' }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check for recent verification attempts (rate limiting)
    const { data: recentCodes } = await supabase
      .from('phone_verification_codes')
      .select('created_at')
      .eq('user_id', user.id)
      .gte('created_at', new Date(Date.now() - 60000).toISOString())
      .order('created_at', { ascending: false })
      .limit(1);

    if (recentCodes && recentCodes.length > 0) {
      const lastSent = new Date(recentCodes[0].created_at);
      const secondsRemaining = Math.ceil(60 - (Date.now() - lastSent.getTime()) / 1000);
      
      if (secondsRemaining > 0) {
        return new Response(
          JSON.stringify({ 
            error: `Please wait ${secondsRemaining} seconds before requesting a new code`,
            cooldown: secondsRemaining
          }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Generate verification code
    const code = generateCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    logStep('Generated code', { codeLength: code.length, expiresAt: expiresAt.toISOString() });

    // Invalidate any existing codes for this user
    await supabase
      .from('phone_verification_codes')
      .delete()
      .eq('user_id', user.id);

    // Store the new code
    const { error: insertError } = await supabase
      .from('phone_verification_codes')
      .insert({
        user_id: user.id,
        phone_number,
        code,
        expires_at: expiresAt.toISOString(),
        verified: false,
        attempts: 0
      });

    if (insertError) {
      logStep('Failed to store code', insertError);
      return new Response(
        JSON.stringify({ error: 'Failed to generate verification code' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get Twilio credentials for direct SMS
    const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
    const authToken = Deno.env.get('TWILIO_AUTH_TOKEN');
    const fromNumber = Deno.env.get('TWILIO_PHONE_NUMBER');

    if (!accountSid || !authToken || !fromNumber) {
      logStep('Missing Twilio credentials');
      return new Response(
        JSON.stringify({ error: 'SMS service not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    logStep('Sending SMS via Twilio Messages API', { from: fromNumber });

    // Send SMS directly using Twilio Messages API
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    
    const formData = new URLSearchParams();
    formData.append('To', phone_number);
    formData.append('From', fromNumber);
    formData.append('Body', `Your Parlay Farm verification code is: ${code}. It expires in 10 minutes.`);

    const twilioResponse = await fetch(twilioUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${btoa(`${accountSid}:${authToken}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });

    const twilioResult = await twilioResponse.json();
    logStep('Twilio SMS response', { 
      status: twilioResponse.status, 
      sid: twilioResult.sid,
      errorCode: twilioResult.code,
      errorMessage: twilioResult.message
    });

    if (!twilioResponse.ok) {
      logStep('Twilio SMS API error', twilioResult);
      
      // Clean up the stored code since SMS failed
      await supabase
        .from('phone_verification_codes')
        .delete()
        .eq('user_id', user.id);

      return new Response(
        JSON.stringify({ 
          error: twilioResult.message || 'Failed to send SMS',
          twilioCode: twilioResult.code
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    logStep('SMS sent successfully', { messageSid: twilioResult.sid });

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Verification code sent',
        expiresInSeconds: 600
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    logStep('Error', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to send verification code';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
