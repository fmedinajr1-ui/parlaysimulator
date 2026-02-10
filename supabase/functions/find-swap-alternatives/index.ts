import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// EST-aware date helper
function getEasternDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

interface WeakLeg {
  description: string;
  playerName?: string;
  propType?: string;
  line?: number;
  side?: string;
  eventId?: string;
  sport?: string;
  currentOdds: number;
}

interface SwapAlternative {
  id: string;
  description: string;
  playerName: string;
  propType: string;
  line: number;
  side: 'over' | 'under';
  estimatedOdds: number;
  confidence: number;
  hitRate?: number;
  source: 'median_lock' | 'unified_props' | 'juiced' | 'hitrate';
  reason: string;
  samePlayer: boolean;
  sameGame: boolean;
  comparisonToOriginal: {
    confidenceGain: number;
    oddsChange: number;
    recommendation: 'strong_upgrade' | 'upgrade' | 'slight_upgrade' | 'lateral';
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { weakLeg, minimumConfidence = 60 } = await req.json() as { 
      weakLeg: WeakLeg; 
      minimumConfidence?: number;
    };

    console.log('Finding swap alternatives for:', weakLeg);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const alternatives: SwapAlternative[] = [];
    const today = getEasternDate();
    const playerName = weakLeg.playerName?.toLowerCase() || '';
    const sport = weakLeg.sport?.toUpperCase() || '';

    // Query 1: Unified Props - high confidence props
    const { data: unifiedProps } = await supabase
      .from('unified_props')
      .select('*')
      .eq('prop_date', today)
      .gte('combined_confidence', minimumConfidence / 100)
      .order('combined_confidence', { ascending: false })
      .limit(20);

    if (unifiedProps) {
      for (const prop of unifiedProps) {
        const propPlayerName = (prop.player_name || '').toLowerCase();
        const samePlayer = playerName && propPlayerName.includes(playerName.split(' ')[0]);
        const sameGame = weakLeg.eventId && prop.event_id === weakLeg.eventId;
        
        // Skip if it's the exact same prop
        if (samePlayer && prop.prop_type === weakLeg.propType && prop.line === weakLeg.line) {
          continue;
        }

        const confidence = (prop.combined_confidence || 0) * 100;
        const originalConfidence = 50; // Assume 50% for weak leg
        const confidenceGain = confidence - originalConfidence;
        
        alternatives.push({
          id: prop.id,
          description: `${prop.player_name} ${prop.recommended_pick?.toUpperCase() || 'OVER'} ${prop.line} ${prop.prop_type}`,
          playerName: prop.player_name || '',
          propType: prop.prop_type || '',
          line: prop.line || 0,
          side: (prop.recommended_pick as 'over' | 'under') || 'over',
          estimatedOdds: -110,
          confidence,
          hitRate: prop.hit_rate_last_10 ? prop.hit_rate_last_10 * 100 : undefined,
          source: 'unified_props',
          reason: `${Math.round(confidence)}% confidence from unified engine`,
          samePlayer,
          sameGame: sameGame || false,
          comparisonToOriginal: {
            confidenceGain,
            oddsChange: 0,
            recommendation: getRecommendation(confidenceGain),
          },
        });
      }
    }

    // Query 2: Median Lock Candidates - LOCK and STRONG picks
    const { data: medianLocks } = await supabase
      .from('median_lock_candidates')
      .select('*')
      .eq('pick_date', today)
      .in('classification', ['LOCK', 'STRONG'])
      .eq('parlay_grade', true)
      .order('consensus_percentage', { ascending: false })
      .limit(15);

    if (medianLocks) {
      for (const lock of medianLocks) {
        const lockPlayerName = (lock.player_name || '').toLowerCase();
        const samePlayer = playerName && lockPlayerName.includes(playerName.split(' ')[0]);
        
        // Skip duplicates
        if (alternatives.some(a => a.playerName.toLowerCase() === lockPlayerName && a.propType === lock.prop_type)) {
          continue;
        }

        const confidence = lock.consensus_percentage || 75;
        const originalConfidence = 50;
        const confidenceGain = confidence - originalConfidence;

        alternatives.push({
          id: lock.id,
          description: `${lock.player_name} ${lock.bet_side} ${lock.line} ${lock.prop_type}`,
          playerName: lock.player_name || '',
          propType: lock.prop_type || '',
          line: lock.line || 0,
          side: (lock.bet_side?.toLowerCase() as 'over' | 'under') || 'over',
          estimatedOdds: lock.odds || -110,
          confidence,
          source: 'median_lock',
          reason: `🔒 ${lock.classification} - ${lock.consensus_sources || 3} sources agree`,
          samePlayer,
          sameGame: false,
          comparisonToOriginal: {
            confidenceGain,
            oddsChange: (lock.odds || -110) - weakLeg.currentOdds,
            recommendation: getRecommendation(confidenceGain),
          },
        });
      }
    }

    // Query 3: Juiced Props - Strong picks
    const { data: juicedProps } = await supabase
      .from('juiced_props')
      .select('*')
      .eq('prop_date', today)
      .not('final_pick', 'is', null)
      .order('juice_level', { ascending: false })
      .limit(10);

    if (juicedProps) {
      for (const juiced of juicedProps) {
        const juicedPlayerName = (juiced.player_name || '').toLowerCase();
        const samePlayer = playerName && juicedPlayerName.includes(playerName.split(' ')[0]);
        
        // Skip duplicates
        if (alternatives.some(a => a.playerName.toLowerCase() === juicedPlayerName && a.propType === juiced.prop_type)) {
          continue;
        }

        const juiceMultiplier = juiced.juice_level === 'extreme' ? 85 : juiced.juice_level === 'high' ? 75 : 65;
        const confidence = juiceMultiplier;
        const originalConfidence = 50;
        const confidenceGain = confidence - originalConfidence;

        alternatives.push({
          id: juiced.id,
          description: `${juiced.player_name} ${juiced.final_pick} ${juiced.line} ${juiced.prop_type}`,
          playerName: juiced.player_name || '',
          propType: juiced.prop_type || '',
          line: juiced.line || 0,
          side: (juiced.final_pick?.toLowerCase() as 'over' | 'under') || 'over',
          estimatedOdds: juiced.current_odds || -110,
          confidence,
          source: 'juiced',
          reason: `🍊 ${juiced.juice_level?.toUpperCase()} juice - ${juiced.juice_direction} movement`,
          samePlayer,
          sameGame: false,
          comparisonToOriginal: {
            confidenceGain,
            oddsChange: (juiced.current_odds || -110) - weakLeg.currentOdds,
            recommendation: getRecommendation(confidenceGain),
          },
        });
      }
    }

    // Query 4: Player Prop Hit Rates - High hit rate props
    const { data: hitRates } = await supabase
      .from('player_prop_hitrates')
      .select('*')
      .gte('hit_rate', 0.65)
      .gte('sample_size', 5)
      .order('hit_rate', { ascending: false })
      .limit(10);

    if (hitRates) {
      for (const hr of hitRates) {
        const hrPlayerName = (hr.player_name || '').toLowerCase();
        const samePlayer = playerName && hrPlayerName.includes(playerName.split(' ')[0]);
        
        // Skip duplicates
        if (alternatives.some(a => a.playerName.toLowerCase() === hrPlayerName && a.propType === hr.prop_type)) {
          continue;
        }

        const confidence = (hr.hit_rate || 0) * 100;
        const originalConfidence = 50;
        const confidenceGain = confidence - originalConfidence;

        alternatives.push({
          id: hr.id,
          description: `${hr.player_name} ${hr.side?.toUpperCase() || 'OVER'} ${hr.line} ${hr.prop_type}`,
          playerName: hr.player_name || '',
          propType: hr.prop_type || '',
          line: hr.line || 0,
          side: (hr.side as 'over' | 'under') || 'over',
          estimatedOdds: -110,
          confidence,
          hitRate: confidence,
          source: 'hitrate',
          reason: `🎯 ${Math.round(confidence)}% hit rate (${hr.sample_size} games)`,
          samePlayer,
          sameGame: false,
          comparisonToOriginal: {
            confidenceGain,
            oddsChange: 0,
            recommendation: getRecommendation(confidenceGain),
          },
        });
      }
    }

    // Sort alternatives: same player first, then same game, then by confidence gain
    alternatives.sort((a, b) => {
      // Same player priority
      if (a.samePlayer && !b.samePlayer) return -1;
      if (!a.samePlayer && b.samePlayer) return 1;
      
      // Same game priority
      if (a.sameGame && !b.sameGame) return -1;
      if (!a.sameGame && b.sameGame) return 1;
      
      // Then by confidence gain
      return b.comparisonToOriginal.confidenceGain - a.comparisonToOriginal.confidenceGain;
    });

    // Limit to top 6 alternatives
    const topAlternatives = alternatives.slice(0, 6);

    console.log(`Found ${topAlternatives.length} swap alternatives`);

    return new Response(JSON.stringify({
      success: true,
      alternatives: topAlternatives,
      originalLeg: weakLeg,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error finding swap alternatives:', error);
    return new Response(JSON.stringify({
      success: false,
      error: errorMessage,
      alternatives: [],
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});

function getRecommendation(confidenceGain: number): 'strong_upgrade' | 'upgrade' | 'slight_upgrade' | 'lateral' {
  if (confidenceGain >= 25) return 'strong_upgrade';
  if (confidenceGain >= 15) return 'upgrade';
  if (confidenceGain >= 5) return 'slight_upgrade';
  return 'lateral';
}
