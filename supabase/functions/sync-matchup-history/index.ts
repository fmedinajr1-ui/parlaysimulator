import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    console.log('[SyncMatchupHistory] Starting H2H data sync from game logs...');
    const startTime = Date.now();

    // Call the database function to sync matchup history
    const { data, error } = await supabase.rpc('sync_matchup_history_from_logs');

    if (error) {
      console.error('[SyncMatchupHistory] RPC error:', error);
      throw error;
    }

    const result = data?.[0] || { players_synced: 0, prop_types_synced: 0, total_records: 0 };
    const duration = Date.now() - startTime;

    console.log(`[SyncMatchupHistory] Sync complete in ${duration}ms:`, result);

    // Log to cron history
    await supabase.from('cron_job_history').insert({
      job_name: 'sync-matchup-history',
      status: 'completed',
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: duration,
      result: {
        players_synced: result.players_synced,
        prop_types_synced: result.prop_types_synced,
        total_records: result.total_records
      }
    });

    return new Response(JSON.stringify({
      success: true,
      message: 'Matchup history synced from game logs',
      players_synced: result.players_synced,
      prop_types_synced: result.prop_types_synced,
      total_records: result.total_records,
      duration_ms: duration
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error('[SyncMatchupHistory] Error:', errorMessage);

    return new Response(JSON.stringify({ 
      success: false,
      error: errorMessage 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
