import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const logStep = (step: string, details?: any) => {
  console.log(`[CLEANUP-PHONE-VERIFICATION] ${step}`, details ? JSON.stringify(details) : '');
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  logStep('Starting phone verification cleanup');

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Cleanup thresholds
    const CODES_MAX_AGE_HOURS = 24;
    const AUDIT_MAX_AGE_DAYS = 90;

    const codesOlderThan = new Date(Date.now() - CODES_MAX_AGE_HOURS * 60 * 60 * 1000).toISOString();
    const auditOlderThan = new Date(Date.now() - AUDIT_MAX_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString();

    // 1. Delete verification codes older than 24 hours
    const { data: deletedExpiredCodes, error: expiredError } = await supabase
      .from('phone_verification_codes')
      .delete()
      .lt('created_at', codesOlderThan)
      .select('id');

    if (expiredError) {
      logStep('Error deleting expired codes', expiredError);
    } else {
      logStep('Deleted expired codes', { count: deletedExpiredCodes?.length || 0 });
    }

    // 2. Delete all verified codes (already used)
    const { data: deletedVerifiedCodes, error: verifiedError } = await supabase
      .from('phone_verification_codes')
      .delete()
      .eq('verified', true)
      .select('id');

    if (verifiedError) {
      logStep('Error deleting verified codes', verifiedError);
    } else {
      logStep('Deleted verified codes', { count: deletedVerifiedCodes?.length || 0 });
    }

    // 3. Delete codes with max attempts exceeded
    const { data: deletedMaxAttemptCodes, error: attemptsError } = await supabase
      .from('phone_verification_codes')
      .delete()
      .gte('attempts', 5)
      .select('id');

    if (attemptsError) {
      logStep('Error deleting max-attempt codes', attemptsError);
    } else {
      logStep('Deleted max-attempt codes', { count: deletedMaxAttemptCodes?.length || 0 });
    }

    // 4. Delete old audit logs (keep 90 days)
    const { data: deletedAuditLogs, error: auditError } = await supabase
      .from('phone_verification_audit')
      .delete()
      .lt('created_at', auditOlderThan)
      .select('id');

    if (auditError) {
      logStep('Error deleting old audit logs', auditError);
    } else {
      logStep('Deleted old audit logs', { count: deletedAuditLogs?.length || 0 });
    }

    const durationMs = Date.now() - startTime;
    const summary = {
      expiredCodesDeleted: deletedExpiredCodes?.length || 0,
      verifiedCodesDeleted: deletedVerifiedCodes?.length || 0,
      maxAttemptCodesDeleted: deletedMaxAttemptCodes?.length || 0,
      oldAuditLogsDeleted: deletedAuditLogs?.length || 0,
      durationMs,
    };

    // Log to cron_job_history
    await supabase.from('cron_job_history').insert({
      job_name: 'cleanup-phone-verification',
      status: 'completed',
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: durationMs,
      result: summary,
    });

    logStep('Cleanup completed', summary);

    return new Response(
      JSON.stringify({ success: true, ...summary }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logStep('Cleanup failed', { error: errorMessage });

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    await supabase.from('cron_job_history').insert({
      job_name: 'cleanup-phone-verification',
      status: 'failed',
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      error_message: errorMessage,
    });

    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
