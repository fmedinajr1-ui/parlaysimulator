import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function getEasternDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function normalizePropType(raw: string): string {
  const s = raw.replace(/^(player_|batter_|pitcher_)/, '').toLowerCase().trim();
  if (/points.*rebounds.*assists|pts.*rebs.*asts|^pra$/.test(s)) return 'pra';
  if (/points.*rebounds|pts.*rebs|^pr$/.test(s)) return 'pr';
  if (/points.*assists|pts.*asts|^pa$/.test(s)) return 'pa';
  if (/rebounds.*assists|rebs.*asts|^ra$/.test(s)) return 'ra';
  if (/three_pointers|threes_made|^threes$/.test(s)) return 'threes';
  return s;
}

// ============= STRICT PROP OVERLAP PREVENTION =============
const COMBO_BASES: Record<string, string[]> = {
  pra: ['points', 'rebounds', 'assists'],
  pr: ['points', 'rebounds'],
  pa: ['points', 'assists'],
  ra: ['rebounds', 'assists'],
};

function hasCorrelatedProp(
  existingLegs: Array<{ player_name: string; prop_type: string }>,
  candidatePlayer: string,
  candidateProp: string
): boolean {
  const player = candidatePlayer.toLowerCase().trim();
  const prop = normalizePropType(candidateProp);

  const playerLegs = existingLegs
    .filter(l => l.player_name.toLowerCase().trim() === player)
    .map(l => normalizePropType(l.prop_type));

  if (playerLegs.length === 0) return false;

  const combos = Object.keys(COMBO_BASES);
  if (combos.includes(prop)) {
    const bases = COMBO_BASES[prop];
    if (playerLegs.some(s => bases.includes(s))) return true;
    if (playerLegs.some(s => combos.includes(s))) return true;
  }
  for (const existing of playerLegs) {
    if (combos.includes(existing)) {
      const bases = COMBO_BASES[existing];
      if (bases?.includes(prop)) return true;
    }
  }

  return true; // Same player = always block
}

interface MispricedPick {
  player_name: string;
  prop_type: string;
  signal: string;
  edge_pct: number;
  confidence_tier: string;
  book_line: number;
  player_avg_l10: number;
  sport: string;
  team?: string;
  riskConfirmed: boolean;
  convictionScore: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);
  const today = getEasternDate();

  try {
    console.log(`[ForceFresh] Starting force-generate for ${today}`);

    // Step 0a: Check if sufficient mispriced parlays already exist (skip if 10+)
    const { count: existingMispricedCount } = await supabase
      .from('bot_daily_parlays')
      .select('*', { count: 'exact', head: true })
      .eq('parlay_date', today)
      .eq('outcome', 'pending')
      .ilike('strategy_name', '%mispriced%');

    if ((existingMispricedCount || 0) >= 10) {
      console.log(`[ForceFresh] ⏭️ ${existingMispricedCount} mispriced parlays already active, skipping force-fresh.`);
      return new Response(JSON.stringify({
        success: true,
        skipped: true,
        reason: `Sufficient mispriced parlays already active (${existingMispricedCount})`,
        parlaysGenerated: 0,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Step 0b: Load stake config
    let stakeConfig: { execution_stake: number } | null = null;
    try {
      const { data: sc } = await supabase.from('bot_stake_config').select('execution_stake').limit(1).single();
      stakeConfig = sc;
    } catch (e) { console.warn('[ForceFresh] Could not load stake config, using default 500'); }

    // Step 0c: Load dynamic performance data
    let dynamicBlockedProps = new Set<string>();
    let playerPerfMap = new Map<string, { legsPlayed: number; legsWon: number; hitRate: number }>();
    
    try {
      const [propPerfResult, playerPerfResult] = await Promise.all([
        supabase.from('bot_prop_type_performance')
          .select('prop_type, is_blocked')
          .eq('is_blocked', true),
        supabase.from('bot_player_performance')
          .select('player_name, prop_type, legs_played, legs_won, hit_rate')
          .gte('legs_played', 3),
      ]);
      
      if (propPerfResult.data) {
        dynamicBlockedProps = new Set(propPerfResult.data.map((p: any) => p.prop_type));
      }
      if (playerPerfResult.data) {
        for (const p of playerPerfResult.data) {
          const key = `${(p.player_name || '').toLowerCase()}|${(p.prop_type || '').toLowerCase()}`;
          playerPerfMap.set(key, { legsPlayed: p.legs_played, legsWon: p.legs_won, hitRate: p.hit_rate });
        }
      }
      console.log(`[ForceFresh] Loaded ${dynamicBlockedProps.size} blocked prop types, ${playerPerfMap.size} player records`);
    } catch (perfErr) {
      console.warn(`[ForceFresh] Performance data load failed, using static fallback:`, perfErr);
    }

    // Step 1: Count existing pending parlays (no longer voiding them -- force-fresh ADDS on top)
    const { count: existingCount } = await supabase
      .from('bot_daily_parlays')
      .select('*', { count: 'exact', head: true })
      .eq('parlay_date', today)
      .is('outcome', null);

    const voidedCount = 0; // No longer voiding
    console.log(`[ForceFresh] ${existingCount || 0} existing pending parlays (preserved). Adding force-fresh on top.`);

    // Step 2: Fetch mispriced lines (ELITE + HIGH, edge >= 50%)
    const [mispricedResult, riskResult] = await Promise.all([
      supabase.from('mispriced_lines')
        .select('player_name, prop_type, signal, edge_pct, confidence_tier, book_line, player_avg_l10, sport')
        .eq('analysis_date', today)
        .in('confidence_tier', ['ELITE', 'HIGH'])
        .gte('book_line', 1.5)
        .order('edge_pct', { ascending: true }),
      supabase.from('nba_risk_engine_picks')
        .select('player_name, prop_type, side, confidence_score, team_name')
        .eq('game_date', today),
    ]);

    const mispricedLines = mispricedResult.data || [];
    const riskPicks = riskResult.data || [];
    console.log(`[ForceFresh] Mispriced ELITE/HIGH: ${mispricedLines.length}, Risk picks: ${riskPicks.length}`);

    if (mispricedLines.length === 0) {
      return new Response(JSON.stringify({
        success: false,
        error: 'No ELITE/HIGH mispriced lines found for today',
        voided: voidedCount,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Build risk engine lookup for cross-referencing
    const riskMap = new Map<string, { side: string; confidence: number; team: string }>();
    for (const rp of riskPicks) {
      const key = `${rp.player_name.toLowerCase()}|${normalizePropType(rp.prop_type)}`;
      riskMap.set(key, { side: rp.side, confidence: rp.confidence_score, team: rp.team_name || '' });
    }

    // Filter out blocked prop types (static + dynamic from bot_prop_type_performance)
    const STATIC_BLOCKED_PROP_TYPES = new Set<string>(); // Cleared: steals/blocks now allowed per relaxed filters
    const preFilterCount = mispricedLines.length;
    // Minimum line thresholds to reject phantom/alternate lines
    const MIN_LINES: Record<string, number> = {
      player_points: 5.5, player_rebounds: 2.5, player_assists: 1.5,
      player_threes: 0.5, player_blocks: 1.5, player_steals: 1.5, player_turnovers: 0.5,
      player_points_rebounds_assists: 10.5, player_pra: 10.5,
      player_points_rebounds: 5.5, player_pr: 5.5,
      player_points_assists: 5.5, player_pa: 5.5,
      player_rebounds_assists: 3.5, player_ra: 3.5,
    };
    const filteredLines = mispricedLines.filter(ml => {
      const propType = (ml.prop_type || '').toLowerCase();
      if (STATIC_BLOCKED_PROP_TYPES.has(propType) || dynamicBlockedProps.has(propType)) {
        console.log(`[BlockedPropType] Filtered ${propType} pick for ${ml.player_name}`);
        return false;
      }
      // Reject lines below minimum thresholds
      const line = Number(ml.book_line || 0);
      const minLine = MIN_LINES[propType] ?? 0.5;
      if (line < minLine) {
        console.log(`[MinLineFilter] Filtered ${ml.player_name} ${propType} line ${line} (min: ${minLine})`);
        return false;
      }
      return true;
    });
    if (preFilterCount !== filteredLines.length) {
      console.log(`[BlockedPropType] Removed ${preFilterCount - filteredLines.length} blocked prop type picks`);
    }

    // Step 3: Score and enrich picks
    const picks: MispricedPick[] = [];
    for (const ml of filteredLines) {
      const key = `${ml.player_name.toLowerCase()}|${normalizePropType(ml.prop_type)}`;
      const riskMatch = riskMap.get(key);
      const riskConfirmed = riskMatch ? riskMatch.side.toLowerCase() === ml.signal.toLowerCase() : false;

      // Conviction score: edge magnitude + tier bonus + risk confirmation
      const edgeMag = ml.edge_pct; // Use raw edge (positive = real value), not Math.abs
      const tierBonus = ml.confidence_tier === 'ELITE' ? 20 : 10;
      const riskBonus = riskConfirmed ? 25 : (riskMatch ? 5 : 0);
      const underBonus = ml.signal === 'UNDER' ? 10 : 0;
      
      // Player performance bonus from historical data
      const playerPerfKey = `${ml.player_name.toLowerCase()}|${normalizePropType(ml.prop_type)}`;
      const playerPerf = playerPerfMap.get(playerPerfKey);
      let playerBonus = 0;
      if (playerPerf && playerPerf.legsPlayed >= 5) {
        if (playerPerf.hitRate >= 0.70) playerBonus = 15;      // Proven winner
        else if (playerPerf.hitRate >= 0.50) playerBonus = 5;   // Reliable
        else if (playerPerf.hitRate < 0.30) playerBonus = -20;  // Avoid
      }
      
      const convictionScore = Math.min(edgeMag * 0.3 + tierBonus + riskBonus + underBonus + playerBonus, 100);

      picks.push({
        player_name: ml.player_name,
        prop_type: ml.prop_type,
        signal: ml.signal,
        edge_pct: ml.edge_pct,
        confidence_tier: ml.confidence_tier,
        book_line: ml.book_line,
        player_avg_l10: ml.player_avg_l10,
        sport: ml.sport,
        team: riskMatch?.team || '',
        riskConfirmed,
        convictionScore,
      });
    }

    // Sort by conviction (highest first)
    picks.sort((a, b) => b.convictionScore - a.convictionScore);
    console.log(`[ForceFresh] Scored ${picks.length} picks, top score: ${picks[0]?.convictionScore.toFixed(1)}`);

    // Step 4: Build 3-leg parlays using greedy algorithm
    const parlays: MispricedPick[][] = [];
    const usedInParlay = new Set<string>(); // track player+prop usage across parlays
    const globalPlayerPropCount = new Map<string, number>(); // global exposure cap
    const MAX_PARLAYS = 10; // Capped from 25 to prevent flooding
    const LEGS_PER_PARLAY = 3;
    const MAX_PLAYER_PROP_EXPOSURE = 5;

    // Try to build parlays
    for (let attempt = 0; attempt < MAX_PARLAYS * 3 && parlays.length < MAX_PARLAYS; attempt++) {
      const parlay: MispricedPick[] = [];
      const usedTeams = new Set<string>();
      const usedPropTypes = new Set<string>();
      const usedPlayers = new Set<string>();

      for (const pick of picks) {
        if (parlay.length >= LEGS_PER_PARLAY) break;

        const playerKey = pick.player_name.toLowerCase();
        const propKey = normalizePropType(pick.prop_type);
        const parlayKey = `${playerKey}|${propKey}|${parlays.length}`;
        const globalKey = `${playerKey}|${propKey}`;

        // Rule 1: No correlated props (same player OR base+combo overlap)
        const parlayLegsForCheck = parlay.map(p => ({ player_name: p.player_name, prop_type: p.prop_type }));
        if (hasCorrelatedProp(parlayLegsForCheck, pick.player_name, pick.prop_type)) continue;

        // Rule 2: No duplicate prop types in a parlay
        if (usedPropTypes.has(propKey)) continue;

        // Rule 3: Max 1 player per team (if team known)
        if (pick.team && usedTeams.has(pick.team.toLowerCase())) continue;

        // Rule 4: Global exposure cap (max 5 per player+prop across all parlays)
        if ((globalPlayerPropCount.get(globalKey) || 0) >= MAX_PLAYER_PROP_EXPOSURE) continue;

        // Limit player+prop reuse across parlays (max 2 per parlay index)
        const usageCount = [...usedInParlay].filter(k => k.startsWith(globalKey)).length;
        if (usageCount >= 2) continue;

        parlay.push(pick);
        usedPlayers.add(playerKey);
        usedPropTypes.add(propKey);
        if (pick.team) usedTeams.add(pick.team.toLowerCase());
      }

      if (parlay.length === LEGS_PER_PARLAY) {
        // Check this exact combination isn't a duplicate
        const comboKey = parlay.map(p => `${p.player_name}|${p.prop_type}`).sort().join('::');
        const isDuplicate = parlays.some(existing => {
          const existKey = existing.map(p => `${p.player_name}|${p.prop_type}`).sort().join('::');
          return existKey === comboKey;
        });

        if (!isDuplicate) {
          parlays.push(parlay);
          for (const p of parlay) {
            const globalKey = `${p.player_name.toLowerCase()}|${normalizePropType(p.prop_type)}`;
            usedInParlay.add(`${globalKey}|${parlays.length - 1}`);
            globalPlayerPropCount.set(globalKey, (globalPlayerPropCount.get(globalKey) || 0) + 1);
          }
        }
      }

      // Shuffle picks slightly for next attempt to get variety
      if (parlays.length < MAX_PARLAYS) {
        // Move top picks down occasionally for variety
        const shuffleIdx = Math.floor(Math.random() * Math.min(picks.length, 10));
        if (shuffleIdx > 0) {
          const [removed] = picks.splice(shuffleIdx, 1);
          picks.unshift(removed);
        }
      }
    }

    console.log(`[ForceFresh] Built ${parlays.length} 3-leg parlays`);

    if (parlays.length === 0) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Could not build any valid 3-leg parlays from available picks',
        voided: voidedCount,
        availablePicks: picks.length,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Step 5: Insert into bot_daily_parlays
    const insertRows = parlays.map((parlay, idx) => {
      const avgScore = parlay.reduce((s, p) => s + p.convictionScore, 0) / parlay.length;
      const combinedProb = parlay.reduce((prob, p) => {
        // Estimate probability from edge
        const baseProb = 0.55 + (Math.abs(p.edge_pct) / 500);
        return prob * Math.min(baseProb, 0.85);
      }, 1);

      return {
        parlay_date: today,
        strategy_name: 'force_mispriced_conviction',
        leg_count: 3,
        legs: parlay.map(p => ({
          player_name: p.player_name,
          prop_type: p.prop_type,
          side: p.signal.toLowerCase(),
          line: p.book_line,
          edge_pct: p.edge_pct,
          confidence_tier: p.confidence_tier,
          risk_confirmed: p.riskConfirmed,
          player_avg: p.player_avg_l10,
          sport: p.sport,
        })),
        combined_probability: combinedProb,
        expected_odds: combinedProb > 0 ? Math.round(1 / combinedProb * 100) : 300,
        selection_rationale: `Force-generated conviction parlay #${idx + 1}. Avg score: ${avgScore.toFixed(1)}. ${parlay.filter(p => p.riskConfirmed).length}/${parlay.length} risk-confirmed.`,
        tier: 'execution',
        is_simulated: true,
        simulated_stake: stakeConfig?.execution_stake ?? 500,
      };
    });

    const { data: inserted, error: insertErr } = await supabase
      .from('bot_daily_parlays')
      .insert(insertRows)
      .select('id');

    if (insertErr) {
      console.error(`[ForceFresh] Insert error:`, insertErr);
      throw new Error(`Failed to insert parlays: ${insertErr.message}`);
    }

    console.log(`[ForceFresh] Inserted ${inserted?.length || 0} parlays`);

    // Step 6: Send to Telegram
    const telegramData = {
      parlays: parlays.map((parlay, idx) => ({
        index: idx + 1,
        avgScore: parlay.reduce((s, p) => s + p.convictionScore, 0) / parlay.length,
        riskConfirmedCount: parlay.filter(p => p.riskConfirmed).length,
        legs: parlay.map(p => ({
          player_name: p.player_name,
          prop_type: p.prop_type,
          signal: p.signal,
          book_line: p.book_line,
          edge_pct: p.edge_pct,
          confidence_tier: p.confidence_tier,
          risk_confirmed: p.riskConfirmed,
          player_avg: p.player_avg_l10,
        })),
      })),
      totalParlays: parlays.length,
      voidedCount,
      totalPicks: picks.length,
    };

    try {
      const teleResp = await fetch(`${supabaseUrl}/functions/v1/bot-send-telegram`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'fresh_slate_report',
          data: telegramData,
        }),
      });
      const teleResult = await teleResp.json();
      console.log(`[ForceFresh] Telegram sent:`, teleResult.success);
    } catch (teleErr) {
      console.error(`[ForceFresh] Telegram failed:`, teleErr);
    }

    return new Response(JSON.stringify({
      success: true,
      parlaysGenerated: parlays.length,
      voidedParlays: voidedCount,
      totalPicks: picks.length,
      parlays: telegramData.parlays,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ForceFresh] Error:`, msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
