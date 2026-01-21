import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ParlayLeg {
  playerName: string;
  propType: string;
  line: number;
  side?: string;
}

interface PlayerAlert {
  playerName: string;
  status: string;
  riskLevel: 'critical' | 'high' | 'medium' | 'low' | 'none';
  message: string;
  recommendation: 'AVOID' | 'WAIT' | 'CAUTION' | 'PROCEED';
  injuryNote?: string;
  isStarting?: boolean;
}

// Normalize player name for matching
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Calculate similarity between two names
function nameSimilarity(name1: string, name2: string): number {
  const n1 = normalizeName(name1);
  const n2 = normalizeName(name2);
  
  if (n1 === n2) return 1;
  
  // Check if one contains the other
  if (n1.includes(n2) || n2.includes(n1)) return 0.9;
  
  // Check last name match
  const parts1 = n1.split(' ');
  const parts2 = n2.split(' ');
  const lastName1 = parts1[parts1.length - 1];
  const lastName2 = parts2[parts2.length - 1];
  
  if (lastName1 === lastName2) return 0.7;
  
  return 0;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { legs } = await req.json() as { legs: ParlayLeg[] };

    if (!legs || !Array.isArray(legs) || legs.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'No legs provided' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const today = new Date().toISOString().split('T')[0];

    // Fetch today's lineup alerts
    const { data: alertsData, error: alertsError } = await supabase
      .from('lineup_alerts')
      .select('*')
      .eq('game_date', today);

    if (alertsError) {
      console.error('[CrossReference] Error fetching alerts:', alertsError);
    }

    const alerts = alertsData || [];

    // Fetch today's lineups for starting status
    const { data: lineupsData, error: lineupsError } = await supabase
      .from('starting_lineups')
      .select('*')
      .eq('game_date', today);

    if (lineupsError) {
      console.error('[CrossReference] Error fetching lineups:', lineupsError);
    }

    const lineups = lineupsData || [];

    // Build a set of all starters
    const startersSet = new Set<string>();
    for (const lineup of lineups) {
      const homeStarters = lineup.home_starters as Array<{ name: string }> || [];
      const awayStarters = lineup.away_starters as Array<{ name: string }> || [];
      
      for (const player of [...homeStarters, ...awayStarters]) {
        if (player?.name) {
          startersSet.add(normalizeName(player.name));
        }
      }
    }

    // Cross-reference each leg
    const playerAlerts: PlayerAlert[] = [];

    for (const leg of legs) {
      const normalizedLegName = normalizeName(leg.playerName);
      
      // Check for alerts
      let matchedAlert = null;
      let bestScore = 0;
      
      for (const alert of alerts) {
        const score = nameSimilarity(leg.playerName, alert.player_name);
        if (score > bestScore && score >= 0.7) {
          bestScore = score;
          matchedAlert = alert;
        }
      }

      if (matchedAlert) {
        // Determine risk level and recommendation
        let riskLevel: PlayerAlert['riskLevel'] = 'medium';
        let recommendation: PlayerAlert['recommendation'] = 'CAUTION';
        let message = '';

        switch (matchedAlert.alert_type) {
          case 'OUT':
            riskLevel = 'critical';
            recommendation = 'AVOID';
            message = `${leg.playerName} is OUT - confirmed not playing`;
            break;
          case 'DOUBTFUL':
            riskLevel = 'high';
            recommendation = 'AVOID';
            message = `${leg.playerName} is DOUBTFUL - very unlikely to play`;
            break;
          case 'GTD':
            riskLevel = 'high';
            recommendation = 'WAIT';
            message = `${leg.playerName} is GTD - check closer to tip-off`;
            break;
          case 'QUESTIONABLE':
            riskLevel = 'medium';
            recommendation = 'WAIT';
            message = `${leg.playerName} is QUESTIONABLE - 50/50 to play`;
            break;
          case 'PROBABLE':
            riskLevel = 'low';
            recommendation = 'PROCEED';
            message = `${leg.playerName} is PROBABLE - expected to play`;
            break;
          default:
            riskLevel = 'medium';
            recommendation = 'CAUTION';
            message = `${leg.playerName} has status: ${matchedAlert.alert_type}`;
        }

        playerAlerts.push({
          playerName: leg.playerName,
          status: matchedAlert.alert_type,
          riskLevel,
          message,
          recommendation,
          injuryNote: matchedAlert.injury_note || matchedAlert.details,
          isStarting: startersSet.has(normalizedLegName),
        });
      } else {
        // Check if player is a confirmed starter
        const isStarter = startersSet.has(normalizedLegName);
        
        if (isStarter) {
          playerAlerts.push({
            playerName: leg.playerName,
            status: 'STARTING',
            riskLevel: 'none',
            message: `${leg.playerName} is a confirmed starter`,
            recommendation: 'PROCEED',
            isStarting: true,
          });
        } else if (lineups.length > 0) {
          // We have lineup data but player not found as starter
          playerAlerts.push({
            playerName: leg.playerName,
            status: 'UNKNOWN',
            riskLevel: 'low',
            message: `${leg.playerName} status not found in lineup data`,
            recommendation: 'CAUTION',
            isStarting: false,
          });
        }
      }
    }

    // Calculate overall risk
    const criticalCount = playerAlerts.filter(a => a.riskLevel === 'critical').length;
    const highCount = playerAlerts.filter(a => a.riskLevel === 'high').length;
    const hasRisks = criticalCount > 0 || highCount > 0;
    const allClear = playerAlerts.every(a => a.riskLevel === 'none' || a.riskLevel === 'low');

    console.log('[CrossReference] Checked', legs.length, 'legs, found', playerAlerts.length, 'with status');

    return new Response(
      JSON.stringify({
        success: true,
        alerts: playerAlerts,
        summary: {
          total: legs.length,
          checked: playerAlerts.length,
          critical: criticalCount,
          high: highCount,
          hasRisks,
          allClear,
        },
        checkedAt: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[CrossReference] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
