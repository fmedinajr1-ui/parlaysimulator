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
  return raw.replace(/^(player_|batter_|pitcher_)/, '').toLowerCase().trim();
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

    // Step 1: Void existing pending parlays for today
    const { data: existingParlays, error: voidErr } = await supabase
      .from('bot_daily_parlays')
      .update({ outcome: 'void', lesson_learned: 'Voided by force-fresh regeneration' })
      .eq('parlay_date', today)
      .is('outcome', null)
      .select('id');

    const voidedCount = existingParlays?.length || 0;
    console.log(`[ForceFresh] Voided ${voidedCount} existing pending parlays`);

    // Step 2: Fetch mispriced lines (ELITE + HIGH, edge >= 50%)
    const [mispricedResult, riskResult] = await Promise.all([
      supabase.from('mispriced_lines')
        .select('player_name, prop_type, signal, edge_pct, confidence_tier, book_line, player_avg_l10, sport')
        .eq('analysis_date', today)
        .in('confidence_tier', ['ELITE', 'HIGH'])
        .gt('book_line', 0)
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

    // Filter out blocked prop types (e.g. steals with 0% win rate)
    const BLOCKED_PROP_TYPES = new Set(['player_steals', 'player_blocks']);
    const preFilterCount = mispricedLines.length;
    const filteredLines = mispricedLines.filter(ml => {
      const propType = (ml.prop_type || '').toLowerCase();
      if (BLOCKED_PROP_TYPES.has(propType)) {
        console.log(`[BlockedPropType] Filtered ${propType} pick for ${ml.player_name}`);
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
      const edgeMag = Math.abs(ml.edge_pct);
      const tierBonus = ml.confidence_tier === 'ELITE' ? 20 : 10;
      const riskBonus = riskConfirmed ? 25 : (riskMatch ? 5 : 0);
      const underBonus = ml.signal === 'UNDER' ? 10 : 0;
      const convictionScore = Math.min(edgeMag * 0.3 + tierBonus + riskBonus + underBonus, 100);

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
    const MAX_PARLAYS = 8;
    const LEGS_PER_PARLAY = 3;

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

        // Rule 1: No duplicate players in a parlay
        if (usedPlayers.has(playerKey)) continue;

        // Rule 2: No duplicate prop types in a parlay
        if (usedPropTypes.has(propKey)) continue;

        // Rule 3: Max 1 player per team (if team known)
        if (pick.team && usedTeams.has(pick.team.toLowerCase())) continue;

        // Limit player+prop reuse across parlays (max 2)
        const globalKey = `${playerKey}|${propKey}`;
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
            usedInParlay.add(`${p.player_name.toLowerCase()}|${normalizePropType(p.prop_type)}|${parlays.length - 1}`);
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
        simulated_stake: 10,
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
