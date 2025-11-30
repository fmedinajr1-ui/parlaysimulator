import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface LegInput {
  description: string;
  odds: number;
  impliedProbability: number;
}

interface InjuryAlert {
  player: string;
  team: string;
  status: 'OUT' | 'DOUBTFUL' | 'QUESTIONABLE' | 'PROBABLE' | 'DAY-TO-DAY';
  injuryType: string;
  injuryDetails: string;
  impactLevel: 'critical' | 'high' | 'medium' | 'low';
  affectsLegs?: number[];
}

interface CalibrationFactor {
  sport: string;
  bet_type: string;
  confidence_level: string;
  calibration_factor: number;
  sample_size: number;
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
  calibratedProbability?: number;
  confidenceLevel: 'high' | 'medium' | 'low';
  vegasJuice: number;
  correlatedWith?: number[];
  injuryAlerts?: InjuryAlert[];
}

interface HistoricalContext {
  userOverall?: { totalBets: number; totalWins: number; hitRate: string | number };
  aiOverall?: { totalPredictions: number; correctPredictions: number; accuracy: string | number };
  userStatsByType?: Array<{ sport: string; bet_type: string; total_bets: number; wins: number; hit_rate: number }>;
  aiMetricsByType?: Array<{ sport: string; bet_type: string; confidence_level: string; total_predictions: number; correct_predictions: number; accuracy_rate: number }>;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { legs, stake, combinedProbability, userId } = await req.json() as {
      legs: LegInput[];
      stake: number;
      combinedProbability: number;
      userId?: string;
    };

    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not configured');
    }

    console.log(`Analyzing ${legs.length} parlay legs with stake $${stake}`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch calibration factors
    let calibrationFactors: CalibrationFactor[] = [];
    try {
      const { data: calibData } = await supabase
        .from('ai_calibration_factors')
        .select('sport, bet_type, confidence_level, calibration_factor, sample_size')
        .gte('sample_size', 3);
      
      calibrationFactors = calibData || [];
      console.log(`Loaded ${calibrationFactors.length} calibration factors`);
    } catch (calibError) {
      console.error('Error fetching calibration factors:', calibError);
    }

    // Fetch injury data for relevant sports
    let injuries: InjuryAlert[] = [];
    try {
      const { data: injuryData } = await supabase
        .from('injury_cache')
        .select('*')
        .gt('expires_at', new Date().toISOString());
      
      if (injuryData && injuryData.length > 0) {
        injuries = injuryData.map((i: any) => ({
          player: i.player_name,
          team: i.team,
          status: i.status,
          injuryType: i.injury_type,
          injuryDetails: i.injury_details,
          impactLevel: i.impact_level
        }));
        console.log(`Loaded ${injuries.length} injury alerts from cache`);
      }
    } catch (injuryError) {
      console.error('Error fetching injuries:', injuryError);
    }

    // Fetch historical context if user is logged in
    let historicalContext: HistoricalContext = {};
    if (userId) {
      try {
        const [userStatsResult, aiMetricsResult] = await Promise.all([
          supabase.rpc('get_user_betting_stats', { p_user_id: userId }),
          supabase.rpc('get_ai_accuracy_stats')
        ]);

        const userStats = userStatsResult.data || [];
        const aiMetrics = aiMetricsResult.data || [];

        const totalBets = userStats.reduce((sum: number, s: any) => sum + Number(s.total_bets || 0), 0);
        const totalWins = userStats.reduce((sum: number, s: any) => sum + Number(s.wins || 0), 0);
        const overallHitRate = totalBets > 0 ? (totalWins / totalBets * 100).toFixed(1) : '0';

        const aiTotalPredictions = aiMetrics.reduce((sum: number, m: any) => sum + Number(m.total_predictions || 0), 0);
        const aiCorrectPredictions = aiMetrics.reduce((sum: number, m: any) => sum + Number(m.correct_predictions || 0), 0);
        const aiOverallAccuracy = aiTotalPredictions > 0 ? (aiCorrectPredictions / aiTotalPredictions * 100).toFixed(1) : '0';

        historicalContext = {
          userOverall: { totalBets, totalWins, hitRate: overallHitRate },
          aiOverall: { totalPredictions: aiTotalPredictions, correctPredictions: aiCorrectPredictions, accuracy: aiOverallAccuracy },
          userStatsByType: userStats,
          aiMetricsByType: aiMetrics
        };

        console.log(`Historical context loaded: ${totalBets} total user bets, ${aiTotalPredictions} AI predictions`);
      } catch (histError) {
        console.error('Error fetching historical context:', histError);
      }
    }

    // Build the prompt for AI analysis
    const legsText = legs.map((leg, idx) => 
      `Leg ${idx + 1}: "${leg.description}" | Odds: ${leg.odds > 0 ? '+' : ''}${leg.odds} | Implied Prob: ${(leg.impliedProbability * 100).toFixed(1)}%`
    ).join('\n');

    // Build historical context section for prompt
    let historicalSection = '';
    if (historicalContext.userOverall && historicalContext.userOverall.totalBets > 0) {
      historicalSection += `\n\nHISTORICAL DATA - USER'S BETTING RECORD:
- Overall record: ${historicalContext.userOverall.totalWins}-${historicalContext.userOverall.totalBets - historicalContext.userOverall.totalWins} (${historicalContext.userOverall.hitRate}% hit rate)`;
      
      if (historicalContext.userStatsByType && historicalContext.userStatsByType.length > 0) {
        historicalSection += '\n- By category:';
        historicalContext.userStatsByType.slice(0, 5).forEach(stat => {
          historicalSection += `\n  • ${stat.sport} ${stat.bet_type}: ${stat.wins}/${stat.total_bets} (${Number(stat.hit_rate).toFixed(0)}%)`;
        });
      }
    }

    if (historicalContext.aiOverall && Number(historicalContext.aiOverall.totalPredictions) > 0) {
      historicalSection += `\n\nAI PREDICTION TRACK RECORD:
- Overall accuracy: ${historicalContext.aiOverall.correctPredictions}/${historicalContext.aiOverall.totalPredictions} (${historicalContext.aiOverall.accuracy}%)`;
      
      if (historicalContext.aiMetricsByType && historicalContext.aiMetricsByType.length > 0) {
        historicalSection += '\n- By category (confidence level):';
        historicalContext.aiMetricsByType.slice(0, 5).forEach(metric => {
          historicalSection += `\n  • ${metric.sport} ${metric.bet_type} (${metric.confidence_level}): ${metric.correct_predictions}/${metric.total_predictions} (${Number(metric.accuracy_rate).toFixed(0)}%)`;
        });
      }
    }

    if (historicalSection) {
      historicalSection += '\n\nUse this historical data to calibrate your confidence levels and adjusted probabilities. If this user or bet type has a track record, factor it in.';
    }

    // Build calibration context
    let calibrationSection = '';
    if (calibrationFactors.length > 0) {
      calibrationSection = '\n\nCALIBRATION FACTORS (based on historical AI accuracy):';
      calibrationFactors.forEach(cf => {
        const factor = Number(cf.calibration_factor);
        const status = factor < 0.95 ? 'OVERCONFIDENT' : factor > 1.05 ? 'UNDERCONFIDENT' : 'WELL CALIBRATED';
        calibrationSection += `\n- ${cf.sport} ${cf.bet_type} (${cf.confidence_level}): ${(factor * 100).toFixed(0)}% calibration (${status})`;
      });
      calibrationSection += '\n\nApply these calibration factors to your adjusted probabilities. If AI has been overconfident, reduce your probability estimates accordingly.';
    }

    // Build injury context
    let injurySection = '';
    if (injuries.length > 0) {
      injurySection = '\n\nCURRENT INJURY REPORT:';
      injuries.forEach(inj => {
        injurySection += `\n- ${inj.player} (${inj.team}): ${inj.status} - ${inj.injuryType}. Impact: ${inj.impactLevel}`;
      });
      injurySection += '\n\nConsider these injuries when analyzing player props and team performance. Flag any legs that may be affected.';
    }

    const prompt = `You are an expert sharp sports bettor and analyst. Analyze this parlay slip and provide detailed intelligence on each leg.

PARLAY SLIP:
${legsText}

Total Stake: $${stake}
Combined Probability: ${(combinedProbability * 100).toFixed(2)}%${historicalSection}${calibrationSection}${injurySection}

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
      "vegasJuice": X.X,
      "injuryAlerts": [
        {
          "player": "Player Name",
          "team": "Team Name", 
          "status": "OUT|DOUBTFUL|QUESTIONABLE|PROBABLE|DAY-TO-DAY",
          "injuryType": "Type",
          "injuryDetails": "Details",
          "impactLevel": "critical|high|medium|low"
        }
      ]
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
   - Historical performance data (if available): factor in user's actual hit rate
4. Be brutally honest. If it's a sucker bet, say so in risk factors.
5. Reference real factors when possible (primetime games, divisional matchups, back-to-backs, etc.)
6. If historical data shows the AI has been accurate/inaccurate on certain bet types, adjust confidence accordingly.

Return ONLY valid JSON, no other text.`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
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
            content: 'You are a sharp sports betting analyst with access to historical betting data. Always return valid JSON. Be specific, analytical, and brutally honest about bet quality. Use any provided historical performance data to calibrate your predictions.' 
          },
          { role: 'user', content: prompt }
        ],
        max_tokens: 3000,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API error:', response.status, errorText);
      
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: 'Rate limits exceeded, please try again later.' }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (response.status === 402 || response.status === 401) {
        return new Response(JSON.stringify({ error: 'AI service error. Please check configuration.' }), {
          status: 402,
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

    console.log('OpenAI response received, parsing...');

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
