import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const logStep = (step: string, details?: any) => {
  console.log(`[SEND-EMAIL-VERIFICATION] ${step}`, details ? JSON.stringify(details) : '');
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
    const { email, debug_mode } = await req.json();
    
    logStep('Received request', { email: email?.substring(0, 3) + '***', debug_mode });

    if (!email) {
      return new Response(
        JSON.stringify({ error: 'Email is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      logStep('Invalid email format', { email: email?.substring(0, 3) + '***' });
      return new Response(
        JSON.stringify({ error: 'Invalid email format' }),
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

    // Check if email is already verified by another user
    const { data: existingProfile } = await supabase
      .from('profiles')
      .select('email, user_id')
      .eq('email', email.toLowerCase())
      .eq('email_verified', true)
      .neq('user_id', user.id)
      .single();

    if (existingProfile) {
      logStep('Email already registered to another user');
      return new Response(
        JSON.stringify({ error: 'This email is already registered to another account' }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if this user's email is already verified
    const { data: userProfile } = await supabase
      .from('profiles')
      .select('email, email_verified')
      .eq('user_id', user.id)
      .single();

    if (userProfile?.email === email.toLowerCase() && userProfile?.email_verified) {
      logStep('Email already verified for this user');
      return new Response(
        JSON.stringify({ 
          success: true,
          alreadyVerified: true,
          message: 'This email is already verified on your account'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check for recent verification attempts (rate limiting - 30 seconds)
    const { data: recentCodes } = await supabase
      .from('email_verification_codes')
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
      .from('email_verification_codes')
      .delete()
      .eq('user_id', user.id);

    // Store the new code
    const { error: insertError } = await supabase
      .from('email_verification_codes')
      .insert({
        user_id: user.id,
        email: email.toLowerCase(),
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

    // Get Resend API key
    const resendApiKey = Deno.env.get('RESEND_API_KEY');

    if (!resendApiKey) {
      logStep('Missing RESEND_API_KEY');
      // In development, still return success but indicate email wasn't sent
      if (debug_mode === true) {
        return new Response(
          JSON.stringify({ 
            success: true, 
            message: 'Verification code generated (email service not configured)',
            debug_code: code,
            expiresInSeconds: 600
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({ error: 'Email service not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Send email via Resend
    const resend = new Resend(resendApiKey);
    
    logStep('Sending email via Resend', { to: email?.substring(0, 3) + '***' });

    const { data: emailData, error: emailError } = await resend.emails.send({
      from: 'Parlay Farm <onboarding@resend.dev>',
      to: [email],
      subject: 'Your Parlay Farm Verification Code',
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #f97316; margin: 0;">🎰 Parlay Farm</h1>
          </div>
          
          <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius: 12px; padding: 30px; text-align: center;">
            <h2 style="color: #ffffff; margin: 0 0 10px 0;">Verify Your Email</h2>
            <p style="color: #94a3b8; margin: 0 0 25px 0;">Enter this code to complete your verification</p>
            
            <div style="background: #0f172a; border-radius: 8px; padding: 20px; margin: 0 auto; max-width: 200px;">
              <span style="font-family: monospace; font-size: 32px; font-weight: bold; color: #f97316; letter-spacing: 4px;">${code}</span>
            </div>
            
            <p style="color: #64748b; font-size: 14px; margin: 25px 0 0 0;">
              This code expires in 10 minutes
            </p>
          </div>
          
          <p style="color: #64748b; font-size: 12px; text-align: center; margin-top: 20px;">
            If you didn't request this code, you can safely ignore this email.
          </p>
        </div>
      `,
    });

    if (emailError) {
      logStep('Resend email error', emailError);
      
      // Clean up the stored code since email failed
      await supabase
        .from('email_verification_codes')
        .delete()
        .eq('user_id', user.id);

      return new Response(
        JSON.stringify({ error: 'Failed to send verification email. Please try again.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    logStep('Email sent successfully', { emailId: emailData?.id });

    // Update email_verification_sent_at in profiles
    await supabase
      .from('profiles')
      .update({ email_verification_sent_at: new Date().toISOString() })
      .eq('user_id', user.id);

    // Build response
    const responseData: any = { 
      success: true, 
      message: 'Verification code sent',
      expiresInSeconds: 600
    };

    // Debug mode - return the code for testing
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
