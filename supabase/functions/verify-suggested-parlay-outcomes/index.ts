import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Prop type to stat column mapping
const PROP_TO_STAT_MAP: Record<string, string | string[]> = {
  'player_points': 'points',
  'player_rebounds': 'rebounds',
  'player_assists': 'assists',
  'player_threes': 'threes_made',
  'player_blocks': 'blocks',
  'player_steals': 'steals',
  'player_turnovers': 'turnovers',
  'Points': 'points',
  'Rebounds': 'rebounds',
  'Assists': 'assists',
  '3-Pointers': 'threes_made',
  'Threes': 'threes_made',
  'Blocks': 'blocks',
  'Steals': 'steals',
  'Turnovers': 'turnovers',
  'Pts+Reb+Ast': ['points', 'rebounds', 'assists'],
  'Pts+Reb': ['points', 'rebounds'],
  'Pts+Ast': ['points', 'assists'],
  'Reb+Ast': ['rebounds', 'assists'],
  'Steals+Blocks': ['steals', 'blocks'],
};

function normalizePlayerName(name: string): string {
  return name.toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
}

function fuzzyMatchPlayerName(targetName: string, candidateName: string): number {
  const target = normalizePlayerName(targetName);
  const candidate = normalizePlayerName(candidateName);
  
  if (target === candidate) return 1.0;
  if (target.includes(candidate) || candidate.includes(target)) return 0.9;
  
  const targetParts = target.split(' ');
  const candidateParts = candidate.split(' ');
  const targetLast = targetParts[targetParts.length - 1];
  const candidateLast = candidateParts[candidateParts.length - 1];
  
  if (targetLast === candidateLast) {
    const targetFirst = targetParts[0]?.[0] || '';
    const candidateFirst = candidateParts[0]?.[0] || '';
    if (targetFirst === candidateFirst) return 0.85;
    return 0.7;
  }
  
  return 0;
}

// Parse leg description like "LeBron James OVER 27.5 Points"
function parseLegDescription(description: string): { playerName: string; side: string; line: number; propType: string } | null {
  // Pattern: "Player Name OVER/UNDER X.X PropType"
  const match = description.match(/^(.+?)\s+(OVER|UNDER|O|U)\s+([\d.]+)\s+(.+)$/i);
  if (match) {
    return {
      playerName: match[1].trim(),
      side: match[2].toUpperCase().startsWith('O') ? 'OVER' : 'UNDER',
      line: parseFloat(match[3]),
      propType: match[4].trim(),
    };
  }
  return null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const startTime = Date.now();
  
  const results = {
    parlaysProcessed: 0,
    parlaysVerified: 0,
    parlaysWon: 0,
    parlaysLost: 0,
    parlaysNoData: 0,
    errors: [] as string[],
  };

  try {
    console.log('=== Starting Suggested Parlay Outcome Verification ===');
    
    // Fetch pending suggested parlays that have expired
    const { data: pendingParlays, error: fetchError } = await supabase
      .from('suggested_parlays')
      .select('*')
      .eq('outcome', 'pending')
      .lt('expires_at', new Date().toISOString())
      .order('expires_at', { ascending: false })
      .limit(100);

    if (fetchError) {
      throw new Error(`Failed to fetch pending parlays: ${fetchError.message}`);
    }

    console.log(`Found ${pendingParlays?.length || 0} expired suggested parlays to verify`);

    if (!pendingParlays || pendingParlays.length === 0) {
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'No pending parlays to verify',
        results 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get date range for game logs
    const oldestParlay = pendingParlays[pendingParlays.length - 1];
    const dateStart = new Date(new Date(oldestParlay.expires_at).getTime() - 3 * 24 * 60 * 60 * 1000);
    
    // Fetch NBA game logs
    const { data: gameLogs, error: logsError } = await supabase
      .from('nba_player_game_logs')
      .select('*')
      .gte('game_date', dateStart.toISOString().split('T')[0]);
    
    if (logsError) {
      console.error(`Error fetching game logs: ${logsError.message}`);
    }
    
    console.log(`Loaded ${gameLogs?.length || 0} game log records`);
    
    // Create lookup map by date
    const gameLogsByDate = new Map<string, any[]>();
    for (const log of gameLogs || []) {
      const date = log.game_date;
      if (!gameLogsByDate.has(date)) {
        gameLogsByDate.set(date, []);
      }
      gameLogsByDate.get(date)!.push(log);
    }

    for (const parlay of pendingParlays) {
      results.parlaysProcessed++;
      
      try {
        const legs = parlay.legs as any[];
        if (!legs || legs.length === 0) {
          console.log(`Parlay ${parlay.id} has no legs, skipping`);
          continue;
        }

        const legOutcomes: any[] = [];
        let allHit = true;
        let anyMissed = false;
        let verifiedCount = 0;

        for (let i = 0; i < legs.length; i++) {
          const leg = legs[i];
          
          // Parse the leg - try structured data first, then description
          let playerName = leg.playerName || leg.player_name || leg.player || '';
          let propType = leg.propType || leg.prop_type || leg.betType || '';
          let line = parseFloat(leg.line || leg.currentLine || 0);
          let side = leg.side || leg.bet_side || 'OVER';
          
          // If we don't have structured data, try parsing description
          if (!playerName && leg.description) {
            const parsed = parseLegDescription(leg.description);
            if (parsed) {
              playerName = parsed.playerName;
              propType = parsed.propType;
              line = parsed.line;
              side = parsed.side;
            }
          }
          
          if (!playerName) {
            legOutcomes.push({ legIndex: i, outcome: 'no_data', actualValue: null });
            allHit = false;
            continue;
          }

          // Get stat mapping
          const statMapping = PROP_TO_STAT_MAP[propType];
          if (!statMapping) {
            console.log(`Unknown prop type: ${propType}`);
            legOutcomes.push({ legIndex: i, playerName, propType, outcome: 'unknown_prop', actualValue: null });
            allHit = false;
            continue;
          }

          // Search for player game log around expires_at date
          const expiryDate = new Date(parlay.expires_at);
          const searchDates = [
            expiryDate.toISOString().split('T')[0],
            new Date(expiryDate.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            new Date(expiryDate.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          ];

          let playerLog: any = null;
          let matchScore = 0;
          
          for (const searchDate of searchDates) {
            const logsForDate = gameLogsByDate.get(searchDate) || [];
            
            for (const log of logsForDate) {
              const score = fuzzyMatchPlayerName(playerName, log.player_name);
              if (score > matchScore && score >= 0.7) {
                matchScore = score;
                playerLog = log;
                if (score === 1.0) break;
              }
            }
            if (matchScore === 1.0) break;
          }

          if (!playerLog) {
            console.log(`No game log found for ${playerName}`);
            legOutcomes.push({ legIndex: i, playerName, propType, line, side, outcome: 'no_data', actualValue: null });
            allHit = false;
            continue;
          }

          // Calculate actual value
          let actualValue: number;
          if (Array.isArray(statMapping)) {
            actualValue = statMapping.reduce((sum, col) => sum + (parseFloat(playerLog[col]) || 0), 0);
          } else {
            actualValue = parseFloat(playerLog[statMapping]) || 0;
          }

          // Determine outcome
          let legOutcome: string;
          const sideUpper = side.toUpperCase();
          
          if (actualValue === line) {
            legOutcome = 'push';
          } else if (sideUpper === 'OVER' || sideUpper === 'O') {
            legOutcome = actualValue > line ? 'hit' : 'miss';
          } else {
            legOutcome = actualValue < line ? 'hit' : 'miss';
          }

          console.log(`Leg ${i}: ${playerName} ${propType} ${side} ${line} -> Actual: ${actualValue} = ${legOutcome}`);

          legOutcomes.push({
            legIndex: i,
            playerName,
            propType,
            line,
            side,
            outcome: legOutcome,
            actualValue,
          });

          verifiedCount++;
          if (legOutcome === 'miss') {
            anyMissed = true;
            allHit = false;
          } else if (legOutcome !== 'hit' && legOutcome !== 'push') {
            allHit = false;
          }
        }

        // Determine overall parlay outcome
        let parlayOutcome: string;
        if (verifiedCount === 0) {
          parlayOutcome = 'no_data';
          results.parlaysNoData++;
        } else if (anyMissed) {
          parlayOutcome = 'lost';
          results.parlaysLost++;
        } else if (allHit && verifiedCount === legs.length) {
          parlayOutcome = 'won';
          results.parlaysWon++;
        } else {
          // Some legs verified but not all, and no misses - still pending more data
          parlayOutcome = 'pending';
          continue; // Skip update, wait for more data
        }

        console.log(`Parlay ${parlay.id}: ${parlayOutcome} (${verifiedCount}/${legs.length} legs verified)`);

        // Update the parlay with outcome
        const { error: updateError } = await supabase
          .from('suggested_parlays')
          .update({
            outcome: parlayOutcome,
            settled_at: new Date().toISOString(),
            leg_outcomes: legOutcomes,
          })
          .eq('id', parlay.id);

        if (updateError) {
          console.error(`Failed to update parlay ${parlay.id}:`, updateError);
          results.errors.push(`Update failed: ${updateError.message}`);
        } else {
          results.parlaysVerified++;
        }

      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`Error processing parlay ${parlay.id}:`, err);
        results.errors.push(`Parlay ${parlay.id}: ${errMsg}`);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`=== Verification Complete in ${duration}ms ===`);
    console.log(`Results: ${JSON.stringify(results)}`);

    // Log to cron history
    await supabase.from('cron_job_history').insert({
      job_name: 'verify-suggested-parlay-outcomes',
      status: 'completed',
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: duration,
      result: results,
    });

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('Fatal error:', error);
    
    await supabase.from('cron_job_history').insert({
      job_name: 'verify-suggested-parlay-outcomes',
      status: 'error',
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      error_message: errorMsg,
    });

    return new Response(JSON.stringify({ success: false, error: errorMsg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
