import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSweetSpotParlayBuilder } from "./useSweetSpotParlayBuilder";
import { Json } from "@/integrations/supabase/types";

// Get today's date in Eastern Time
function getEasternDate(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

// Unified leg structure for all parlay sources
export interface UnifiedParlayLeg {
  playerName: string;
  propType: string;
  line: number;
  side: 'over' | 'under';
  team?: string;
  category?: string;
  confidence?: number;
  l10HitRate?: number;
  archetype?: string;
}

// Unified parlay structure
export interface DailyParlay {
  id: string;
  type: 'OPTIMAL' | 'SAFE' | 'BALANCED' | 'UPSIDE' | 'CORE' | 'HEAT_UPSIDE';
  source: 'sweet-spot' | 'sharp' | 'heat';
  legCount: number;
  legs: UnifiedParlayLeg[];
  combinedOdds: number;
  winProbability: number;
  patterns: string[];
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  parlayDate: string;
  outcome: 'pending' | 'won' | 'lost';
}

// Type guard for JSONB leg data - supports both naming conventions
interface SharpLegJson {
  // New format from sharp-parlay-builder
  player?: string;
  prop?: string;
  team?: string;
  // Legacy format
  player_name?: string;
  prop_type?: string;
  team_name?: string;
  // Common fields
  line?: number;
  side?: string;
  category?: string;
  confidence?: number;
  l10_hit_rate?: number;
  archetype?: string;
}

interface HeatLegJson {
  player_name?: string;
  market_type?: string;
  line?: number;
  side?: string;
  team?: string;
  signal_label?: string;
  final_score?: number;
}

// v3.0: ARCHETYPE-PROP ALIGNMENT VALIDATION
// Prevents misaligned picks like rebounders for points, guards for rebounds
const ARCHETYPE_PROP_BLOCKED: Record<string, string[]> = {
  'ELITE_REBOUNDER': ['points', 'threes'],
  'GLASS_CLEANER': ['points', 'threes', 'assists'],
  'RIM_PROTECTOR': ['points', 'threes'],
  'PURE_SHOOTER': ['rebounds', 'blocks'],
  'PLAYMAKER': ['rebounds', 'blocks'],
  'COMBO_GUARD': ['rebounds', 'blocks'],
  'SCORING_GUARD': ['rebounds', 'blocks'],
};

// v3.0: Validate leg is not misaligned
function isLegArchetypeAligned(leg: UnifiedParlayLeg): boolean {
  if (!leg.archetype || leg.archetype === 'UNKNOWN') return true; // Allow if no archetype data
  
  const blockedProps = ARCHETYPE_PROP_BLOCKED[leg.archetype];
  if (!blockedProps) return true;
  
  const propLower = leg.propType.toLowerCase();
  for (const blocked of blockedProps) {
    if (propLower.includes(blocked)) {
      console.warn(`[DailyParlays] Blocking misaligned leg: ${leg.playerName} (${leg.archetype}) for ${leg.propType}`);
      return false;
    }
  }
  
  return true;
}

// Parse sharp parlay legs from JSONB - handles both field naming conventions
function parseSharpLegs(legs: Json): UnifiedParlayLeg[] {
  if (!Array.isArray(legs)) return [];
  
  return (legs as SharpLegJson[]).map(leg => ({
    playerName: leg.player || leg.player_name || '',
    propType: leg.prop || leg.prop_type || '',
    line: leg.line || 0,
    side: (leg.side?.toLowerCase() === 'under' ? 'under' : 'over') as 'over' | 'under',
    team: leg.team || leg.team_name,
    category: leg.category,
    confidence: leg.confidence,
    l10HitRate: leg.l10_hit_rate,
    archetype: leg.archetype,
  })).filter(leg => leg.playerName !== '').filter(isLegArchetypeAligned);
}

// Parse heat parlay legs from JSONB
function parseHeatLeg(leg: Json): UnifiedParlayLeg | null {
  if (!leg || typeof leg !== 'object') return null;
  const heatLeg = leg as HeatLegJson;
  
  const parsed: UnifiedParlayLeg = {
    playerName: heatLeg.player_name || '',
    propType: heatLeg.market_type || '',
    line: heatLeg.line || 0,
    side: (heatLeg.side?.toLowerCase() === 'under' ? 'under' : 'over') as 'over' | 'under',
    team: heatLeg.team,
    category: heatLeg.signal_label,
    confidence: heatLeg.final_score ? heatLeg.final_score / 100 : undefined,
  };
  
  return isLegArchetypeAligned(parsed) ? parsed : null; // v3.0: Filter misaligned
}

// Extract patterns from legs
function extractPatterns(legs: UnifiedParlayLeg[]): string[] {
  const patterns = new Set<string>();
  
  legs.forEach(leg => {
    if (leg.category) {
      patterns.add(leg.category);
    }
    // Add prop type patterns
    const propLower = leg.propType.toLowerCase();
    if (propLower.includes('rebound')) {
      patterns.add(leg.side === 'over' ? 'REB_OVER' : 'REB_UNDER');
    } else if (propLower.includes('assist')) {
      patterns.add(leg.side === 'over' ? 'AST_OVER' : 'AST_UNDER');
    } else if (propLower.includes('point')) {
      patterns.add(leg.side === 'over' ? 'PTS_OVER' : 'PTS_UNDER');
    }
  });
  
  return Array.from(patterns);
}

export function useDailyParlays() {
  const today = getEasternDate();
  
  // Get Sweet Spot Dream Team parlay
  const { optimalParlay, isLoading: sweetSpotLoading, combinedStats } = useSweetSpotParlayBuilder();
  
  // Fetch Sharp AI Parlays
  const { data: sharpParlays, isLoading: sharpLoading } = useQuery({
    queryKey: ['sharp-parlays-daily', today],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sharp_ai_parlays')
        .select('*')
        .eq('parlay_date', today)
        .neq('outcome', 'lost')
        .order('created_at', { ascending: false });
      
      if (error) {
        console.error('Error fetching sharp parlays:', error);
        return [];
      }
      return data || [];
    },
    staleTime: 60000,
  });
  
  // Fetch Heat Parlays
  const { data: heatParlays, isLoading: heatLoading } = useQuery({
    queryKey: ['heat-parlays-daily', today],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('heat_parlays')
        .select('*')
        .eq('parlay_date', today)
        .neq('outcome', 'lost')
        .order('created_at', { ascending: false });
      
      if (error) {
        console.error('Error fetching heat parlays:', error);
        return [];
      }
      return data || [];
    },
    staleTime: 60000,
  });
  
  // Aggregate all parlays into unified format
  const dailyParlays: DailyParlay[] = [];
  
  // Add Sweet Spot Dream Team (OPTIMAL)
  if (optimalParlay && optimalParlay.length > 0) {
    const legs: UnifiedParlayLeg[] = optimalParlay.map(leg => ({
      playerName: leg.pick.player_name,
      propType: leg.pick.prop_type,
      line: leg.pick.line,
      side: leg.pick.side.toLowerCase() as 'over' | 'under',
      team: leg.pick.team_name,
      category: leg.pick.category || undefined,
      confidence: leg.pick.confidence_score,
      l10HitRate: leg.pick.l10HitRate || undefined,
    }));
    
    dailyParlays.push({
      id: 'sweet-spot-optimal',
      type: 'OPTIMAL',
      source: 'sweet-spot',
      legCount: legs.length,
      legs,
      combinedOdds: Math.round(850 * (legs.length / 6)), // Approximate based on leg count
      winProbability: combinedStats.avgL10HitRate || 0.62,
      patterns: combinedStats.categories.filter(Boolean) as string[],
      riskLevel: 'LOW',
      parlayDate: today,
      outcome: 'pending',
    });
  }
  
  // Add Sharp AI Parlays
  sharpParlays?.forEach(parlay => {
    const legs = parseSharpLegs(parlay.legs);
    if (legs.length === 0) return;
    
    // Map parlay_type to our unified types
    let type: DailyParlay['type'] = 'BALANCED';
    if (parlay.parlay_type === 'SAFE' || parlay.is_dream_team) type = 'SAFE';
    else if (parlay.parlay_type === 'UPSIDE') type = 'UPSIDE';
    else if (parlay.parlay_type === 'BALANCED') type = 'BALANCED';
    
    dailyParlays.push({
      id: parlay.id,
      type,
      source: 'sharp',
      legCount: legs.length,
      legs,
      combinedOdds: parlay.total_odds || 300,
      winProbability: parlay.combined_probability || 0.55,
      patterns: extractPatterns(legs),
      riskLevel: type === 'SAFE' ? 'LOW' : type === 'UPSIDE' ? 'HIGH' : 'MEDIUM',
      parlayDate: parlay.parlay_date,
      outcome: (parlay.outcome as 'pending' | 'won' | 'lost') || 'pending',
    });
  });
  
  // Add Heat Parlays
  heatParlays?.forEach(parlay => {
    const leg1 = parseHeatLeg(parlay.leg_1);
    const leg2 = parseHeatLeg(parlay.leg_2);
    const legs = [leg1, leg2].filter(Boolean) as UnifiedParlayLeg[];
    if (legs.length === 0) return;
    
    const type: DailyParlay['type'] = parlay.parlay_type === 'CORE' ? 'CORE' : 'HEAT_UPSIDE';
    
    dailyParlays.push({
      id: parlay.id,
      type,
      source: 'heat',
      legCount: legs.length,
      legs,
      combinedOdds: parlay.estimated_odds || 180,
      winProbability: parlay.combined_probability || 0.60,
      patterns: extractPatterns(legs),
      riskLevel: parlay.risk_level === 'LOW' ? 'LOW' : parlay.risk_level === 'HIGH' ? 'HIGH' : 'MEDIUM',
      parlayDate: parlay.parlay_date,
      outcome: (parlay.outcome as 'pending' | 'won' | 'lost') || 'pending',
    });
  });
  
  // Sort by priority: OPTIMAL first, then by leg count descending
  const sortedParlays = dailyParlays.sort((a, b) => {
    const typePriority: Record<DailyParlay['type'], number> = {
      'OPTIMAL': 0,
      'SAFE': 1,
      'CORE': 2,
      'BALANCED': 3,
      'UPSIDE': 4,
      'HEAT_UPSIDE': 5,
    };
    
    const priorityDiff = typePriority[a.type] - typePriority[b.type];
    if (priorityDiff !== 0) return priorityDiff;
    
    return b.legCount - a.legCount;
  });
  
  return {
    parlays: sortedParlays,
    isLoading: sweetSpotLoading || sharpLoading || heatLoading,
    parlayCount: sortedParlays.length,
    today,
  };
}
