import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface UpsetSignal {
  type: 'sharp_money' | 'line_movement' | 'historical_pattern' | 'trap_alert' | 'day_pattern';
  description: string;
  weight: number;
}

interface UpsetPrediction {
  gameId: string;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  underdog: string;
  underdogOdds: number;
  favorite: string;
  favoriteOdds: number;
  commenceTime: string;
  upsetScore: number;
  signals: UpsetSignal[];
  aiReasoning: string | null;
  confidence: 'high' | 'medium' | 'low';
}

const SPORT_KEYS: Record<string, string> = {
  'basketball_nba': 'NBA',
  'basketball_ncaab': 'NCAAB',
  'americanfootball_nfl': 'NFL',
  'americanfootball_ncaaf': 'NCAAF',
  'icehockey_nhl': 'NHL',
  'baseball_mlb': 'MLB',
};

const SPORTS_TO_FETCH = [
  'basketball_nba',
  'basketball_ncaab',
  'americanfootball_nfl',
  'icehockey_nhl',
];

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { userId } = await req.json();
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const oddsApiKey = Deno.env.get('THE_ODDS_API_KEY')!;
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
    
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch today's games from The Odds API
    const todaysGames: any[] = [];
    
    for (const sportKey of SPORTS_TO_FETCH) {
      try {
        const response = await fetch(
          `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?apiKey=${oddsApiKey}&regions=us&markets=h2h&oddsFormat=american`
        );
        
        if (response.ok) {
          const games = await response.json();
          const today = new Date();
          const tomorrow = new Date(today);
          tomorrow.setDate(tomorrow.getDate() + 1);
          
          // Filter for today's games
          const todayGames = games.filter((game: any) => {
            const gameDate = new Date(game.commence_time);
            return gameDate >= today && gameDate < tomorrow;
          });
          
          todaysGames.push(...todayGames.map((g: any) => ({ ...g, sportKey })));
        }
      } catch (e) {
        console.error(`Error fetching ${sportKey}:`, e);
      }
    }

    console.log(`Found ${todaysGames.length} games today`);

    // Get historical upset data from database
    const { data: historicalUpsets } = await supabase
      .from('parlay_training_data')
      .select('sport, team, odds, parlay_outcome')
      .gt('odds', 150)
      .eq('parlay_outcome', true)
      .limit(500);

    // Get recent sharp line movements
    const { data: sharpMovements } = await supabase
      .from('line_movements')
      .select('*')
      .eq('is_sharp_action', true)
      .gte('detected_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order('detected_at', { ascending: false })
      .limit(100);

    // Get trap patterns
    const { data: trapPatterns } = await supabase
      .from('trap_patterns')
      .select('sport, bet_type, confirmed_trap, movement_size')
      .eq('confirmed_trap', true)
      .limit(200);

    // Calculate sport upset rates from historical data
    const sportUpsetRates: Record<string, number> = {};
    if (historicalUpsets) {
      const sportCounts: Record<string, { upsets: number; total: number }> = {};
      historicalUpsets.forEach((u: any) => {
        const sport = u.sport || 'Unknown';
        if (!sportCounts[sport]) sportCounts[sport] = { upsets: 0, total: 0 };
        sportCounts[sport].upsets++;
        sportCounts[sport].total++;
      });
      
      for (const [sport, counts] of Object.entries(sportCounts)) {
        sportUpsetRates[sport] = (counts.upsets / counts.total) * 100;
      }
    }

    // Get day-of-week patterns
    const dayOfWeek = new Date().getDay();
    const dayUpsetMultiplier = [1.0, 1.1, 1.0, 1.05, 1.15, 1.1, 1.2][dayOfWeek]; // Weekend tends to have more upsets

    // Analyze each game for upset potential
    const upsetPredictions: UpsetPrediction[] = [];

    for (const game of todaysGames) {
      const bookmaker = game.bookmakers?.[0];
      if (!bookmaker) continue;

      const h2hMarket = bookmaker.markets?.find((m: any) => m.key === 'h2h');
      if (!h2hMarket || !h2hMarket.outcomes || h2hMarket.outcomes.length < 2) continue;

      const outcomes = h2hMarket.outcomes;
      const homeOutcome = outcomes.find((o: any) => o.name === game.home_team);
      const awayOutcome = outcomes.find((o: any) => o.name === game.away_team);

      if (!homeOutcome || !awayOutcome) continue;

      // Determine underdog (positive odds or higher positive odds)
      let underdog, underdogOdds, favorite, favoriteOdds;
      
      if (homeOutcome.price > awayOutcome.price) {
        underdog = game.home_team;
        underdogOdds = homeOutcome.price;
        favorite = game.away_team;
        favoriteOdds = awayOutcome.price;
      } else {
        underdog = game.away_team;
        underdogOdds = awayOutcome.price;
        favorite = game.home_team;
        favoriteOdds = homeOutcome.price;
      }

      // Only analyze if there's a clear underdog (+120 or more)
      if (underdogOdds < 120) continue;

      const sport = SPORT_KEYS[game.sportKey] || game.sportKey;
      const signals: UpsetSignal[] = [];
      let upsetScore = 0;

      // Signal 1: Sharp money on underdog (25 points max)
      const sharpOnUnderdog = sharpMovements?.filter((m: any) => 
        m.event_id === game.id && 
        m.outcome_name?.toLowerCase().includes(underdog.toLowerCase()) &&
        m.recommendation === 'pick'
      );
      
      if (sharpOnUnderdog && sharpOnUnderdog.length > 0) {
        const sharpWeight = Math.min(sharpOnUnderdog.length * 12, 25);
        upsetScore += sharpWeight;
        signals.push({
          type: 'sharp_money',
          description: `Sharp money detected on ${underdog}`,
          weight: sharpWeight
        });
      }

      // Signal 2: Line movement toward underdog (20 points max)
      const lineMovements = sharpMovements?.filter((m: any) => 
        m.event_id === game.id &&
        m.price_change < 0 && // Price getting shorter (better for bettor)
        m.outcome_name?.toLowerCase().includes(underdog.toLowerCase())
      );
      
      if (lineMovements && lineMovements.length > 0) {
        const moveWeight = Math.min(lineMovements.length * 10, 20);
        upsetScore += moveWeight;
        signals.push({
          type: 'line_movement',
          description: `Line moving toward ${underdog}`,
          weight: moveWeight
        });
      }

      // Signal 3: Trap pattern on favorite (15 points max)
      const trapOnFavorite = trapPatterns?.filter((t: any) => 
        t.sport === sport && t.confirmed_trap
      );
      
      if (trapOnFavorite && trapOnFavorite.length > 3) {
        const trapRate = trapOnFavorite.length / 10;
        const trapWeight = Math.min(trapRate * 15, 15);
        upsetScore += trapWeight;
        signals.push({
          type: 'trap_alert',
          description: `${sport} favorites showing trap patterns`,
          weight: trapWeight
        });
      }

      // Signal 4: Historical sport upset rate (15 points max)
      const sportRate = sportUpsetRates[sport] || 15;
      if (sportRate > 20) {
        const histWeight = Math.min((sportRate - 15) * 1.5, 15);
        upsetScore += histWeight;
        signals.push({
          type: 'historical_pattern',
          description: `${sport} has ${sportRate.toFixed(0)}% upset rate`,
          weight: histWeight
        });
      }

      // Signal 5: Day-of-week pattern (10 points max)
      if (dayUpsetMultiplier > 1.05) {
        const dayWeight = (dayUpsetMultiplier - 1.0) * 50;
        upsetScore += dayWeight;
        signals.push({
          type: 'day_pattern',
          description: `${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayOfWeek]}s historically have more upsets`,
          weight: dayWeight
        });
      }

      // Signal 6: Underdog odds sweetness (15 points max)
      // Big underdogs (+200 to +400) that hit are valuable
      if (underdogOdds >= 150 && underdogOdds <= 400) {
        const oddsWeight = Math.min((underdogOdds - 100) / 20, 15);
        upsetScore += oddsWeight;
      }

      // Determine confidence level
      let confidence: 'high' | 'medium' | 'low';
      if (upsetScore >= 60) confidence = 'high';
      else if (upsetScore >= 35) confidence = 'medium';
      else confidence = 'low';

      // Cap score at 100
      upsetScore = Math.min(Math.round(upsetScore), 100);

      upsetPredictions.push({
        gameId: game.id,
        sport,
        homeTeam: game.home_team,
        awayTeam: game.away_team,
        underdog,
        underdogOdds,
        favorite,
        favoriteOdds,
        commenceTime: game.commence_time,
        upsetScore,
        signals,
        aiReasoning: null,
        confidence
      });
    }

    // Sort by upset score
    upsetPredictions.sort((a, b) => b.upsetScore - a.upsetScore);

    // Generate AI reasoning for top predictions using Lovable AI
    const topPredictions = upsetPredictions.slice(0, 5);
    
    if (lovableApiKey && topPredictions.length > 0) {
      try {
        const prompt = `You are a sports betting analyst. For each game below, provide a brief (1-2 sentences) analysis of why an upset might occur. Focus on the signals provided.

Games to analyze:
${topPredictions.map((p, i) => `
${i + 1}. ${p.sport}: ${p.favorite} (${p.favoriteOdds}) vs ${p.underdog} (${p.underdogOdds > 0 ? '+' : ''}${p.underdogOdds})
   Upset Score: ${p.upsetScore}/100
   Signals: ${p.signals.map(s => s.description).join(', ')}
`).join('\n')}

Provide analysis in this JSON format:
{"analyses": [{"gameId": "id", "reasoning": "brief analysis"}]}`;

        const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${lovableApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'google/gemini-2.5-flash',
            messages: [
              { role: 'system', content: 'You are a sports betting analyst. Provide concise, insightful analysis.' },
              { role: 'user', content: prompt }
            ],
          }),
        });

        if (aiResponse.ok) {
          const aiData = await aiResponse.json();
          const content = aiData.choices?.[0]?.message?.content;
          
          if (content) {
            try {
              // Try to extract JSON from response
              const jsonMatch = content.match(/\{[\s\S]*\}/);
              if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                if (parsed.analyses) {
                  parsed.analyses.forEach((analysis: any, idx: number) => {
                    if (topPredictions[idx]) {
                      topPredictions[idx].aiReasoning = analysis.reasoning;
                    }
                  });
                }
              }
            } catch (parseError) {
              console.error('Error parsing AI response:', parseError);
              // Fallback: assign generic reasoning
              topPredictions.forEach(p => {
                if (p.signals.length > 0) {
                  p.aiReasoning = `Multiple signals suggest ${p.underdog} has upset potential: ${p.signals[0].description.toLowerCase()}.`;
                }
              });
            }
          }
        }
      } catch (aiError) {
        console.error('AI reasoning error:', aiError);
      }
    }

    // Update predictions array with AI reasoning
    for (const topPred of topPredictions) {
      const idx = upsetPredictions.findIndex(p => p.gameId === topPred.gameId);
      if (idx !== -1) {
        upsetPredictions[idx].aiReasoning = topPred.aiReasoning;
      }
    }

    // Calculate summary
    const summary = {
      totalGames: upsetPredictions.length,
      highUpsetPotential: upsetPredictions.filter(p => p.upsetScore >= 60).length,
      mediumUpsetPotential: upsetPredictions.filter(p => p.upsetScore >= 35 && p.upsetScore < 60).length,
      lowUpsetPotential: upsetPredictions.filter(p => p.upsetScore < 35).length,
      sportBreakdown: Object.entries(
        upsetPredictions.reduce((acc, p) => {
          acc[p.sport] = (acc[p.sport] || 0) + 1;
          return acc;
        }, {} as Record<string, number>)
      ).map(([sport, count]) => ({ sport, count }))
    };

    return new Response(JSON.stringify({
      predictions: upsetPredictions,
      summary,
      analyzedAt: new Date().toISOString()
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error('Error in predict-upsets:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error',
      predictions: [],
      summary: { totalGames: 0, highUpsetPotential: 0, mediumUpsetPotential: 0, lowUpsetPotential: 0, sportBreakdown: [] }
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
