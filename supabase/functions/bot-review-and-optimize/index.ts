/**
 * bot-review-and-optimize
 * 
 * Analyzes historical parlay win/loss patterns, identifies hot/cold templates,
 * stores optimization findings, then triggers generation with pattern-replay data.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ParlayLeg {
  player_name?: string;
  prop_type?: string;
  category?: string;
  side?: string;
  type?: string;
  bet_type?: string;
  sport?: string;
  home_team?: string;
  away_team?: string;
  outcome?: string;
}

interface ParlayRow {
  id: string;
  parlay_date: string;
  outcome: string;
  legs: ParlayLeg[] | string;
  leg_count: number;
  strategy_name: string;
  tier?: string;
  profit_loss?: number;
  combined_probability?: number;
}

interface PatternKey {
  legCount: number;
  betTypes: string;    // sorted, comma-joined
  sports: string;      // sorted, comma-joined
  tier: string;
}

interface PatternStats {
  key: PatternKey;
  wins: number;
  losses: number;
  total: number;
  winRate: number;
  avgProfit: number;
  totalProfit: number;
}

function getEasternDate(): string {
  const now = new Date();
  const eastern = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return eastern.toISOString().split('T')[0];
}

function extractPatternKey(parlay: ParlayRow): PatternKey {
  const legs: ParlayLeg[] = typeof parlay.legs === 'string' ? JSON.parse(parlay.legs) : parlay.legs;
  
  const betTypes = new Set<string>();
  const sports = new Set<string>();
  
  for (const leg of legs) {
    if (leg.bet_type) betTypes.add(leg.bet_type);
    else if (leg.prop_type) betTypes.add(leg.prop_type);
    if (leg.sport) sports.add(leg.sport);
  }
  
  return {
    legCount: parlay.leg_count || legs.length,
    betTypes: [...betTypes].sort().join(','),
    sports: [...sports].sort().join(','),
    tier: parlay.tier || 'unknown',
  };
}

function patternToString(key: PatternKey): string {
  return `${key.legCount}L|${key.betTypes}|${key.sports}|${key.tier}`;
}

function analyzeSideBias(parlays: ParlayRow[]): Record<string, { over: number; under: number; overWins: number; underWins: number }> {
  const sideStats: Record<string, { over: number; under: number; overWins: number; underWins: number }> = {};
  
  for (const parlay of parlays) {
    const legs: ParlayLeg[] = typeof parlay.legs === 'string' ? JSON.parse(parlay.legs) : parlay.legs;
    for (const leg of legs) {
      if (!leg.category || !leg.side) continue;
      if (!sideStats[leg.category]) {
        sideStats[leg.category] = { over: 0, under: 0, overWins: 0, underWins: 0 };
      }
      if (leg.side === 'over') {
        sideStats[leg.category].over++;
        if (leg.outcome === 'hit') sideStats[leg.category].overWins++;
      } else if (leg.side === 'under') {
        sideStats[leg.category].under++;
        if (leg.outcome === 'hit') sideStats[leg.category].underWins++;
      }
    }
  }
  return sideStats;
}

function detectColdPatterns(parlays: ParlayRow[]): string[] {
  const coldPatterns: string[] = [];
  
  // Detect: parlays where all legs are same bet_type OVER and all lost
  const overStackedLosses = parlays.filter(p => {
    if (p.outcome !== 'lost') return false;
    const legs: ParlayLeg[] = typeof p.legs === 'string' ? JSON.parse(p.legs) : p.legs;
    const allOverTotals = legs.every(l => l.side === 'over' && (l.bet_type === 'total' || l.prop_type?.includes('total')));
    return allOverTotals && legs.length >= 3;
  });
  
  if (overStackedLosses.length >= 2) {
    coldPatterns.push('3+ OVER totals stacked in same parlay (systematic loss pattern)');
  }
  
  // Detect: any bet_type with 0% win rate across 3+ parlays
  const betTypeResults = new Map<string, { wins: number; total: number }>();
  for (const p of parlays) {
    const legs: ParlayLeg[] = typeof p.legs === 'string' ? JSON.parse(p.legs) : p.legs;
    const types = [...new Set(legs.map(l => l.bet_type || l.prop_type).filter(Boolean))];
    for (const t of types) {
      if (!betTypeResults.has(t!)) betTypeResults.set(t!, { wins: 0, total: 0 });
      const stat = betTypeResults.get(t!)!;
      stat.total++;
      if (p.outcome === 'won') stat.wins++;
    }
  }
  
  for (const [type, stat] of betTypeResults) {
    if (stat.total >= 3 && stat.wins === 0) {
      coldPatterns.push(`${type}: 0% win rate across ${stat.total} parlays`);
    }
  }
  
  return coldPatterns;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const body = await req.json().catch(() => ({}));
    const targetDate = body.date || getEasternDate();

    console.log(`[Review] Analyzing historical patterns for optimized generation on ${targetDate}`);

    // 1. Query all settled parlays
    const { data: settledParlays, error: parlayError } = await supabase
      .from('bot_daily_parlays')
      .select('*')
      .in('outcome', ['won', 'lost'])
      .order('parlay_date', { ascending: false })
      .limit(500);

    if (parlayError) throw parlayError;
    
    const parlays = (settledParlays || []).map(p => ({
      ...p,
      legs: typeof p.legs === 'string' ? JSON.parse(p.legs) : p.legs,
    })) as ParlayRow[];

    console.log(`[Review] Analyzing ${parlays.length} settled parlays`);

    // 2. Group by pattern and calculate stats
    const patternMap = new Map<string, PatternStats>();
    
    for (const parlay of parlays) {
      const key = extractPatternKey(parlay);
      const keyStr = patternToString(key);
      
      if (!patternMap.has(keyStr)) {
        patternMap.set(keyStr, {
          key,
          wins: 0,
          losses: 0,
          total: 0,
          winRate: 0,
          avgProfit: 0,
          totalProfit: 0,
        });
      }
      
      const stats = patternMap.get(keyStr)!;
      stats.total++;
      if (parlay.outcome === 'won') {
        stats.wins++;
        stats.totalProfit += (parlay.profit_loss || 0);
      } else {
        stats.losses++;
        stats.totalProfit += (parlay.profit_loss || 0);
      }
      stats.winRate = stats.wins / stats.total;
      stats.avgProfit = stats.totalProfit / stats.total;
    }

    // 3. Identify hot and cold patterns
    const allPatterns = [...patternMap.values()];
    
    const hotPatterns = allPatterns
      .filter(p => p.total >= 3 && p.winRate >= 0.5)
      .sort((a, b) => b.winRate - a.winRate || b.totalProfit - a.totalProfit)
      .slice(0, 10);

    const coldPatterns = allPatterns
      .filter(p => p.total >= 3 && p.winRate < 0.3)
      .sort((a, b) => a.winRate - b.winRate)
      .slice(0, 10);

    // 4. Detect specific failure modes
    const failurePatterns = detectColdPatterns(parlays);
    
    // 5. Analyze side bias
    const sideBias = analyzeSideBias(parlays);

    // 6. Build winning_patterns payload for generation
    const winningPatterns = {
      boost_leg_counts: hotPatterns.map(p => p.key.legCount),
      boost_bet_types: [...new Set(hotPatterns.flatMap(p => p.key.betTypes.split(',')))],
      boost_sports: [...new Set(hotPatterns.flatMap(p => p.key.sports.split(',')))],
      boost_tiers: [...new Set(hotPatterns.map(p => p.key.tier))],
      penalize_bet_types: [...new Set(coldPatterns.flatMap(p => p.key.betTypes.split(',')))],
      max_same_side_per_parlay: 2, // Anti-stacking rule
      failure_modes: failurePatterns,
      side_bias: Object.entries(sideBias).map(([cat, stats]) => ({
        category: cat,
        preferred_side: stats.overWins / (stats.over || 1) > stats.underWins / (stats.under || 1) ? 'over' : 'under',
        over_rate: stats.over > 0 ? (stats.overWins / stats.over * 100).toFixed(0) + '%' : 'N/A',
        under_rate: stats.under > 0 ? (stats.underWins / stats.under * 100).toFixed(0) + '%' : 'N/A',
      })),
      hot_patterns: hotPatterns.map(p => ({
        description: `${p.key.legCount}-leg ${p.key.betTypes} (${p.key.sports}) [${p.key.tier}]`,
        winRate: (p.winRate * 100).toFixed(0) + '%',
        sample: p.total,
        avgProfit: '$' + p.avgProfit.toFixed(0),
      })),
      cold_patterns: coldPatterns.map(p => ({
        description: `${p.key.legCount}-leg ${p.key.betTypes} (${p.key.sports}) [${p.key.tier}]`,
        winRate: (p.winRate * 100).toFixed(0) + '%',
        sample: p.total,
      })),
    };

    // 7. Store optimization findings
    const summary = [
      `Analyzed ${parlays.length} historical parlays.`,
      `Found ${hotPatterns.length} hot patterns (≥50% WR) and ${coldPatterns.length} cold patterns (<30% WR).`,
      hotPatterns.length > 0 ? `Top pattern: ${hotPatterns[0].key.legCount}-leg ${hotPatterns[0].key.betTypes} at ${(hotPatterns[0].winRate * 100).toFixed(0)}% WR.` : '',
      failurePatterns.length > 0 ? `Failure modes detected: ${failurePatterns.join('; ')}` : 'No systemic failure modes detected.',
    ].filter(Boolean).join(' ');

    await supabase.from('bot_research_findings').insert({
      title: `Pattern Replay Optimization - ${targetDate}`,
      summary,
      category: 'optimization',
      research_date: targetDate,
      relevance_score: 90,
      actionable: true,
      action_taken: 'Applied to smart generation',
      key_insights: [
        ...hotPatterns.map(p => `HOT: ${p.key.legCount}-leg ${p.key.betTypes} (${p.key.tier}) = ${(p.winRate * 100).toFixed(0)}% WR over ${p.total} parlays`),
        ...coldPatterns.map(p => `COLD: ${p.key.legCount}-leg ${p.key.betTypes} (${p.key.tier}) = ${(p.winRate * 100).toFixed(0)}% WR over ${p.total} parlays`),
        ...failurePatterns.map(f => `AVOID: ${f}`),
      ],
      sources: ['bot_daily_parlays historical analysis'],
    });

    console.log(`[Review] Stored optimization findings. Triggering smart generation...`);

    // 8. Call bot-generate-daily-parlays with winning patterns
    const genResponse = await fetch(`${supabaseUrl}/functions/v1/bot-generate-daily-parlays`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({
        date: targetDate,
        winning_patterns: winningPatterns,
        source: 'smart_review',
      }),
    });

    const genResult = await genResponse.json();

    console.log(`[Review] Generation complete:`, genResult);

    return new Response(
      JSON.stringify({
        success: true,
        analysis: {
          totalAnalyzed: parlays.length,
          hotPatterns: hotPatterns.length,
          coldPatterns: coldPatterns.length,
          failureModes: failurePatterns,
          topPattern: hotPatterns[0] ? `${hotPatterns[0].key.legCount}-leg ${hotPatterns[0].key.betTypes} at ${(hotPatterns[0].winRate * 100).toFixed(0)}% WR` : 'none',
        },
        generation: genResult,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Review] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
