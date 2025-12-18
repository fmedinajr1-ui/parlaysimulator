import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const logStep = (step: string, details?: any) => {
  console.log(`[SEND-PHONE-VERIFICATION] ${step}`, details ? JSON.stringify(details) : '');
};

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
        JSON.stringify({ error: 'Invalid phone number format. Please use E.164 format (e.g., +1234567890)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check if phone is already verified by another user
    const { data: existingProfile } = await supabase
      .from('profiles')
      .select('phone_number, phone_verification_sent_at')
      .eq('phone_number', phone_number)
      .eq('phone_verified', true)
      .single();

    if (existingProfile) {
      logStep('Phone already registered');
      return new Response(
        JSON.stringify({ error: 'This phone number is already registered to another account' }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check for recent verification attempt to prevent race condition
    const { data: recentAttempt } = await supabase
      .from('profiles')
      .select('phone_verification_sent_at')
      .eq('phone_number', phone_number)
      .single();

    if (recentAttempt?.phone_verification_sent_at) {
      const lastSentAt = new Date(recentAttempt.phone_verification_sent_at);
      const secondsSinceSent = (Date.now() - lastSentAt.getTime()) / 1000;
      
      if (secondsSinceSent < 60) {
        const waitTime = Math.ceil(60 - secondsSinceSent);
        logStep('Rate limited - code recently sent', { secondsSinceSent, waitTime });
        return new Response(
          JSON.stringify({ 
            error: `Please wait ${waitTime} seconds before requesting a new code`,
            waitTime,
            alreadySent: true
          }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
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

    logStep('Sending verification via Twilio Verify API');

    // Use Twilio Verify API to send verification code
    const twilioUrl = `https://verify.twilio.com/v2/Services/${verifyServiceSid}/Verifications`;
    
    const formData = new URLSearchParams();
    formData.append('To', phone_number);
    formData.append('Channel', 'sms');

    const twilioResponse = await fetch(twilioUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${btoa(`${accountSid}:${authToken}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });

    const twilioResult = await twilioResponse.json();
    logStep('Twilio Verify response', { 
      status: twilioResponse.status, 
      verificationStatus: twilioResult.status,
      valid: twilioResult.valid,
      sid: twilioResult.sid,
      sendAttempts: twilioResult.send_code_attempts?.length 
    });

    if (!twilioResponse.ok) {
      logStep('Twilio Verify API error', twilioResult);
      
      // Handle specific Twilio errors
      if (twilioResult.code === 60203) {
        return new Response(
          JSON.stringify({ error: 'Too many verification attempts. Please try again later.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      return new Response(
        JSON.stringify({ error: twilioResult.message || 'Failed to send verification code' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (twilioResult.status !== 'pending') {
      logStep('Unexpected verification status', { status: twilioResult.status });
      return new Response(
        JSON.stringify({ error: 'Failed to send verification code' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if valid is false - this indicates a potential issue with Twilio config
    if (twilioResult.valid === false) {
      logStep('WARNING: Twilio returned valid=false', { 
        sid: twilioResult.sid,
        sendAttempts: twilioResult.send_code_attempts?.length,
        hint: 'This may indicate trial account restrictions or credential mismatch'
      });
    }

    logStep('Verification sent successfully', { 
      status: twilioResult.status,
      valid: twilioResult.valid,
      verificationSid: twilioResult.sid
    });

    // Record the send time to prevent rapid re-sends
    const authHeader = req.headers.get('Authorization');
    if (authHeader) {
      const token = authHeader.replace('Bearer ', '');
      const { data: { user } } = await supabase.auth.getUser(token);
      if (user) {
        await supabase
          .from('profiles')
          .update({ phone_verification_sent_at: new Date().toISOString() })
          .eq('user_id', user.id);
        logStep('Updated verification sent timestamp for user', { userId: user.id });
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Verification code sent successfully',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString() // 10 minutes
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
