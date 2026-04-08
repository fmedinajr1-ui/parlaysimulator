import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const HALF_LIFE_MIN = 15;
const MIN_CONFIDENCE = 40; // Lower for RBI props which have subtler movement
const TELEGRAM_THRESHOLD = 75;

interface Snapshot {
  id: string;
  event_id: string;
  player_name: string;
  line: number;
  over_price: number | null;
  under_price: number | null;
  opening_line: number | null;
  drift_velocity: number | null;
  line_change_from_open: number | null;
  snapshot_time: string;
  event_description: string | null;
  commence_time: string | null;
  hours_to_tip: number | null;
}

interface Alert {
  player_name: string;
  event_id: string;
  signal_type: string;
  prediction: string;
  confidence: number;
  metadata: Record<string, any>;
  event_description: string | null;
  commence_time: string | null;
}

function timeDecayWeight(snapshotTime: string): number {
  const ageMin = (Date.now() - new Date(snapshotTime).getTime()) / 60000;
  return Math.exp(-0.693 * ageMin / HALF_LIFE_MIN);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);
  const log = (msg: string) => console.log(`[hrb-rbi-analyzer] ${msg}`);

  try {
    // Load recent snapshots (last 6 hours)
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const { data: snapshots, error: snapErr } = await supabase
      .from('hrb_rbi_line_timeline')
      .select('*')
      .gte('snapshot_time', sixHoursAgo)
      .order('snapshot_time', { ascending: false });

    if (snapErr) throw new Error(`Snapshot query error: ${JSON.stringify(snapErr)}`);
    if (!snapshots || snapshots.length === 0) {
      log('No recent snapshots found');
      return new Response(JSON.stringify({ success: true, alerts: 0, message: 'No data' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    log(`Loaded ${snapshots.length} recent snapshots`);

    // Group by player+event
    const groups: Record<string, Snapshot[]> = {};
    for (const s of snapshots) {
      const key = `${s.event_id}::${s.player_name}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(s);
    }

    const alerts: Alert[] = [];

    // Load adaptive thresholds from historical accuracy
    const { data: accuracyData } = await supabase
      .from('fanduel_prediction_accuracy')
      .select('signal_type, was_correct, drift_pct_at_alert')
      .eq('bookmaker', 'hrb')
      .not('was_correct', 'is', null)
      .limit(500);

    let velocityThreshold = 0.005; // RBI lines move in 0.5 increments, need lower threshold
    if (accuracyData && accuracyData.length >= 20) {
      const correctDrifts = accuracyData
        .filter((a: any) => a.was_correct && a.drift_pct_at_alert)
        .map((a: any) => Math.abs(a.drift_pct_at_alert));
      if (correctDrifts.length > 5) {
        correctDrifts.sort((a: number, b: number) => a - b);
        velocityThreshold = correctDrifts[Math.floor(correctDrifts.length * 0.25)] || 0.02;
      }
    }
    log(`Adaptive velocity threshold: ${velocityThreshold}`);

    // Pattern 1-4: Per-player analysis
    for (const [key, snaps] of Object.entries(groups)) {
      if (snaps.length < 2) continue;
      const latest = snaps[0];
      const playerName = latest.player_name;
      const eventId = latest.event_id;

      // Only analyze pre-game
      if (latest.hours_to_tip != null && latest.hours_to_tip < 0) continue;

      // Pattern 1: Line About to Move (sustained directional drift)
      if (snaps.length >= 3) {
        const directions = snaps.slice(0, 5).map((s, i) => {
          if (i === snaps.length - 1) return 0;
          const next = snaps[i + 1];
          return Number(s.line) - Number(next.line);
        }).filter(d => d !== 0);

        if (directions.length >= 2) {
          const positiveCount = directions.filter(d => d > 0).length;
          const negativeCount = directions.filter(d => d < 0).length;
          const consistency = Math.max(positiveCount, negativeCount) / directions.length;

          if (consistency >= 0.6) {
            const direction = positiveCount > negativeCount ? 'up' : 'down';
            const prediction = direction === 'up' ? 'Over' : 'Under';
            const weightedMag = directions.reduce((sum, d, i) =>
              sum + Math.abs(d) * timeDecayWeight(snaps[i].snapshot_time), 0);
            const confidence = Math.min(95, Math.round(consistency * 100 * (1 + weightedMag)));

            if (confidence >= MIN_CONFIDENCE) {
              alerts.push({
                player_name: playerName,
                event_id: eventId,
                signal_type: 'line_about_to_move',
                prediction,
                confidence,
                metadata: {
                  direction, consistency: Math.round(consistency * 100),
                  snapshots_analyzed: directions.length,
                  line_from: Number(snaps[snaps.length - 1].line),
                  line_to: Number(latest.line),
                },
                event_description: latest.event_description,
                commence_time: latest.commence_time,
              });
            }
          }
        }
      }

      // Pattern 2: Velocity Spike
      const velocity = latest.drift_velocity != null ? Math.abs(Number(latest.drift_velocity)) : 0;
      if (velocity > velocityThreshold) {
        const direction = Number(latest.drift_velocity) > 0 ? 'up' : 'down';
        const prediction = direction === 'up' ? 'Over' : 'Under';
        const confidence = Math.min(95, Math.round(60 + velocity * 500));

        if (confidence >= MIN_CONFIDENCE) {
          alerts.push({
            player_name: playerName,
            event_id: eventId,
            signal_type: 'velocity_spike',
            prediction,
            confidence,
            metadata: {
              velocity: Math.round(velocity * 1000) / 1000,
              direction,
              threshold: velocityThreshold,
              line: Number(latest.line),
            },
            event_description: latest.event_description,
            commence_time: latest.commence_time,
          });
        }
      }

      // Pattern 3: Snapback Candidate (8%+ drift from open)
      const openLine = Number(latest.opening_line);
      const currentLine = Number(latest.line);
      if (openLine > 0) {
        const driftPct = Math.abs(currentLine - openLine) / openLine;
        if (driftPct >= 0.04) { // RBI lines are small (0.5-1.5), 4% drift is significant
          const snapbackDir = currentLine > openLine ? 'down' : 'up';
          const prediction = snapbackDir === 'up' ? 'Over' : 'Under';
          const confidence = Math.min(90, Math.round(55 + driftPct * 200));

          if (confidence >= MIN_CONFIDENCE) {
            alerts.push({
              player_name: playerName,
              event_id: eventId,
              signal_type: 'snapback_candidate',
              prediction,
              confidence,
              metadata: {
                opening_line: openLine,
                current_line: currentLine,
                drift_pct: Math.round(driftPct * 100),
                expected_correction: snapbackDir,
              },
              event_description: latest.event_description,
              commence_time: latest.commence_time,
            });
          }
        }
      }
    }

    // Pattern 4: Cascade Detection (team-level, 2+ players moving same direction)
    const eventGroups: Record<string, { player: string; direction: number; line: number }[]> = {};
    for (const [key, snaps] of Object.entries(groups)) {
      if (snaps.length < 2) continue;
      const latest = snaps[0];
      const prev = snaps[1];
      const diff = Number(latest.line) - Number(prev.line);
      if (diff === 0) continue;

      const eventId = latest.event_id;
      if (!eventGroups[eventId]) eventGroups[eventId] = [];
      eventGroups[eventId].push({
        player: latest.player_name,
        direction: diff > 0 ? 1 : -1,
        line: Number(latest.line),
      });
    }

    for (const [eventId, players] of Object.entries(eventGroups)) {
      if (players.length < 2) continue;
      const upCount = players.filter(p => p.direction > 0).length;
      const downCount = players.filter(p => p.direction < 0).length;
      const alignment = Math.max(upCount, downCount) / players.length;

      if (alignment >= 0.65 && Math.max(upCount, downCount) >= 2) {
        const direction = upCount > downCount ? 'up' : 'down';
        const prediction = direction === 'up' ? 'Over' : 'Under';
        const confidence = Math.min(90, Math.round(60 + alignment * 30));
        const firstPlayer = players[0];
        const eventSnaps = groups[`${eventId}::${firstPlayer.player}`];
        const eventDesc = eventSnaps?.[0]?.event_description || eventId;
        const commenceTime = eventSnaps?.[0]?.commence_time || null;

        alerts.push({
          player_name: `TEAM CASCADE (${players.map(p => p.player).join(', ')})`,
          event_id: eventId,
          signal_type: 'cascade',
          prediction,
          confidence,
          metadata: {
            direction, alignment: Math.round(alignment * 100),
            players_involved: players.length,
            player_details: players,
          },
          event_description: eventDesc,
          commence_time: commenceTime,
        });
      }
    }

    log(`Detected ${alerts.length} raw alerts`);

    // L10 validation via mlb_player_game_logs
    const validatedAlerts: Alert[] = [];
    for (const alert of alerts) {
      if (alert.signal_type === 'cascade') {
        validatedAlerts.push(alert);
        continue;
      }

      const { data: gameLogs } = await supabase
        .from('mlb_player_game_logs')
        .select('rbis')
        .eq('player_name', alert.player_name)
        .order('game_date', { ascending: false })
        .limit(10);

      if (gameLogs && gameLogs.length >= 3) {
        const l10Avg = gameLogs.reduce((s: number, g: any) => s + (Number(g.rbis) || 0), 0) / gameLogs.length;
        const line = alert.metadata.line || alert.metadata.current_line || 0;

        // Validate: Over prediction needs L10 avg >= line, Under needs L10 avg <= line
        if (alert.prediction === 'Over' && l10Avg < line * 0.7) {
          log(`L10 block: ${alert.player_name} Over ${line} but L10 avg ${l10Avg.toFixed(1)}`);
          continue;
        }
        if (alert.prediction === 'Under' && l10Avg > line * 1.3) {
          log(`L10 block: ${alert.player_name} Under ${line} but L10 avg ${l10Avg.toFixed(1)}`);
          continue;
        }

        alert.metadata.l10_rbi_avg = Math.round(l10Avg * 100) / 100;
        alert.metadata.l10_sample = gameLogs.length;
      }

      validatedAlerts.push(alert);
    }

    log(`${validatedAlerts.length} alerts after L10 validation`);

    // Deduplicate: best per player per event
    const bestAlerts: Record<string, Alert> = {};
    for (const alert of validatedAlerts) {
      const dedupeKey = `${alert.event_id}::${alert.player_name}`;
      if (!bestAlerts[dedupeKey] || alert.confidence > bestAlerts[dedupeKey].confidence) {
        bestAlerts[dedupeKey] = alert;
      }
    }

    const finalAlerts = Object.values(bestAlerts);
    log(`${finalAlerts.length} final alerts after dedup`);

    // Insert into fanduel_prediction_alerts
    if (finalAlerts.length > 0) {
      const alertRows = finalAlerts.map(a => ({
        player_name: a.player_name,
        event_id: a.event_id,
        signal_type: a.signal_type,
        prediction: a.prediction,
        confidence: a.confidence,
        prop_type: 'batter_rbis',
        sport: 'MLB',
        bookmaker: 'hrb',
        event_description: a.event_description,
        commence_time: a.commence_time,
        metadata: a.metadata,
      }));

      const { error: insertErr } = await supabase
        .from('fanduel_prediction_alerts')
        .insert(alertRows);

      if (insertErr) {
        log(`Alert insert error: ${JSON.stringify(insertErr)}`);
      } else {
        log(`Inserted ${alertRows.length} alerts`);
      }
    }

    // Telegram for high-confidence alerts
    const telegramAlerts = finalAlerts.filter(a => a.confidence >= TELEGRAM_THRESHOLD);
    if (telegramAlerts.length > 0) {
      const signalEmojis: Record<string, string> = {
        'line_about_to_move': '🔮',
        'velocity_spike': '⚡',
        'cascade': '🌊',
        'snapback_candidate': '🔄',
      };

      const lines = telegramAlerts.map(a => {
        const emoji = signalEmojis[a.signal_type] || '📊';
        const l10 = a.metadata.l10_rbi_avg ? ` | L10: ${a.metadata.l10_rbi_avg}` : '';
        return `${emoji} ${a.signal_type.replace(/_/g, ' ').toUpperCase()}\n${a.player_name} → ${a.prediction} RBIs\n🎯 ${a.confidence}% conf${l10}\n${a.event_description || ''}`;
      });

      const message = `🏟️ *HRB MLB RBI Alerts*\n\n${lines.join('\n\n')}`;

      try {
        await supabase.functions.invoke('bot-send-telegram', {
          body: { message, parse_mode: 'Markdown', admin_only: true },
        });
      } catch (_) { /* ignore */ }
    }

    return new Response(JSON.stringify({
      success: true,
      snapshots_analyzed: snapshots.length,
      raw_alerts: alerts.length,
      validated_alerts: validatedAlerts.length,
      final_alerts: finalAlerts.length,
      telegram_sent: telegramAlerts.length,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    log(`Fatal: ${error}`);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
