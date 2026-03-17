import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PROP_LABELS: Record<string, string> = {
  points: 'PTS', rebounds: 'REB', assists: 'AST', threes: '3PT',
  steals: 'STL', blocks: 'BLK', pra: 'PRA', turnovers: 'TO',
  player_points: 'PTS', player_rebounds: 'REB', player_assists: 'AST',
  player_threes: '3PT', player_steals: 'STL', player_blocks: 'BLK',
};

interface BufferThresholds { onTrack: number; monitor: number; alert: number; }

function getBufferThresholds(gameProgress: number): BufferThresholds {
  if (gameProgress < 25) return { onTrack: 4, monitor: 1, alert: -2 };
  if (gameProgress < 50) return { onTrack: 3, monitor: 0.5, alert: -1.5 };
  if (gameProgress < 75) return { onTrack: 2, monitor: 0, alert: -1 };
  return { onTrack: 1.5, monitor: -0.5, alert: -1 };
}

type HedgeAction = 'LOCK' | 'HOLD' | 'MONITOR' | 'HEDGE ALERT' | 'HEDGE NOW';

function calculateHedgeAction(params: {
  currentValue: number; projectedFinal: number; line: number;
  side: string; gameProgress: number;
}): HedgeAction {
  const { currentValue, projectedFinal, line, side, gameProgress } = params;
  const isOver = side.toLowerCase() !== 'under';

  if (isOver && currentValue >= line) return 'LOCK';
  if (!isOver && currentValue >= line) return 'HEDGE NOW';

  const buffer = isOver ? projectedFinal - line : line - projectedFinal;
  const thresholds = getBufferThresholds(gameProgress);

  if (buffer >= thresholds.onTrack) return 'HOLD';
  if (buffer >= thresholds.monitor) return 'MONITOR';
  if (buffer >= thresholds.alert) return 'HEDGE ALERT';
  return 'HEDGE NOW';
}

function getStatusEmoji(status: HedgeAction): string {
  switch (status) {
    case 'LOCK': return '🔒';
    case 'HOLD': return '🟢';
    case 'MONITOR': return '🟡';
    case 'HEDGE ALERT': return '🟠';
    case 'HEDGE NOW': return '🔴';
  }
}

function getRoleInfo(avgMinutes: number | null): { label: string; emoji: string; playsAll4Q: boolean; fadeSignal: boolean } {
  const mins = avgMinutes ?? 30;
  if (mins >= 28) return { label: 'STARTER', emoji: '⭐', playsAll4Q: true, fadeSignal: false };
  if (mins >= 20) return { label: 'BENCH', emoji: '🪑', playsAll4Q: false, fadeSignal: false };
  return { label: 'BENCH_FRINGE', emoji: '⚠️', playsAll4Q: false, fadeSignal: true };
}

function formatQuarterAvgs(baselines: any[], propType: string): string {
  const normProp = propType.toLowerCase().replace('player_', '');
  const baseline = baselines.find((b: any) => {
    const bp = (b.prop_type || '').toLowerCase().replace('player_', '');
    return bp === normProp;
  });
  if (!baseline) return 'N/A';
  return `Q1: ${baseline.q1_avg?.toFixed(1)} | Q2: ${baseline.q2_avg?.toFixed(1)} | Q3: ${baseline.q3_avg?.toFixed(1)} | Q4: ${baseline.q4_avg?.toFixed(1)}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get today's date in ET
    const now = new Date();
    const etDate = now.toLocaleDateString('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
    const [m, d, y] = etDate.split('/');
    const today = `${y}-${m}-${d}`;
    const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });

    // Check ET hour — only run during game hours (roughly 6 PM - 1 AM ET)
    const etHour = parseInt(now.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }));
    // Allow pre-game scouts from 5 PM ET, live updates until 2 AM ET
    const isGameHours = etHour >= 17 || etHour < 2;

    // 1. Fetch today's unsettled sweet spot picks
    const { data: picks, error: picksErr } = await supabase
      .from('category_sweet_spots')
      .select('id, player_name, prop_type, recommended_line, recommended_side, l10_avg, confidence_score, analysis_date')
      .eq('analysis_date', today)
      .or('outcome.is.null,outcome.eq.pending')
      .not('recommended_line', 'is', null);

    if (picksErr || !picks || picks.length === 0) {
      console.log('[HedgeTracker] No unsettled picks for today');
      return new Response(JSON.stringify({ success: true, message: 'No picks to track' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Filter to NBA-only prop types (quarter baselines + live feeds are NBA-exclusive)
    const NBA_PROP_TYPES = ['points', 'rebounds', 'assists', 'threes', 'steals', 'blocks', 'pra',
      'player_points', 'player_rebounds', 'player_assists', 'player_threes', 'player_steals', 'player_blocks'];
    const nbaPicks = picks.filter((p: any) => NBA_PROP_TYPES.includes((p.prop_type || '').toLowerCase()));

    console.log(`[HedgeTracker] Found ${picks.length} total picks, ${nbaPicks.length} NBA picks`);

    if (nbaPicks.length === 0) {
      return new Response(JSON.stringify({ success: true, message: 'No NBA picks to track' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Get unique player names
    const playerNames = [...new Set(nbaPicks.map((p: any) => p.player_name))];

    // 3. Fetch StatMuse quarter baselines + behavior profiles in parallel
    const [baselinesRes, profilesRes, trackerRes] = await Promise.all([
      supabase
        .from('player_quarter_baselines')
        .select('player_name, prop_type, q1_avg, q2_avg, q3_avg, q4_avg, data_source')
        .in('player_name', playerNames)
        .eq('data_source', 'statmuse'),
      supabase
        .from('player_nba_profiles')
        .select('player_name, avg_minutes')
        .in('player_name', playerNames),
      supabase
        .from('hedge_telegram_tracker')
        .select('*')
        .eq('analysis_date', today),
    ]);

    const baselines = baselinesRes.data || [];
    const profiles = profilesRes.data || [];
    const trackerRows = trackerRes.data || [];

    // Build lookup maps
    const baselinesByPlayer: Record<string, any[]> = {};
    for (const b of baselines) {
      if (!baselinesByPlayer[b.player_name]) baselinesByPlayer[b.player_name] = [];
      baselinesByPlayer[b.player_name].push(b);
    }

    const profileByPlayer: Record<string, any> = {};
    for (const p of profiles) {
      profileByPlayer[p.player_name] = p;
    }

    const trackerByKey: Record<string, any> = {};
    for (const t of trackerRows) {
      trackerByKey[`${t.player_name}::${t.prop_type}`] = t;
    }

    // 4. Fetch live stats from unified-player-feed
    let liveData: any = null;
    try {
      const { data: feedData } = await supabase.functions.invoke('unified-player-feed', { body: {} });
      liveData = feedData;
    } catch (e) {
      console.log('[HedgeTracker] Could not fetch live feed:', e);
    }

    // Build live player lookup
    const livePlayerMap: Record<string, { player: any; game: any }> = {};
    if (liveData?.games) {
      for (const game of liveData.games) {
        for (const player of game.players || []) {
          const normName = player.playerName?.toLowerCase().trim();
          if (normName) {
            livePlayerMap[normName] = { player, game };
          }
        }
      }
    }

    const hasLiveGames = liveData?.games?.some((g: any) => g.status === 'in_progress') || false;

    // 5. Process each pick
    const pregameMessages: string[] = [];
    const liveUpdateMessages: string[] = [];
    const trackerUpserts: any[] = [];

    for (const pick of nbaPicks) {
      const key = `${pick.player_name}::${pick.prop_type}`;
      const tracker = trackerByKey[key];
      const playerBaselines = baselinesByPlayer[pick.player_name] || [];
      const profile = profileByPlayer[pick.player_name];
      const role = getRoleInfo(profile?.avg_minutes);
      const propLabel = PROP_LABELS[pick.prop_type?.toLowerCase()] || (pick.prop_type || '').toUpperCase();
      const side = (pick.recommended_side || 'over').toUpperCase();
      const sideChar = side.charAt(0);
      const line = pick.recommended_line;
      const quarterAvgs = formatQuarterAvgs(playerBaselines, pick.prop_type);

      // Find live data for this player
      const normPlayerName = pick.player_name?.toLowerCase().trim();
      const liveMatch = livePlayerMap[normPlayerName];

      // --- PRE-GAME SCOUT ---
      if (!tracker?.pregame_sent && isGameHours) {
        const minsExpected = profile?.avg_minutes ? `~${Math.round(profile.avg_minutes)} min expected` : '';
        const playsAllQ = role.playsAll4Q ? ' | Plays all 4Q' : ' | Unlikely all 4Q';
        const l10Str = pick.l10_avg ? `\n  🔥 L10 Avg: ${pick.l10_avg}` : '';

        let line1 = `${role.fadeSignal ? '⚠️' : '🎯'} ${pick.player_name} ${propLabel} ${sideChar}${line}`;
        let details = `  ${role.emoji} ${role.label} | ${minsExpected}${playsAllQ}`;
        details += `\n  📊 StatMuse Q-Avg: ${quarterAvgs}`;
        details += l10Str;

        if (role.fadeSignal) {
          details += `\n  ❌ FADE SIGNAL — bench player, inconsistent minutes`;
        }

        pregameMessages.push(`${line1}\n${details}`);

        trackerUpserts.push({
          player_name: pick.player_name,
          prop_type: pick.prop_type,
          line,
          side: side.toLowerCase(),
          pick_id: pick.id,
          pregame_sent: true,
          last_status_sent: tracker?.last_status_sent || null,
          last_quarter_sent: tracker?.last_quarter_sent || 0,
          analysis_date: today,
        });
      }

      // --- LIVE UPDATE ---
      if (liveMatch && liveMatch.game.status === 'in_progress') {
        const game = liveMatch.game;
        const player = liveMatch.player;
        const gameProgress = game.gameProgress || 0;
        const currentQuarter = game.period || 1;

        // Get current stat value
        const statKey = (pick.prop_type || '').toLowerCase().replace('player_', '');
        const currentValue = player.currentStats?.[statKey] ?? 0;

        // Get projection
        const projection = player.projections?.[statKey];
        const projectedFinal = projection?.projected ?? 0;
        const ratePerMin = projection?.ratePerMinute ?? 0;

        // Calculate hedge status
        const hedgeAction = calculateHedgeAction({
          currentValue,
          projectedFinal,
          line,
          side: pick.recommended_side || 'over',
          gameProgress,
        });

        // Determine if we should send an update
        const prevStatus = tracker?.last_status_sent;
        const prevQuarter = tracker?.last_quarter_sent || 0;
        const statusChanged = prevStatus !== hedgeAction;
        const newQuarter = currentQuarter > prevQuarter;

        if (statusChanged || newQuarter) {
          const statusEmoji = getStatusEmoji(hedgeAction);
          const prevStatusEmoji = prevStatus ? getStatusEmoji(prevStatus as HedgeAction) : '';
          const statusTransition = prevStatus
            ? `${prevStatusEmoji} ${prevStatus} → ${statusEmoji} ${hedgeAction}`
            : `${statusEmoji} ${hedgeAction}`;

          // Calculate needed rate
          const remainingMinutes = player.estimatedRemaining || 0;
          const remaining = line - currentValue;
          const neededRate = remainingMinutes > 0 ? (remaining / remainingMinutes).toFixed(2) : '?';

          let msg = `🎯 HEDGE UPDATE — ${pick.player_name} ${propLabel} ${sideChar}${line}\n\n`;
          msg += `📊 Status: ${statusTransition}\n`;
          msg += `📈 Current: ${currentValue} ${propLabel.toLowerCase()} | Projected: ${projectedFinal.toFixed(1)}\n`;
          msg += `⏱️ Q${currentQuarter} ${game.clock || ''} | Progress: ${Math.round(gameProgress)}%\n`;
          msg += `🏃 Rate: ${ratePerMin.toFixed(2)}/min (need ${neededRate})\n\n`;
          msg += `📋 StatMuse Q-Avg: ${quarterAvgs}\n`;

          // Show actual quarter results if available
          if (currentQuarter > 1 && player.currentStats) {
            // We show total accumulated vs quarter expectation
            const qBaseline = playerBaselines.find((b: any) => {
              const bp = (b.prop_type || '').toLowerCase().replace('player_', '');
              return bp === statKey;
            });
            if (qBaseline) {
              const expectedByNow = Array.from({ length: currentQuarter - 1 }, (_, i) => {
                const qKey = `q${i + 1}_avg`;
                return qBaseline[qKey] || 0;
              }).reduce((a: number, b: number) => a + b, 0);
              const diff = currentValue - expectedByNow;
              const diffSign = diff >= 0 ? '+' : '';
              msg += `✅ Through Q${currentQuarter - 1}: ${currentValue} (${diffSign}${diff.toFixed(1)} vs avg)\n`;
            }
          }

          msg += `💡 Role: ${role.emoji} ${role.label}`;
          if (role.playsAll4Q) msg += ` — expected to play closing minutes`;
          if (role.fadeSignal) msg += ` — ⚠️ may not get enough minutes`;

          liveUpdateMessages.push(msg);

          trackerUpserts.push({
            player_name: pick.player_name,
            prop_type: pick.prop_type,
            line,
            side: (pick.recommended_side || 'over').toLowerCase(),
            pick_id: pick.id,
            pregame_sent: tracker?.pregame_sent || true,
            last_status_sent: hedgeAction,
            last_quarter_sent: currentQuarter,
            analysis_date: today,
          });
        }
      }
    }

    // 6. Upsert tracker state
    if (trackerUpserts.length > 0) {
      const { error: upsertErr } = await supabase
        .from('hedge_telegram_tracker')
        .upsert(trackerUpserts, { onConflict: 'player_name,prop_type,analysis_date' });
      if (upsertErr) console.error('[HedgeTracker] Tracker upsert error:', upsertErr);
    }

    // 7. Send Telegram messages
    let messagesSent = 0;

    // Pre-game scout (batch all into one message)
    if (pregameMessages.length > 0) {
      const fullMessage = `🏀 PRE-GAME SCOUT — ${dateStr}\n━━━━━━━━━━━━━━━━━━━━━\n\n${pregameMessages.join('\n\n')}`;

      await supabase.functions.invoke('bot-send-telegram', {
        body: { type: 'hedge_pregame_scout', data: { message: fullMessage } },
      });
      messagesSent++;
      console.log(`[HedgeTracker] Sent pregame scout with ${pregameMessages.length} picks`);
    }

    // Live updates (send each status change individually for urgency)
    const hedgePushAlerts: any[] = [];

    for (const msg of liveUpdateMessages) {
      await supabase.functions.invoke('bot-send-telegram', {
        body: { type: 'hedge_live_update', data: { message: msg } },
      });
      messagesSent++;
    }

    // Collect hedge alerts for customer push notifications
    for (const upsert of trackerUpserts) {
      if (upsert.last_status_sent && ['HEDGE ALERT', 'HEDGE NOW', 'LOCK'].includes(upsert.last_status_sent)) {
        hedgePushAlerts.push({
          playerName: upsert.player_name,
          propType: upsert.prop_type,
          line: upsert.line,
          side: upsert.side,
          hedgeAction: upsert.last_status_sent,
          previousStatus: null, // tracked via transition in message
          currentValue: 0, // approximate from tracker
          projectedFinal: 0,
          gameProgress: 0,
          quarter: upsert.last_quarter_sent || 1,
        });
      }
    }

    // Send customer push notifications for hedge status changes
    if (hedgePushAlerts.length > 0) {
      try {
        await supabase.functions.invoke('send-hedge-push-notification', {
          body: { alerts: hedgePushAlerts },
        });
        console.log(`[HedgeTracker] Sent ${hedgePushAlerts.length} customer hedge push alerts`);
      } catch (pushErr) {
        console.error('[HedgeTracker] Customer push notification error:', pushErr);
      }
    }

    if (liveUpdateMessages.length > 0) {
      console.log(`[HedgeTracker] Sent ${liveUpdateMessages.length} live hedge updates`);
    }

    return new Response(JSON.stringify({
      success: true,
      totalPicks: picks.length,
      nbaPicks: nbaPicks.length,
      pregamesSent: pregameMessages.length,
      liveUpdatesSent: liveUpdateMessages.length,
      hasLiveGames,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[HedgeTracker] Error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
