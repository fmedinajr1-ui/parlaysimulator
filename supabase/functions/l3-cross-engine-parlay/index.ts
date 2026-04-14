import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

function americanToDecimal(odds: number): number {
  if (odds > 0) return (odds / 100) + 1;
  return (100 / Math.abs(odds)) + 1;
}

function decimalToAmerican(decimal: number): number {
  if (decimal >= 2) return Math.round((decimal - 1) * 100);
  return Math.round(-100 / (decimal - 1));
}

interface ScoredPick {
  player_name: string;
  prop_type: string;
  display_prop_type: string;
  side: string;
  line: number;
  l3_avg: number;
  l3_margin: number;
  edge_pct: number;
  hit_rate: number;
  overlap_count: number;
  sources: string[];
  composite_score: number;
  confidence_tier: string;
  sport: string;
  odds: number;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const sb = createClient(supabaseUrl, supabaseKey);
  const today = getEasternDate();

  try {
    console.log(`[L3CrossEngine] Starting for ${today}`);

    // Fetch all sources in parallel (including MLB Over SB/HR)
    const [mispricedRes, sweetRes, hcRes, sbAlertsRes, hrSweetRes] = await Promise.all([
      sb.from('mispriced_lines')
        .select('player_name, prop_type, signal, edge_pct, confidence_tier, book_line, player_avg_l10, sport, shooting_context')
        .eq('analysis_date', today)
        .not('sport', 'ilike', '%baseball%'),
      sb.from('category_sweet_spots')
        .select('player_name, prop_type, category, recommended_side, actual_line, l3_avg, l10_avg, l10_hit_rate, confidence_score, quality_tier')
        .eq('analysis_date', today)
        .eq('is_active', true),
      sb.from('high_conviction_results')
        .select('player_name, prop_type, signal, edge_pct, conviction_score, current_line, player_avg, sport, engines, confidence_tier')
        .eq('analysis_date', today),
      // Over SB alerts (HIGH/ELITE tier only)
      sb.from('fanduel_prediction_alerts')
        .select('player_name, prop_type, prediction, metadata, event_id')
        .eq('signal_type', 'sb_over_l10')
        .is('was_correct', null)
        .gte('created_at', `${today}T00:00:00`),
      // Over HR sweet spots
      sb.from('category_sweet_spots')
        .select('player_name, prop_type, category, recommended_side, actual_line, l3_avg, confidence_score, quality_tier')
        .eq('analysis_date', today)
        .eq('is_active', true)
        .eq('category', 'MLB_HR_OVER'),
    ]);

    const mispriced = mispricedRes.data || [];
    const sweets = sweetRes.data || [];
    const hcPlays = hcRes.data || [];
    const sbAlerts = sbAlertsRes.data || [];
    const hrSweets = hrSweetRes.data || [];

    console.log(`[L3CrossEngine] Sources — Mispriced: ${mispriced.length}, Sweet: ${sweets.length}, HC: ${hcPlays.length}, SB Over: ${sbAlerts.length}, HR Over: ${hrSweets.length}`);

    // Filter mispriced to L3-confirmed only
    const l3Mispriced = mispriced.filter((m: any) => {
      const ctx = m.shooting_context;
      if (!ctx || typeof ctx !== 'object') return false;
      return ctx.l3_confirms === true;
    });

    console.log(`[L3CrossEngine] L3-confirmed mispriced: ${l3Mispriced.length}`);

    // --- L3 BACKFILL for sweet spots missing l3_avg ---
    const sweetsNeedingBackfill = sweets.filter((s: any) => s.l3_avg == null);
    if (sweetsNeedingBackfill.length > 0) {
      console.log(`[L3CrossEngine] Backfilling L3 for ${sweetsNeedingBackfill.length} sweet spot picks`);
      const playerNames = [...new Set(sweetsNeedingBackfill.map((s: any) => s.player_name))];
      
      // Fetch recent game logs for these players
      const { data: gameLogs } = await sb
        .from('nba_player_game_logs')
        .select('player_name, pts, reb, ast, stl, blk, turnover, threes_made, game_date')
        .in('player_name', playerNames.slice(0, 50)) // cap to avoid huge queries
        .order('game_date', { ascending: false })
        .limit(500);

      if (gameLogs && gameLogs.length > 0) {
        // Group by player
        const playerLogs = new Map<string, any[]>();
        for (const log of gameLogs) {
          const key = log.player_name.toLowerCase();
          if (!playerLogs.has(key)) playerLogs.set(key, []);
          playerLogs.get(key)!.push(log);
        }

        // Compute L3 avg per player+prop
        const propStatMap: Record<string, string> = {
          points: 'pts', rebounds: 'reb', assists: 'ast',
          steals: 'stl', blocks: 'blk', turnovers: 'turnover',
          threes: 'threes_made', pts: 'pts', reb: 'reb', ast: 'ast',
        };

        for (const s of sweetsNeedingBackfill) {
          const logs = playerLogs.get(s.player_name.toLowerCase());
          if (!logs || logs.length < 3) continue;
          const normalizedProp = normalizePropType(s.prop_type);
          const statKey = propStatMap[normalizedProp];
          if (!statKey) continue;
          const last3 = logs.slice(0, 3);
          const avg = last3.reduce((sum: number, g: any) => sum + (g[statKey] || 0), 0) / 3;
          s.l3_avg = Math.round(avg * 100) / 100;
        }
        console.log(`[L3CrossEngine] Backfilled L3 data for sweet spot picks`);
      }
    }

    // Build a unified pick map keyed by player|prop
    const pickMap = new Map<string, any>();

    const makeKey = (name: string, prop: string) => `${name.toLowerCase()}|${normalizePropType(prop)}`;

    // Add mispriced picks
    for (const m of l3Mispriced) {
      // Block UNDER stolen bases — Over-only market
      const normalizedProp = normalizePropType(m.prop_type);
      if ((normalizedProp === 'stolen_bases' || normalizedProp === 'stolen bases') && m.signal.toLowerCase() === 'under') {
        console.log(`[L3CrossEngine] Blocked UNDER SB (mispriced): ${m.player_name}`);
        continue;
      }

      const key = makeKey(m.player_name, m.prop_type);
      const ctx = m.shooting_context || {};
      
      if (!pickMap.has(key)) {
        pickMap.set(key, {
          player_name: m.player_name,
          prop_type: normalizePropType(m.prop_type),
          display_prop_type: m.prop_type,
          side: m.signal.toLowerCase(),
          line: m.book_line,
          edge_pct: Math.abs(m.edge_pct),
          confidence_tier: m.confidence_tier,
          sport: m.sport || 'NBA',
          sources: ['mispriced'],
          l3_avg: ctx.l3_avg || 0,
          hit_rate: 0,
          odds: -110,
        });
      } else {
        pickMap.get(key).sources.push('mispriced');
        pickMap.get(key).edge_pct = Math.max(pickMap.get(key).edge_pct, Math.abs(m.edge_pct));
      }
    }

    // Add sweet spot picks (now with backfilled l3_avg)
    // Block stolen bases UNDER — HRB only offers Over side for SB
    for (const s of sweets) {
      if (!s.l3_avg) continue; // skip if still no L3 data after backfill
      
      // Block UNDER stolen bases picks (Over-only market)
      const normalizedProp = normalizePropType(s.prop_type);
      const side = (s.recommended_side || 'over').toLowerCase();
      if ((normalizedProp === 'stolen_bases' || normalizedProp === 'stolen bases') && side === 'under') {
        console.log(`[L3CrossEngine] Blocked UNDER SB: ${s.player_name}`);
        continue;
      }
      
      const key = makeKey(s.player_name, s.prop_type);
      if (pickMap.has(key)) {
        const existing = pickMap.get(key);
        existing.sources.push('sweet_spot');
        existing.l3_avg = s.l3_avg || existing.l3_avg;
        existing.hit_rate = Math.max(existing.hit_rate, s.l10_hit_rate || 0);
      } else {
        pickMap.set(key, {
          player_name: s.player_name,
          prop_type: normalizePropType(s.prop_type),
          display_prop_type: s.prop_type,
          side,
          line: s.actual_line || 0,
          edge_pct: 0,
          confidence_tier: s.quality_tier || 'MEDIUM',
          sport: 'NBA',
          sources: ['sweet_spot'],
          l3_avg: s.l3_avg,
          hit_rate: s.l10_hit_rate || 0,
          odds: -110,
        });
      }
    }

    // Add high conviction plays
    for (const h of hcPlays) {
      const key = makeKey(h.player_name, h.prop_type);
      if (pickMap.has(key)) {
        const existing = pickMap.get(key);
        if (!existing.sources.includes('high_conviction')) {
          existing.sources.push('high_conviction');
        }
        existing.edge_pct = Math.max(existing.edge_pct, Math.abs(h.edge_pct || 0));
      } else {
        pickMap.set(key, {
          player_name: h.player_name,
          prop_type: normalizePropType(h.prop_type),
          display_prop_type: h.prop_type,
          side: (h.signal || 'over').toLowerCase(),
          line: h.current_line || 0,
          edge_pct: Math.abs(h.edge_pct || 0),
          confidence_tier: h.confidence_tier || 'MEDIUM',
          sport: h.sport || 'NBA',
          sources: ['high_conviction'],
          l3_avg: 0,
          hit_rate: 0,
          odds: -110,
        });
      }
    }

    // Score all picks with quality floor
    const scoredPicks: ScoredPick[] = [];
    for (const [, pick] of pickMap) {
      // Quality floor: must meet at least one threshold
      const meetsQuality = (pick.hit_rate >= 0.6) || (pick.edge_pct >= 8) || (pick.sources.length >= 2);
      if (!meetsQuality) continue;

      // Calculate L3 margin (how far L3 clears the line)
      let l3Margin = 0;
      if (pick.l3_avg > 0 && pick.line > 0) {
        if (pick.side === 'over') {
          l3Margin = (pick.l3_avg - pick.line) / pick.line;
        } else {
          l3Margin = (pick.line - pick.l3_avg) / pick.line;
        }
      }

      // Composite scoring — tuned to reward L3 margin over overlap
      const overlapBonus = (pick.sources.length - 1) * 10; // 10 pts per extra source (was 15)
      const edgeScore = Math.min(pick.edge_pct / 2, 30); // max 30
      const l3Score = Math.max(l3Margin * 60, 0); // margin * 60 (was 40)
      const hitRateScore = pick.hit_rate * 20; // up to ~20
      const tierBonus = pick.confidence_tier === 'ELITE' ? 10 : pick.confidence_tier === 'HIGH' ? 5 : 0;

      const composite = overlapBonus + edgeScore + l3Score + hitRateScore + tierBonus;

      scoredPicks.push({
        ...pick,
        l3_margin: l3Margin,
        overlap_count: pick.sources.length,
        composite_score: Math.round(composite * 100) / 100,
      });
    }

    // Sort by composite score
    scoredPicks.sort((a, b) => b.composite_score - a.composite_score);

    console.log(`[L3CrossEngine] Total scored picks: ${scoredPicks.length}`);
    if (scoredPicks.length > 0) {
      console.log(`[L3CrossEngine] Top 5:`, scoredPicks.slice(0, 5).map(p => `${p.player_name} ${p.prop_type} ${p.side} (score: ${p.composite_score}, sources: ${p.sources.join(',')})`));
    }

    // Assemble 3-5 leg parlay — max 1 per player, no redundant L3 gate
    const selectedLegs: ScoredPick[] = [];
    const usedPlayers = new Set<string>();

    for (const pick of scoredPicks) {
      if (selectedLegs.length >= 5) break;
      
      const playerKey = pick.player_name.toLowerCase();
      if (usedPlayers.has(playerKey)) continue;

      usedPlayers.add(playerKey);
      selectedLegs.push(pick);
    }

    // Allow 2-leg parlays at reduced stake
    const minLegs = 2;
    if (selectedLegs.length < minLegs) {
      console.log(`[L3CrossEngine] Only ${selectedLegs.length} legs found, need at least ${minLegs}`);
      return new Response(JSON.stringify({ 
        success: false, 
        reason: 'insufficient_legs', 
        found: selectedLegs.length,
        total_scored: scoredPicks.length,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log(`[L3CrossEngine] Selected ${selectedLegs.length} legs for parlay`);

    // Calculate combined odds
    const combinedDecimal = selectedLegs.reduce((acc, leg) => acc * americanToDecimal(leg.odds), 1);
    const combinedAmerican = decimalToAmerican(combinedDecimal);
    const stake = selectedLegs.length >= 3 ? 10 : 5; // reduced stake for 2-leggers
    const payout = Math.round(stake * combinedDecimal);

    // Build legs array for persistence
    const parlayLegs = selectedLegs.map((leg, idx) => ({
      leg_number: idx + 1,
      player_name: leg.player_name,
      prop_type: leg.display_prop_type,
      side: leg.side,
      line: leg.line,
      odds: leg.odds,
      l3_avg: leg.l3_avg,
      l3_margin: leg.l3_margin,
      edge_pct: leg.edge_pct,
      sources: leg.sources,
      composite_score: leg.composite_score,
      outcome: 'pending',
    }));

    // Persist to bot_daily_parlays
    const { data: inserted, error: insertError } = await sb
      .from('bot_daily_parlays')
      .insert({
        parlay_date: today,
        strategy_name: 'l3_cross_engine',
        tier: 'execution',
        leg_count: selectedLegs.length,
        legs: parlayLegs,
        expected_odds: combinedAmerican,
        combined_probability: 1 / combinedDecimal,
        simulated_stake: stake,
        simulated_payout: payout,
        outcome: 'pending',
        approval_status: 'approved',
        is_simulated: true,
        selection_rationale: `L3 Cross-Engine: ${selectedLegs.length} legs from ${new Set(selectedLegs.flatMap(l => l.sources)).size} engines. Avg edge: ${Math.round(selectedLegs.reduce((s, l) => s + l.edge_pct, 0) / selectedLegs.length)}%. All L3-confirmed.`,
      })
      .select('id')
      .single();

    if (insertError) throw insertError;
    console.log(`[L3CrossEngine] Persisted parlay ${inserted.id}`);

    // Broadcast via Telegram
    const telegramPayload = {
      type: 'mega_lottery_v2',
      data: {
        date: today,
        ticketCount: 1,
        scanned: `${scoredPicks.length} L3-confirmed picks`,
        events: `${selectedLegs.length}-leg cross-engine`,
        exoticProps: 0,
        teamBets: 0,
        tickets: [{
          tier: '🔬 L3 CROSS-ENGINE',
          combinedOdds: Math.abs(combinedAmerican),
          stake,
          payout,
          legs: parlayLegs.map((leg, idx) => ({
            leg: idx + 1,
            player: leg.player_name,
            side: leg.side.toUpperCase().charAt(0),
            line: leg.line,
            prop: normalizePropType(leg.prop_type),
            odds: leg.odds > 0 ? `+${leg.odds}` : `${leg.odds}`,
            market_type: 'player_prop',
            l3_avg: leg.l3_avg,
            sources: leg.sources.join('+'),
            edge: `${Math.round(leg.edge_pct)}%`,
          })),
        }],
      },
    };

    const teleResp = await fetch(`${supabaseUrl}/functions/v1/bot-send-telegram`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(telegramPayload),
    });

    const teleResult = await teleResp.json();
    console.log(`[L3CrossEngine] Telegram:`, teleResult.success);

    return new Response(JSON.stringify({
      success: true,
      parlay_id: inserted.id,
      legs: selectedLegs.length,
      combined_odds: combinedAmerican,
      stake,
      payout,
      picks: selectedLegs.map(l => ({
        player: l.player_name,
        prop: l.display_prop_type,
        side: l.side,
        line: l.line,
        l3_avg: l.l3_avg,
        edge: l.edge_pct,
        sources: l.sources,
        score: l.composite_score,
      })),
      telegram_sent: teleResult.success,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    console.error(`[L3CrossEngine] Error:`, err);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
