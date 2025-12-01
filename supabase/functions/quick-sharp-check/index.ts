import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface LegCheck {
  description: string;
}

interface SharpSignal {
  type: 'real_sharp' | 'fake_sharp' | 'caution';
  message: string;
  confidence: number;
}

interface LegResult {
  description: string;
  riskLevel: 'safe' | 'caution' | 'danger';
  sharpSignals: SharpSignal[];
  hasSharpData: boolean;
  warnings: string[];
}

interface QuickCheckResponse {
  legs: LegResult[];
  overallRisk: 'safe' | 'caution' | 'danger';
  hasSharpConflicts: boolean;
  suggestedAction: string;
}

// Fuzzy match leg description against line movements
function fuzzyMatch(legDesc: string, movement: any): number {
  const legLower = legDesc.toLowerCase();
  const movementDesc = movement.description?.toLowerCase() || '';
  const playerName = movement.player_name?.toLowerCase() || '';
  
  let score = 0;
  
  // Check for player name match
  if (playerName && legLower.includes(playerName)) {
    score += 50;
  }
  
  // Check for team names
  const teams = movementDesc.split(' vs ');
  if (teams.length === 2) {
    if (legLower.includes(teams[0].toLowerCase()) || legLower.includes(teams[1].toLowerCase())) {
      score += 30;
    }
  }
  
  // Check for bet type keywords
  const betKeywords = ['over', 'under', 'spread', 'moneyline', 'ml', 'points', 'pts', 'rebounds', 'reb', 'assists', 'ast'];
  for (const keyword of betKeywords) {
    if (legLower.includes(keyword) && movementDesc.includes(keyword)) {
      score += 15;
    }
  }
  
  // Check market type
  if (movement.market_type) {
    const marketLower = movement.market_type.toLowerCase();
    if (legLower.includes('spread') && marketLower.includes('spread')) score += 20;
    if (legLower.includes('total') && marketLower.includes('total')) score += 20;
    if ((legLower.includes('ml') || legLower.includes('moneyline')) && marketLower.includes('h2h')) score += 20;
  }
  
  return score;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { legs } = await req.json() as { legs: LegCheck[] };
    
    if (!legs || legs.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No legs provided' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Query recent line movements (last 6 hours)
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    
    const { data: movements, error } = await supabase
      .from('line_movements')
      .select('*')
      .gte('detected_at', sixHoursAgo)
      .order('detected_at', { ascending: false });

    if (error) {
      console.error('Error fetching movements:', error);
      throw error;
    }

    console.log(`Checking ${legs.length} legs against ${movements?.length || 0} recent movements`);

    // Analyze each leg
    const results: LegResult[] = legs.map(leg => {
      const signals: SharpSignal[] = [];
      const warnings: string[] = [];
      let hasSharpData = false;
      
      // Find matching movements
      const matches = movements
        ?.map(m => ({ movement: m, score: fuzzyMatch(leg.description, m) }))
        .filter(m => m.score >= 40) // Minimum confidence threshold
        .sort((a, b) => b.score - a.score)
        .slice(0, 3) || []; // Top 3 matches

      if (matches.length > 0) {
        hasSharpData = true;
        
        for (const { movement, score } of matches) {
          const confidence = Math.min(score / 100, 1);
          
          if (movement.is_sharp_action) {
            // Real sharp money detected
            if (movement.movement_authenticity === 'real' && movement.recommendation === 'pick') {
              signals.push({
                type: 'real_sharp',
                message: `Sharp action detected: ${movement.sharp_indicator || 'Professional money'}`,
                confidence
              });
            }
            // Fake sharp / trap detected
            else if (movement.movement_authenticity === 'fake' && movement.recommendation === 'fade') {
              signals.push({
                type: 'fake_sharp',
                message: `⚠️ TRAP: ${movement.recommendation_reason || 'Fake sharp signal - likely market adjustment'}`,
                confidence
              });
              warnings.push(`Consider fading this line - ${movement.sharp_indicator || 'trap detected'}`);
            }
            // Uncertain
            else {
              signals.push({
                type: 'caution',
                message: `Mixed signals: ${movement.recommendation_reason || 'Proceed with caution'}`,
                confidence
              });
            }
          }
          
          // Large price movements
          if (Math.abs(movement.price_change) >= 10) {
            warnings.push(`Large line movement: ${movement.price_change > 0 ? '+' : ''}${movement.price_change} points`);
          }
        }
      }
      
      // Determine risk level
      let riskLevel: 'safe' | 'caution' | 'danger' = 'safe';
      
      const hasFakeSharp = signals.some(s => s.type === 'fake_sharp');
      const hasRealSharp = signals.some(s => s.type === 'real_sharp');
      
      if (hasFakeSharp) {
        riskLevel = 'danger';
      } else if (signals.some(s => s.type === 'caution') || warnings.length > 0) {
        riskLevel = 'caution';
      } else if (hasRealSharp) {
        riskLevel = 'safe'; // Real sharp = good bet
      }
      
      return {
        description: leg.description,
        riskLevel,
        sharpSignals: signals,
        hasSharpData,
        warnings
      };
    });

    // Calculate overall risk
    const dangerCount = results.filter(r => r.riskLevel === 'danger').length;
    const cautionCount = results.filter(r => r.riskLevel === 'caution').length;
    
    const overallRisk: 'safe' | 'caution' | 'danger' = 
      dangerCount > 0 ? 'danger' :
      cautionCount >= results.length / 2 ? 'caution' : 'safe';
    
    const hasSharpConflicts = dangerCount > 0;
    
    let suggestedAction = '';
    if (hasSharpConflicts) {
      suggestedAction = `Review ${dangerCount} leg${dangerCount > 1 ? 's' : ''} with trap signals before proceeding`;
    } else if (overallRisk === 'caution') {
      suggestedAction = `Proceed with caution - monitor line movements`;
    } else {
      suggestedAction = `All clear - no major red flags detected`;
    }

    const response: QuickCheckResponse = {
      legs: results,
      overallRisk,
      hasSharpConflicts,
      suggestedAction
    };

    return new Response(
      JSON.stringify(response),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in quick-sharp-check:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
