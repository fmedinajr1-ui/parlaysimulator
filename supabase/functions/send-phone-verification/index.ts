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

// Clean and format phone number to E.164
function formatToE164(phone: string): string {
  // Remove all non-digit characters except leading +
  let cleaned = phone.replace(/[^\d+]/g, '');
  
  // If it doesn't start with +, assume it needs one
  if (!cleaned.startsWith('+')) {
    // If it starts with 1 and is 11 digits, it's likely US
    if (cleaned.startsWith('1') && cleaned.length === 11) {
      cleaned = '+' + cleaned;
    } else if (cleaned.length === 10) {
      // Assume US number
      cleaned = '+1' + cleaned;
    } else {
      cleaned = '+' + cleaned;
    }
  }
  
  return cleaned;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { phone_number, debug_mode } = await req.json();
    
    logStep('Received request', { phone_number: phone_number?.substring(0, 6) + '***', debug_mode });

    if (!phone_number) {
      return new Response(
        JSON.stringify({ error: 'Phone number is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Clean and format phone number
    const formattedPhone = formatToE164(phone_number);
    logStep('Formatted phone', { original: phone_number?.substring(0, 6) + '***', formatted: formattedPhone?.substring(0, 6) + '***' });

    // Validate phone number format (E.164)
    const phoneRegex = /^\+[1-9]\d{6,14}$/;
    if (!phoneRegex.test(formattedPhone)) {
      logStep('Invalid phone format', { formattedPhone: formattedPhone?.substring(0, 6) + '***' });
      return new Response(
        JSON.stringify({ error: 'Invalid phone number format. Please enter a valid phone number.' }),
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
      .eq('phone_number', formattedPhone)
      .eq('phone_verified', true)
      .neq('user_id', user.id)
      .single();

    if (existingProfile) {
      logStep('Phone already registered to another user');
      return new Response(
        JSON.stringify({ error: 'An account with this phone number has already been created. Please sign in instead.' }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check for recent verification attempts (rate limiting - 30 seconds)
    const { data: recentCodes } = await supabase
      .from('phone_verification_codes')
      .select('created_at')
      .eq('user_id', user.id)
      .gte('created_at', new Date(Date.now() - 30000).toISOString())
      .order('created_at', { ascending: false })
      .limit(1);

    if (recentCodes && recentCodes.length > 0) {
      const lastSent = new Date(recentCodes[0].created_at);
      const secondsRemaining = Math.ceil(30 - (Date.now() - lastSent.getTime()) / 1000);
      
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
        phone_number: formattedPhone,
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
      logStep('Missing Twilio credentials', { 
        hasAccountSid: !!accountSid, 
        hasAuthToken: !!authToken, 
        hasFromNumber: !!fromNumber 
      });
      return new Response(
        JSON.stringify({ error: 'SMS service not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Clean the from number too
    const cleanFromNumber = formatToE164(fromNumber);
    logStep('Sending SMS via Twilio Messages API', { 
      from: cleanFromNumber,
      to: formattedPhone?.substring(0, 6) + '***'
    });

    // Send SMS directly using Twilio Messages API
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    
    const formData = new URLSearchParams();
    formData.append('To', formattedPhone);
    formData.append('From', cleanFromNumber);
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
    
    // Detailed Twilio response logging
    logStep('Twilio SMS response', { 
      status: twilioResponse.status, 
      sid: twilioResult.sid,
      messageStatus: twilioResult.status,
      errorCode: twilioResult.code,
      errorMessage: twilioResult.message,
      to: twilioResult.to?.substring(0, 6) + '***',
      from: twilioResult.from
    });

    if (!twilioResponse.ok) {
      logStep('Twilio SMS API error', {
        fullError: twilioResult,
        status: twilioResponse.status
      });
      
      // Clean up the stored code since SMS failed
      await supabase
        .from('phone_verification_codes')
        .delete()
        .eq('user_id', user.id);

      // Provide user-friendly error messages
      let userMessage = 'Failed to send SMS. Please try again.';
      if (twilioResult.code === 21211) {
        userMessage = 'Invalid phone number. Please check and try again.';
      } else if (twilioResult.code === 21608) {
        userMessage = 'This phone number cannot receive SMS. Please use a different number.';
      } else if (twilioResult.code === 21610) {
        userMessage = 'This number has been blacklisted. Please contact support.';
      } else if (twilioResult.code === 21614) {
        userMessage = 'This number is not a valid mobile number.';
      } else if (twilioResult.message) {
        userMessage = twilioResult.message;
      }

      return new Response(
        JSON.stringify({ 
          error: userMessage,
          twilioCode: twilioResult.code
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    logStep('SMS sent successfully', { 
      messageSid: twilioResult.sid,
      messageStatus: twilioResult.status 
    });

    // In debug mode, return the code (ONLY for development!)
    const responseData: any = { 
      success: true, 
      message: 'Verification code sent',
      expiresInSeconds: 600,
      phoneFormatted: formattedPhone?.substring(0, 6) + '***'
    };

    // Debug mode - return the code for testing (disable in production!)
    if (debug_mode === true) {
      responseData.debug_code = code;
      logStep('DEBUG MODE: Returning code in response');
    }

    return new Response(
      JSON.stringify(responseData),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    logStep('Unhandled error', { error: error instanceof Error ? error.message : error });
    const errorMessage = error instanceof Error ? error.message : 'Failed to send verification code';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
