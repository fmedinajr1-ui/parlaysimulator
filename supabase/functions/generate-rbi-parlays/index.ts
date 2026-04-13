/**
 * generate-rbi-parlays
 * 
 * Builds 2-3 leg UNDER-only RBI parlays from Hard Rock Bet signals.
 * Every leg must face a quality pitcher (K/g >= 5 OR ERA <= 3.5).
 * Sends formatted parlay suggestions to Telegram.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SignalAccuracy {
  signal_type: string;
  settled: number;
  wins: number;
  win_rate: number;
}

interface PitcherStats {
  name: string;
  era: number;
  kPerGame: number;
}

const MLB_API = 'https://statsapi.mlb.com/api/v1';
const log = (msg: string) => console.log(`[rbi-parlays] ${msg}`);

// ── MLB Pitcher Lookup ──────────────────────────────────────────────

async function fetchTodayPitchers(): Promise<Map<string, PitcherStats>> {
  const pitcherMap = new Map<string, PitcherStats>();
  try {
    const today = new Date().toISOString().split('T')[0];
    const schedRes = await fetch(`${MLB_API}/schedule?date=${today}&sportId=1&hydrate=probablePitcher`);
    if (!schedRes.ok) { log(`MLB schedule API error: ${schedRes.status}`); return pitcherMap; }
    const sched = await schedRes.json();

    for (const date of (sched.dates || [])) {
      for (const game of (date.games || [])) {
        const away = game.teams?.away;
        const home = game.teams?.home;

        // Away pitcher faces home batters, home pitcher faces away batters
        for (const { pitcher, facingTeam } of [
          { pitcher: away?.probablePitcher, facingTeam: home?.team?.name },
          { pitcher: home?.probablePitcher, facingTeam: away?.team?.name },
        ]) {
          if (!pitcher?.id || !facingTeam) continue;
          try {
            const statsRes = await fetch(`${MLB_API}/people/${pitcher.id}?hydrate=stats(group=[pitching],type=[season])`);
            if (!statsRes.ok) continue;
            const statsData = await statsRes.json();
            const splits = statsData.people?.[0]?.stats?.[0]?.splits;
            if (!splits?.length) continue;
            const s = splits[splits.length - 1].stat;
            const gamesPlayed = s.gamesPlayed || s.gamesPitched || 1;
            const kPerGame = (s.strikeOuts || 0) / gamesPlayed;
            const era = s.era ? parseFloat(s.era) : 9.0;

            // Map by team name so we can look up "which pitcher does this batter face"
            pitcherMap.set(facingTeam.toLowerCase(), {
              name: pitcher.fullName || pitcher.lastName || 'Unknown',
              era,
              kPerGame: Math.round(kPerGame * 10) / 10,
            });
          } catch (_) { /* skip individual pitcher errors */ }
        }
      }
    }
    log(`Fetched pitcher stats for ${pitcherMap.size} team matchups`);
  } catch (err) {
    log(`Pitcher fetch error: ${err}`);
  }
  return pitcherMap;
}

function findPitcherForPlayer(
  pitcherMap: Map<string, PitcherStats>,
  eventDescription: string,
): PitcherStats | null {
  // eventDescription is like "Team A @ Team B"
  const lower = (eventDescription || '').toLowerCase();
  for (const [team, stats] of pitcherMap) {
    if (lower.includes(team)) return stats;
  }
  return null;
}

// ── Main Handler ────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // Step 1: Get accuracy by signal type from settled RBI picks
    const { data: dashboardData, error: dashErr } = await supabase.rpc('get_rbi_accuracy_dashboard');
    if (dashErr) throw dashErr;

    const bySignal: SignalAccuracy[] = (dashboardData?.by_signal_type || []).filter(
      (s: SignalAccuracy) => s.settled >= 5 && s.win_rate >= 60
    );

    log(`Qualifying signal types (60%+ win rate, 5+ sample): ${bySignal.map(s => `${s.signal_type}=${s.win_rate}%`).join(', ') || 'NONE'}`);

    if (bySignal.length === 0) {
      return new Response(JSON.stringify({ parlays: [], message: 'No signal types meet 60%+ accuracy threshold yet' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const qualifyingSignals = bySignal.map(s => s.signal_type);

    // Step 2: Get today's UNDER-only RBI alerts from qualifying signals
    const today = new Date().toISOString().split('T')[0];
    const { data: todayAlerts, error: alertErr } = await supabase
      .from('fanduel_prediction_alerts')
      .select('id, player_name, prediction, signal_type, confidence, metadata, created_at')
      .eq('prop_type', 'batter_rbis')
      .is('was_correct', null)
      .in('signal_type', qualifyingSignals)
      .gte('created_at', `${today}T00:00:00`)
      .ilike('prediction', '%under%')
      .order('created_at', { ascending: false })
      .limit(50);

    if (alertErr) throw alertErr;

    log(`Found ${todayAlerts?.length || 0} Under RBI alerts for today`);

    if (!todayAlerts || todayAlerts.length < 2) {
      return new Response(JSON.stringify({ parlays: [], message: `Only ${todayAlerts?.length || 0} Under alerts today — need at least 2` }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Step 3: L10 Hard Gate — block Unders with high hit rates
    const l10Filtered = todayAlerts.filter(a => {
      const l10 = a.metadata?.l10_hit_rate ?? 0.5;
      if (l10 > 0.5) {
        log(`L10 gate: BLOCKED ${a.player_name} Under — L10 hit rate ${l10} > 0.5`);
        return false;
      }
      return true;
    });

    log(`After L10 gate: ${l10Filtered.length} alerts (was ${todayAlerts.length})`);

    if (l10Filtered.length < 2) {
      return new Response(JSON.stringify({ parlays: [], message: `Only ${l10Filtered.length} alerts after L10 gate` }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Step 4: Pitcher Quality Gate — fetch today's pitchers, block weak matchups
    const pitcherMap = await fetchTodayPitchers();

    // We need event descriptions to match pitchers — pull from HRB timeline or metadata
    const pitcherGated: (typeof l10Filtered[0] & { pitcher: PitcherStats })[] = [];

    for (const alert of l10Filtered) {
      // Try to find event description from metadata or HRB timeline
      let eventDesc = alert.metadata?.event_description || '';

      if (!eventDesc) {
        // Look up from HRB timeline for this player
        const { data: hrbSnap } = await supabase
          .from('hrb_rbi_line_timeline')
          .select('event_description')
          .eq('player_name', alert.player_name)
          .gte('snapshot_time', `${today}T00:00:00`)
          .limit(1);
        eventDesc = hrbSnap?.[0]?.event_description || '';
      }

      // Also try opposing_pitcher from metadata
      const metaPitcher = alert.metadata?.opposing_pitcher;
      const metaPitcherEra = alert.metadata?.pitcher_era;
      const metaPitcherK = alert.metadata?.pitcher_k_rate;

      let pitcher: PitcherStats | null = null;

      if (eventDesc) {
        pitcher = findPitcherForPlayer(pitcherMap, eventDesc);
      }

      // Fallback to metadata pitcher info if available
      if (!pitcher && metaPitcher && (metaPitcherEra != null || metaPitcherK != null)) {
        pitcher = {
          name: metaPitcher,
          era: metaPitcherEra ?? 9.0,
          kPerGame: metaPitcherK ?? 0,
        };
      }

      if (!pitcher) {
        log(`Pitcher gate: BLOCKED ${alert.player_name} — no pitcher data found`);
        continue;
      }

      // Hard gate: K/game >= 5 OR ERA <= 3.5
      if (pitcher.kPerGame < 5 && pitcher.era > 3.5) {
        log(`Pitcher gate: BLOCKED ${alert.player_name} — ${pitcher.name} (ERA ${pitcher.era}, K/g ${pitcher.kPerGame}) too weak`);
        continue;
      }

      log(`Pitcher gate: PASS ${alert.player_name} — facing ${pitcher.name} (ERA ${pitcher.era}, K/g ${pitcher.kPerGame})`);
      pitcherGated.push({ ...alert, pitcher });
    }

    log(`After pitcher gate: ${pitcherGated.length} candidates`);

    if (pitcherGated.length < 2) {
      return new Response(JSON.stringify({ parlays: [], message: `Only ${pitcherGated.length} alerts after pitcher quality gate` }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Step 5: Cross-ref HRB lines
    const withHrb = await Promise.all(pitcherGated.map(async (alert) => {
      const { data: hrbSnap } = await supabase
        .from('hrb_rbi_line_timeline')
        .select('line, under_price, drift_velocity')
        .eq('player_name', alert.player_name)
        .gte('snapshot_time', `${today}T00:00:00`)
        .order('snapshot_time', { ascending: false })
        .limit(1);

      return {
        ...alert,
        hrb_line: hrbSnap?.[0]?.line ?? null,
        hrb_under_price: hrbSnap?.[0]?.under_price ?? null,
        hrb_drift: hrbSnap?.[0]?.drift_velocity ?? 0,
      };
    }));

    // Step 6: Score and rank
    const signalAccMap = new Map(bySignal.map(s => [s.signal_type, s]));

    const scored = withHrb.map(alert => {
      const signalAcc = signalAccMap.get(alert.signal_type);
      const accScore = signalAcc ? signalAcc.win_rate : 50;
      const confScore = (alert.confidence || 0) >= 80 ? 20 : (alert.confidence || 0) >= 60 ? 10 : 0;

      // L10 bonus — lower hit rate is better for Unders
      const l10HitRate = alert.metadata?.l10_hit_rate ?? 0.5;
      const l10Bonus = l10HitRate <= 0.2 ? 20 : l10HitRate <= 0.3 ? 15 : l10HitRate <= 0.4 ? 10 : 0;

      // Pitcher quality bonus
      let pitcherBonus = 0;
      if (alert.pitcher.kPerGame >= 7 || alert.pitcher.era < 2.5) {
        pitcherBonus = 15; // Elite arm
      } else if (alert.pitcher.kPerGame >= 5 || alert.pitcher.era <= 3.5) {
        pitcherBonus = 8; // Good arm
      }

      return {
        ...alert,
        composite_score: accScore + confScore + l10Bonus + pitcherBonus,
        signal_accuracy: accScore,
        pitcher_bonus: pitcherBonus,
      };
    }).sort((a, b) => b.composite_score - a.composite_score);

    // Step 7: Build 2-3 leg Under parlays
    const parlays: { legs: typeof scored; type: string }[] = [];

    // 2-leg parlay
    const usedPlayers2 = new Set<string>();
    const twoLeg: typeof scored = [];
    for (const pick of scored) {
      if (usedPlayers2.has(pick.player_name)) continue;
      twoLeg.push(pick);
      usedPlayers2.add(pick.player_name);
      if (twoLeg.length >= 2) break;
    }
    if (twoLeg.length === 2) {
      parlays.push({ legs: twoLeg, type: '2-Leg RBI Under Lock 🔒' });
    }

    // 3-leg parlay if enough candidates
    if (scored.length >= 4) {
      const usedPlayers3 = new Set<string>();
      const threeLeg: typeof scored = [];
      const topScore = scored[0]?.composite_score || 0;

      for (const pick of scored) {
        if (usedPlayers3.has(pick.player_name)) continue;

        // 3rd leg stricter gates
        if (threeLeg.length === 2) {
          if (pick.composite_score < topScore * 0.8) {
            log(`3rd leg gate: ${pick.player_name} score ${pick.composite_score} < 80% of top (${topScore})`);
            continue;
          }
          const l10 = pick.metadata?.l10_hit_rate ?? 0.5;
          if (l10 > 0.3) {
            log(`3rd leg gate: ${pick.player_name} L10=${l10} > 0.3`);
            continue;
          }
        }

        threeLeg.push(pick);
        usedPlayers3.add(pick.player_name);
        if (threeLeg.length >= 3) break;
      }
      if (threeLeg.length === 3) {
        parlays.push({ legs: threeLeg, type: '3-Leg RBI Under Sniper 🎯' });
      }
    }

    if (parlays.length === 0) {
      return new Response(JSON.stringify({ parlays: [], message: 'Not enough diverse Under candidates' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Step 8: Format Telegram message
    const SIGNAL_DISPLAY: Record<string, string> = {
      velocity_spike: "Sharp Money Spike", cascade: "Sustained Line Move",
      line_about_to_move: "Early Line Signal", take_it_now: "Snapback Value",
      price_drift: "Steady Drift", trap_warning: "Trap Alert",
    };

    const parlayMessages: string[] = [];
    for (const parlay of parlays) {
      const legLines = parlay.legs.map((leg, i) => {
        const line = leg.hrb_line ?? leg.metadata?.line ?? 0.5;
        const l10Rate = leg.metadata?.l10_hit_rate;
        const l10Games = l10Rate != null ? Math.round(l10Rate * 10) : null;
        const quietGames = l10Games != null ? 10 - l10Games : null;
        const signalName = SIGNAL_DISPLAY[leg.signal_type] || leg.signal_type;
        const p = leg.pitcher;

        // Build narrative
        let narrative = '';
        if (quietGames != null) {
          narrative = `${leg.player_name} has been quiet — 0 RBI in ${quietGames} of the last 10.`;
        } else {
          narrative = `${signalName} signal detected — ${leg.signal_accuracy}% historical accuracy.`;
        }
        narrative += ` Facing ${p.name} (${p.era.toFixed(2)} ERA, ${p.kPerGame} K/g).`;

        const l10Line = l10Games != null ? ` | L10: ${l10Games}/10 RBI games` : '';
        const hrbLine = leg.hrb_under_price ? ` | HRB Under: ${leg.hrb_under_price}` : '';

        return [
          `${i === 0 ? '1️⃣' : i === 1 ? '2️⃣' : '3️⃣'} *${leg.player_name}* — UNDER ${line} RBI`,
          `   🧊 ${narrative}`,
          `   📊 ${leg.signal_accuracy}% signal accuracy${l10Line}${hrbLine}`,
        ].join('\n');
      });

      parlayMessages.push(`⚾ *${parlay.type}*\n\n${legLines.join('\n\n')}`);
    }

    const telegramMsg = [
      `⚾ *RBI Under Parlay Picks* (Hard Rock Bet)`,
      ``,
      ...parlayMessages,
      ``,
      `━━━━━━━━━━━━━━━`,
      `🧊 All legs: UNDER + quality pitcher + quiet bat`,
      `_Based on ${dashboardData?.overall?.total_settled || 0} settled RBI picks_`,
    ].join('\n');

    try {
      await supabase.functions.invoke('bot-send-telegram', {
        body: { message: telegramMsg, parse_mode: 'Markdown', admin_only: true },
      });
      log('Telegram sent');
    } catch (_) {
      log('Telegram send failed (non-fatal)');
    }

    return new Response(JSON.stringify({
      parlays: parlays.map(p => ({
        type: p.type,
        legs: p.legs.map(l => ({
          player: l.player_name,
          prediction: l.prediction,
          signal: l.signal_type,
          accuracy: l.signal_accuracy,
          score: l.composite_score,
          pitcher: l.pitcher.name,
          pitcher_era: l.pitcher.era,
          pitcher_k: l.pitcher.kPerGame,
          hrb_line: l.hrb_line,
        }))
      })),
      qualifying_signals: bySignal,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    log(`Error: ${err.message}`);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
