import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Security constants
const MAX_CODE_AGE_MS = 10 * 60 * 1000; // 10 minutes max code age
const PENALTY_PER_ATTEMPT_MS = 2 * 60 * 1000; // 2 minutes penalty per failed attempt
const MAX_ATTEMPTS = 5;

const logStep = (step: string, details?: any) => {
  console.log(`[VERIFY-PHONE-CODE] ${step}`, details ? JSON.stringify(details) : '');
};

/**
 * Normalize phone number to E.164 format for consistent comparison
 */
function formatToE164(phone: string): string {
  let cleaned = phone.replace(/[^\d+]/g, '');
  if (!cleaned.startsWith('+')) {
    if (cleaned.startsWith('1') && cleaned.length === 11) {
      cleaned = '+' + cleaned;
    } else if (cleaned.length === 10) {
      cleaned = '+1' + cleaned;
    } else {
      cleaned = '+' + cleaned;
    }
  }
  return cleaned;
}

/**
 * Constant-time string comparison to prevent timing attacks
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still do the comparison to maintain constant time
    let result = 0;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      result |= (a.charCodeAt(i % a.length) || 0) ^ (b.charCodeAt(i % b.length) || 0);
    }
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Log verification attempt to audit table
 */
async function logAuditEvent(
  supabase: any,
  userId: string,
  phoneNumber: string,
  eventType: string,
  success: boolean,
  failureReason: string | null,
  ipAddress: string | null,
  userAgent: string | null,
  codeAgeSeconds: number | null,
  attemptsAtTime: number | null
) {
  try {
    await supabase.from('phone_verification_audit').insert({
      user_id: userId,
      phone_number: phoneNumber,
      event_type: eventType,
      success,
      failure_reason: failureReason,
      ip_address: ipAddress,
      user_agent: userAgent,
      code_age_seconds: codeAgeSeconds,
      attempts_at_time: attemptsAtTime,
    });
  } catch (err) {
    logStep('Failed to write audit log', err);
    // Don't fail the request if audit logging fails
  }
}

/**
 * Generic error response to prevent enumeration attacks
 */
function genericErrorResponse(needsNewCode: boolean, attemptsRemaining?: number) {
  const response: any = {
    error: 'Verification failed. Please check your code and try again.',
    needsNewCode,
  };
  if (attemptsRemaining !== undefined) {
    response.attemptsRemaining = attemptsRemaining;
  }
  return new Response(
    JSON.stringify(response),
    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Extract request metadata for audit logging
  const ipAddress = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 
                    req.headers.get('cf-connecting-ip') || 
                    req.headers.get('x-real-ip') ||
                    null;
  const userAgent = req.headers.get('user-agent');

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

    // CRITICAL: Normalize phone number to match stored format
    const formattedPhone = formatToE164(phone_number);
    logStep('Normalized phone', { original: phone_number?.substring(0, 6) + '***', formatted: formattedPhone?.substring(0, 6) + '***' });

    // Get the verification code from database
    const { data: verificationRecord, error: fetchError } = await supabase
      .from('phone_verification_codes')
      .select('*')
      .eq('user_id', user_id)
      .eq('phone_number', formattedPhone)
      .eq('verified', false)
      .single();

    if (fetchError || !verificationRecord) {
      logStep('No verification code found', { fetchError, reason: 'code_not_found' });
      
      await logAuditEvent(
        supabase, user_id, formattedPhone, 'verification_attempt',
        false, 'code_not_found', ipAddress, userAgent, null, null
      );
      
      // Generic error to prevent enumeration
      return genericErrorResponse(true);
    }

    const codeCreatedAt = new Date(verificationRecord.created_at).getTime();
    const codeExpiresAt = new Date(verificationRecord.expires_at).getTime();
    const now = Date.now();
    const codeAgeMs = now - codeCreatedAt;
    const codeAgeSeconds = Math.floor(codeAgeMs / 1000);

    logStep('Found verification record', { 
      expiresAt: verificationRecord.expires_at,
      attempts: verificationRecord.attempts,
      codeAgeSeconds
    });

    // Check 1: Maximum code age (prevents bugs where expires_at is far future)
    if (codeAgeMs > MAX_CODE_AGE_MS) {
      logStep('Code too old', { codeAgeMs, maxAge: MAX_CODE_AGE_MS });
      
      await supabase
        .from('phone_verification_codes')
        .delete()
        .eq('id', verificationRecord.id);

      await logAuditEvent(
        supabase, user_id, formattedPhone, 'verification_attempt',
        false, 'code_too_old', ipAddress, userAgent, codeAgeSeconds, verificationRecord.attempts
      );

      return genericErrorResponse(true);
    }

    // Check 2: Standard expiration check
    if (codeExpiresAt < now) {
      logStep('Code expired');
      
      await supabase
        .from('phone_verification_codes')
        .delete()
        .eq('id', verificationRecord.id);

      await logAuditEvent(
        supabase, user_id, formattedPhone, 'verification_attempt',
        false, 'code_expired', ipAddress, userAgent, codeAgeSeconds, verificationRecord.attempts
      );

      return genericErrorResponse(true);
    }

    // Check 3: Progressive lifetime reduction (penalty for failed attempts)
    const effectiveExpiryMs = codeExpiresAt - (verificationRecord.attempts * PENALTY_PER_ATTEMPT_MS);
    if (effectiveExpiryMs < now) {
      logStep('Code effectively expired due to attempt penalties', { 
        attempts: verificationRecord.attempts, 
        penaltyMs: verificationRecord.attempts * PENALTY_PER_ATTEMPT_MS 
      });
      
      await supabase
        .from('phone_verification_codes')
        .delete()
        .eq('id', verificationRecord.id);

      await logAuditEvent(
        supabase, user_id, formattedPhone, 'verification_attempt',
        false, 'expired_by_penalty', ipAddress, userAgent, codeAgeSeconds, verificationRecord.attempts
      );

      return genericErrorResponse(true);
    }

    // Check 4: Maximum attempts
    if (verificationRecord.attempts >= MAX_ATTEMPTS) {
      logStep('Too many attempts');
      
      await supabase
        .from('phone_verification_codes')
        .delete()
        .eq('id', verificationRecord.id);

      await logAuditEvent(
        supabase, user_id, formattedPhone, 'verification_attempt',
        false, 'max_attempts_exceeded', ipAddress, userAgent, codeAgeSeconds, verificationRecord.attempts
      );

      return genericErrorResponse(true);
    }

    // Verify the code using timing-safe comparison
    const codeMatches = timingSafeEqual(verificationRecord.code, code.toString().trim());
    
    if (!codeMatches) {
      const newAttemptCount = verificationRecord.attempts + 1;
      logStep('Invalid code', { attempts: newAttemptCount, reason: 'code_mismatch' });
      
      // Increment attempts
      await supabase
        .from('phone_verification_codes')
        .update({ attempts: newAttemptCount })
        .eq('id', verificationRecord.id);

      await logAuditEvent(
        supabase, user_id, formattedPhone, 'verification_attempt',
        false, 'invalid_code', ipAddress, userAgent, codeAgeSeconds, newAttemptCount
      );

      const attemptsRemaining = MAX_ATTEMPTS - newAttemptCount;
      
      // Generic error with attempts remaining (this is safe to reveal)
      return genericErrorResponse(false, attemptsRemaining);
    }

    logStep('Code verified successfully');

    // Check if phone is already verified by another user
    const { data: existingProfile } = await supabase
      .from('profiles')
      .select('phone_number')
      .eq('phone_number', formattedPhone)
      .eq('phone_verified', true)
      .neq('user_id', user_id)
      .single();

    if (existingProfile) {
      logStep('Phone already verified by another user');
      
      await logAuditEvent(
        supabase, user_id, formattedPhone, 'verification_attempt',
        false, 'phone_already_claimed', ipAddress, userAgent, codeAgeSeconds, verificationRecord.attempts
      );
      
      // This specific error is okay to reveal as it's a conflict situation
      return new Response(
        JSON.stringify({ error: 'An account with this phone number has already been created. Please sign in instead.' }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update profile with verified phone (use normalized format)
    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        phone_number: formattedPhone,
        phone_verified: true,
      })
      .eq('user_id', user_id);

    if (updateError) {
      logStep('Error updating profile', updateError);
      
      await logAuditEvent(
        supabase, user_id, formattedPhone, 'verification_attempt',
        false, 'profile_update_failed', ipAddress, userAgent, codeAgeSeconds, verificationRecord.attempts
      );
      
      throw new Error('Failed to verify phone number');
    }

    // Delete the used verification code
    await supabase
      .from('phone_verification_codes')
      .delete()
      .eq('id', verificationRecord.id);

    // Log successful verification
    await logAuditEvent(
      supabase, user_id, formattedPhone, 'verification_success',
      true, null, ipAddress, userAgent, codeAgeSeconds, verificationRecord.attempts
    );

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
