import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ---------- Helpers ----------
function median(arr: number[]): number {
  if (!arr?.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function stdDev(arr: number[]): number {
  if (!arr || arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const v = arr.reduce((sum, x) => sum + (x - mean) ** 2, 0) / arr.length;
  return Math.sqrt(v);
}

// Defense code (0–100) -> multiplier
// Higher code = harder defense = suppress stats
function defenseMultiplier(code: number | null | undefined): number {
  if (code === null || code === undefined) return 0;
  if (code >= 80) return -0.08;  // Hard defense
  if (code >= 60) return -0.04;
  if (code >= 40) return 0;       // Neutral
  if (code >= 20) return 0.04;
  return 0.08;                    // Soft defense, boost stats
}

// Prop type mapping
type StatKey = "points" | "rebounds" | "assists" | "pra" | "pr" | "pa" | "ra";

function normalizePropType(propType: string): StatKey | null {
  const t = (propType || "").toLowerCase();
  if (t.includes("player_points_rebounds_assists") || t.includes("pra")) return "pra";
  if (t.includes("player_points_rebounds") || t.includes("pr")) return "pr";
  if (t.includes("player_points_assists") || t.includes("pa")) return "pa";
  if (t.includes("player_rebounds_assists") || t.includes("ra")) return "ra";
  if (t.includes("player_points")) return "points";
  if (t.includes("player_rebounds")) return "rebounds";
  if (t.includes("player_assists")) return "assists";
  return null;
}

// Build series for a stat or combo
function seriesFromLogs(logs: any[], stat: StatKey): number[] {
  const safe = (n: any) => (typeof n === "number" ? n : 0);

  if (stat === "points") return logs.map(l => safe(l.points ?? l.pts));
  if (stat === "rebounds") return logs.map(l => safe(l.rebounds ?? l.reb));
  if (stat === "assists") return logs.map(l => safe(l.assists ?? l.ast));

  // combos: sum per-game series
  return logs.map(l => {
    const pts = safe(l.points ?? l.pts);
    const reb = safe(l.rebounds ?? l.reb);
    const ast = safe(l.assists ?? l.ast);
    if (stat === "pra") return pts + reb + ast;
    if (stat === "pr") return pts + reb;
    if (stat === "pa") return pts + ast;
    if (stat === "ra") return reb + ast;
    return 0;
  });
}

// Hit rate vs line
function hitRates(series: number[], line: number) {
  const over = series.filter(v => v > line).length / (series.length || 1);
  const under = series.filter(v => v < line).length / (series.length || 1);
  return { over, under };
}

// Volatility ratio (coefficient of variation)
function volatilityRatio(series: number[]) {
  const mu = series.reduce((a, b) => a + b, 0) / (series.length || 1);
  const sd = stdDev(series);
  return mu > 0 ? sd / mu : 1;
}

// Stat-specific thresholds (balanced accuracy mode)
const THRESH: Record<StatKey, { lean: number; strong: number; volCapStrong: number }> = {
  points:   { lean: 1.5, strong: 3.0, volCapStrong: 0.32 },
  rebounds: { lean: 1.3, strong: 2.5, volCapStrong: 0.34 },
  assists:  { lean: 1.2, strong: 2.2, volCapStrong: 0.30 },
  pra:      { lean: 2.0, strong: 4.0, volCapStrong: 0.28 },
  pr:       { lean: 1.8, strong: 3.5, volCapStrong: 0.30 },
  pa:       { lean: 1.6, strong: 3.0, volCapStrong: 0.30 },
  ra:       { lean: 1.4, strong: 2.6, volCapStrong: 0.32 },
};

// ========== ONE PLAYER PER PARLAY HELPERS ==========

// Stat Safety Ranking - Bias toward safer stat types
const STAT_SAFETY: Record<string, number> = {
  ra: 5,
  rebounds: 4,
  assists: 3,
  points: 2,
  pra: 1,
  pr: 2,
  pa: 2,
};

// Hard veto: Only allow one leg per player
function canAddPlayerLeg(
  playerCount: Record<string, number>,
  playerName: string
): boolean {
  const key = playerName.toLowerCase().trim();
  return (playerCount[key] || 0) === 0;
}

// Combo overlap veto: Prevents base+combo for same player
function violatesComboOverlap(existingLegs: any[], candidate: any): boolean {
  const player = (candidate.player_name || candidate.playerName || '').toLowerCase().trim();
  const stat = (candidate.stat_type || '').toLowerCase();

  const existingStats = existingLegs
    .filter(l => (l.player_name || l.playerName || '').toLowerCase().trim() === player)
    .map(l => (l.stat_type || '').toLowerCase());

  if (existingStats.length === 0) return false;

  const comboStats = ['pra', 'pa', 'pr', 'ra', 
    'points_rebounds_assists', 'points_rebounds', 'points_assists', 'rebounds_assists'];
  const baseStats = ['points', 'rebounds', 'assists'];

  // If candidate is a combo stat
  if (comboStats.includes(stat)) {
    const bases: Record<string, string[]> = {
      pra: ['points', 'rebounds', 'assists'],
      points_rebounds_assists: ['points', 'rebounds', 'assists'],
      pr: ['points', 'rebounds'],
      points_rebounds: ['points', 'rebounds'],
      pa: ['points', 'assists'],
      points_assists: ['points', 'assists'],
      ra: ['rebounds', 'assists'],
      rebounds_assists: ['rebounds', 'assists'],
    };
    const baseComponents = bases[stat] || [];
    if (existingStats.some(s => baseComponents.includes(s))) return true;
    if (existingStats.some(s => comboStats.includes(s))) return true;
    return true; // Block combo if player already has any leg
  }

  // If candidate is a base stat, check if a combo exists
  if (baseStats.includes(stat)) {
    if (existingStats.some(s => comboStats.includes(s))) return true;
  }

  return false;
}

// Select best single prop from a list (by quality score)
function selectBestPropFromDuo(picks: any[]): any {
  if (!picks || picks.length === 0) return null;
  
  return picks
    .map(p => {
      const hitRate = p.hit_rate_over_10 || p.hit_rate_under_10 || 0.5;
      return {
        ...p,
        quality_score:
          (hitRate * 100) +
          Math.abs(p.edge || 0) * 8 -
          ((p.volatility || 0) * 40) +
          (STAT_SAFETY[p.stat_type as StatKey] || 1) * 5
      };
    })
    .sort((a, b) => b.quality_score - a.quality_score)[0];
}

type EngineResult = {
  player_name: string;
  stat_type: StatKey;
  line: number;
  games_analyzed: number;
  median10: number;
  median5: number;
  adjusted_median: number;
  edge: number;
  hit_rate_over_10: number;
  hit_rate_under_10: number;
  volatility: number;
  defense_code: number | null;
  defense_multiplier: number;
  recommendation: "STRONG OVER" | "LEAN OVER" | "STRONG UNDER" | "LEAN UNDER" | "NO BET";
  confidence_tier: "A" | "B" | "C" | "D";
  reason: string;
  event_id?: string;
  opponent_team?: string;
};

// ========== DUO STACK DETECTION ==========
interface DuoStack {
  player: string;
  stats: string[];
  direction: "OVER" | "UNDER";
  combined_edge: number;
  avg_hit_rate: number;
  boost: number;
  confidence: "ELITE" | "STRONG" | "MODERATE";
  picks: any[];
}

function detectDuoStacks(picks: any[]): DuoStack[] {
  const byPlayer = new Map<string, any[]>();
  
  for (const pick of picks) {
    const key = pick.player_name.toLowerCase();
    if (!byPlayer.has(key)) byPlayer.set(key, []);
    byPlayer.get(key)!.push(pick);
  }
  
  const duos: DuoStack[] = [];
  
  for (const [playerKey, playerPicks] of byPlayer) {
    if (playerPicks.length < 2) continue;
    
    // Group by direction
    const overPicks = playerPicks.filter(p => p.recommendation.includes('OVER'));
    const underPicks = playerPicks.filter(p => p.recommendation.includes('UNDER'));
    
    // Check OVER duos
    if (overPicks.length >= 2) {
      const stats = overPicks.map(p => p.stat_type);
      const combinedEdge = overPicks.reduce((sum, p) => sum + Math.abs(p.edge), 0);
      const avgHitRate = overPicks.reduce((sum, p) => sum + (p.hit_rate_over_10 || 0.5), 0) / overPicks.length;
      
      // Calculate boost based on tier composition
      const strongCount = overPicks.filter(p => p.recommendation.includes('STRONG')).length;
      let boost = 5;
      if (strongCount >= 2) boost = 15;
      else if (strongCount >= 1) boost = 10;
      
      // Confidence level
      let confidence: DuoStack["confidence"] = "MODERATE";
      if (avgHitRate >= 0.70 && strongCount >= 2) confidence = "ELITE";
      else if (avgHitRate >= 0.65 || strongCount >= 1) confidence = "STRONG";
      
      duos.push({
        player: playerPicks[0].player_name,
        stats,
        direction: "OVER",
        combined_edge: Number(combinedEdge.toFixed(2)),
        avg_hit_rate: Number(avgHitRate.toFixed(3)),
        boost,
        confidence,
        picks: overPicks
      });
    }
    
    // Check UNDER duos
    if (underPicks.length >= 2) {
      const stats = underPicks.map(p => p.stat_type);
      const combinedEdge = underPicks.reduce((sum, p) => sum + Math.abs(p.edge), 0);
      const avgHitRate = underPicks.reduce((sum, p) => sum + (p.hit_rate_under_10 || 0.5), 0) / underPicks.length;
      
      const strongCount = underPicks.filter(p => p.recommendation.includes('STRONG')).length;
      let boost = 5;
      if (strongCount >= 2) boost = 15;
      else if (strongCount >= 1) boost = 10;
      
      let confidence: DuoStack["confidence"] = "MODERATE";
      if (avgHitRate >= 0.70 && strongCount >= 2) confidence = "ELITE";
      else if (avgHitRate >= 0.65 || strongCount >= 1) confidence = "STRONG";
      
      duos.push({
        player: playerPicks[0].player_name,
        stats,
        direction: "UNDER",
        combined_edge: Number(combinedEdge.toFixed(2)),
        avg_hit_rate: Number(avgHitRate.toFixed(3)),
        boost,
        confidence,
        picks: underPicks
      });
    }
  }
  
  return duos.sort((a, b) => b.combined_edge - a.combined_edge);
}

// ========== PARLAY BUILDER ==========
interface ParlayLeg {
  player_name: string;
  stat_type: string;
  line: number;
  edge: number;
  recommendation: string;
  confidence_tier: string;
  hit_rate: number;
  volatility: number;
  defense_code: number | null;
  is_duo: boolean;
  pick_score: number;
}

interface GeneratedParlay {
  type: "SAFE" | "BALANCED" | "VALUE";
  legs: ParlayLeg[];
  total_edge: number;
  combined_hit_rate: number;
  confidence_score: number;
  stat_breakdown: Record<string, number>;
  duo_stacks: { player: string; type: string; boost: number }[];
  defense_advantage_score: number;
}

function scorePick(pick: any, duoPlayers: Set<string>): number {
  const absEdge = Math.abs(pick.edge || 0);
  const isOver = pick.recommendation.includes('OVER');
  const hitRate = isOver ? (pick.hit_rate_over_10 || 0.5) : (pick.hit_rate_under_10 || 0.5);
  const volatility = pick.volatility || 0.3;
  const defCode = pick.defense_code ?? 50;
  
  // Base score: edge × hit rate × (1 - volatility dampening)
  let score = absEdge * hitRate * (1 - volatility / 2);
  
  // Defense bonus (soft defense for OVER = +5, hard defense = -5)
  if (isOver) {
    if (defCode < 40) score += 5;
    else if (defCode >= 60) score -= 5;
  } else {
    // For UNDER, hard defense is good
    if (defCode >= 60) score += 5;
    else if (defCode < 40) score -= 5;
  }
  
  // Tier bonus
  const tier = pick.confidence_tier || 'D';
  if (tier === 'A') score += 10;
  else if (tier === 'B') score += 5;
  
  // Duo bonus
  if (duoPlayers.has(pick.player_name.toLowerCase())) {
    score += 8;
  }
  
  return score;
}

// Configurable parlay config type
interface ParlayConfig {
  tierA: number;
  tierBC: number;
  minHitRate: number;
  maxVol: number;
  duoBoost?: number;
  defenseWeight?: number;
  minEdge?: number;
}

function buildParlay(
  picks: any[],
  duos: DuoStack[],
  type: "SAFE" | "BALANCED" | "VALUE",
  usedPlayers: Set<string>,
  configOverride?: Partial<ParlayConfig>
): GeneratedParlay | null {
  const duoPlayers = new Set(duos.map(d => d.player.toLowerCase()));
  
  // Score all picks
  const scoredPicks = picks.map(p => ({
    ...p,
    pick_score: scorePick(p, duoPlayers),
    is_duo: duoPlayers.has(p.player_name.toLowerCase())
  })).sort((a, b) => b.pick_score - a.pick_score);
  
  // Default parlay configuration by type
  const defaultConfig: Record<"SAFE" | "BALANCED" | "VALUE", ParlayConfig> = {
    SAFE: { tierA: 4, tierBC: 2, minHitRate: 0.75, maxVol: 0.30 },
    BALANCED: { tierA: 3, tierBC: 3, minHitRate: 0.65, maxVol: 0.35 },
    VALUE: { tierA: 2, tierBC: 4, minHitRate: 0.60, maxVol: 0.40 }
  };
  
  // Apply config override if provided
  const cfg: ParlayConfig = { ...defaultConfig[type], ...configOverride };
  
  const legs: ParlayLeg[] = [];
  const statCount: Record<string, number> = {};
  const playerCount: Record<string, number> = {};
  const includedDuos: { player: string; type: string; boost: number }[] = [];
  
  // First, try to include BEST pick from each duo (one player per parlay rule)
  for (const duo of duos) {
    if (legs.length >= 6) break;
    
    const playerKey = duo.player.toLowerCase();
    
    // Hard veto: one player per parlay
    if (!canAddPlayerLeg(playerCount, duo.player)) continue;
    
    // Select BEST single prop from duo using quality scoring
    const bestPick = selectBestPropFromDuo(duo.picks);
    if (!bestPick) continue;
    
    // Check combo overlap veto
    if (violatesComboOverlap(legs, bestPick)) continue;
    
    const isOver = bestPick.recommendation.includes('OVER');
    const hitRate = isOver ? (bestPick.hit_rate_over_10 || 0.5) : (bestPick.hit_rate_under_10 || 0.5);
    const vol = bestPick.volatility || 0.3;
    
    if (hitRate < cfg.minHitRate || vol > cfg.maxVol) continue;
    if (cfg.minEdge && Math.abs(bestPick.edge || 0) < cfg.minEdge) continue;
    
    const stat = bestPick.stat_type;
    if ((statCount[stat] || 0) >= 2) continue;
    
    legs.push({
      player_name: bestPick.player_name,
      stat_type: stat,
      line: bestPick.sportsbook_line,
      edge: bestPick.edge,
      recommendation: bestPick.recommendation,
      confidence_tier: bestPick.confidence_tier || 'D',
      hit_rate: hitRate,
      volatility: vol,
      defense_code: bestPick.defense_code,
      is_duo: true, // Mark as duo pick (has multiple strong signals)
      pick_score: bestPick.quality_score || 0
    });
    
    statCount[stat] = (statCount[stat] || 0) + 1;
    playerCount[playerKey] = 1;
    
    includedDuos.push({
      player: duo.player,
      type: duo.stats.join('+'),
      boost: cfg.duoBoost ?? duo.boost
    });
  }
  
  // Fill remaining slots with best picks (one player per parlay rule)
  for (const pick of scoredPicks) {
    if (legs.length >= 6) break;
    
    // Hard veto: one player per parlay
    if (!canAddPlayerLeg(playerCount, pick.player_name)) continue;
    
    // Combo overlap veto
    if (violatesComboOverlap(legs, pick)) continue;
    
    const isOver = pick.recommendation.includes('OVER');
    const hitRate = isOver ? (pick.hit_rate_over_10 || 0.5) : (pick.hit_rate_under_10 || 0.5);
    const vol = pick.volatility || 0.3;
    
    if (hitRate < cfg.minHitRate || vol > cfg.maxVol) continue;
    if (cfg.minEdge && Math.abs(pick.edge || 0) < cfg.minEdge) continue;
    
    const stat = pick.stat_type;
    if ((statCount[stat] || 0) >= 2) continue;
    
    legs.push({
      player_name: pick.player_name,
      stat_type: stat,
      line: pick.sportsbook_line,
      edge: pick.edge,
      recommendation: pick.recommendation,
      confidence_tier: pick.confidence_tier || 'D',
      hit_rate: hitRate,
      volatility: vol,
      defense_code: pick.defense_code,
      is_duo: pick.is_duo,
      pick_score: pick.pick_score
    });
    
    statCount[stat] = (statCount[stat] || 0) + 1;
    playerCount[pick.player_name.toLowerCase()] = 1;
  }
  
  // INVARIANT ASSERTION: Fail fast if duplicate player detected
  const uniquePlayers = new Set(legs.map(l => l.player_name.toLowerCase()));
  if (uniquePlayers.size !== legs.length) {
    console.error('[NBA-PARLAY-BUILDER] INVARIANT VIOLATION: Duplicate player detected!', 
      legs.map(l => l.player_name));
    throw new Error('Invariant violation: duplicate player detected in parlay');
  }
  
  // Validate we have 6 legs with stat diversity (3+ different stat types)
  if (legs.length < 6) return null;
  const uniqueStats = Object.keys(statCount).length;
  if (uniqueStats < 3) return null;
  
  // Validate tier composition
  const tierACount = legs.filter(l => l.confidence_tier === 'A').length;
  const tierBCount = legs.filter(l => l.confidence_tier === 'B').length;
  
  if (type === 'SAFE' && tierACount < cfg.tierA) return null;
  if (type === 'BALANCED' && tierACount < cfg.tierA) return null;
  if (type === 'VALUE' && tierACount < cfg.tierA) return null;
  
  // Calculate parlay metrics
  const totalEdge = legs.reduce((sum, l) => sum + Math.abs(l.edge), 0);
  const combinedHitRate = legs.reduce((sum, l) => sum + l.hit_rate, 0) / legs.length;
  
  // Defense advantage score
  const defenseWeight = cfg.defenseWeight ?? 5;
  const avgDefCode = legs.reduce((sum, l) => sum + (l.defense_code ?? 50), 0) / legs.length;
  const softDefenseLegs = legs.filter(l => {
    const isOver = l.recommendation.includes('OVER');
    const defCode = l.defense_code ?? 50;
    return (isOver && defCode < 40) || (!isOver && defCode >= 60);
  }).length;
  const defenseAdvantage = softDefenseLegs / legs.length;
  
  // Confidence score calculation
  const tierWeightSum = legs.reduce((sum, l) => {
    if (l.confidence_tier === 'A') return sum + 1.0;
    if (l.confidence_tier === 'B') return sum + 0.75;
    if (l.confidence_tier === 'C') return sum + 0.5;
    return sum + 0.25;
  }, 0);
  const avgTierWeight = tierWeightSum / legs.length;
  
  // Apply configurable duo boost
  const duoBoostMultiplier = (cfg.duoBoost ?? 15) / 100;
  let confidence = avgTierWeight * combinedHitRate * 100;
  confidence *= (1 + includedDuos.length * duoBoostMultiplier * 0.33);
  confidence *= (1 + defenseAdvantage * (defenseWeight / 50));
  confidence = Math.min(100, Math.max(0, confidence));
  
  return {
    type,
    legs,
    total_edge: Number(totalEdge.toFixed(2)),
    combined_hit_rate: Number(combinedHitRate.toFixed(3)),
    confidence_score: Number(confidence.toFixed(1)),
    stat_breakdown: statCount,
    duo_stacks: includedDuos,
    defense_advantage_score: Number(defenseAdvantage.toFixed(2))
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    const body = await req.json().catch(() => ({}));
    const action = body?.action ?? "analyze_auto";

    // ========== GENERATE PARLAYS ACTION ==========
    if (action === "generate_parlays") {
      console.log('[NBA-PARLAY-BUILDER] Starting parlay generation...');
      const today = new Date().toISOString().split('T')[0];
      
      // Fetch today's actionable picks
      const { data: picks, error: picksErr } = await supabase
        .from('median_edge_picks')
        .select('*')
        .eq('game_date', today)
        .neq('recommendation', 'NO BET')
        .order('edge', { ascending: false });
      
      if (picksErr) throw picksErr;
      
      console.log(`[NBA-PARLAY-BUILDER] Found ${picks?.length || 0} actionable picks`);
      
      if (!picks || picks.length < 6) {
        return new Response(JSON.stringify({
          success: false,
          error: "Not enough actionable picks to build parlays (need at least 6)"
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" }});
      }
      
      // Deduplicate: keep best line per player/stat combo
      const deduped = new Map<string, any>();
      for (const pick of picks) {
        const key = `${pick.player_name.toLowerCase()}_${pick.stat_type}`;
        const existing = deduped.get(key);
        if (!existing || Math.abs(pick.edge) > Math.abs(existing.edge)) {
          deduped.set(key, pick);
        }
      }
      const dedupedPicks = Array.from(deduped.values());
      console.log(`[NBA-PARLAY-BUILDER] Deduplicated to ${dedupedPicks.length} picks`);
      
      // Detect duo stacks
      const duoStacks = detectDuoStacks(dedupedPicks);
      console.log(`[NBA-PARLAY-BUILDER] Detected ${duoStacks.length} duo stacks`);
      
      // Check for active A/B experiments
      const { data: activeExperiments } = await supabase
        .from('parlay_ab_experiments')
        .select('*')
        .eq('status', 'active')
        .lte('start_date', today);
      
      // Build parlays of each type
      const usedPlayers = new Set<string>();
      const safeParlay = buildParlay(dedupedPicks, duoStacks, "SAFE", usedPlayers);
      const balancedParlay = buildParlay(dedupedPicks, duoStacks, "BALANCED", usedPlayers);
      const valueParlay = buildParlay(dedupedPicks, duoStacks, "VALUE", usedPlayers);
      
      const parlays: GeneratedParlay[] = [];
      if (safeParlay) parlays.push(safeParlay);
      if (balancedParlay) parlays.push(balancedParlay);
      if (valueParlay) parlays.push(valueParlay);
      
      console.log(`[NBA-PARLAY-BUILDER] Built ${parlays.length} parlays`);
      
      // Build A/B experiment parlays if experiments are active
      const experimentParlays: { experiment_id: string; variant: string; parlay: GeneratedParlay }[] = [];
      
      for (const experiment of activeExperiments || []) {
        console.log(`[NBA-PARLAY-BUILDER] Processing experiment: ${experiment.experiment_name}`);
        
        const controlConfig = experiment.control_config as any;
        const variantConfig = experiment.variant_config as any;
        
        // Generate control parlay
        const controlParlay = buildParlay(dedupedPicks, duoStacks, "BALANCED", new Set(), controlConfig);
        if (controlParlay) {
          experimentParlays.push({
            experiment_id: experiment.id,
            variant: 'control',
            parlay: controlParlay
          });
        }
        
        // Generate variant parlay
        const variantParlay = buildParlay(dedupedPicks, duoStacks, "BALANCED", new Set(), variantConfig);
        if (variantParlay) {
          experimentParlays.push({
            experiment_id: experiment.id,
            variant: 'variant',
            parlay: variantParlay
          });
        }
      }
      
      console.log(`[NBA-PARLAY-BUILDER] Built ${experimentParlays.length} A/B experiment parlays`);
      
      // Save parlays to database
      if (parlays.length > 0) {
        // Clear today's old parlays first
        await supabase
          .from('median_parlay_picks')
          .delete()
          .eq('parlay_date', today)
          .is('experiment_id', null);
        
        const parlaysToSave = parlays.map(p => ({
          parlay_date: today,
          parlay_type: p.type,
          legs: p.legs,
          total_edge: p.total_edge,
          combined_hit_rate: p.combined_hit_rate,
          confidence_score: p.confidence_score,
          stat_breakdown: p.stat_breakdown,
          duo_stacks: p.duo_stacks,
          defense_advantage_score: p.defense_advantage_score,
          engine_version: 'v2'
        }));
        
        const { error: insertErr } = await supabase
          .from('median_parlay_picks')
          .insert(parlaysToSave);
        
        if (insertErr) {
          console.error('[NBA-PARLAY-BUILDER] Insert error:', insertErr);
        } else {
          console.log(`[NBA-PARLAY-BUILDER] Saved ${parlaysToSave.length} parlays`);
        }
      }
      
      // Save experiment parlays and track assignments
      for (const expParlay of experimentParlays) {
        // Clear today's experiment parlays for this variant
        await supabase
          .from('median_parlay_picks')
          .delete()
          .eq('parlay_date', today)
          .eq('experiment_id', expParlay.experiment_id)
          .eq('experiment_variant', expParlay.variant);
        
        // Insert the experiment parlay
        const { data: savedParlay, error: expInsertErr } = await supabase
          .from('median_parlay_picks')
          .insert({
            parlay_date: today,
            parlay_type: expParlay.parlay.type,
            legs: expParlay.parlay.legs,
            total_edge: expParlay.parlay.total_edge,
            combined_hit_rate: expParlay.parlay.combined_hit_rate,
            confidence_score: expParlay.parlay.confidence_score,
            stat_breakdown: expParlay.parlay.stat_breakdown,
            duo_stacks: expParlay.parlay.duo_stacks,
            defense_advantage_score: expParlay.parlay.defense_advantage_score,
            engine_version: 'v2',
            experiment_id: expParlay.experiment_id,
            experiment_variant: expParlay.variant
          })
          .select()
          .single();
        
        if (expInsertErr) {
          console.error(`[NBA-PARLAY-BUILDER] Experiment insert error:`, expInsertErr);
          continue;
        }
        
        // Track assignment
        const { error: assignErr } = await supabase
          .from('parlay_experiment_assignments')
          .insert({
            experiment_id: expParlay.experiment_id,
            parlay_id: savedParlay.id,
            variant: expParlay.variant,
            parlay_type: expParlay.parlay.type,
            confidence_at_creation: expParlay.parlay.confidence_score,
            total_edge_at_creation: expParlay.parlay.total_edge,
            duo_stacks_count: expParlay.parlay.duo_stacks.length,
            config_snapshot: expParlay.variant === 'control' 
              ? activeExperiments?.find(e => e.id === expParlay.experiment_id)?.control_config
              : activeExperiments?.find(e => e.id === expParlay.experiment_id)?.variant_config
          });
        
        if (assignErr) {
          console.error(`[NBA-PARLAY-BUILDER] Assignment error:`, assignErr);
        }
      }
      
      return new Response(JSON.stringify({
        success: true,
        engine: "NBA_PARLAY_BUILDER_V1",
        parlays: {
          SAFE: safeParlay,
          BALANCED: balancedParlay,
          VALUE: valueParlay
        },
        duo_opportunities: duoStacks.slice(0, 10),
        summary: {
          total_picks_analyzed: dedupedPicks.length,
          duo_stacks_found: duoStacks.length,
          parlays_generated: parlays.length,
          experiment_parlays_generated: experimentParlays.length,
          active_experiments: activeExperiments?.length || 0
        }
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" }});
    }

    // ========== GET PARLAYS ACTION ==========
    if (action === "get_parlays") {
      const today = new Date().toISOString().split('T')[0];
      
      const { data: parlays, error } = await supabase
        .from('median_parlay_picks')
        .select('*')
        .eq('parlay_date', today)
        .order('confidence_score', { ascending: false });
      
      if (error) throw error;
      
      // Also get duo opportunities from today's picks
      const { data: picks } = await supabase
        .from('median_edge_picks')
        .select('*')
        .eq('game_date', today)
        .neq('recommendation', 'NO BET');
      
      const duoStacks = picks ? detectDuoStacks(picks) : [];
      
      return new Response(JSON.stringify({
        success: true,
        parlays: parlays || [],
        duo_opportunities: duoStacks.slice(0, 10)
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" }});
    }

    // --------- AUTO MODE: pull NBA props and compute results ----------
    if (action === "analyze_auto") {
      const nowIso = new Date().toISOString();
      const today = nowIso.split('T')[0];

      // 1) Pull upcoming NBA props
      const { data: props, error: propsErr } = await supabase
        .from("unified_props")
        .select("*")
        .eq("sport", "basketball_nba")
        .gte("commence_time", nowIso)
        .eq("is_active", true);

      if (propsErr) throw propsErr;

      console.log(`[NBA-MEDIAN-V2] Found ${props?.length || 0} NBA props`);

      // 2) Pull defense codes
      const { data: defRows } = await supabase
        .from("nba_defense_codes")
        .select("*")
        .eq("season", "2024-25");

      const defMap = new Map<string, any>();
      (defRows || []).forEach((r: any) => {
        defMap.set((r.team_name || "").toLowerCase(), r);
        if (r.team_abbreviation) {
          defMap.set(r.team_abbreviation.toLowerCase(), r);
        }
      });

      console.log(`[NBA-MEDIAN-V2] Loaded ${defRows?.length || 0} defense codes`);

      // 3) Pull game logs with pagination (overcome 1000 row limit)
      let allLogs: any[] = [];
      let page = 0;
      const pageSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data: pageLogs, error: logsErr } = await supabase
          .from("nba_player_game_logs")
          .select("player_name, game_date, opponent, is_home, minutes_played, points, rebounds, assists")
          .order("game_date", { ascending: false })
          .range(page * pageSize, (page + 1) * pageSize - 1);

        if (logsErr) throw logsErr;
        
        if (pageLogs && pageLogs.length > 0) {
          allLogs = allLogs.concat(pageLogs);
          hasMore = pageLogs.length === pageSize;
          page++;
        } else {
          hasMore = false;
        }
      }

      console.log(`[NBA-MEDIAN-V2] Loaded ${allLogs.length} game logs (${page} pages)`);

      // Index logs by player_name
      const byPlayer = new Map<string, any[]>();
      for (const l of allLogs) {
        const key = (l.player_name || "").toLowerCase();
        if (!key) continue;
        if (!byPlayer.has(key)) byPlayer.set(key, []);
        byPlayer.get(key)!.push(l);
      }

      const results: EngineResult[] = [];

      for (const p of props || []) {
        const player = (p.player_name || "").trim();
        const statType = normalizePropType(p.prop_type);
        if (!player || !statType) continue;

        const line = Number(p.current_line ?? p.line ?? 0);
        if (!Number.isFinite(line) || line <= 0) continue;

        const playerLogs = (byPlayer.get(player.toLowerCase()) || [])
          .filter(l => (l.minutes_played ?? 0) > 0)
          .slice(0, 10);

        // Minimum 8 games required (v2 spec)
        if (playerLogs.length < 8) {
          results.push({
            player_name: player,
            stat_type: statType,
            line,
            games_analyzed: playerLogs.length,
            median10: 0,
            median5: 0,
            adjusted_median: 0,
            edge: 0,
            hit_rate_over_10: 0,
            hit_rate_under_10: 0,
            volatility: 1,
            defense_code: null,
            defense_multiplier: 0,
            recommendation: "NO BET",
            confidence_tier: "D",
            reason: `Insufficient sample (${playerLogs.length}/8 games)`,
            event_id: p.event_id,
            opponent_team: p.opponent_team
          });
          continue;
        }

        const series10 = seriesFromLogs(playerLogs, statType);
        const series5 = series10.slice(0, 5);

        const med10 = median(series10);
        const med5 = median(series5);

        const { over, under } = hitRates(series10, line);
        const vol = volatilityRatio(series10);

        // Defense code lookup - parse opponent from game_description
        // Format: "Away Team @ Home Team" or check for direct opponent_team field
        let opp = "";
        if (p.opponent_team) {
          opp = p.opponent_team.toLowerCase();
        } else if (p.game_description) {
          const gameDesc = p.game_description;
          const atIdx = gameDesc.indexOf(" @ ");
          if (atIdx > -1) {
            const awayTeam = gameDesc.substring(0, atIdx).toLowerCase();
            const homeTeam = gameDesc.substring(atIdx + 3).toLowerCase();
            const playerTeam = (p.team_name || "").toLowerCase();
            // Determine which team is the opponent
            opp = playerTeam && homeTeam.includes(playerTeam) ? awayTeam : homeTeam;
          }
        }
        const def = defMap.get(opp) || null;

        let defCode: number | null = null;
        if (def) {
          // Get stat-appropriate defense code
          if (statType === "points") defCode = def.vs_points_code ?? null;
          else if (statType === "rebounds") defCode = def.vs_rebounds_code ?? null;
          else if (statType === "assists") defCode = def.vs_assists_code ?? null;
          else if (statType === "pra") defCode = Math.round((def.vs_points_code + def.vs_rebounds_code + def.vs_assists_code) / 3) ?? null;
          else if (statType === "pr") defCode = Math.round((def.vs_points_code + def.vs_rebounds_code) / 2) ?? null;
          else if (statType === "pa") defCode = Math.round((def.vs_points_code + def.vs_assists_code) / 2) ?? null;
          else if (statType === "ra") defCode = Math.round((def.vs_rebounds_code + def.vs_assists_code) / 2) ?? null;
        }

        const defMult = defenseMultiplier(defCode);
        const adjustedMedian = med10 * (1 + defMult);

        let edge = adjustedMedian - line;

        // Recency influence (20% weight to recent form)
        edge += (med5 - med10) * 0.20;

        // Volatility dampening
        if (vol > 0.35) edge *= 0.88;

        // Decision logic (v2 gates: edge + hit rate must agree)
        const t = THRESH[statType];
        let rec: EngineResult["recommendation"] = "NO BET";
        const dir = edge >= 0 ? "OVER" : "UNDER";
        const absEdge = Math.abs(edge);
        const hitRateDir = dir === "OVER" ? over : under;

        // LEAN: |edge| >= threshold AND hit_rate >= 60%
        if (absEdge >= t.lean && hitRateDir >= 0.60) {
          rec = dir === "OVER" ? "LEAN OVER" : "LEAN UNDER";
        }
        
        // STRONG: |edge| >= threshold AND hit_rate >= 70% AND low volatility
        if (absEdge >= t.strong && hitRateDir >= 0.70 && vol <= t.volCapStrong) {
          rec = dir === "OVER" ? "STRONG OVER" : "STRONG UNDER";
        }

        // Confidence tier
        let tier: EngineResult["confidence_tier"] = "D";
        if (rec.includes("STRONG")) tier = "A";
        else if (rec.includes("LEAN")) tier = hitRateDir >= 0.67 ? "B" : "C";

        const reason = [
          `med10=${med10.toFixed(1)}`,
          `med5=${med5.toFixed(1)}`,
          `adj=${adjustedMedian.toFixed(1)}`,
          defCode !== null ? `def=${defCode}→${(defMult * 100).toFixed(0)}%` : 'def=NA',
          `edge=${edge >= 0 ? '+' : ''}${edge.toFixed(2)}`,
          `hit${dir.toLowerCase()}=${(hitRateDir * 100).toFixed(0)}%`,
          `vol=${vol.toFixed(2)}`
        ].join(' | ');

        results.push({
          player_name: player,
          stat_type: statType,
          line,
          games_analyzed: playerLogs.length,
          median10: Number(med10.toFixed(2)),
          median5: Number(med5.toFixed(2)),
          adjusted_median: Number(adjustedMedian.toFixed(2)),
          edge: Number(edge.toFixed(2)),
          hit_rate_over_10: Number(over.toFixed(3)),
          hit_rate_under_10: Number(under.toFixed(3)),
          volatility: Number(vol.toFixed(3)),
          defense_code: defCode,
          defense_multiplier: defMult,
          recommendation: rec,
          confidence_tier: tier,
          reason,
          event_id: p.event_id,
          opponent_team: p.opponent_team
        });
      }

      // Filter actionable picks
      const actionable = results.filter(r => r.recommendation !== "NO BET");

      console.log(`[NBA-MEDIAN-V2] Analyzed: ${results.length}, Actionable: ${actionable.length}`);

      // Save actionable picks to median_edge_picks
      if (actionable.length > 0) {
        const picksToSave = actionable.map(r => ({
          player_name: r.player_name,
          stat_type: r.stat_type,
          sportsbook_line: r.line,
          true_median: r.median10,
          edge: r.edge,
          recommendation: r.recommendation,
          confidence_flag: r.recommendation.includes('STRONG') ? 'HIGH' : 'MEDIUM',
          reason_summary: r.reason,
          game_date: today,
          // V2 fields
          adjusted_median: r.adjusted_median,
          defense_code: r.defense_code,
          defense_multiplier: r.defense_multiplier,
          hit_rate_over_10: r.hit_rate_over_10,
          hit_rate_under_10: r.hit_rate_under_10,
          median5: r.median5,
          volatility: r.volatility,
          confidence_tier: r.confidence_tier,
          engine_version: 'v2'
        }));

        // Clear today's old picks first
        await supabase
          .from('median_edge_picks')
          .delete()
          .eq('game_date', today);

        // Insert new picks
        const { error: insertError } = await supabase
          .from('median_edge_picks')
          .insert(picksToSave);

        if (insertError) {
          console.error('[NBA-MEDIAN-V2] Insert error:', insertError);
        } else {
          console.log(`[NBA-MEDIAN-V2] Saved ${picksToSave.length} picks`);
        }
      }

      const strongCount = actionable.filter(r => r.recommendation.includes('STRONG')).length;
      const leanCount = actionable.filter(r => r.recommendation.includes('LEAN')).length;

      return new Response(JSON.stringify({
        success: true,
        engine: "NBA_MEDIAN_MATCHUP_V2",
        analyzed: results.length,
        actionable_picks: actionable.length,
        strong_picks: strongCount,
        lean_picks: leanCount,
        tier_breakdown: {
          A: actionable.filter(r => r.confidence_tier === 'A').length,
          B: actionable.filter(r => r.confidence_tier === 'B').length,
          C: actionable.filter(r => r.confidence_tier === 'C').length,
        },
        picks: actionable,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" }});
    }

    // GET_PICKS action - retrieve saved picks
    if (action === "get_picks") {
      const today = new Date().toISOString().split('T')[0];
      
      const { data: picks, error } = await supabase
        .from('median_edge_picks')
        .select('*')
        .eq('game_date', today)
        .eq('engine_version', 'v2')
        .order('edge', { ascending: false });

      if (error) throw error;

      return new Response(JSON.stringify({
        success: true,
        picks: picks || []
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" }});
    }

    // Default info
    return new Response(JSON.stringify({
      success: true,
      engine: "NBA_MEDIAN_MATCHUP_V2",
      version: "2.0.0",
      supports: ["points", "rebounds", "assists", "pra", "pr", "pa", "ra"],
      features: [
        "Defense code multipliers (0-100 → -8% to +8%)",
        "Hit rate validation (60%+ for LEAN, 70%+ for STRONG)",
        "Per-stat thresholds",
        "Volatility dampening",
        "Confidence tiers (A/B/C/D)",
        "Duo stack detection",
        "AI parlay builder (SAFE/BALANCED/VALUE)"
      ],
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" }});

  } catch (e) {
    console.error('[NBA-MEDIAN-V2] Error:', e);
    return new Response(JSON.stringify({
      success: false,
      error: e instanceof Error ? e.message : String(e)
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }});
  }
});
