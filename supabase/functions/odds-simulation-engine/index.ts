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

function americanToImplied(odds: number): number {
  return odds > 0 ? 100 / (odds + 100) : -odds / (-odds + 100);
}

function clamp(min: number, max: number, v: number): number {
  return Math.max(min, Math.min(max, v));
}

// ============= SPORT-SPECIFIC SCORING (mirrors bot-generate-daily-parlays) =============

interface GameBet {
  id: string;
  game_id: string;
  sport: string;
  home_team: string;
  away_team: string;
  bet_type: string;
  line?: number;
  home_odds?: number;
  away_odds?: number;
  over_odds?: number;
  under_odds?: number;
  sharp_score?: number;
  commence_time: string;
}

function scoreGame(
  game: GameBet,
  betType: string,
  side: string,
  nhlStats: Map<string, any>,
  baseballStats: Map<string, any>
): { score: number; breakdown: Record<string, number> } {
  const sport = (game.sport || '').toLowerCase();
  
  if (sport.includes('nhl') || sport.includes('icehockey')) {
    return scoreNhl(game, betType, side, nhlStats);
  }
  if (sport.includes('baseball')) {
    return scoreBaseball(game, betType, side, baseballStats);
  }
  if (sport.includes('tennis') || sport.includes('pingpong')) {
    return scoreTennis(game, betType, side);
  }
  // Default NBA/WNBA/NCAAB — simple odds-based scoring
  return scoreDefault(game, betType, side);
}

function scoreNhl(game: GameBet, betType: string, side: string, stats: Map<string, any>): { score: number; breakdown: Record<string, number> } {
  let score = 50;
  const bd: Record<string, number> = { base: 50 };
  const resolve = (name: string) => {
    const d = stats.get(name);
    if (d) return d;
    const l = name.toLowerCase();
    for (const [k, v] of stats) {
      if (k.toLowerCase().includes(l) || l.includes(k.toLowerCase())) return v;
    }
    return null;
  };
  const h = resolve(game.home_team);
  const a = resolve(game.away_team);
  if (!h || !a) { bd.no_data = -10; return { score: 40, breakdown: bd }; }

  if (betType === 'total') {
    const avgSave = ((h.save_pct || 0.9) + (a.save_pct || 0.9)) / 2;
    if (side === 'under' && avgSave > 0.910) { const b = clamp(0, 15, Math.round((avgSave - 0.9) * 250)); score += b; bd.save_pct = b; }
    else if (side === 'over' && avgSave < 0.900) { const b = clamp(0, 12, Math.round((0.91 - avgSave) * 200)); score += b; bd.low_save = b; }
    const avgGAA = ((h.goals_against_per_game || 3) + (a.goals_against_per_game || 3)) / 2;
    if (side === 'under' && avgGAA < 2.8) { const b = clamp(0, 12, Math.round((3 - avgGAA) * 30)); score += b; bd.low_gaa = b; }
    else if (side === 'over' && avgGAA > 3.2) { const b = clamp(0, 10, Math.round((avgGAA - 3) * 25)); score += b; bd.high_gaa = b; }
  } else {
    const shotDiff = side === 'home' ? (h.shot_differential || 0) - (a.shot_differential || 0) : (a.shot_differential || 0) - (h.shot_differential || 0);
    const sb = clamp(-12, 12, shotDiff * 1.5); score += sb; bd.shot_diff = sb;
    const sw = side === 'home' ? (h.win_pct || 0.5) : (a.win_pct || 0.5);
    const ow = side === 'home' ? (a.win_pct || 0.5) : (h.win_pct || 0.5);
    if (sw > ow + 0.05) { const b = clamp(0, 8, Math.round((sw - ow) * 60)); score += b; bd.win_edge = b; }
    if (side === 'home') { score += 3; bd.home_ice = 3; }
  }
  return { score: clamp(30, 95, score), breakdown: bd };
}

function scoreBaseball(game: GameBet, betType: string, side: string, stats: Map<string, any>): { score: number; breakdown: Record<string, number> } {
  let score = 50;
  const bd: Record<string, number> = { base: 50 };
  const resolve = (name: string) => {
    const d = stats.get(name);
    if (d) return d;
    const l = name.toLowerCase();
    for (const [k, v] of stats) {
      if (k.toLowerCase().includes(l) || l.includes(k.toLowerCase())) return v;
    }
    return null;
  };
  const h = resolve(game.home_team);
  const a = resolve(game.away_team);
  if (!h || !a) { bd.no_data = -10; return { score: 40, breakdown: bd }; }

  if (betType === 'total') {
    const avgERA = ((h.era || 4.5) + (a.era || 4.5)) / 2;
    if (side === 'under' && avgERA < 3.5) { const b = clamp(0, 15, Math.round((4 - avgERA) * 15)); score += b; bd.low_era = b; }
    else if (side === 'over' && avgERA > 5) { const b = clamp(0, 12, Math.round((avgERA - 4) * 10)); score += b; bd.high_era = b; }
    const cRPG = (h.runs_per_game || 5) + (a.runs_per_game || 5);
    if (side === 'over' && cRPG > 12) { const b = clamp(0, 10, Math.round((cRPG - 10) * 3)); score += b; bd.high_scoring = b; }
    else if (side === 'under' && cRPG < 8) { const b = clamp(0, 10, Math.round((10 - cRPG) * 3)); score += b; bd.low_scoring = b; }
  } else {
    const sERA = side === 'home' ? (h.era || 4.5) : (a.era || 4.5);
    const oERA = side === 'home' ? (a.era || 4.5) : (h.era || 4.5);
    const eraEdge = clamp(-15, 15, (oERA - sERA) * 5); score += eraEdge; bd.era_edge = eraEdge;
    if (side === 'home') { score += 6; bd.home_field = 6; }
    const sRank = side === 'home' ? (h.national_rank || 999) : (a.national_rank || 999);
    const oRank = side === 'home' ? (a.national_rank || 999) : (h.national_rank || 999);
    if (sRank <= 25 && oRank > 50) { score += 8; bd.rank_mismatch = 8; }
  }
  return { score: clamp(30, 95, score), breakdown: bd };
}

function scoreTennis(game: GameBet, betType: string, side: string): { score: number; breakdown: Record<string, number> } {
  let score = 50;
  const bd: Record<string, number> = { base: 50 };
  const sOdds = side === 'home' ? (game.home_odds || -110) : (game.away_odds || -110);
  const sProb = americanToImplied(sOdds);
  const oProb = americanToImplied(side === 'home' ? (game.away_odds || -110) : (game.home_odds || -110));
  if (betType === 'h2h' || betType === 'moneyline') {
    const gap = sProb - oProb;
    if (gap > 0.15) { const b = clamp(0, 12, Math.round(gap * 40)); score += b; bd.ranking_edge = b; }
    if (sProb > 0.75) { score -= 12; bd.heavy_fav = -12; }
    if (sOdds > 0 && sProb > 0.40) { score += 6; bd.plus_money = 6; }
  }
  return { score: clamp(30, 95, score), breakdown: bd };
}

function scoreDefault(game: GameBet, betType: string, side: string): { score: number; breakdown: Record<string, number> } {
  let score = 50;
  const bd: Record<string, number> = { base: 50 };
  const sOdds = side === 'home' ? (game.home_odds || -110) : (game.away_odds || -110);
  const impliedProb = americanToImplied(sOdds);
  if (impliedProb > 0.55 && impliedProb < 0.70) { score += 8; bd.value_range = 8; }
  if (side === 'home') { score += 4; bd.home_adv = 4; }
  if (impliedProb > 0.75) { score -= 10; bd.heavy_fav = -10; }
  return { score: clamp(30, 95, score), breakdown: bd };
}

// ============= MAIN HANDLER =============

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const { mode = 'predict' } = await req.json().catch(() => ({}));
    const today = getEasternDate();
    const SCORING_VERSION = 'v1';
    const ACCURACY_THRESHOLDS = { spread: 0.55, total: 0.55, h2h: 0.52, moneyline: 0.52 };

    if (mode === 'predict') {
      // Load all active game_bets for today
      const startUtc = new Date(`${today}T04:00:00Z`).toISOString();
      const endUtc = new Date(new Date(`${today}T04:00:00Z`).getTime() + 24 * 60 * 60 * 1000).toISOString();

      const { data: games } = await supabase
        .from('game_bets')
        .select('*')
        .eq('is_active', true)
        .gte('commence_time', startUtc)
        .lt('commence_time', endUtc);

      if (!games || games.length === 0) {
        return new Response(JSON.stringify({ mode, message: 'No active games to simulate', picks: 0 }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Load sport-specific stats
      const [nhlResult, baseballResult] = await Promise.all([
        supabase.from('nhl_team_pace_stats').select('*'),
        supabase.from('ncaa_baseball_team_stats').select('*'),
      ]);

      const nhlStats = new Map<string, any>();
      (nhlResult.data || []).forEach((t: any) => { nhlStats.set(t.team_abbrev, t); if (t.team_name) nhlStats.set(t.team_name, t); });
      const baseballStats = new Map<string, any>();
      (baseballResult.data || []).forEach((t: any) => baseballStats.set(t.team_name, t));

      // Check existing shadow picks to avoid duplicates
      const { data: existingPicks } = await supabase
        .from('simulation_shadow_picks')
        .select('event_id, bet_type, side')
        .eq('scoring_version', SCORING_VERSION)
        .gte('created_at', startUtc);

      const existingKeys = new Set((existingPicks || []).map((p: any) => `${p.event_id}_${p.bet_type}_${p.side}`));


      const shadowPicks: any[] = [];

      for (const game of games as GameBet[]) {
        const sides: { betType: string; side: string; odds: number }[] = [];

        if (game.bet_type === 'spread') {
          if (game.home_odds) sides.push({ betType: 'spread', side: 'home', odds: game.home_odds });
          if (game.away_odds) sides.push({ betType: 'spread', side: 'away', odds: game.away_odds });
        }
        if (game.bet_type === 'total') {
          if (game.over_odds) sides.push({ betType: 'total', side: 'over', odds: game.over_odds });
          if (game.under_odds) sides.push({ betType: 'total', side: 'under', odds: game.under_odds });
        }
        if (game.bet_type === 'h2h') {
          if (game.home_odds) sides.push({ betType: 'h2h', side: 'home', odds: game.home_odds });
          if (game.away_odds) sides.push({ betType: 'h2h', side: 'away', odds: game.away_odds });
        }

        for (const { betType, side, odds } of sides) {
          const key = `${game.game_id}_${betType}_${side}`;
          if (existingKeys.has(key)) continue;

          const { score, breakdown } = scoreGame(game, betType, side, nhlStats, baseballStats);

          // Only shadow-pick if score is above 60 (meaningful prediction)
          if (score >= 60) {
            shadowPicks.push({
              sport: game.sport,
              event_id: game.game_id,
              bet_type: betType,
              side,
              predicted_score: score,
              line: game.line || 0,
              odds: Math.round(odds),
              outcome: 'pending',
              scoring_version: SCORING_VERSION,
              score_breakdown: breakdown,
              home_team: game.home_team,
              away_team: game.away_team,
            });
          }
        }
      }

      // Batch insert shadow picks
      if (shadowPicks.length > 0) {
        const { error } = await supabase.from('simulation_shadow_picks').insert(shadowPicks);
        if (error) console.error('[Simulation] Insert error:', error);
      }

      console.log(`[Simulation] Created ${shadowPicks.length} shadow picks from ${games.length} games`);

      return new Response(JSON.stringify({
        mode, date: today,
        gamesScored: games.length,
        shadowPicksCreated: shadowPicks.length,
        bySport: shadowPicks.reduce((acc: Record<string, number>, p) => { acc[p.sport] = (acc[p.sport] || 0) + 1; return acc; }, {}),
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (mode === 'settle') {
      // Settle pending shadow picks by checking game_bets outcomes
      const { data: pendingPicks } = await supabase
        .from('simulation_shadow_picks')
        .select('*')
        .eq('outcome', 'pending')
        .lt('created_at', new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()); // Only settle picks older than 3 hours

      if (!pendingPicks || pendingPicks.length === 0) {
        return new Response(JSON.stringify({ mode, message: 'No pending picks to settle', settled: 0 }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Check game_bets for settled outcomes
      const eventIds = [...new Set(pendingPicks.map((p: any) => p.event_id))];
      const { data: settledGames } = await supabase
        .from('game_bets')
        .select('game_id, bet_type, outcome, home_score, away_score')
        .in('game_id', eventIds)
        .not('outcome', 'is', null);

      const outcomeMap = new Map<string, any>();
      (settledGames || []).forEach((g: any) => {
        outcomeMap.set(`${g.game_id}_${g.bet_type}`, g);
      });

      let settledCount = 0;
      for (const pick of pendingPicks) {
        const gameResult = outcomeMap.get(`${pick.event_id}_${pick.bet_type}`);
        if (!gameResult) continue;

        let outcome = 'push';
        const homeScore = gameResult.home_score;
        const awayScore = gameResult.away_score;

        if (homeScore !== null && awayScore !== null) {
          const totalScore = homeScore + awayScore;
          const spreadDiff = homeScore - awayScore;

          if (pick.bet_type === 'total') {
            if (pick.side === 'over') outcome = totalScore > pick.line ? 'won' : totalScore < pick.line ? 'lost' : 'push';
            else outcome = totalScore < pick.line ? 'won' : totalScore > pick.line ? 'lost' : 'push';
          } else if (pick.bet_type === 'spread') {
            const adjustedDiff = spreadDiff + (pick.side === 'home' ? 0 : 0); // line already reflects side
            if (pick.side === 'home') outcome = spreadDiff + pick.line > 0 ? 'won' : spreadDiff + pick.line < 0 ? 'lost' : 'push';
            else outcome = -spreadDiff - pick.line > 0 ? 'won' : -spreadDiff - pick.line < 0 ? 'lost' : 'push';
          } else if (pick.bet_type === 'h2h') {
            if (pick.side === 'home') outcome = homeScore > awayScore ? 'won' : 'lost';
            else outcome = awayScore > homeScore ? 'won' : 'lost';
          }
        } else if (gameResult.outcome) {
          // Fallback to game-level outcome
          outcome = gameResult.outcome === 'home' && pick.side === 'home' ? 'won'
            : gameResult.outcome === 'away' && pick.side === 'away' ? 'won'
            : gameResult.outcome === 'push' ? 'push' : 'lost';
        } else {
          continue; // Can't determine outcome yet
        }

        await supabase
          .from('simulation_shadow_picks')
          .update({ outcome, settled_at: new Date().toISOString() })
          .eq('id', pick.id);
        settledCount++;
      }

      // Update accuracy aggregates
      await updateAccuracyAggregates(supabase, SCORING_VERSION, ACCURACY_THRESHOLDS);

      console.log(`[Simulation] Settled ${settledCount}/${pendingPicks.length} picks`);

      return new Response(JSON.stringify({ mode, settled: settledCount, pending: pendingPicks.length }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (mode === 'report') {
      const { data: accuracy } = await supabase
        .from('simulation_accuracy')
        .select('*')
        .order('accuracy_rate', { ascending: false });

      const { data: recentPicks } = await supabase
        .from('simulation_shadow_picks')
        .select('sport, bet_type, outcome, predicted_score')
        .neq('outcome', 'pending')
        .order('created_at', { ascending: false })
        .limit(500);

      // Calculate live stats
      const sportStats: Record<string, { total: number; won: number; avgScore: number }> = {};
      for (const p of (recentPicks || [])) {
        const key = `${p.sport}__${p.bet_type}`;
        if (!sportStats[key]) sportStats[key] = { total: 0, won: 0, avgScore: 0 };
        sportStats[key].total++;
        if (p.outcome === 'won') sportStats[key].won++;
        sportStats[key].avgScore += p.predicted_score;
      }
      for (const key of Object.keys(sportStats)) {
        sportStats[key].avgScore = Math.round(sportStats[key].avgScore / sportStats[key].total * 100) / 100;
      }

      return new Response(JSON.stringify({
        mode,
        storedAccuracy: accuracy || [],
        liveStats: sportStats,
        totalSettled: (recentPicks || []).length,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ error: `Unknown mode: ${mode}` }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Simulation] Error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function updateAccuracyAggregates(supabase: any, scoringVersion: string, thresholds: Record<string, number>) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: settled } = await supabase
    .from('simulation_shadow_picks')
    .select('sport, bet_type, outcome, predicted_score')
    .neq('outcome', 'pending')
    .eq('scoring_version', scoringVersion)
    .gte('created_at', thirtyDaysAgo);

  if (!settled || settled.length === 0) return;

  const groups: Record<string, { total: number; won: number; totalScore: number }> = {};
  for (const p of settled) {
    const key = `${p.sport}__${p.bet_type}`;
    if (!groups[key]) groups[key] = { total: 0, won: 0, totalScore: 0 };
    groups[key].total++;
    if (p.outcome === 'won') groups[key].won++;
    groups[key].totalScore += p.predicted_score;
  }

  const today = getEasternDate();
  const periodStart = thirtyDaysAgo.split('T')[0];

  for (const [key, stats] of Object.entries(groups)) {
    const [sport, betType] = key.split('__');
    const accuracyRate = stats.total > 0 ? stats.won / stats.total : 0;
    const threshold = thresholds[betType] || 0.55;

    await supabase.from('simulation_accuracy').upsert({
      sport,
      bet_type: betType,
      scoring_version: scoringVersion,
      predictions_made: stats.total,
      predictions_correct: stats.won,
      accuracy_rate: Math.round(accuracyRate * 10000) / 10000,
      avg_composite_score: Math.round(stats.totalScore / stats.total * 100) / 100,
      period_start: periodStart,
      period_end: today,
      is_production_ready: accuracyRate >= threshold && stats.total >= 20,
    }, { onConflict: 'sport,bet_type,scoring_version,period_start,period_end' });
  }

  console.log(`[Simulation] Updated accuracy for ${Object.keys(groups).length} sport/bet_type combos`);
}
