import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Archetype to role mapping
const ARCHETYPE_TO_ROLE: Record<string, string> = {
  'ELITE_REBOUNDER': 'BIG',
  'GLASS_CLEANER': 'BIG',
  'RIM_PROTECTOR': 'BIG',
  'STRETCH_BIG': 'BIG',
  'PAINT_PRESENCE': 'BIG',
  'PLAYMAKER': 'PRIMARY',
  'COMBO_GUARD': 'PRIMARY',
  'SCORING_GUARD': 'PRIMARY',
  'STAR_SCORER': 'PRIMARY',
  'PURE_SHOOTER': 'PRIMARY',
  'THREE_AND_D': 'SECONDARY',
  'ROLE_PLAYER': 'SECONDARY',
  'WING_SCORER': 'SECONDARY',
};

// Lock Mode slot types
type LockModeSlot = 'BIG_REB_OVER' | 'ASSIST_OVER' | 'FLEX';

interface GateResult {
  passed: boolean;
  reason?: string;
}

interface Candidate {
  id: string;
  player_name: string;
  prop: string;
  line: number;
  side: string;
  predicted_final: number;
  actual_final: number | null;
  outcome: string | null;
  confidence_raw: number;
  rotation_role: string | null;
  minutes_uncertainty: number | null;
  risk_flags: string[] | null;
  archetype: string | null;
  role: string;
  edge: number;
  slot: LockModeSlot | null;
  gates: {
    minutes: GateResult;
    statType: GateResult;
    edge: GateResult;
    under: GateResult;
    confidence: GateResult;
  };
}

interface SlipLeg {
  player: string;
  prop: string;
  line: number;
  side: string;
  projected: number;
  actual: number | null;
  outcome: string | null;
  edge: number;
  confidence: number;
  slot: LockModeSlot;
}

// Gate 1: Minutes & Rotation Check
function checkMinutesGate(candidate: Candidate): GateResult {
  const validRoles = ['STARTER', 'CLOSER', 'PRIMARY'];
  const role = candidate.rotation_role?.toUpperCase() || '';
  const passed = validRoles.some(r => role.includes(r)) || candidate.role === 'PRIMARY' || candidate.role === 'BIG';
  
  return {
    passed,
    reason: passed ? undefined : `Role ${role || 'UNKNOWN'} not in starter/closer rotation`
  };
}

// Gate 2: Stat Type Priority
function checkStatTypeGate(candidate: Candidate): GateResult {
  const allowedProps = ['Rebounds', 'Assists', 'PRA', 'Points', 'rebounds', 'assists', 'pra', 'points'];
  const propLower = candidate.prop.toLowerCase();
  const passed = allowedProps.some(p => p.toLowerCase() === propLower);
  
  return {
    passed,
    reason: passed ? undefined : `${candidate.prop} not in allowed stat types`
  };
}

// Gate 3: Edge vs Uncertainty
function checkEdgeGate(candidate: Candidate): GateResult {
  const edge = Math.abs(candidate.predicted_final - candidate.line);
  const uncertainty = candidate.minutes_uncertainty || 1;
  const threshold = uncertainty * 1.25;
  const passed = edge >= threshold && edge > 0.5;
  
  return {
    passed,
    reason: passed ? undefined : `Edge ${edge.toFixed(2)} < ${threshold.toFixed(2)} (unc × 1.25)`
  };
}

// Gate 4: UNDER Rules
function checkUnderGate(candidate: Candidate): GateResult {
  if (candidate.side.toUpperCase() === 'OVER') {
    return { passed: true };
  }
  
  const flags = candidate.risk_flags || [];
  const hasBreakout = flags.includes('BREAKOUT_RISK');
  const hasBlowout = flags.includes('BLOWOUT_RISK');
  const hasHighVariance = flags.includes('HIGH_VARIANCE');
  
  const passed = !hasBreakout && !hasBlowout && !hasHighVariance;
  
  return {
    passed,
    reason: passed ? undefined : `UNDER blocked: ${hasBreakout ? 'BREAKOUT' : hasBlowout ? 'BLOWOUT' : 'HIGH_VARIANCE'} risk`
  };
}

// Confidence Filter
function checkConfidenceGate(candidate: Candidate): GateResult {
  const passed = candidate.confidence_raw >= 72;
  
  return {
    passed,
    reason: passed ? undefined : `Confidence ${candidate.confidence_raw} < 72`
  };
}

// Determine slot type for a candidate
function determineSlot(candidate: Candidate): LockModeSlot | null {
  const propLower = candidate.prop.toLowerCase();
  const sideLower = candidate.side.toLowerCase();
  
  // Slot 1: BIG_REB_OVER
  if (propLower === 'rebounds' && sideLower === 'over') {
    if (candidate.role === 'BIG' || candidate.role === 'PRIMARY') {
      return 'BIG_REB_OVER';
    }
  }
  
  // Slot 2: ASSIST_OVER
  if (propLower === 'assists' && sideLower === 'over') {
    if (candidate.role === 'PRIMARY' || candidate.role === 'SECONDARY') {
      return 'ASSIST_OVER';
    }
  }
  
  // Slot 3: FLEX
  if (propLower === 'points' && sideLower === 'over' && candidate.role === 'PRIMARY') {
    return 'FLEX';
  }
  if (propLower === 'pra' && sideLower === 'over' && candidate.role === 'BIG') {
    return 'FLEX';
  }
  if (sideLower === 'under' && candidate.confidence_raw >= 75) {
    return 'FLEX';
  }
  
  return null;
}

// Process candidates through all gates
function processCandidate(outcome: any, archetype: string | null): Candidate {
  const role = archetype ? (ARCHETYPE_TO_ROLE[archetype] || 'SECONDARY') : 'SECONDARY';
  const edge = Math.abs((outcome.predicted_final || 0) - outcome.line);
  
  const candidate: Candidate = {
    id: outcome.id,
    player_name: outcome.player_name,
    prop: outcome.prop,
    line: outcome.line,
    side: outcome.side,
    predicted_final: outcome.predicted_final || 0,
    actual_final: outcome.actual_final,
    outcome: outcome.outcome,
    confidence_raw: outcome.confidence_raw || 0,
    rotation_role: outcome.rotation_role,
    minutes_uncertainty: outcome.minutes_uncertainty || 1,
    risk_flags: outcome.risk_flags,
    archetype,
    role,
    edge,
    slot: null,
    gates: {
      minutes: { passed: false },
      statType: { passed: false },
      edge: { passed: false },
      under: { passed: false },
      confidence: { passed: false },
    }
  };
  
  // Run all gates
  candidate.gates.minutes = checkMinutesGate(candidate);
  candidate.gates.statType = checkStatTypeGate(candidate);
  candidate.gates.edge = checkEdgeGate(candidate);
  candidate.gates.under = checkUnderGate(candidate);
  candidate.gates.confidence = checkConfidenceGate(candidate);
  
  // If all gates pass, determine slot
  const allPass = Object.values(candidate.gates).every(g => g.passed);
  if (allPass) {
    candidate.slot = determineSlot(candidate);
  }
  
  return candidate;
}

// Build a 3-leg slip for a given date's candidates
function buildSlip(candidates: Candidate[]): { legs: SlipLeg[], missingSlots: LockModeSlot[] } {
  const slots: Record<LockModeSlot, SlipLeg | null> = {
    BIG_REB_OVER: null,
    ASSIST_OVER: null,
    FLEX: null,
  };
  
  // Sort candidates by confidence (highest first)
  const eligible = candidates
    .filter(c => c.slot !== null)
    .sort((a, b) => b.confidence_raw - a.confidence_raw);
  
  // Fill slots
  for (const candidate of eligible) {
    if (candidate.slot && !slots[candidate.slot]) {
      slots[candidate.slot] = {
        player: candidate.player_name,
        prop: candidate.prop,
        line: candidate.line,
        side: candidate.side,
        projected: candidate.predicted_final,
        actual: candidate.actual_final,
        outcome: candidate.outcome,
        edge: candidate.edge,
        confidence: candidate.confidence_raw,
        slot: candidate.slot,
      };
    }
  }
  
  const legs = Object.values(slots).filter((l): l is SlipLeg => l !== null);
  const missingSlots = (Object.keys(slots) as LockModeSlot[]).filter(s => !slots[s]);
  
  return { legs, missingSlots };
}

// Grade a slip's outcomes
function gradeSlip(legs: SlipLeg[]): { hit: number, missed: number, pushed: number, allHit: boolean } {
  let hit = 0, missed = 0, pushed = 0;
  
  for (const leg of legs) {
    if (leg.outcome === 'hit') hit++;
    else if (leg.outcome === 'miss') missed++;
    else if (leg.outcome === 'push') pushed++;
  }
  
  return { hit, missed, pushed, allHit: hit === 3 && missed === 0 };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { dateStart, dateEnd, runName } = await req.json();
    
    if (!dateStart || !dateEnd) {
      return new Response(
        JSON.stringify({ error: "dateStart and dateEnd required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[Lock Mode Backtest] Starting for ${dateStart} to ${dateEnd}`);

    // Fetch historical outcomes with archetypes
    const { data: outcomes, error: outcomesError } = await supabase
      .from('scout_prop_outcomes')
      .select('*')
      .gte('analysis_date', dateStart)
      .lte('analysis_date', dateEnd)
      .not('outcome', 'is', null)
      .order('analysis_date', { ascending: true });

    if (outcomesError) {
      throw new Error(`Failed to fetch outcomes: ${outcomesError.message}`);
    }

    console.log(`[Lock Mode Backtest] Fetched ${outcomes?.length || 0} outcomes`);

    // Fetch archetypes
    const { data: archetypes } = await supabase
      .from('player_archetypes')
      .select('player_name, primary_archetype');

    const archetypeMap = new Map<string, string>();
    archetypes?.forEach(a => {
      archetypeMap.set(a.player_name.toLowerCase(), a.primary_archetype);
    });

    // Group outcomes by date
    const byDate = new Map<string, any[]>();
    for (const outcome of outcomes || []) {
      const date = outcome.analysis_date;
      if (!byDate.has(date)) {
        byDate.set(date, []);
      }
      byDate.get(date)!.push(outcome);
    }

    // Stats tracking
    const gateBlockStats = {
      minutes: 0,
      statType: 0,
      edge: 0,
      under: 0,
      confidence: 0,
    };
    
    let totalSlates = 0;
    let slipsGenerated = 0;
    let slipsPassed = 0;
    let totalLegs = 0;
    let legsHit = 0;
    let legsMissed = 0;
    let legsPushed = 0;
    let parlaysWon = 0;
    let totalEdge = 0;

    // Create run record
    const { data: runData, error: runError } = await supabase
      .from('lock_mode_backtest_runs')
      .insert({
        run_name: runName || `Backtest ${dateStart} to ${dateEnd}`,
        date_range_start: dateStart,
        date_range_end: dateEnd,
        config: {
          confidenceThreshold: 72,
          edgeMultiplier: 1.25,
          slots: ['BIG_REB_OVER', 'ASSIST_OVER', 'FLEX']
        }
      })
      .select()
      .single();

    if (runError) {
      throw new Error(`Failed to create run: ${runError.message}`);
    }

    const runId = runData.id;
    const slipRecords: any[] = [];

    // Process each date
    for (const [date, dateOutcomes] of byDate.entries()) {
      totalSlates++;
      
      // Process all candidates
      const candidates: Candidate[] = [];
      const blockedCandidates: any[] = [];
      
      for (const outcome of dateOutcomes) {
        const archetype = archetypeMap.get(outcome.player_name?.toLowerCase() || '') || null;
        const candidate = processCandidate(outcome, archetype);
        candidates.push(candidate);
        
        // Track gate blocks
        if (!candidate.gates.minutes.passed) gateBlockStats.minutes++;
        else if (!candidate.gates.statType.passed) gateBlockStats.statType++;
        else if (!candidate.gates.edge.passed) gateBlockStats.edge++;
        else if (!candidate.gates.under.passed) gateBlockStats.under++;
        else if (!candidate.gates.confidence.passed) gateBlockStats.confidence++;
        
        // Track blocked candidates
        if (!candidate.slot) {
          blockedCandidates.push({
            player: candidate.player_name,
            prop: candidate.prop,
            gates: candidate.gates
          });
        }
      }
      
      // Build slip
      const { legs, missingSlots } = buildSlip(candidates);
      const slipValid = legs.length === 3;
      
      if (slipValid) {
        slipsGenerated++;
        totalLegs += 3;
        
        const grade = gradeSlip(legs);
        legsHit += grade.hit;
        legsMissed += grade.missed;
        legsPushed += grade.pushed;
        
        if (grade.allHit) {
          parlaysWon++;
        }
        
        // Calculate average edge
        for (const leg of legs) {
          totalEdge += leg.edge;
        }
      } else {
        slipsPassed++;
      }
      
      // Record slip
      slipRecords.push({
        run_id: runId,
        slate_date: date,
        slip_valid: slipValid,
        legs: legs,
        leg_count: legs.length,
        legs_hit: slipValid ? legs.filter(l => l.outcome === 'hit').length : 0,
        legs_missed: slipValid ? legs.filter(l => l.outcome === 'miss').length : 0,
        legs_pushed: slipValid ? legs.filter(l => l.outcome === 'push').length : 0,
        all_legs_hit: slipValid && legs.every(l => l.outcome === 'hit'),
        missing_slots: missingSlots,
        blocked_candidates: blockedCandidates.slice(0, 10), // Limit to 10 for storage
      });
    }

    // Insert slip records in batches
    if (slipRecords.length > 0) {
      const batchSize = 50;
      for (let i = 0; i < slipRecords.length; i += batchSize) {
        const batch = slipRecords.slice(i, i + batchSize);
        const { error: slipError } = await supabase
          .from('lock_mode_backtest_slips')
          .insert(batch);
        
        if (slipError) {
          console.error(`[Lock Mode Backtest] Slip insert error: ${slipError.message}`);
        }
      }
    }

    // Calculate final rates
    const legHitRate = (legsHit + legsMissed) > 0 
      ? (legsHit / (legsHit + legsMissed)) * 100 
      : 0;
    const parlayWinRate = slipsGenerated > 0 
      ? (parlaysWon / slipsGenerated) * 100 
      : 0;
    const avgEdge = totalLegs > 0 ? totalEdge / totalLegs : 0;

    // Update run with final stats
    const { error: updateError } = await supabase
      .from('lock_mode_backtest_runs')
      .update({
        total_slates: totalSlates,
        slips_generated: slipsGenerated,
        slips_passed: slipsPassed,
        total_legs: totalLegs,
        legs_hit: legsHit,
        legs_missed: legsMissed,
        legs_pushed: legsPushed,
        leg_hit_rate: legHitRate,
        parlay_win_rate: parlayWinRate,
        gate_block_stats: gateBlockStats,
        avg_edge_value: avgEdge,
        completed_at: new Date().toISOString(),
      })
      .eq('id', runId);

    if (updateError) {
      console.error(`[Lock Mode Backtest] Update error: ${updateError.message}`);
    }

    const summary = {
      dateRange: { start: dateStart, end: dateEnd },
      totalSlates,
      slipsGenerated,
      slipsPassed,
      totalLegs,
      legsHit,
      legsMissed,
      legsPushed,
      legHitRate: parseFloat(legHitRate.toFixed(2)),
      parlayWinRate: parseFloat(parlayWinRate.toFixed(2)),
      parlaysWon,
      gateBlockStats,
      avgEdge: parseFloat(avgEdge.toFixed(2)),
    };

    console.log(`[Lock Mode Backtest] Complete:`, summary);

    return new Response(
      JSON.stringify({ success: true, runId, summary }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error("[Lock Mode Backtest] Error:", errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});