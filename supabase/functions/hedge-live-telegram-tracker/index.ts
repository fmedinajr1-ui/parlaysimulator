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
  if (gameProgress < 25) return { onTrack: 2, monitor: -1, alert: -4 };
  if (gameProgress < 50) return { onTrack: 3, monitor: 1.5, alert: -0.5 };
  if (gameProgress < 75) return { onTrack: 1.5, monitor: 0.5, alert: 0 };
  return { onTrack: 1.0, monitor: 0, alert: -0.25 };
}

type HedgeAction = 'LOCK' | 'HOLD' | 'MONITOR' | 'HEDGE ALERT' | 'HEDGE NOW';

// ── Tri-Signal Projection (server-side copy) ──
const SCORING_PROPS = new Set(['points', 'threes', 'player_points', 'player_threes']);

function getSignalWeights(gameProgress: number, hasFg: boolean) {
  let rate: number, book: number, fg: number;
  if (gameProgress < 25) { rate = 0.40; book = 0.45; fg = 0.15; }
  else if (gameProgress < 50) { rate = 0.45; book = 0.35; fg = 0.20; }
  else if (gameProgress < 75) { rate = 0.55; book = 0.25; fg = 0.20; }
  else { rate = 0.70; book = 0.15; fg = 0.15; }
  if (!hasFg) { rate += fg; fg = 0; }
  return { rate, book, fg };
}

function triSignalProjection(params: {
  currentValue: number; ratePerMinute: number; remainingMinutes: number;
  gameProgress: number; propType: string;
  liveBookLine?: number; fgPct?: number; baselineFgPct?: number;
}): number {
  const { currentValue, ratePerMinute, remainingMinutes, gameProgress, propType, liveBookLine, fgPct, baselineFgPct } = params;
  const rateProj = currentValue + ratePerMinute * remainingMinutes;
  const hasBook = liveBookLine != null && liveBookLine > 0;
  const isScoringProp = SCORING_PROPS.has(propType.toLowerCase());
  const hasFg = isScoringProp && fgPct != null && baselineFgPct != null && fgPct > 0;

  let fgProj = rateProj;
  if (hasFg) {
    const factor = Math.max(0.7, Math.min(1.4, Math.pow(baselineFgPct! / fgPct!, 0.3)));
    fgProj = currentValue + (ratePerMinute * factor) * remainingMinutes;
  }

  const w = getSignalWeights(gameProgress, hasFg);
  let ew = { ...w };
  if (!hasBook) { ew.rate += ew.book; ew.book = 0; }

  let proj = ew.rate * rateProj;
  if (hasBook) proj += ew.book * liveBookLine!;
  if (hasFg) proj += ew.fg * fgProj;
  return Math.round(proj * 10) / 10;
}

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

    // Filter to NBA-only prop types
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

    // 3. Fetch baselines, profiles, tracker state, baseline FG%, AND actual book lines in parallel
    const [baselinesRes, profilesRes, trackerRes, fgBaselineRes, bookLinesRes] = await Promise.all([
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
      // Signal 3: Fetch L10 FG baseline from game logs
      supabase
        .from('nba_player_game_logs')
        .select('player_name, field_goals_made, field_goals_attempted')
        .in('player_name', playerNames)
        .order('game_date', { ascending: false })
        .limit(playerNames.length * 10), // L10 per player
      // Fetch actual sportsbook lines from unified_props
      supabase
        .from('unified_props')
        .select('player_name, prop_type, current_line, bookmaker, over_price, under_price')
        .eq('is_active', true)
        .in('player_name', playerNames),
    ]);

    const baselines = baselinesRes.data || [];
    const profiles = profilesRes.data || [];
    const trackerRows = trackerRes.data || [];
    const fgLogs = fgBaselineRes.data || [];
    const bookLines = bookLinesRes.data || [];

    // Build actual sportsbook line lookup: player::prop_type -> { line, bookmaker, overPrice, underPrice }
    const actualLineByKey: Record<string, { line: number; bookmaker: string; overPrice: number | null; underPrice: number | null }> = {};
    for (const bl of bookLines) {
      const normProp = (bl.prop_type || '').toLowerCase().replace('player_', '');
      const key = `${bl.player_name}::${normProp}`;
      // Keep the first match (or prefer fanduel if available)
      if (!actualLineByKey[key] || bl.bookmaker === 'fanduel') {
        actualLineByKey[key] = { line: bl.current_line, bookmaker: bl.bookmaker, overPrice: bl.over_price, underPrice: bl.under_price };
      }
    }
    console.log(`[HedgeTracker] Fetched ${bookLines.length} active book lines, mapped ${Object.keys(actualLineByKey).length} unique`);

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

    // Build baseline FG% map from L10 game logs
    const baselineFgByPlayer: Record<string, number> = {};
    const playerFgAccum: Record<string, { fgm: number; fga: number; games: number }> = {};
    for (const log of fgLogs) {
      if (!log.player_name || log.field_goals_attempted == null) continue;
      if (!playerFgAccum[log.player_name]) {
        playerFgAccum[log.player_name] = { fgm: 0, fga: 0, games: 0 };
      }
      const accum = playerFgAccum[log.player_name];
      if (accum.games < 10) {
        accum.fgm += log.field_goals_made || 0;
        accum.fga += log.field_goals_attempted || 0;
        accum.games++;
      }
    }
    for (const [name, accum] of Object.entries(playerFgAccum)) {
      if (accum.fga > 0) {
        baselineFgByPlayer[name] = accum.fgm / accum.fga;
      }
    }

    console.log(`[HedgeTracker] Baseline FG% computed for ${Object.keys(baselineFgByPlayer).length} players`);

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
    // Store computed live values for push notifications
    const liveComputedByKey: Record<string, { currentValue: number; projectedFinal: number; gameProgress: number; quarter: number }> = {};

    for (const pick of nbaPicks) {
      const key = `${pick.player_name}::${pick.prop_type}`;
      const tracker = trackerByKey[key];
      const playerBaselines = baselinesByPlayer[pick.player_name] || [];
      const profile = profileByPlayer[pick.player_name];
      const role = getRoleInfo(profile?.avg_minutes);
      const propLabel = PROP_LABELS[pick.prop_type?.toLowerCase()] || (pick.prop_type || '').toUpperCase();
      const side = (pick.recommended_side || 'over').toUpperCase();
      const sideChar = side.charAt(0);
      const originalLine = pick.recommended_line;
      const line = originalLine;
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

        // Get projection + apply tri-signal
        const projection = player.projections?.[statKey];
        const ratePerMin = projection?.ratePerMinute ?? 0;
        const remainingMinutes = player.estimatedRemaining ?? 0;
        
        // Signal 2: Use actual sportsbook line from unified_props, fall back to sweet spot line
        const statKey2 = (pick.prop_type || '').toLowerCase().replace('player_', '');
        const bookKey = `${pick.player_name}::${statKey2}`;
        const actualBook = actualLineByKey[bookKey];
        const liveBookLine = actualBook?.line ?? pick.recommended_line ?? undefined;
        // Use FanDuel line for hedge decisions (not just projection blending)
        const hedgeLine = actualBook?.line ?? pick.actual_line ?? originalLine;
        const lineSource = actualBook ? 'fanduel' : (pick.actual_line ? 'actual_line' : 'sweet_spot');
        const liveBookmaker = actualBook?.bookmaker;
        const liveOverPrice = actualBook?.overPrice;
        const liveUnderPrice = actualBook?.underPrice;
        
        // Signal 3: Get baseline FG% from L10 game logs
        const baselineFg = baselineFgByPlayer[pick.player_name];
        const liveFgPct = player.currentStats?.fgPct;
        
        // Use tri-signal blended projection with all three signals
        const projectedFinal = triSignalProjection({
          currentValue,
          ratePerMinute: ratePerMin,
          remainingMinutes,
          gameProgress,
          propType: pick.prop_type || '',
          liveBookLine,
          fgPct: liveFgPct,
          baselineFgPct: baselineFg,
        });

        console.log(`[HedgeTracker] ${pick.player_name} ${statKey}: curr=${currentValue}, proj=${projectedFinal}, book=${liveBookLine}, fgLive=${liveFgPct?.toFixed(3)}, fgBase=${baselineFg?.toFixed(3)}`);

        // Store computed values for push notifications
        liveComputedByKey[key] = { currentValue, projectedFinal, gameProgress, quarter: currentQuarter };

        // Calculate hedge status with tri-signal projection
        // Use real FanDuel line for hedge decision
        const hedgeAction = (() => {
          const isOver = (pick.recommended_side || 'over').toLowerCase() !== 'under';
          const bufferPct = isOver
            ? ((projectedFinal - hedgeLine) / hedgeLine) * 100
            : ((hedgeLine - projectedFinal) / hedgeLine) * 100;
          // Force escalation if buffer deeply negative
          if (bufferPct < -15) return 'HEDGE NOW' as HedgeAction;
          return calculateHedgeAction({
            currentValue,
            projectedFinal,
            line: hedgeLine,
            side: pick.recommended_side || 'over',
            gameProgress,
          });
        })();

        // Determine if we should send an update
        const prevStatus = tracker?.last_status_sent;
        const prevQuarter = tracker?.last_quarter_sent || 0;
        const statusChanged = prevStatus !== hedgeAction;
        const newQuarter = currentQuarter > prevQuarter;

        // Record hedge snapshot on EVERY cron tick (upsert deduplicates by composite key)
        try {
          await supabase.functions.invoke('record-hedge-snapshot', {
            body: {
              sweet_spot_id: pick.id,
              player_name: pick.player_name,
              prop_type: pick.prop_type,
              line: hedgeLine,
              side: (pick.recommended_side || 'over').toLowerCase(),
              quarter: currentQuarter,
              game_progress: gameProgress,
              hedge_status: hedgeAction,
              hit_probability: Math.round(gameProgress > 50 ? 60 : 50),
              current_value: currentValue,
              projected_final: projectedFinal,
              rate_per_minute: ratePerMin,
              rate_needed: remainingMinutes > 0 ? (line - currentValue) / remainingMinutes : undefined,
              gap_to_line: projectedFinal - line,
              live_book_line: liveBookLine,
              analysis_date: today,
            },
          });
          console.log(`[HedgeTracker] Recorded Q${currentQuarter} snapshot for ${pick.player_name}`);
        } catch (snapErr) {
          console.error(`[HedgeTracker] Snapshot recording error:`, snapErr);
        }

        if (statusChanged || newQuarter) {
          // Q1 Flip Logic: suppress MONITOR/HEDGE ALERT in Q1, reword as flip opportunity
          const isQ1 = gameProgress < 25;
          const isQ1Suppressible = isQ1 && (hedgeAction === 'MONITOR' || hedgeAction === 'HEDGE ALERT');

          if (isQ1Suppressible) {
            // Don't send a full hedge alert — send a flip opportunity note instead
            const flipMsg = `🔄 Q1 FLIP OPPORTUNITY — ${pick.player_name} ${propLabel} ${sideChar}${line}\n\n`
              + `📊 Status: ${getStatusEmoji(hedgeAction)} ${hedgeAction} (Q1 — historically 75% recover)\n`
              + `📈 Current: ${currentValue} ${propLabel.toLowerCase()} | Projected: ${projectedFinal.toFixed(1)}\n`
              + `⏱️ Q${currentQuarter} ${game.clock || ''} | Progress: ${Math.round(gameProgress)}%\n`
              + `💡 HOLD recommended — Q1 signals are noisy. Wait for Q2 to decide.`;
            liveUpdateMessages.push(flipMsg);
          } else {
          const statusEmoji = getStatusEmoji(hedgeAction);
          const prevStatusEmoji = prevStatus ? getStatusEmoji(prevStatus as HedgeAction) : '';
          const statusTransition = prevStatus
            ? `${prevStatusEmoji} ${prevStatus} → ${statusEmoji} ${hedgeAction}`
            : `${statusEmoji} ${hedgeAction}`;

          // Calculate needed rate
          const remaining = line - currentValue;
          const neededRate = remainingMinutes > 0 ? (remaining / remainingMinutes).toFixed(2) : '?';

          // Calculate buffer % for display
          const isOverPick = (pick.recommended_side || 'over').toLowerCase() !== 'under';
          const bufferPctDisplay = isOverPick
            ? ((projectedFinal - hedgeLine) / hedgeLine) * 100
            : ((hedgeLine - projectedFinal) / hedgeLine) * 100;
          const fdTag = lineSource === 'fanduel' ? ' (FD)' : '';

          let msg = `🎯 HEDGE UPDATE — ${pick.player_name} ${propLabel} ${sideChar}${hedgeLine}${fdTag}\n\n`;
          msg += `📊 Status: ${statusTransition}\n`;
          msg += `📈 Current: ${currentValue} ${propLabel.toLowerCase()} | Projected: ${projectedFinal.toFixed(1)}\n`;
          msg += `📏 FD Line: ${hedgeLine} | Buffer: ${bufferPctDisplay >= 0 ? '+' : ''}${bufferPctDisplay.toFixed(1)}%\n`;
          msg += `⏱️ Q${currentQuarter} ${game.clock || ''} | Progress: ${Math.round(gameProgress)}%\n`;
          msg += `🏃 Rate: ${ratePerMin.toFixed(2)}/min (need ${neededRate})\n\n`;
          msg += `📋 StatMuse Q-Avg: ${quarterAvgs}\n`;

          // Show actual quarter results if available
          if (currentQuarter > 1 && player.currentStats) {
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

          // Show actual sportsbook line info for hedge recommendations
          if (actualBook && (hedgeAction === 'HEDGE ALERT' || hedgeAction === 'HEDGE NOW')) {
            const oppSide = side === 'OVER' ? 'UNDER' : 'OVER';
            const price = oppSide === 'UNDER' ? liveUnderPrice : liveOverPrice;
            const priceStr = price ? ` (${price > 0 ? '+' : ''}${price})` : '';
            const bookLabel = liveBookmaker ? ` on ${liveBookmaker.charAt(0).toUpperCase() + liveBookmaker.slice(1)}` : '';
            msg += `\n\n🎰 Consider: ${oppSide} ${actualBook.line}${priceStr}${bookLabel}`;
            if (actualBook.line !== line) {
              msg += `\n   (Your line: ${sideChar}${line} | Book line: ${actualBook.line})`;
            }
          }

          liveUpdateMessages.push(msg);
          }

          trackerUpserts.push({
            player_name: pick.player_name,
            prop_type: pick.prop_type,
            line: hedgeLine,
            side: (pick.recommended_side || 'over').toLowerCase(),
            pick_id: pick.id,
            pregame_sent: tracker?.pregame_sent || true,
            last_status_sent: hedgeAction,
            last_quarter_sent: currentQuarter,
            analysis_date: today,
            live_book_line: actualBook?.line ?? null,
            line_source: lineSource,
          });
        } else {
          // Even if no Telegram message sent, update tracker quarter
          // (but DON'T set last_status_sent so status transitions still trigger messages)
          trackerUpserts.push({
            player_name: pick.player_name,
            prop_type: pick.prop_type,
            line: hedgeLine,
            side: (pick.recommended_side || 'over').toLowerCase(),
            pick_id: pick.id,
            pregame_sent: tracker?.pregame_sent || true,
            last_status_sent: tracker?.last_status_sent || null,
            last_quarter_sent: currentQuarter,
            analysis_date: today,
            live_book_line: actualBook?.line ?? null,
            line_source: lineSource,
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

    // Collect hedge alerts for customer push notifications — use actual computed values
    for (const upsert of trackerUpserts) {
      if (upsert.last_status_sent && ['HEDGE ALERT', 'HEDGE NOW', 'LOCK'].includes(upsert.last_status_sent)) {
        const upsertKey = `${upsert.player_name}::${upsert.prop_type}`;
        const computed = liveComputedByKey[upsertKey];
        hedgePushAlerts.push({
          playerName: upsert.player_name,
          propType: upsert.prop_type,
          line: upsert.line,
          side: upsert.side,
          hedgeAction: upsert.last_status_sent,
          previousStatus: null,
          currentValue: computed?.currentValue ?? 0,
          projectedFinal: computed?.projectedFinal ?? 0,
          gameProgress: computed?.gameProgress ?? 0,
          quarter: computed?.quarter ?? upsert.last_quarter_sent ?? 1,
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
      baselineFgPlayers: Object.keys(baselineFgByPlayer).length,
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
