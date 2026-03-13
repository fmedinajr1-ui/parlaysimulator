import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function getEasternDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

/**
 * scanlines-game-markets
 * 
 * Scans FanDuel moneylines + totals across all sports.
 * Inserts snapshots for drift tracking.
 * Cross-refs KenPom for NCAAB + whale_picks for convergence.
 * Stores top signals to mispriced_lines for /scanlines reporting.
 */

interface GameMarket {
  game_id: string;
  sport: string;
  bet_type: string;
  home_team: string;
  away_team: string;
  line: number | null;
  home_odds: number | null;
  away_odds: number | null;
  over_odds: number | null;
  under_odds: number | null;
  commence_time: string;
  composite_score: number | null;
  recommended_side: string | null;
  sharp_score: number | null;
}

interface ScoredMarket {
  game_id: string;
  sport: string;
  bet_type: string;
  home_team: string;
  away_team: string;
  fanduel_line: number | null;
  commence_time: string;
  edge_pct: number;
  signal: string;
  confidence_tier: string;
  drift_amount: number;
  drift_direction: string | null;
  whale_convergence: boolean;
  kenpom_projected?: number;
  kenpom_context?: Record<string, any>;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);
  const today = getEasternDate();

  try {
    console.log('[ScanlineGM] Starting game market scan...');

    // ==================== STEP 1: FETCH FANDUEL GAME MARKETS ====================
    const { data: fdMoneylines } = await supabase
      .from('game_bets')
      .select('game_id, sport, bet_type, home_team, away_team, line, home_odds, away_odds, over_odds, under_odds, commence_time, composite_score, recommended_side, sharp_score')
      .ilike('bookmaker', '%fanduel%')
      .eq('bet_type', 'h2h')
      .eq('is_active', true)
      .gte('commence_time', new Date().toISOString());

    const { data: fdTotals } = await supabase
      .from('game_bets')
      .select('game_id, sport, bet_type, home_team, away_team, line, home_odds, away_odds, over_odds, under_odds, commence_time, composite_score, recommended_side, sharp_score')
      .ilike('bookmaker', '%fanduel%')
      .eq('bet_type', 'total')
      .eq('is_active', true)
      .gte('commence_time', new Date().toISOString());

    const allMarkets: GameMarket[] = [
      ...(fdMoneylines || []).map(m => ({ ...m, bet_type: 'moneyline' })),
      ...(fdTotals || []).map(m => ({ ...m, bet_type: 'total' })),
    ];

    console.log(`[ScanlineGM] Found ${fdMoneylines?.length || 0} FD moneylines, ${fdTotals?.length || 0} FD totals`);

    if (allMarkets.length === 0) {
      return new Response(JSON.stringify({ success: true, message: 'No FanDuel markets found' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ==================== STEP 2: INSERT SNAPSHOTS ====================
    const snapshotRows = allMarkets.map(m => ({
      game_id: m.game_id,
      sport: m.sport,
      bet_type: m.bet_type,
      home_team: m.home_team,
      away_team: m.away_team,
      fanduel_line: m.line,
      fanduel_home_odds: m.home_odds ? Math.round(m.home_odds) : null,
      fanduel_away_odds: m.away_odds ? Math.round(m.away_odds) : null,
      fanduel_over_odds: m.over_odds ? Math.round(m.over_odds) : null,
      fanduel_under_odds: m.under_odds ? Math.round(m.under_odds) : null,
      commence_time: m.commence_time,
      analysis_date: today,
    }));

    for (let i = 0; i < snapshotRows.length; i += 50) {
      const chunk = snapshotRows.slice(i, i + 50);
      const { error } = await supabase.from('game_market_snapshots').insert(chunk);
      if (error) console.error('[ScanlineGM] Snapshot insert error:', error.message);
    }
    console.log(`[ScanlineGM] Inserted ${snapshotRows.length} snapshots`);

    // ==================== STEP 3: CALCULATE DRIFT ====================
    // Get earliest snapshots for today to compare
    const { data: earliestSnapshots } = await supabase
      .from('game_market_snapshots')
      .select('game_id, bet_type, fanduel_line, fanduel_home_odds, fanduel_away_odds, scan_time')
      .eq('analysis_date', today)
      .order('scan_time', { ascending: true });

    // Build map of earliest line per game+bet_type
    const earliestMap = new Map<string, { line: number | null; home_odds: number | null; away_odds: number | null; time: string }>();
    for (const s of earliestSnapshots || []) {
      const key = `${s.game_id}|${s.bet_type}`;
      if (!earliestMap.has(key)) {
        earliestMap.set(key, { line: s.fanduel_line, home_odds: s.fanduel_home_odds, away_odds: s.fanduel_away_odds, time: s.scan_time });
      }
    }

    // ==================== STEP 4: LOAD NCAAB KENPOM ====================
    const { data: ncaabStats } = await supabase
      .from('ncaab_team_stats')
      .select('team_name, kenpom_adj_o, kenpom_adj_d, adj_tempo, kenpom_rank, over_under_record, ats_record, conference');

    const ncaabMap = new Map<string, any>();
    for (const t of ncaabStats || []) {
      ncaabMap.set(t.team_name?.toLowerCase(), t);
    }

    // ==================== STEP 5: LOAD WHALE PICKS ====================
    const { data: whales } = await supabase
      .from('whale_picks')
      .select('player_name, stat_type, pick_side, sharp_score, sport, confidence')
      .eq('is_expired', false)
      .gte('sharp_score', 50);

    // Build whale lookup by matchup string or game key
    const whaleGameMap = new Map<string, any[]>();
    for (const w of whales || []) {
      // whale_picks player_name for team bets often contains "Team1 @ Team2" or similar
      const key = (w.player_name || '').toLowerCase();
      if (!whaleGameMap.has(key)) whaleGameMap.set(key, []);
      whaleGameMap.get(key)!.push(w);
    }

    // ==================== STEP 6: SCORE EACH MARKET ====================
    const scored: ScoredMarket[] = [];

    for (const m of allMarkets) {
      const driftKey = `${m.game_id}|${m.bet_type}`;
      const earliest = earliestMap.get(driftKey);

      let driftAmount = 0;
      let driftDirection: string | null = null;

      if (earliest && earliest.line != null && m.line != null) {
        driftAmount = Math.abs(m.line - earliest.line);
        driftDirection = m.line > earliest.line ? 'UP' : m.line < earliest.line ? 'DOWN' : null;
      } else if (earliest && m.bet_type === 'moneyline') {
        // For moneylines, compare odds shift
        const homeShift = Math.abs((m.home_odds || 0) - (earliest.home_odds || 0));
        const awayShift = Math.abs((m.away_odds || 0) - (earliest.away_odds || 0));
        driftAmount = Math.max(homeShift, awayShift);
        if (driftAmount >= 15) {
          driftDirection = (m.home_odds || 0) < (earliest.home_odds || 0) ? 'HOME_STEAM' : 'AWAY_STEAM';
        }
      }

      // Check whale convergence
      const matchupKey1 = `${m.away_team} @ ${m.home_team}`.toLowerCase();
      const matchupKey2 = `${m.away_team} vs ${m.home_team}`.toLowerCase();
      const whaleSignals = whaleGameMap.get(matchupKey1) || whaleGameMap.get(matchupKey2) || [];
      const whaleConvergence = whaleSignals.length > 0;

      // Calculate edge
      let edgePct = 0;
      let signal = m.recommended_side || 'HOLD';
      let kenpomProjected: number | undefined;
      let kenpomContext: Record<string, any> | undefined;

      if (m.bet_type === 'total' && m.line) {
        // For NCAAB: use KenPom projected total
        if (m.sport?.includes('ncaab')) {
          const homeStats = ncaabMap.get(m.home_team?.toLowerCase());
          const awayStats = ncaabMap.get(m.away_team?.toLowerCase());

          if (homeStats && awayStats) {
            const homeO = homeStats.kenpom_adj_o || 100;
            const homeD = homeStats.kenpom_adj_d || 100;
            const awayO = awayStats.kenpom_adj_o || 100;
            const awayD = awayStats.kenpom_adj_d || 100;
            const avgTempo = ((homeStats.adj_tempo || 66) + (awayStats.adj_tempo || 66)) / 2;

            // KenPom projected total: (homeO + awayD)/200 * tempo + (awayO + homeD)/200 * tempo
            const homeProj = (homeO + awayD) / 200 * avgTempo;
            const awayProj = (awayO + homeD) / 200 * avgTempo;
            kenpomProjected = Math.round((homeProj + awayProj) * 10) / 10;

            edgePct = ((kenpomProjected - m.line) / m.line) * 100;
            signal = edgePct > 0 ? 'OVER' : 'UNDER';
            edgePct = Math.abs(edgePct);

            const tempoLabel = avgTempo >= 70 ? 'HIGH' : avgTempo <= 64 ? 'LOW' : 'MED';
            kenpomContext = {
              home_rank: homeStats.kenpom_rank,
              away_rank: awayStats.kenpom_rank,
              tempo: avgTempo,
              tempo_label: tempoLabel,
              home_ou_record: homeStats.over_under_record,
              away_ou_record: awayStats.over_under_record,
              home_ats: homeStats.ats_record,
              away_ats: awayStats.ats_record,
            };
          }
        } else {
          // For other sports: composite_score is 0-100, scale to edge %
          // A score of 60+ is strong (treat as ~8% edge), 50 is neutral
          const cs = m.composite_score || 50;
          edgePct = Math.max(0, (cs - 50) * 0.5); // 60 → 5%, 70 → 10%, 80 → 15%
          signal = (m.recommended_side || 'over').toUpperCase();
          if (signal !== 'OVER' && signal !== 'UNDER') signal = 'OVER';
        }
      } else if (m.bet_type === 'moneyline') {
        // Moneyline edge from composite score (0-100 scale)
        const cs = m.composite_score || 50;
        edgePct = Math.max(0, (cs - 50) * 0.5); // 60 → 5%, 70 → 10%
        // mispriced_lines only allows OVER/UNDER — store real side in shooting_context
        const realSide = (m.recommended_side || 'home').toUpperCase();
        signal = 'OVER'; // placeholder, real side in context
        kenpomContext = { ...(kenpomContext || {}), ml_side: realSide };

        // NCAAB: boost edge for upset-zone matchups
        if (m.sport?.includes('ncaab')) {
          const homeStats = ncaabMap.get(m.home_team?.toLowerCase());
          const awayStats = ncaabMap.get(m.away_team?.toLowerCase());
          if (homeStats?.kenpom_rank && awayStats?.kenpom_rank) {
            const rankGap = Math.abs(homeStats.kenpom_rank - awayStats.kenpom_rank);
            if (rankGap >= 15 && rankGap <= 50) {
              // Upset zone — meaningful gap but not blowout territory
              edgePct *= 1.1;
              kenpomContext = {
                ...kenpomContext,
                home_rank: homeStats.kenpom_rank,
                away_rank: awayStats.kenpom_rank,
                rank_gap: rankGap,
                upset_zone: true,
              };
            }
          }
        }
      }

      // Boost edge for drift convergence
      const isDramaticDrift = (m.bet_type === 'total' && driftAmount >= 1.5) ||
                              (m.bet_type === 'moneyline' && driftAmount >= 15);
      if (isDramaticDrift) edgePct *= 1.15;
      if (whaleConvergence) edgePct *= 1.2;

      // Confidence tier
      let confidenceTier = 'MODERATE';
      if (edgePct >= 10 && (whaleConvergence || isDramaticDrift)) confidenceTier = 'ELITE';
      else if (edgePct >= 7 || (whaleConvergence && edgePct >= 5)) confidenceTier = 'HIGH';

      // Only include if there's a meaningful signal
      if (edgePct >= 3) {
        scored.push({
          game_id: m.game_id,
          sport: m.sport,
          bet_type: m.bet_type,
          home_team: m.home_team,
          away_team: m.away_team,
          fanduel_line: m.line,
          commence_time: m.commence_time,
          edge_pct: Math.round(edgePct * 10) / 10,
          signal,
          confidence_tier: confidenceTier,
          drift_amount: Math.round(driftAmount * 10) / 10,
          drift_direction: driftDirection,
          whale_convergence: whaleConvergence,
          kenpom_projected: kenpomProjected,
          kenpom_context: kenpomContext,
        });
      }
    }

    // Sort by edge (convergence picks first)
    scored.sort((a, b) => {
      const aConv = (a.whale_convergence ? 1 : 0) + (a.drift_amount >= 1.5 ? 1 : 0);
      const bConv = (b.whale_convergence ? 1 : 0) + (b.drift_amount >= 1.5 ? 1 : 0);
      if (aConv !== bConv) return bConv - aConv;
      return b.edge_pct - a.edge_pct;
    });

    console.log(`[ScanlineGM] Scored ${scored.length} actionable markets from ${allMarkets.length} total`);

    // ==================== STEP 7: STORE TO MISPRICED_LINES ====================
    const mispricedRows = scored.slice(0, 20).map(s => ({
      player_name: `${s.away_team} @ ${s.home_team}`,
      prop_type: s.bet_type === 'total' ? 'game_total' : 'game_moneyline',
      signal: s.signal,
      edge_pct: s.edge_pct,
      confidence_tier: s.confidence_tier,
      book_line: s.fanduel_line ?? (s.bet_type === 'moneyline' ? 0 : 0),
      player_avg_l10: s.kenpom_projected || null,
      sport: s.sport,
      analysis_date: today,
      shooting_context: {
        source: 'scanlines_game_markets',
        drift_amount: s.drift_amount,
        drift_direction: s.drift_direction,
        whale_convergence: s.whale_convergence,
        commence_time: s.commence_time,
        ...(s.kenpom_context || {}),
      },
    }));

    if (mispricedRows.length > 0) {
      // Upsert game market entries (unique constraint: player_name, prop_type, analysis_date)
      const { error } = await supabase
        .from('mispriced_lines')
        .upsert(mispricedRows, { onConflict: 'player_name,prop_type,analysis_date' });
      if (error) {
        console.error('[ScanlineGM] mispriced_lines upsert error:', error.message, error.details, error.hint);
      } else {
        console.log(`[ScanlineGM] Upserted ${mispricedRows.length} game market rows to mispriced_lines`);
      }
    }

    // Update drift on snapshots
    for (const s of scored) {
      if (s.drift_amount > 0) {
        await supabase
          .from('game_market_snapshots')
          .update({ drift_amount: s.drift_amount, drift_direction: s.drift_direction })
          .eq('game_id', s.game_id)
          .eq('bet_type', s.bet_type)
          .eq('analysis_date', today)
          .order('scan_time', { ascending: false })
          .limit(1);
      }
    }

    const summary = {
      success: true,
      total_fd_markets: allMarkets.length,
      snapshots_inserted: snapshotRows.length,
      actionable_signals: scored.length,
      elite_signals: scored.filter(s => s.confidence_tier === 'ELITE').length,
      whale_convergence: scored.filter(s => s.whale_convergence).length,
      dramatic_drift: scored.filter(s => (s.bet_type === 'total' && s.drift_amount >= 1.5) || (s.bet_type === 'moneyline' && s.drift_amount >= 15)).length,
      top_5: scored.slice(0, 5).map(s => `${s.away_team}@${s.home_team} ${s.bet_type} ${s.signal} edge:${s.edge_pct}%`),
    };

    console.log('[ScanlineGM] Done:', JSON.stringify(summary));

    await supabase.from('cron_job_history').insert({
      job_name: 'scanlines-game-markets',
      status: 'completed',
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      result: summary,
    });

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[ScanlineGM] Fatal:', msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
