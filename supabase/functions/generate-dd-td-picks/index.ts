import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function getEasternDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function getTomorrowET(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

interface PlayerPattern {
  player_name: string;
  total_games: number;
  total_hits: number;
  hit_rate: number;
  season_rate: number;
  recent_streak: string[]; // last 5 outcomes
  consecutive_hits: number;
  home_hit_rate: number;
  away_hit_rate: number;
  prediction_type: 'DD' | 'TD';
  confidence_tier: 'ELITE' | 'STRONG' | 'TRENDING' | 'RISKY';
  confidence_score: number;
  patterns: string[];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json().catch(() => ({}));
    const targetDate = body.target_date || getTomorrowET();
    const todayET = getEasternDate();

    console.log(`[generate-dd-td-picks] Generating picks for ${targetDate} (today ET: ${todayET})`);

    // ── STEP 1: Analyze all historical DD/TD data ──
    const { data: allPredictions } = await supabase
      .from('dd_td_predictions')
      .select('player_name, prediction_type, outcome, prediction_date, season_rate, is_home, opponent')
      .in('outcome', ['hit', 'miss'])
      .order('prediction_date', { ascending: false });

    if (!allPredictions || allPredictions.length === 0) {
      return new Response(JSON.stringify({ error: 'No historical data' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[generate-dd-td-picks] Analyzing ${allPredictions.length} settled predictions`);

    // ── STEP 2: Build player profiles ──
    const profiles = new Map<string, {
      total: number; hits: number; homeGames: number; homeHits: number;
      awayGames: number; awayHits: number; seasonRate: number;
      recentOutcomes: string[]; type: string;
    }>();

    for (const p of allPredictions) {
      const key = `${p.player_name}_${p.prediction_type}`;
      if (!profiles.has(key)) {
        profiles.set(key, {
          total: 0, hits: 0, homeGames: 0, homeHits: 0,
          awayGames: 0, awayHits: 0, seasonRate: p.season_rate || 0,
          recentOutcomes: [], type: p.prediction_type,
        });
      }
      const prof = profiles.get(key)!;
      prof.total++;
      if (p.outcome === 'hit') prof.hits++;
      if (p.is_home) {
        prof.homeGames++;
        if (p.outcome === 'hit') prof.homeHits++;
      } else {
        prof.awayGames++;
        if (p.outcome === 'hit') prof.awayHits++;
      }
      if (prof.recentOutcomes.length < 5) {
        prof.recentOutcomes.push(p.outcome);
      }
    }

    // ── STEP 3: Identify winning patterns ──
    const playerPatterns: PlayerPattern[] = [];
    const winningPatterns: string[] = [];
    const losingPatterns: string[] = [];

    for (const [key, prof] of profiles) {
      if (prof.total < 3) continue;

      const [playerName, predType] = key.split(/_(?=[^_]+$)/);
      const hitRate = prof.hits / prof.total;
      const homeHitRate = prof.homeGames > 0 ? prof.homeHits / prof.homeGames : 0;
      const awayHitRate = prof.awayGames > 0 ? prof.awayHits / prof.awayGames : 0;

      // Count consecutive recent hits
      let consecutiveHits = 0;
      for (const o of prof.recentOutcomes) {
        if (o === 'hit') consecutiveHits++;
        else break;
      }

      // Calculate confidence score (0-100)
      let score = 0;
      const patterns: string[] = [];

      // Base: season hit rate (max 30pts)
      score += hitRate * 30;

      // Season rate boost (max 20pts) - higher season DD rate = more likely
      score += Math.min(prof.seasonRate * 25, 20);

      // Streak bonus (max 20pts)
      if (consecutiveHits >= 3) { score += 20; patterns.push(`🔥 ${consecutiveHits}-game DD streak`); }
      else if (consecutiveHits >= 2) { score += 12; patterns.push(`📈 ${consecutiveHits}-game streak`); }

      // Volume reliability (max 10pts)
      if (prof.total >= 8) score += 10;
      else if (prof.total >= 5) score += 6;
      else score += 3;

      // Home/away split advantage (max 10pts)
      if (homeHitRate > 0.7 && prof.homeGames >= 2) { score += 10; patterns.push(`🏠 ${(homeHitRate * 100).toFixed(0)}% at home`); }
      if (awayHitRate > 0.7 && prof.awayGames >= 2) { score += 8; patterns.push(`✈️ ${(awayHitRate * 100).toFixed(0)}% on road`); }

      // Bounce-back pattern (miss then usually hits)
      if (prof.recentOutcomes[0] === 'miss' && hitRate >= 0.6) {
        score += 5;
        patterns.push('🔄 Bounce-back candidate');
      }

      // Elite season rate
      if (prof.seasonRate >= 0.6) patterns.push(`⭐ ${(prof.seasonRate * 100).toFixed(0)}% season rate`);

      // Determine tier
      let tier: 'ELITE' | 'STRONG' | 'TRENDING' | 'RISKY';
      if (score >= 65 && hitRate >= 0.7) tier = 'ELITE';
      else if (score >= 50 && hitRate >= 0.5) tier = 'STRONG';
      else if (score >= 35 && hitRate >= 0.4) tier = 'TRENDING';
      else tier = 'RISKY';

      playerPatterns.push({
        player_name: playerName,
        total_games: prof.total,
        total_hits: prof.hits,
        hit_rate: hitRate,
        season_rate: prof.seasonRate,
        recent_streak: prof.recentOutcomes,
        consecutive_hits: consecutiveHits,
        home_hit_rate: homeHitRate,
        away_hit_rate: awayHitRate,
        prediction_type: predType as 'DD' | 'TD',
        confidence_tier: tier,
        confidence_score: Math.round(score),
        patterns,
      });

      // Collect global patterns
      if (hitRate >= 0.75 && prof.total >= 4) {
        winningPatterns.push(`${playerName} ${predType}: ${(hitRate * 100).toFixed(0)}% (${prof.hits}/${prof.total})`);
      }
      if (hitRate <= 0.2 && prof.total >= 4) {
        losingPatterns.push(`${playerName} ${predType}: ${(hitRate * 100).toFixed(0)}% — AVOID`);
      }
    }

    // Sort by confidence
    playerPatterns.sort((a, b) => b.confidence_score - a.confidence_score);

    console.log(`[generate-dd-td-picks] Built ${playerPatterns.length} player profiles`);

    // ── STEP 4: Generate picks for target date ──
    // Get today's game data to find who's playing tomorrow (use latest game logs for matchup info)
    const elitePicks = playerPatterns.filter(p => p.confidence_tier === 'ELITE');
    const strongPicks = playerPatterns.filter(p => p.confidence_tier === 'STRONG');
    const trendingPicks = playerPatterns.filter(p => p.confidence_tier === 'TRENDING');

    // ── STEP 5: Insert predictions for tomorrow ──
    const { data: existingTomorrow } = await supabase
      .from('dd_td_predictions')
      .select('player_name, prediction_type')
      .eq('prediction_date', targetDate);

    const existingKeys = new Set((existingTomorrow || []).map(e => `${e.player_name}_${e.prediction_type}`));

    const newPredictions: any[] = [];
    const topPicks = [...elitePicks, ...strongPicks].slice(0, 20);

    for (const pick of topPicks) {
      const key = `${pick.player_name}_${pick.prediction_type}`;
      if (existingKeys.has(key)) continue;

      newPredictions.push({
        prediction_date: targetDate,
        player_name: pick.player_name,
        prediction_type: pick.prediction_type,
        season_rate: pick.season_rate,
        home_away_rate: pick.home_hit_rate,
        vs_opponent_rate: pick.hit_rate,
        l10_rate: pick.hit_rate,
        composite_score: pick.confidence_score / 100,
        opponent: '',
        is_home: false,
        near_miss_rate: 0,
        games_played: pick.total_games,
        outcome: 'pending',
      });
    }

    if (newPredictions.length > 0) {
      const { error: insertErr } = await supabase
        .from('dd_td_predictions')
        .upsert(newPredictions, { onConflict: 'prediction_date,player_name,prediction_type', ignoreDuplicates: true });
      if (insertErr) console.error('[generate-dd-td-picks] Insert error:', insertErr);
      else console.log(`[generate-dd-td-picks] Inserted ${newPredictions.length} predictions for ${targetDate}`);
    }

    // ── STEP 6: Build and send Telegram report ──
    let msg = `🏀 DD/TD Pattern Analysis & Picks\n`;
    msg += `📅 Picks for: ${targetDate}\n`;
    msg += `📊 Based on ${allPredictions.length} settled predictions\n\n`;

    // Global patterns
    if (winningPatterns.length > 0) {
      msg += `🏆 WINNING PATTERNS:\n`;
      winningPatterns.slice(0, 5).forEach(p => { msg += `  ${p}\n`; });
      msg += `\n`;
    }

    if (losingPatterns.length > 0) {
      msg += `🚫 AVOID PATTERNS:\n`;
      losingPatterns.slice(0, 5).forEach(p => { msg += `  ${p}\n`; });
      msg += `\n`;
    }

    // Elite picks
    if (elitePicks.length > 0) {
      msg += `🔥 ELITE PICKS (70%+ hit rate):\n`;
      for (const p of elitePicks) {
        msg += `  ⭐ ${p.player_name} ${p.prediction_type} — ${(p.hit_rate * 100).toFixed(0)}% (${p.total_hits}/${p.total_games})`;
        if (p.consecutive_hits >= 2) msg += ` 🔥${p.consecutive_hits}`;
        msg += `\n`;
        if (p.patterns.length > 0) msg += `     ${p.patterns.join(' | ')}\n`;
      }
      msg += `\n`;
    }

    // Strong picks
    if (strongPicks.length > 0) {
      msg += `💪 STRONG PICKS (50%+ hit rate):\n`;
      for (const p of strongPicks.slice(0, 8)) {
        msg += `  📈 ${p.player_name} ${p.prediction_type} — ${(p.hit_rate * 100).toFixed(0)}% (${p.total_hits}/${p.total_games})`;
        if (p.consecutive_hits >= 2) msg += ` 🔥${p.consecutive_hits}`;
        msg += `\n`;
      }
      msg += `\n`;
    }

    // Trending (brief)
    if (trendingPicks.length > 0) {
      msg += `📊 TRENDING (40%+): ${trendingPicks.map(p => `${p.player_name}(${(p.hit_rate * 100).toFixed(0)}%)`).slice(0, 5).join(', ')}\n\n`;
    }

    // Key insight
    const overallHitRate = playerPatterns.reduce((s, p) => s + p.total_hits, 0) / 
                           playerPatterns.reduce((s, p) => s + p.total_games, 0);
    msg += `📈 Overall DD hit rate: ${(overallHitRate * 100).toFixed(1)}%\n`;
    msg += `🎯 Elite picks avg: ${elitePicks.length > 0 ? (elitePicks.reduce((s, p) => s + p.hit_rate, 0) / elitePicks.length * 100).toFixed(1) : 0}%`;

    // Send Telegram
    try {
      await fetch(`${supabaseUrl}/functions/v1/bot-send-telegram`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({ message: msg }),
      });
      console.log('[generate-dd-td-picks] Telegram report sent');
    } catch (teleErr) {
      console.error('[generate-dd-td-picks] Telegram error:', teleErr);
    }

    return new Response(JSON.stringify({
      success: true,
      targetDate,
      patterns: { winning: winningPatterns, losing: losingPatterns },
      picks: {
        elite: elitePicks.map(p => ({ name: p.player_name, type: p.prediction_type, hitRate: p.hit_rate, score: p.confidence_score, patterns: p.patterns })),
        strong: strongPicks.map(p => ({ name: p.player_name, type: p.prediction_type, hitRate: p.hit_rate, score: p.confidence_score })),
        trending: trendingPicks.map(p => ({ name: p.player_name, type: p.prediction_type, hitRate: p.hit_rate })),
      },
      predictionsInserted: newPredictions.length,
      totalAnalyzed: allPredictions.length,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[generate-dd-td-picks] Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
