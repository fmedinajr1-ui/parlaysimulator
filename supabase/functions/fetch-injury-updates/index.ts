import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 30000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

interface InjuryInfo {
  player: string;
  team: string;
  status: 'OUT' | 'DOUBTFUL' | 'QUESTIONABLE' | 'PROBABLE' | 'DAY-TO-DAY';
  injuryType: string;
  injuryDetails: string;
  impactLevel: 'critical' | 'high' | 'medium' | 'low';
  lastUpdated: string;
}

interface LegInput {
  description: string;
  sport?: string;
  player?: string;
  team?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { legs, sports } = await req.json() as {
      legs?: LegInput[];
      sports?: string[];
    };

    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not configured');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check cache first
    const { data: cachedInjuries } = await supabase
      .from('injury_cache')
      .select('*')
      .gt('expires_at', new Date().toISOString());

    // If we have recent cache and no specific legs to check, return cached data
    if (cachedInjuries && cachedInjuries.length > 0 && !legs) {
      console.log(`Returning ${cachedInjuries.length} cached injuries`);
      return new Response(JSON.stringify({ 
        injuries: cachedInjuries.map(i => ({
          player: i.player_name,
          team: i.team,
          status: i.status,
          injuryType: i.injury_type,
          injuryDetails: i.injury_details,
          impactLevel: i.impact_level,
          lastUpdated: i.last_updated
        })),
        source: 'cache' 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Build context for AI to parse injury info
    let legsContext = '';
    if (legs && legs.length > 0) {
      legsContext = `\n\nSPECIFIC BETS TO CHECK FOR INJURY IMPACT:\n${legs.map((leg, idx) => 
        `${idx + 1}. "${leg.description}" (Sport: ${leg.sport || 'Unknown'}, Player: ${leg.player || 'N/A'}, Team: ${leg.team || 'N/A'})`
      ).join('\n')}`;
    }

    const targetSports = sports || ['NBA', 'NFL', 'NHL', 'MLB'];
    
    const prompt = `You are a sports injury analyst with access to the latest injury reports. Provide current injury information for key players in ${targetSports.join(', ')}.${legsContext}

Return injury data in this exact JSON format:
{
  "injuries": [
    {
      "player": "Player Full Name",
      "team": "Team Name",
      "sport": "NBA|NFL|NHL|MLB",
      "status": "OUT|DOUBTFUL|QUESTIONABLE|PROBABLE|DAY-TO-DAY",
      "injuryType": "Type of injury (e.g., Knee, Ankle, Illness)",
      "injuryDetails": "Brief description of the injury and expected timeline",
      "impactLevel": "critical|high|medium|low",
      "affectsLegs": [0, 2]
    }
  ],
  "lastUpdated": "${new Date().toISOString()}"
}

INJURY STATUS DEFINITIONS:
- OUT: Will not play, confirmed out
- DOUBTFUL: Unlikely to play (25% chance or less)
- QUESTIONABLE: Uncertain (50/50 chance)
- PROBABLE: Likely to play (75%+ chance)
- DAY-TO-DAY: Being evaluated daily

IMPACT LEVEL DEFINITIONS:
- critical: Star player out, major impact on team performance
- high: Key rotation player out, significant impact
- medium: Role player out, moderate impact
- low: Bench player or minor injury, minimal impact

If checking specific bets, the "affectsLegs" array should contain the indices (0-based) of legs that this injury affects.

Focus on:
1. Star players and key starters
2. Players relevant to the specific bets provided
3. Recent injury updates from the last 24-48 hours
4. Be conservative - only include injuries you're confident about

Return ONLY valid JSON, no other text.`;

    console.log('Fetching injury updates for sports:', targetSports.join(', '));

    const response = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { 
            role: 'system', 
            content: 'You are a sports injury analyst with up-to-date knowledge of player injuries. Always return valid JSON with accurate injury information. Be conservative and only report injuries you are confident about.' 
          },
          { role: 'user', content: prompt }
        ],
        max_tokens: 2000,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API error:', response.status, errorText);
      
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: 'Rate limits exceeded' }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      throw new Error('OpenAI API error');
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    
    if (!content) {
      throw new Error('No content in AI response');
    }

    // Parse the JSON response
    let injuryData;
    try {
      let jsonStr = content;
      if (content.includes('```')) {
        const match = content.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (match) {
          jsonStr = match[1].trim();
        }
      }
      injuryData = JSON.parse(jsonStr);
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      injuryData = { injuries: [], lastUpdated: new Date().toISOString() };
    }

    console.log(`Fetched ${injuryData.injuries?.length || 0} injury reports`);

    // Cache the injury data
    if (injuryData.injuries && injuryData.injuries.length > 0) {
      // Clear old cache
      await supabase
        .from('injury_cache')
        .delete()
        .lt('expires_at', new Date().toISOString());

      // Insert new injuries
      const cacheData = injuryData.injuries.map((injury: any) => ({
        sport: injury.sport || 'Unknown',
        player_name: injury.player,
        team: injury.team,
        status: injury.status,
        injury_type: injury.injuryType,
        injury_details: injury.injuryDetails,
        impact_level: injury.impactLevel,
        last_updated: new Date().toISOString(),
        expires_at: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString() // 6 hours
      }));

      const { error: cacheError } = await supabase
        .from('injury_cache')
        .upsert(cacheData, { 
          onConflict: 'player_name,team',
          ignoreDuplicates: false 
        });

      if (cacheError) {
        console.error('Cache error:', cacheError);
      }
    }

    return new Response(JSON.stringify({
      injuries: injuryData.injuries || [],
      lastUpdated: injuryData.lastUpdated,
      source: 'fresh'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in fetch-injury-updates:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error',
      injuries: []
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
