import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface LegInput {
  description: string;
  odds: number;
  impliedProbability: number;
}

interface LegAnalysis {
  sport: string;
  betType: 'moneyline' | 'spread' | 'total' | 'player_prop' | 'other';
  team?: string;
  player?: string;
  insights: string[];
  riskFactors: string[];
  trendDirection: 'favorable' | 'neutral' | 'unfavorable';
  adjustedProbability: number;
  confidenceLevel: 'high' | 'medium' | 'low';
  vegasJuice: number; // Estimated vig percentage
  correlatedWith?: number[]; // Indices of correlated legs
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { legs, stake, combinedProbability } = await req.json() as {
      legs: LegInput[];
      stake: number;
      combinedProbability: number;
    };

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    console.log(`Analyzing ${legs.length} parlay legs with stake $${stake}`);

    // Build the prompt for AI analysis
    const legsText = legs.map((leg, idx) => 
      `Leg ${idx + 1}: "${leg.description}" | Odds: ${leg.odds > 0 ? '+' : ''}${leg.odds} | Implied Prob: ${(leg.impliedProbability * 100).toFixed(1)}%`
    ).join('\n');

    const prompt = `You are an expert sharp sports bettor and analyst. Analyze this parlay slip and provide detailed intelligence on each leg.

PARLAY SLIP:
${legsText}

Total Stake: $${stake}
Combined Probability: ${(combinedProbability * 100).toFixed(2)}%

For EACH leg, provide analysis in this exact JSON format. Be specific and analytical:

{
  "legAnalyses": [
    {
      "legIndex": 0,
      "sport": "NFL|NBA|MLB|NHL|NCAAF|NCAAB|Soccer|UFC|Tennis|Other",
      "betType": "moneyline|spread|total|player_prop|other",
      "team": "team name if applicable",
      "player": "player name if applicable",
      "insights": [
        "specific insight about this bet (trends, matchup, historical data)",
        "another specific insight"
      ],
      "riskFactors": [
        "specific risk factor (injuries, weather, rest days, etc.)",
        "another risk factor if applicable"
      ],
      "trendDirection": "favorable|neutral|unfavorable",
      "adjustedProbability": 0.XX,
      "confidenceLevel": "high|medium|low",
      "vegasJuice": X.X
    }
  ],
  "correlatedLegs": [
    {"indices": [0, 2], "reason": "Same game - outcomes are linked"},
    {"indices": [1, 3], "reason": "Both require same team to perform well"}
  ],
  "overallAssessment": "One sentence brutally honest assessment of this parlay"
}

ANALYSIS GUIDELINES:
1. VEGAS JUICE: Standard juice is 4.5%. Lines at -130 or worse indicate heavy juice (8%+). Calculate estimated vig.
2. CORRELATIONS: Flag legs from the same game or that logically depend on each other. Correlated legs reduce true odds.
3. ADJUSTED PROBABILITY: Start with implied prob, adjust -15% to +10% based on:
   - Favorable trends/matchups: +5% to +10%
   - Injury concerns: -5% to -10%
   - Weather factors (outdoor sports): -3% to -8%
   - Public money inflating lines: -5%
   - Sharp money indicator: +5%
4. Be brutally honest. If it's a sucker bet, say so in risk factors.
5. Reference real factors when possible (primetime games, divisional matchups, back-to-backs, etc.)

Return ONLY valid JSON, no other text.`;

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { 
            role: 'system', 
            content: 'You are a sharp sports betting analyst. Always return valid JSON. Be specific, analytical, and brutally honest about bet quality.' 
          },
          { role: 'user', content: prompt }
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('AI gateway error:', response.status, errorText);
      
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: 'Rate limits exceeded, please try again later.' }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: 'AI credits exhausted. Please add credits to continue.' }), {
          status: 402,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      throw new Error('AI gateway error');
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    
    if (!content) {
      throw new Error('No content in AI response');
    }

    console.log('AI response received, parsing...');

    // Parse the JSON response
    let analysis;
    try {
      // Extract JSON from potential markdown code blocks
      let jsonStr = content;
      if (content.includes('```')) {
        const match = content.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (match) {
          jsonStr = match[1].trim();
        }
      }
      analysis = JSON.parse(jsonStr);
    } catch (parseError) {
      console.error('JSON parse error:', parseError, 'Content:', content);
      // Return a fallback analysis if parsing fails
      analysis = {
        legAnalyses: legs.map((leg, idx) => ({
          legIndex: idx,
          sport: 'Other',
          betType: 'other',
          insights: ['Unable to analyze - review manually'],
          riskFactors: ['Analysis unavailable'],
          trendDirection: 'neutral',
          adjustedProbability: leg.impliedProbability,
          confidenceLevel: 'low',
          vegasJuice: 4.5
        })),
        correlatedLegs: [],
        overallAssessment: 'Analysis unavailable - proceed with caution'
      };
    }

    return new Response(JSON.stringify(analysis), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in analyze-parlay:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error occurred' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
