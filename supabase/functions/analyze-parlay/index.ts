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

interface UsageProjection {
  playerName: string;
  propType: string;
  line: number;
  projectedMinutes: { min: number; max: number; avg: number };
  requiredRate: number;
  historicalRate: number;
  efficiencyMargin: number;
  recentGames: { date: string; value: number; minutes: number }[];
  hitRate: { hits: number; total: number; percentage: number };
  paceImpact: number;
  fatigueImpact: number;
  opponentDefenseRank: number | null;
  verdict: 'FAVORABLE' | 'NEUTRAL' | 'UNFAVORABLE';
  verdictReason: string;
}

interface UnifiedPropData {
  pvsScore: number;
  pvsTier: string;
  hitRateScore: number;
  trapScore: number;
  fatigueScore: number;
  recommendation: string;
  confidence: number;
  sharpMoneyScore: number;
}

interface UpsetData {
  upsetScore: number;
  isTrapFavorite: boolean;
  suggestion: string;
  confidence: string;
  chaosModeActive: boolean;
}

interface JuiceData {
  juiceLevel: string;
  juiceDirection: string;
  juiceAmount: number;
  finalPick: string;
  movementConsistency: number;
}

interface FatigueData {
  fatigueScore: number;
  fatigueCategory: string;
  recommendedAngle: string;
  isBackToBack: boolean;
  travelMiles: number;
}

interface EngineSignal {
  engine: string;
  status: 'agree' | 'disagree' | 'neutral' | 'no_data';
  score: number | null;
  reason: string;
  confidence?: number;
}

interface MedianLockData {
  classification: string;
  confidence_score: number;
  bet_side: string;
  hit_rate: number;
  parlay_grade: boolean;
  edge_percent: number;
  projected_minutes: number;
  adjusted_edge: number;
}

interface EngineConsensus {
  agreeingEngines: string[];
  disagreingEngines: string[];
  consensusScore: number;
  totalEngines: number;
  engineSignals?: EngineSignal[];
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
  sharpRecommendation?: 'pick' | 'fade' | 'caution' | null;
  sharpReason?: string;
  sharpSignals?: string[];
  sharpConfidence?: number;
  sharpFinalPick?: string;
  usageProjection?: UsageProjection;
  unifiedPropData?: UnifiedPropData;
  upsetData?: UpsetData;
  juiceData?: JuiceData;
  fatigueData?: FatigueData;
  engineConsensus?: EngineConsensus;
  avoidPatterns?: string[];
  medianLockData?: MedianLockData;
  coachData?: {
    coachName: string;
    teamName: string;
    sport: string;
    offensiveBias: number;
    defensiveBias: number;
    recommendation: string;
    confidence: number;
    propRelevance: string;
    propAdjustment: number;
  };
  hitRatePercent?: number;
}

interface HistoricalContext {
  userOverall?: { totalBets: number; totalWins: number; hitRate: string | number };
  aiOverall?: { totalPredictions: number; correctPredictions: number; accuracy: string | number };
  userStatsByType?: Array<{ sport: string; bet_type: string; total_bets: number; wins: number; hit_rate: number }>;
  aiMetricsByType?: Array<{ sport: string; bet_type: string; confidence_level: string; total_predictions: number; correct_predictions: number; accuracy_rate: number }>;
}

interface LineMovement {
  description: string;
  market_type: string;
  player_name?: string;
  recommendation?: string;
  recommendation_reason?: string;
  movement_authenticity?: string;
  authenticity_confidence?: number;
  sharp_indicator?: string;
  final_pick?: string;
  is_sharp_action?: boolean;
}

interface MatchedSharpData {
  recommendation: string;
  reason: string;
  authenticity: string;
  confidence: number;
  signals: string[];
  finalPick: string;
  isTrap: boolean;
}

const TRAP_SIGNALS = [
  'BOTH_SIDES_MOVED',
  'PRICE_ONLY_MOVE_TRAP',
  'SINGLE_BOOK_DIVERGENCE',
  'EARLY_MORNING_OVER',
  'FAKE_SHARP_TAG'
];

// Deterministic matching function
function matchLegToMovements(legDescription: string, movements: LineMovement[]): MatchedSharpData | null {
  const descLower = legDescription.toLowerCase();
  
  // Extract team names, player names, and key terms
  const teamRegex = /\b(lakers|celtics|warriors|nets|knicks|heat|bucks|sixers|raptors|bulls|cavaliers|pistons|pacers|magic|hawks|hornets|wizards|nuggets|timberwolves|thunder|trail blazers|jazz|clippers|kings|suns|mavericks|rockets|grizzlies|pelicans|spurs|chiefs|bills|bengals|cowboys|eagles|49ers|rams|packers|ravens|browns|steelers|dolphins|jets|patriots|raiders|chargers|broncos|colts|jaguars|titans|texans|commanders|giants|panthers|falcons|saints|buccaneers|seahawks|cardinals|lions|bears|vikings)\b/gi;
  const playerRegex = /\b([A-Z][a-z]+\s[A-Z][a-z]+)\b/g;
  
  const teams = descLower.match(teamRegex) || [];
  const players = legDescription.match(playerRegex) || [];
  
  // Find matching movements
  const matches = movements.filter(m => {
    const moveDesc = m.description.toLowerCase();
    const playerName = m.player_name?.toLowerCase() || '';
    
    // Check for team match
    const teamMatch = teams.some(team => moveDesc.includes(team.toLowerCase()));
    // Check for player match
    const playerMatch = players.some(player => playerName.includes(player.toLowerCase()));
    
    return teamMatch || playerMatch;
  });
  
  if (matches.length === 0) return null;
  
  // Sort by confidence and authenticity
  const sortedMatches = matches.sort((a, b) => {
    const aConf = a.authenticity_confidence || 0;
    const bConf = b.authenticity_confidence || 0;
    return bConf - aConf;
  });
  
  const bestMatch = sortedMatches[0];
  
  // Parse signals from sharp indicator
  const signals: string[] = [];
  if (bestMatch.sharp_indicator) {
    const indicatorUpper = bestMatch.sharp_indicator.toUpperCase();
    if (indicatorUpper.includes('MULTI_BOOK')) signals.push('MULTI_BOOK_CONSENSUS');
    if (indicatorUpper.includes('LATE_MONEY')) signals.push('LATE_MONEY_SWEET_SPOT');
    if (indicatorUpper.includes('STEAM')) signals.push('STEAM_MOVE');
    if (indicatorUpper.includes('REVERSE')) signals.push('REVERSE_LINE_MOVEMENT');
    if (indicatorUpper.includes('SINGLE') || indicatorUpper.includes('DIVERGENCE')) signals.push('SINGLE_BOOK_DIVERGENCE');
    if (indicatorUpper.includes('BOTH_SIDES')) signals.push('BOTH_SIDES_MOVED');
  }
  
  // Detect trap bets
  const isTrap = bestMatch.movement_authenticity === 'fake' || 
                 signals.some(s => TRAP_SIGNALS.includes(s)) ||
                 (bestMatch.recommendation === 'fade');
  
  return {
    recommendation: bestMatch.recommendation || 'caution',
    reason: bestMatch.recommendation_reason || 'Sharp line movement detected',
    authenticity: bestMatch.movement_authenticity || 'uncertain',
    confidence: bestMatch.authenticity_confidence || 0.5,
    signals,
    finalPick: bestMatch.final_pick || 'No clear pick',
    isTrap
  };
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

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
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

    // Fetch recent line movements (last 6 hours)
    let lineMovements: any[] = [];
    let unifiedProps: any[] = [];
    let godModeUpsets: any[] = [];
    let juicedProps: any[] = [];
    let fatigueScores: any[] = [];
    let avoidPatterns: any[] = [];
    let formulaPerformance: any[] = [];
    let bestBetsLog: any[] = [];
    let hitrateProps: any[] = [];
    let coachProfiles: any[] = [];
    let medianLockCandidates: any[] = [];
    
    try {
      const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
      const today = new Date().toISOString().split('T')[0];
      
      // Fetch all engine data in parallel (11 data sources)
      const [
        movementResult,
        unifiedResult,
        godModeResult,
        juicedResult,
        fatigueResult,
        avoidResult,
        formulaResult,
        bestBetsResult,
        hitrateResult,
        coachResult,
        medianLockResult
      ] = await Promise.all([
        supabase
          .from('line_movements')
          .select('*')
          .gte('detected_at', sixHoursAgo)
          .order('detected_at', { ascending: false })
          .limit(100),
        supabase
          .from('unified_props')
          .select('*')
          .gte('commence_time', new Date().toISOString())
          .not('recommendation', 'is', null)
          .limit(500),
        supabase
          .from('god_mode_upset_predictions')
          .select('*')
          .gte('commence_time', new Date().toISOString())
          .eq('game_completed', false)
          .limit(100),
        supabase
          .from('juiced_props')
          .select('*')
          .gte('commence_time', new Date().toISOString())
          .not('final_pick', 'is', null)
          .limit(200),
        supabase
          .from('nba_fatigue_scores')
          .select('*')
          .eq('game_date', today)
          .limit(60),
        supabase
          .from('ai_avoid_patterns')
          .select('*')
          .eq('is_active', true)
          .limit(100),
        supabase
          .from('ai_formula_performance')
          .select('*')
          .gte('total_picks', 10)
          .order('current_accuracy', { ascending: false })
          .limit(20),
        supabase
          .from('best_bets_log')
          .select('*')
          .gte('created_at', sixHoursAgo)
          .limit(100),
        supabase
          .from('hitrate_parlays')
          .select('*')
          .eq('is_active', true)
          .gte('expires_at', new Date().toISOString())
          .limit(100),
        supabase
          .from('coach_profiles')
          .select('*')
          .eq('is_active', true)
          .limit(100),
        supabase
          .from('median_lock_candidates')
          .select('*')
          .eq('slate_date', today)
          .in('classification', ['LOCK', 'STRONG'])
          .limit(200)
      ]);
      
      lineMovements = movementResult.data || [];
      unifiedProps = unifiedResult.data || [];
      godModeUpsets = godModeResult.data || [];
      juicedProps = juicedResult.data || [];
      fatigueScores = fatigueResult.data || [];
      avoidPatterns = avoidResult.data || [];
      formulaPerformance = formulaResult.data || [];
      bestBetsLog = bestBetsResult.data || [];
      hitrateProps = hitrateResult.data || [];
      coachProfiles = coachResult.data || [];
      medianLockCandidates = medianLockResult.data || [];
      
      console.log(`Loaded engine data: ${lineMovements.length} movements, ${unifiedProps.length} unified, ${godModeUpsets.length} upsets, ${juicedProps.length} juiced, ${fatigueScores.length} fatigue, ${avoidPatterns.length} avoid, ${formulaPerformance.length} formulas, ${bestBetsLog.length} bestBets, ${hitrateProps.length} hitrate, ${coachProfiles.length} coaches, ${medianLockCandidates.length} medianLock`);
    } catch (dataError) {
      console.error('Error fetching engine data:', dataError);
    }

    // Pre-process sharp data for each leg using deterministic matching
    const legSharpData = legs.map((leg, idx) => {
      const matchedMovements = matchLegToMovements(leg.description, lineMovements as LineMovement[]);
      
      if (matchedMovements) {
        return {
          legIndex: idx,
          hasSharpData: true,
          ...matchedMovements
        };
      }
      return { legIndex: idx, hasSharpData: false };
    });

    // Build sharp money context with pre-matched data
    let sharpSection = '';
    if (lineMovements.length > 0) {
      sharpSection = '\n\nREAL-TIME SHARP LINE MOVEMENTS (last 6 hours):';
      const sharpMovements = lineMovements.filter(m => m.is_sharp_action || m.movement_authenticity === 'real' || m.recommendation);
      sharpMovements.slice(0, 15).forEach(m => {
        const rec = m.recommendation ? ` | ${m.recommendation.toUpperCase()}` : '';
        const auth = m.movement_authenticity ? ` (${m.movement_authenticity})` : '';
        sharpSection += `\n- ${m.description} | ${m.market_type}${rec}${auth}`;
        if (m.sharp_indicator) sharpSection += ` | Signal: ${m.sharp_indicator}`;
      });
      
      sharpSection += '\n\nPRE-MATCHED SHARP DATA FOR EACH LEG (use this data directly):';
      legSharpData.forEach(d => {
        if (d.hasSharpData && 'recommendation' in d) {
          sharpSection += `\nLeg ${d.legIndex + 1}: ${d.recommendation.toUpperCase()} - ${d.reason}`;
          if (d.isTrap) sharpSection += ' ⚠️ TRAP ALERT';
          sharpSection += ` | Signals: ${d.signals.join(', ') || 'None'}`;
          sharpSection += ` | Final Pick: ${d.finalPick}`;
        } else {
          sharpSection += `\nLeg ${d.legIndex + 1}: No sharp data available`;
        }
      });
      
      sharpSection += '\n\nSHARP ANALYSIS RULES:';
      sharpSection += '\n- PICK: Real sharp money detected (authentic movement, multi-book consensus, late money sweet spot) - bet this side';
      sharpSection += '\n- FADE: Fake/trap movement detected (single book, opposite side moved, low confidence) - bet the opposite';
      sharpSection += '\n- CAUTION: Mixed signals or uncertain - proceed carefully';
      sharpSection += '\n\n⚠️ CRITICAL: Use the PRE-MATCHED SHARP DATA above for sharpRecommendation fields. Only override if you have strong reasoning.';
    }

    const prompt = `You are an expert sharp sports bettor and analyst. Analyze this parlay slip and provide detailed intelligence on each leg.

PARLAY SLIP:
${legsText}

Total Stake: $${stake}
Combined Probability: ${(combinedProbability * 100).toFixed(2)}%${historicalSection}${calibrationSection}${injurySection}${sharpSection}

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
      ],
      "sharpRecommendation": "pick|fade|caution|null",
      "sharpReason": "Explanation of sharp signals detected",
      "sharpSignals": ["MULTI_BOOK_CONSENSUS", "LATE_MONEY_SWEET_SPOT"],
      "sharpConfidence": 0.75,
      "sharpFinalPick": "Team/Player to bet or 'No sharp action detected'"
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
4. SHARP ANALYSIS: For each leg, check if line movements match the bet. Set sharpRecommendation based on:
   - "pick": Real sharp money (multi-book consensus, late money, high confidence, authentic movement)
   - "fade": Fake/trap money (single book, opposite side moved, low confidence, questionable authenticity)
   - "caution": Mixed signals or insufficient data
   - null: No relevant line movement data
5. Be brutally honest. If it's a sucker bet, say so in risk factors.
6. Reference real factors when possible (primetime games, divisional matchups, back-to-backs, etc.)
7. If historical data shows the AI has been accurate/inaccurate on certain bet types, adjust confidence accordingly.

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
            content: 'You are a sharp sports betting analyst with access to historical betting data. Always return valid JSON. Be specific, analytical, and brutally honest about bet quality. Use any provided historical performance data to calibrate your predictions.' 
          },
          { role: 'user', content: prompt }
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Lovable AI Gateway error:', response.status, errorText);
      
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: 'Rate limits exceeded, please try again later.' }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: 'AI usage limit reached. Please add credits to your workspace.' }), {
          status: 402,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      throw new Error('Lovable AI Gateway error');
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    
    if (!content) {
      throw new Error('No content in AI response');
    }

    console.log('Lovable AI response received, parsing...');

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

    // Helper functions for matching legs to engine data
    function matchUnifiedProp(playerName: string, propDesc: string, props: any[]): any | null {
      const playerLower = playerName.toLowerCase();
      const descLower = propDesc.toLowerCase();
      return props.find(p => 
        p.player_name?.toLowerCase().includes(playerLower) ||
        playerLower.includes(p.player_name?.toLowerCase() || '')
      ) || null;
    }

    function matchUpset(teams: string[], upsets: any[]): any | null {
      return upsets.find(u => 
        teams.some(t => 
          u.home_team?.toLowerCase().includes(t.toLowerCase()) ||
          u.away_team?.toLowerCase().includes(t.toLowerCase()) ||
          t.toLowerCase().includes(u.home_team?.toLowerCase() || '') ||
          t.toLowerCase().includes(u.away_team?.toLowerCase() || '')
        )
      ) || null;
    }

    function matchJuicedProp(playerName: string, props: any[]): any | null {
      const playerLower = playerName.toLowerCase();
      return props.find(p => 
        p.player_name?.toLowerCase().includes(playerLower) ||
        playerLower.includes(p.player_name?.toLowerCase() || '')
      ) || null;
    }

    function matchFatigue(team: string, scores: any[]): any | null {
      const teamLower = team.toLowerCase();
      return scores.find(f => 
        f.team_name?.toLowerCase().includes(teamLower) ||
        teamLower.includes(f.team_name?.toLowerCase() || '')
      ) || null;
    }

    function checkAvoidPatterns(desc: string, patterns: any[]): string[] {
      const descLower = desc.toLowerCase();
      return patterns
        .filter(p => {
          const key = p.pattern_key?.toLowerCase() || '';
          const patternType = p.pattern_type?.toLowerCase() || '';
          return descLower.includes(key) || descLower.includes(patternType);
        })
        .map(p => p.avoid_reason || p.description || p.pattern_key);
    }

    function matchMedianLock(playerName: string, propType: string, candidates: any[]): any | null {
      const playerLower = playerName.toLowerCase();
      const propLower = propType.toLowerCase();
      return candidates.find(c => 
        c.player_name?.toLowerCase().includes(playerLower) ||
        playerLower.includes(c.player_name?.toLowerCase() || '')
      ) || null;
    }

    function calculateCoachBias(coach: any, propType: string): { 
      offensiveBias: number; 
      defensiveBias: number; 
      propRelevance: string;
      propAdjustment: number;
    } {
      // Calculate offensive/defensive bias relative to league averages
      const pace = coach.pace_preference === 'fast' ? 10 : coach.pace_preference === 'slow' ? -10 : 0;
      const starUsage = (coach.star_usage_pct || 50) - 50; // Normalize to 50% average
      const rotationImpact = coach.rotation_depth ? (10 - coach.rotation_depth) * 2 : 0; // Deeper rotation = negative
      
      const offensiveBias = pace + (starUsage * 0.3);
      const defensiveBias = -pace + (rotationImpact * 0.5);
      
      // Prop-type-specific relevance
      const propLower = propType.toLowerCase();
      let propRelevance = 'Neutral coaching impact';
      let propAdjustment = 0;
      
      if (propLower.includes('points') || propLower.includes('pts')) {
        propRelevance = pace > 0 ? 'Fast pace boosts scoring opportunities' : pace < 0 ? 'Slow pace limits possessions' : 'Standard pace';
        propAdjustment = pace > 0 ? 2 : pace < 0 ? -2 : 0;
      } else if (propLower.includes('rebound') || propLower.includes('reb')) {
        propRelevance = 'Rotation depth affects rebound opportunities';
        propAdjustment = rotationImpact > 0 ? 1 : -1;
      } else if (propLower.includes('assist') || propLower.includes('ast')) {
        propRelevance = pace > 0 ? 'Ball movement creates assist opportunities' : 'Isolation plays limit assists';
        propAdjustment = pace > 0 ? 1.5 : -1;
      } else if (propLower.includes('three') || propLower.includes('3pt')) {
        propRelevance = pace > 0 ? 'Up-tempo creates more 3PT attempts' : 'Half-court sets limit attempts';
        propAdjustment = pace > 0 ? 0.5 : -0.5;
      }
      
      return { offensiveBias, defensiveBias, propRelevance, propAdjustment };
    }

    function calculateEngineConsensus(legDesc: string, legPlayer: string | undefined, legTeam: string | undefined, allData: {
      unifiedProp: any,
      upset: any,
      juiced: any,
      sharpData: any,
      fatigueData: any,
      bestBet: any,
      hitrateData: any,
      coachingData: any,
      medianLockData: any
    }, formulas: any[]): EngineConsensus {
      const agreeing: string[] = [];
      const disagreeing: string[] = [];
      const engineSignals: EngineSignal[] = [];

      // 1. Sharp Money Engine
      if (allData.sharpData?.recommendation) {
        const isAgree = allData.sharpData.recommendation === 'pick';
        const isDisagree = allData.sharpData.recommendation === 'fade';
        engineSignals.push({
          engine: 'sharp',
          status: isAgree ? 'agree' : isDisagree ? 'disagree' : 'neutral',
          score: allData.sharpData.confidence || null,
          reason: allData.sharpData.reason || (isAgree ? 'Sharp money detected' : isDisagree ? 'Trap movement detected' : 'Mixed signals'),
          confidence: allData.sharpData.confidence
        });
        if (isAgree) agreeing.push('Sharp');
        else if (isDisagree) disagreeing.push('Sharp');
      } else {
        engineSignals.push({ engine: 'sharp', status: 'no_data', score: null, reason: 'No sharp data available' });
      }

      // 2. PVS Engine (from unified props)
      if (allData.unifiedProp?.pvs_final_score !== undefined) {
        const pvsScore = allData.unifiedProp.pvs_final_score;
        const pvsTier = allData.unifiedProp.pvs_tier || '';
        const isAgree = ['S', 'A'].includes(pvsTier.toUpperCase()) || pvsScore >= 65;
        const isDisagree = ['D', 'F'].includes(pvsTier.toUpperCase()) || pvsScore <= 35;
        engineSignals.push({
          engine: 'pvs',
          status: isAgree ? 'agree' : isDisagree ? 'disagree' : 'neutral',
          score: pvsScore,
          reason: `PVS Tier ${pvsTier.toUpperCase()} (${pvsScore.toFixed(0)}%)`,
          confidence: allData.unifiedProp.confidence ? allData.unifiedProp.confidence * 100 : undefined
        });
        if (isAgree) agreeing.push('PVS');
        else if (isDisagree) disagreeing.push('PVS');
      } else {
        engineSignals.push({ engine: 'pvs', status: 'no_data', score: null, reason: 'No PVS data available' });
      }

      // 3. Hit Rate Engine (from unified props or hitrate_parlays)
      const hitRateScore = allData.unifiedProp?.hit_rate_score || allData.hitrateData?.combined_probability;
      if (hitRateScore !== undefined) {
        const hrPct = hitRateScore * (hitRateScore > 1 ? 1 : 100);
        const isAgree = hrPct >= 65;
        const isDisagree = hrPct <= 40;
        engineSignals.push({
          engine: 'hitrate',
          status: isAgree ? 'agree' : isDisagree ? 'disagree' : 'neutral',
          score: hrPct,
          reason: isAgree ? `High hit rate: ${hrPct.toFixed(0)}%` : isDisagree ? `Low hit rate: ${hrPct.toFixed(0)}%` : `Moderate: ${hrPct.toFixed(0)}%`
        });
        if (isAgree) agreeing.push('HitRate');
        else if (isDisagree) disagreeing.push('HitRate');
      } else {
        engineSignals.push({ engine: 'hitrate', status: 'no_data', score: null, reason: 'No hit rate data available' });
      }

      // 4. Juiced Props Engine
      if (allData.juiced?.final_pick) {
        const descLower = legDesc.toLowerCase();
        const juiceDirection = allData.juiced.juice_direction?.toLowerCase() || '';
        const isOver = descLower.includes('over') || descLower.includes(' o ');
        const isUnder = descLower.includes('under') || descLower.includes(' u ');
        const juiceMatchesBet = (isOver && juiceDirection === 'over') || (isUnder && juiceDirection === 'under');
        const juiceOppositesBet = (isOver && juiceDirection === 'under') || (isUnder && juiceDirection === 'over');
        
        engineSignals.push({
          engine: 'juiced',
          status: juiceMatchesBet ? 'agree' : juiceOppositesBet ? 'disagree' : 'neutral',
          score: juiceDirection === 'over' ? 1 : juiceDirection === 'under' ? -1 : 0,
          reason: `Juice direction: ${juiceDirection.toUpperCase()} (${allData.juiced.juice_level})`
        });
        if (juiceMatchesBet) agreeing.push('Juiced');
        else if (juiceOppositesBet) disagreeing.push('Juiced');
      } else {
        engineSignals.push({ engine: 'juiced', status: 'no_data', score: null, reason: 'No juice data available' });
      }

      // 5. God Mode Engine
      if (allData.upset?.suggestion) {
        const isAgree = allData.upset.suggestion === 'bet';
        const isDisagree = allData.upset.suggestion === 'avoid' || allData.upset.trap_on_favorite;
        engineSignals.push({
          engine: 'godmode',
          status: isAgree ? 'agree' : isDisagree ? 'disagree' : 'neutral',
          score: allData.upset.final_upset_score || null,
          reason: isDisagree && allData.upset.trap_on_favorite ? 'Trap favorite detected' : `Suggestion: ${allData.upset.suggestion}`,
          confidence: allData.upset.confidence ? (allData.upset.confidence === 'high' ? 80 : allData.upset.confidence === 'medium' ? 60 : 40) : undefined
        });
        if (isAgree) agreeing.push('GodMode');
        else if (isDisagree) disagreeing.push('GodMode');
      } else {
        engineSignals.push({ engine: 'godmode', status: 'no_data', score: null, reason: 'No God Mode data available' });
      }

      // 6. Fatigue Engine
      if (allData.fatigueData?.fatigue_score !== undefined) {
        const fatigueScore = allData.fatigueData.fatigue_score;
        const isAgree = fatigueScore <= 20; // Low fatigue = good for player props
        const isDisagree = fatigueScore >= 50; // High fatigue = bad
        engineSignals.push({
          engine: 'fatigue',
          status: isAgree ? 'agree' : isDisagree ? 'disagree' : 'neutral',
          score: 100 - fatigueScore, // Invert so higher = better
          reason: `Fatigue: ${allData.fatigueData.fatigue_category || (fatigueScore <= 20 ? 'Fresh' : fatigueScore >= 50 ? 'Tired' : 'Moderate')}`
        });
        if (isAgree) agreeing.push('Fatigue');
        else if (isDisagree) disagreeing.push('Fatigue');
      } else {
        engineSignals.push({ engine: 'fatigue', status: 'no_data', score: null, reason: 'No fatigue data available' });
      }

      // 7. Best Bets Engine
      if (allData.bestBet) {
        const isPick = allData.bestBet.prediction?.toLowerCase().includes('pick') || allData.bestBet.signal_type?.includes('best');
        engineSignals.push({
          engine: 'bestbets',
          status: isPick ? 'agree' : 'neutral',
          score: isPick ? 1 : 0,
          reason: isPick ? `Best bet pick: ${allData.bestBet.signal_type}` : 'Listed but not top pick',
          confidence: allData.bestBet.accuracy_at_time ? allData.bestBet.accuracy_at_time * 100 : undefined
        });
        if (isPick) agreeing.push('BestBets');
      } else {
        engineSignals.push({ engine: 'bestbets', status: 'no_data', score: null, reason: 'Not in best bets' });
      }

      // 8. Coaching Engine
      if (allData.coachingData) {
        const coach = allData.coachingData;
        const hasHighPace = coach.pace_preference === 'fast';
        const hasDeepRotation = coach.rotation_depth && coach.rotation_depth >= 9;
        const hasRestTendency = coach.b2b_rest_tendency === 'aggressive_rest';
        
        // Analyze coaching recommendation based on bet type
        let isAgree = false;
        let isDisagree = false;
        let coachReason = '';
        
        if (legDesc.toLowerCase().includes('points') || legDesc.toLowerCase().includes('over')) {
          // For points/over bets, fast pace and high star usage are favorable
          isAgree = hasHighPace || (coach.star_usage_pct && coach.star_usage_pct >= 35);
          isDisagree = coach.pace_preference === 'slow' || hasRestTendency;
          coachReason = isAgree ? 'High pace/star usage supports scoring' : isDisagree ? 'Slow pace/rest tendency' : 'Neutral coaching style';
        } else if (legDesc.toLowerCase().includes('assists') || legDesc.toLowerCase().includes('rebounds')) {
          // For assists/rebounds, rotation depth and pace matter
          isAgree = hasHighPace && !hasDeepRotation;
          isDisagree = hasDeepRotation;
          coachReason = isAgree ? 'Favorable rotation for stats' : isDisagree ? 'Deep rotation limits volume' : 'Moderate coaching impact';
        } else {
          // General game coaching analysis
          coachReason = `Coach: ${coach.coach_name || 'Unknown'} - ${coach.pace_preference || 'standard'} pace`;
        }
        
        engineSignals.push({
          engine: 'coaching',
          status: isAgree ? 'agree' : isDisagree ? 'disagree' : 'neutral',
          score: coach.star_usage_pct || null,
          reason: coachReason,
          confidence: coach.rotation_depth ? Math.min(coach.rotation_depth * 10, 100) : undefined
        });
        if (isAgree) agreeing.push('Coaching');
        else if (isDisagree) disagreeing.push('Coaching');
      } else {
        engineSignals.push({ engine: 'coaching', status: 'no_data', score: null, reason: 'No coaching data available' });
      }

      // 9. MedianLock Engine
      if (allData.medianLockData) {
        const mlData = allData.medianLockData;
        const isLock = mlData.classification === 'LOCK';
        const isParlayGrade = mlData.parlay_grade === true;
        const descLower = legDesc.toLowerCase();
        const betMatchesSide = (descLower.includes('over') && mlData.bet_side === 'OVER') || 
                               (descLower.includes('under') && mlData.bet_side === 'UNDER');
        
        const isAgree = (isLock || isParlayGrade) && betMatchesSide;
        const isDisagree = !betMatchesSide && (isLock || isParlayGrade);
        
        engineSignals.push({
          engine: 'medianlock',
          status: isAgree ? 'agree' : isDisagree ? 'disagree' : 'neutral',
          score: mlData.confidence_score || null,
          reason: isParlayGrade 
            ? `🏆 PARLAY GRADE - ${mlData.classification} (${(mlData.hit_rate || 0).toFixed(0)}% hit rate)`
            : `${mlData.classification} pick - ${mlData.bet_side} (${(mlData.confidence_score || 0).toFixed(0)}% conf)`,
          confidence: mlData.confidence_score
        });
        if (isAgree) agreeing.push('MedianLock');
        else if (isDisagree) disagreeing.push('MedianLock');
      } else {
        engineSignals.push({ engine: 'medianlock', status: 'no_data', score: null, reason: 'No MedianLock data available' });
      }

      const totalEngines = 9;
      const consensusScore = agreeing.length;

      return { 
        agreeingEngines: agreeing, 
        disagreingEngines: disagreeing, 
        consensusScore, 
        totalEngines,
        engineSignals 
      };
    }

    // Enrich all legs with engine data
    if (analysis.legAnalyses) {
      console.log(`Processing ${analysis.legAnalyses.length} legs for engine enrichment...`);
      
      const enrichmentPromises = analysis.legAnalyses.map(async (legAnalysis: any, idx: number) => {
        const legDesc = legs[idx]?.description || '';
        console.log(`Leg ${idx}: betType=${legAnalysis.betType}, player=${legAnalysis.player}, team=${legAnalysis.team}`);
        
        // Match to unified props (for player props)
        if (legAnalysis.player && unifiedProps.length > 0) {
          const matchedUnified = matchUnifiedProp(legAnalysis.player, legDesc, unifiedProps);
          if (matchedUnified) {
            legAnalysis.unifiedPropData = {
              pvsScore: matchedUnified.pvs_final_score || 0,
              pvsTier: matchedUnified.pvs_tier || 'unrated',
              hitRateScore: matchedUnified.hit_rate_score || 0,
              trapScore: matchedUnified.trap_score || 0,
              fatigueScore: matchedUnified.fatigue_score || 0,
              recommendation: matchedUnified.recommendation || 'neutral',
              confidence: matchedUnified.confidence || 0.5,
              sharpMoneyScore: matchedUnified.sharp_money_score || 0
            };
            console.log(`✅ Unified prop matched for ${legAnalysis.player}: tier=${matchedUnified.pvs_tier}, rec=${matchedUnified.recommendation}`);
          }
        }

        // Match to God Mode upsets (for moneyline/spread)
        if (['moneyline', 'spread'].includes(legAnalysis.betType) && godModeUpsets.length > 0) {
          const teams = [legAnalysis.team, legDesc].filter(Boolean);
          const matchedUpset = matchUpset(teams, godModeUpsets);
          if (matchedUpset) {
            legAnalysis.upsetData = {
              upsetScore: matchedUpset.final_upset_score || 0,
              isTrapFavorite: matchedUpset.trap_on_favorite || false,
              suggestion: matchedUpset.suggestion || 'avoid',
              confidence: matchedUpset.confidence || 'low',
              chaosModeActive: matchedUpset.chaos_mode_active || false
            };
            console.log(`✅ God Mode matched for ${legAnalysis.team}: score=${matchedUpset.final_upset_score}, trap=${matchedUpset.trap_on_favorite}`);
          }
        }

        // Match to juiced props
        if (legAnalysis.player && juicedProps.length > 0) {
          const matchedJuiced = matchJuicedProp(legAnalysis.player, juicedProps);
          if (matchedJuiced) {
            legAnalysis.juiceData = {
              juiceLevel: matchedJuiced.juice_level || 'normal',
              juiceDirection: matchedJuiced.juice_direction || 'neutral',
              juiceAmount: matchedJuiced.juice_amount || 0,
              finalPick: matchedJuiced.final_pick || 'none',
              movementConsistency: matchedJuiced.movement_consistency_score || 0
            };
            console.log(`✅ Juiced prop matched for ${legAnalysis.player}: level=${matchedJuiced.juice_level}, pick=${matchedJuiced.final_pick}`);
          }
        }

        // Match to fatigue scores (for NBA legs)
        if (legAnalysis.team && legAnalysis.sport?.toUpperCase() === 'NBA' && fatigueScores.length > 0) {
          const matchedFatigue = matchFatigue(legAnalysis.team, fatigueScores);
          if (matchedFatigue) {
            legAnalysis.fatigueData = {
              fatigueScore: matchedFatigue.fatigue_score || 0,
              fatigueCategory: matchedFatigue.fatigue_category || 'Fresh',
              recommendedAngle: matchedFatigue.recommended_angle || 'none',
              isBackToBack: matchedFatigue.is_back_to_back || false,
              travelMiles: matchedFatigue.travel_miles || 0
            };
            console.log(`✅ Fatigue matched for ${legAnalysis.team}: score=${matchedFatigue.fatigue_score}, category=${matchedFatigue.fatigue_category}`);
          }
        }

        // Check avoid patterns
        if (avoidPatterns.length > 0) {
          const matchedPatterns = checkAvoidPatterns(legDesc, avoidPatterns);
          if (matchedPatterns.length > 0) {
            legAnalysis.avoidPatterns = matchedPatterns;
            console.log(`⚠️ Avoid patterns matched for leg ${idx}: ${matchedPatterns.join(', ')}`);
          }
        }

        // Calculate engine consensus
        const sharpData = legSharpData.find(d => d.legIndex === idx);
        
        // Match to best bets
        const matchedBestBet = bestBetsLog.find(b => 
          legDesc.toLowerCase().includes(b.description?.toLowerCase() || '') ||
          (legAnalysis.player && b.description?.toLowerCase().includes(legAnalysis.player.toLowerCase()))
        );
        
        // Match to hitrate parlays
        const matchedHitrate = hitrateProps.find(h => {
          const legs = h.legs as any[];
          return legs?.some(l => 
            legDesc.toLowerCase().includes(l.description?.toLowerCase() || '') ||
            (legAnalysis.player && l.player_name?.toLowerCase().includes(legAnalysis.player.toLowerCase()))
          );
        });

        // Match to MedianLock candidates
        let matchedMedianLock = null;
        if (legAnalysis.player && medianLockCandidates.length > 0) {
          matchedMedianLock = matchMedianLock(legAnalysis.player, legDesc, medianLockCandidates);
          if (matchedMedianLock) {
            legAnalysis.medianLockData = {
              classification: matchedMedianLock.classification,
              confidence_score: matchedMedianLock.confidence_score || 0,
              bet_side: matchedMedianLock.bet_side,
              hit_rate: matchedMedianLock.hit_rate || 0,
              parlay_grade: matchedMedianLock.parlay_grade || false,
              edge_percent: matchedMedianLock.edge_percent || 0,
              projected_minutes: matchedMedianLock.projected_minutes || 0,
              adjusted_edge: matchedMedianLock.adjusted_edge || 0
            };
            console.log(`✅ MedianLock matched for ${legAnalysis.player}: ${matchedMedianLock.classification}, ${matchedMedianLock.bet_side}`);
          }
        }

        // Add coach data with prop-type-specific analysis
        const matchedCoach = coachProfiles.find(c => c.team_name?.toLowerCase().includes(legAnalysis.team?.toLowerCase() || ''));
        if (matchedCoach) {
          const coachBias = calculateCoachBias(matchedCoach, legDesc);
          legAnalysis.coachData = {
            coachName: matchedCoach.coach_name,
            teamName: matchedCoach.team_name,
            sport: matchedCoach.sport || 'NBA',
            offensiveBias: coachBias.offensiveBias,
            defensiveBias: coachBias.defensiveBias,
            recommendation: coachBias.propAdjustment > 0 ? 'PICK' : coachBias.propAdjustment < 0 ? 'FADE' : 'NEUTRAL',
            confidence: Math.min(100, Math.abs(coachBias.offensiveBias) + Math.abs(coachBias.defensiveBias) + 40),
            propRelevance: coachBias.propRelevance,
            propAdjustment: coachBias.propAdjustment
          };
          console.log(`✅ Coach data matched for ${legAnalysis.team}: ${matchedCoach.coach_name}`);
        }

        // Add hit rate percentage from unified props or hitrate parlays
        if (legAnalysis.unifiedPropData?.hitRateScore) {
          legAnalysis.hitRatePercent = legAnalysis.unifiedPropData.hitRateScore * 100;
        } else if (matchedHitrate?.combined_probability) {
          legAnalysis.hitRatePercent = matchedHitrate.combined_probability * 100;
        }
        
        legAnalysis.engineConsensus = calculateEngineConsensus(
          legDesc,
          legAnalysis.player,
          legAnalysis.team,
          {
            unifiedProp: legAnalysis.unifiedPropData ? unifiedProps.find(p => p.player_name?.toLowerCase() === legAnalysis.player?.toLowerCase()) : null,
            upset: legAnalysis.upsetData ? godModeUpsets.find(u => u.home_team?.toLowerCase().includes(legAnalysis.team?.toLowerCase() || '')) : null,
            juiced: legAnalysis.juiceData ? juicedProps.find(j => j.player_name?.toLowerCase() === legAnalysis.player?.toLowerCase()) : null,
            sharpData: sharpData?.hasSharpData ? sharpData : null,
            fatigueData: legAnalysis.fatigueData ? fatigueScores.find(f => f.team_name?.toLowerCase().includes(legAnalysis.team?.toLowerCase() || '')) : null,
            bestBet: matchedBestBet || null,
            hitrateData: matchedHitrate || null,
            coachingData: matchedCoach || null,
            medianLockData: matchedMedianLock || null
          },
          formulaPerformance
        );

        // Also fetch usage projection for player props (existing logic)
        if (legAnalysis.betType === 'player_prop' && legAnalysis.player) {
          try {
            const desc = legs[idx]?.description?.toLowerCase() || '';
            let propType = 'points';
            let line = 0;

            if (desc.includes('point') || desc.includes('pts')) propType = 'points';
            else if (desc.includes('rebound') || desc.includes('reb')) propType = 'rebounds';
            else if (desc.includes('assist') || desc.includes('ast')) propType = 'assists';
            else if (desc.includes('three') || desc.includes('3pt') || desc.includes('3-pt')) propType = 'threes';
            else if (desc.includes('block') || desc.includes('blk')) propType = 'blocks';
            else if (desc.includes('steal') || desc.includes('stl')) propType = 'steals';

            const lineMatch = desc.match(/(?:over|under|o|u)\s*(\d+\.?\d*)/i) || 
                             desc.match(/(\d+\.?\d*)\s*(?:pts?|points?|reb|rebounds?|ast|assists?|3pm?|blocks?|blk|steals?|stl)/i);
            if (lineMatch) {
              line = parseFloat(lineMatch[1]);
            }

            if (line > 0) {
              const functionUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/calculate-player-usage`;
              const usageResponse = await fetch(functionUrl, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
                },
                body: JSON.stringify({
                  playerName: legAnalysis.player,
                  propType,
                  line,
                  opponent: legAnalysis.team || undefined
                })
              });

              if (usageResponse.ok) {
                const usageData = await usageResponse.json();
                legAnalysis.usageProjection = usageData;
                console.log(`✅ Usage projection added for ${legAnalysis.player}`);
              }
            }
          } catch (usageError) {
            console.error(`❌ Error fetching usage for ${legAnalysis.player}:`, usageError);
          }
        }

        return legAnalysis;
      });

      await Promise.all(enrichmentPromises);
      
      // Log enrichment summary
      const stats = {
        unified: analysis.legAnalyses.filter((la: any) => la.unifiedPropData).length,
        upset: analysis.legAnalyses.filter((la: any) => la.upsetData).length,
        juiced: analysis.legAnalyses.filter((la: any) => la.juiceData).length,
        fatigue: analysis.legAnalyses.filter((la: any) => la.fatigueData).length,
        usage: analysis.legAnalyses.filter((la: any) => la.usageProjection).length,
        avoid: analysis.legAnalyses.filter((la: any) => la.avoidPatterns?.length > 0).length,
        consensus: analysis.legAnalyses.filter((la: any) => la.engineConsensus?.totalEngines > 0).length
      };
      console.log(`📊 Engine enrichment summary: unified=${stats.unified}, upset=${stats.upset}, juiced=${stats.juiced}, fatigue=${stats.fatigue}, usage=${stats.usage}, avoid=${stats.avoid}, consensus=${stats.consensus}`);
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
