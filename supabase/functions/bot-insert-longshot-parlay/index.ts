import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // DEPRECATED: This function contained hardcoded stale player data (e.g. Jaylen Wells 0.5 assists)
  // that is not verified against live sportsbook lines. Disabled to prevent phantom lines in parlays.
  console.log('[Longshot] DEPRECATED — function disabled. Hardcoded parlays are no longer inserted.');
  return new Response(
    JSON.stringify({ success: false, error: 'Function deprecated — hardcoded longshot parlays disabled' }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
