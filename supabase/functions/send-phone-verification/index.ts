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

    // Validate phone number format (E.164)
    const phoneRegex = /^\+[1-9]\d{1,14}$/;
    if (!phone_number || !phoneRegex.test(phone_number)) {
      return new Response(
        JSON.stringify({ error: 'Invalid phone number format. Use E.164 format (+1234567890)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check if phone is already registered
    const { data: existingProfile } = await supabase
      .from('profiles')
      .select('phone_number')
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

    // Rate limiting - check recent codes for this phone
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: recentCodes, error: countError } = await supabase
      .from('phone_verification_codes')
      .select('id')
      .eq('phone_number', phone_number)
      .gte('created_at', oneHourAgo);

    if (countError) {
      logStep('Error checking rate limit', countError);
    }

    if (recentCodes && recentCodes.length >= 3) {
      logStep('Rate limit exceeded');
      return new Response(
        JSON.stringify({ error: 'Too many verification attempts. Please try again in an hour.' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Generate 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 minutes

    // Store the code
    const { error: insertError } = await supabase
      .from('phone_verification_codes')
      .insert({
        phone_number,
        code,
        expires_at: expiresAt,
      });

    if (insertError) {
      logStep('Error storing code', insertError);
      throw new Error('Failed to generate verification code');
    }

    // Send SMS via Twilio
    const twilioAccountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
    const twilioAuthToken = Deno.env.get('TWILIO_AUTH_TOKEN');
    const twilioPhoneNumber = Deno.env.get('TWILIO_PHONE_NUMBER');

    if (!twilioAccountSid || !twilioAuthToken || !twilioPhoneNumber) {
      logStep('Missing Twilio credentials');
      throw new Error('SMS service not configured');
    }

    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Messages.json`;
    const authHeader = btoa(`${twilioAccountSid}:${twilioAuthToken}`);

    const formData = new URLSearchParams();
    formData.append('To', phone_number);
    formData.append('From', twilioPhoneNumber);
    formData.append('Body', `Your verification code is: ${code}. It expires in 5 minutes.`);

    const twilioResponse = await fetch(twilioUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${authHeader}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });

    if (!twilioResponse.ok) {
      const errorData = await twilioResponse.text();
      logStep('Twilio error', errorData);
      throw new Error('Failed to send SMS');
    }

    logStep('SMS sent successfully');

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Verification code sent',
        expiresIn: 300 // 5 minutes in seconds
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
