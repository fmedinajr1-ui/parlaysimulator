import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const HALF_LIFE_MIN = 15;
const MIN_CONFIDENCE = 40;
const TELEGRAM_THRESHOLD = 70;

interface Snapshot {
  id: string;
  event_id: string;
  player_name: string;
  line: number;
  over_price: number | null;
  under_price: number | null;
  opening_line: number | null;
  opening_over_price: number | null;
  opening_under_price: number | null;
  drift_velocity: number | null;
  line_change_from_open: number | null;
  price_change_from_open: number | null;
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

    // RBI lines are almost always 0.5 — the signal is in PRICE movement
    // Price movement thresholds (in American odds points)
    const PRICE_MOVE_THRESHOLD = 15;   // 15+ point price swing = notable
    const PRICE_SPIKE_THRESHOLD = 30;  // 30+ point swing = velocity spike
    const PRICE_SNAPBACK_THRESHOLD = 50; // 50+ from open = snapback candidate

    for (const [key, snaps] of Object.entries(groups)) {
      if (snaps.length < 2) continue;
      const latest = snaps[0];
      const playerName = latest.player_name;
      const eventId = latest.event_id;

      // Only analyze pre-game
      if (latest.hours_to_tip != null && latest.hours_to_tip < 0) continue;

      const currentOver = Number(latest.over_price) || 0;
      const openingOver = Number(latest.opening_over_price) || Number(snaps[snaps.length - 1].over_price) || 0;
      const priceDrift = currentOver - openingOver;
      const absPriceDrift = Math.abs(priceDrift);

      // Pattern 1: Sustained Price Drift (price moving consistently in one direction)
      if (snaps.length >= 3) {
        const priceChanges = snaps.slice(0, Math.min(8, snaps.length)).map((s, i) => {
          if (i >= snaps.length - 1) return 0;
          const next = snaps[i + 1];
          return (Number(s.over_price) || 0) - (Number(next.over_price) || 0);
        }).filter(d => d !== 0);

        if (priceChanges.length >= 2) {
          const positiveCount = priceChanges.filter(d => d > 0).length;
          const negativeCount = priceChanges.filter(d => d < 0).length;
          const consistency = Math.max(positiveCount, negativeCount) / priceChanges.length;

          if (consistency >= 0.6 && absPriceDrift >= PRICE_MOVE_THRESHOLD) {
            // Price going UP on over = market moving toward Over (more value)
            // Price going DOWN on over = market moving toward Under (sharps on under)
            const direction = priceDrift > 0 ? 'over_price_rising' : 'over_price_dropping';
            const prediction = priceDrift > 0 ? 'Over' : 'Under';
            const confidence = Math.min(95, Math.round(
              consistency * 70 + Math.min(absPriceDrift / 2, 25)
            ));

            if (confidence >= MIN_CONFIDENCE) {
              alerts.push({
                player_name: playerName,
                event_id: eventId,
                signal_type: 'price_drift',
                prediction,
                confidence,
                metadata: {
                  direction, consistency: Math.round(consistency * 100),
                  snapshots_analyzed: priceChanges.length,
                  opening_over: openingOver, current_over: currentOver,
                  price_change: priceDrift, line: Number(latest.line),
                },
                event_description: latest.event_description,
                commence_time: latest.commence_time,
              });
            }
          }
        }
      }

      // Pattern 2: Price Velocity Spike (rapid price movement between recent snapshots)
      if (snaps.length >= 2) {
        const recentPriceChange = Math.abs(
          (Number(snaps[0].over_price) || 0) - (Number(snaps[1].over_price) || 0)
        );
        
        if (recentPriceChange >= PRICE_SPIKE_THRESHOLD) {
          const direction = (Number(snaps[0].over_price) || 0) > (Number(snaps[1].over_price) || 0) ? 'up' : 'down';
          const prediction = direction === 'up' ? 'Over' : 'Under';
          const confidence = Math.min(95, Math.round(55 + recentPriceChange / 3));

          if (confidence >= MIN_CONFIDENCE) {
            alerts.push({
              player_name: playerName,
              event_id: eventId,
              signal_type: 'velocity_spike',
              prediction,
              confidence,
              metadata: {
                price_change: recentPriceChange, direction,
                from_price: Number(snaps[1].over_price),
                to_price: Number(snaps[0].over_price),
                line: Number(latest.line),
              },
              event_description: latest.event_description,
              commence_time: latest.commence_time,
            });
          }
        }
      }

      // Pattern 3: Snapback Candidate (price drifted significantly from open)
      if (absPriceDrift >= PRICE_SNAPBACK_THRESHOLD) {
        // Expect correction back toward opening price
        const snapbackPrediction = priceDrift > 0 ? 'Under' : 'Over';
        const confidence = Math.min(90, Math.round(50 + absPriceDrift / 4));

        if (confidence >= MIN_CONFIDENCE) {
          alerts.push({
            player_name: playerName,
            event_id: eventId,
            signal_type: 'snapback_candidate',
            prediction: snapbackPrediction,
            confidence,
            metadata: {
              opening_over: openingOver, current_over: currentOver,
              drift_points: priceDrift,
              expected_correction: snapbackPrediction === 'Over' ? 'price_rise' : 'price_drop',
              line: Number(latest.line),
            },
            event_description: latest.event_description,
            commence_time: latest.commence_time,
          });
        }
      }
    }

    // Pattern 4: Cascade Detection (multiple players in same game, prices moving same direction)
    const eventPriceMoves: Record<string, { player: string; direction: number; change: number; line: number }[]> = {};
    for (const [key, snaps] of Object.entries(groups)) {
      if (snaps.length < 2) continue;
      const latest = snaps[0];
      const openOver = Number(latest.opening_over_price) || Number(snaps[snaps.length - 1].over_price) || 0;
      const curOver = Number(latest.over_price) || 0;
      const diff = curOver - openOver;
      if (Math.abs(diff) < 10) continue; // need at least 10 point move

      const eventId = latest.event_id;
      if (!eventPriceMoves[eventId]) eventPriceMoves[eventId] = [];
      eventPriceMoves[eventId].push({
        player: latest.player_name,
        direction: diff > 0 ? 1 : -1,
        change: diff,
        line: Number(latest.line),
      });
    }

    for (const [eventId, players] of Object.entries(eventPriceMoves)) {
      if (players.length < 2) continue;
      const upCount = players.filter(p => p.direction > 0).length;
      const downCount = players.filter(p => p.direction < 0).length;
      const alignment = Math.max(upCount, downCount) / players.length;

      if (alignment >= 0.6 && Math.max(upCount, downCount) >= 2) {
        const direction = upCount > downCount ? 'over_prices_rising' : 'over_prices_dropping';
        const prediction = upCount > downCount ? 'Over' : 'Under';
        const confidence = Math.min(90, Math.round(55 + alignment * 30 + players.length * 3));
        const firstSnaps = groups[`${eventId}::${players[0].player}`];
        const eventDesc = firstSnaps?.[0]?.event_description || eventId;
        const commenceTime = firstSnaps?.[0]?.commence_time || null;

        alerts.push({
          player_name: `TEAM CASCADE (${players.map(p => p.player).join(', ')})`,
          event_id: eventId,
          signal_type: 'cascade',
          prediction,
          confidence,
          metadata: {
            direction, alignment: Math.round(alignment * 100),
            players_involved: players.length,
            player_details: players.map(p => ({ player: p.player, change: p.change })),
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
        const line = alert.metadata.line || 0.5;

        if (alert.prediction === 'Over' && l10Avg < line * 0.5) {
          log(`L10 block: ${alert.player_name} Over ${line} but L10 avg ${l10Avg.toFixed(1)}`);
          continue;
        }
        if (alert.prediction === 'Under' && l10Avg > line * 2.0) {
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
        'price_drift': '🔮',
        'velocity_spike': '⚡',
        'cascade': '🌊',
        'snapback_candidate': '🔄',
      };

      const lines = telegramAlerts.map(a => {
        const emoji = signalEmojis[a.signal_type] || '📊';
        const l10 = a.metadata.l10_rbi_avg != null ? ` | L10: ${a.metadata.l10_rbi_avg}` : '';
        const priceInfo = a.metadata.price_change != null ? ` | Δ${a.metadata.price_change > 0 ? '+' : ''}${a.metadata.price_change}` : '';
        return `${emoji} ${a.signal_type.replace(/_/g, ' ').toUpperCase()}\n${a.player_name} → ${a.prediction} RBIs (${a.metadata.line})\n🎯 ${a.confidence}% conf${priceInfo}${l10}\n${a.event_description || ''}`;
      });

      const message = `🏟️ *HRB MLB RBI Alerts*\n\n${lines.join('\n\n')}`;

      try {
        await supabase.functions.invoke('bot-send-telegram', {
          body: { message, parse_mode: 'Markdown', admin_only: true },
        });
        log(`Sent ${telegramAlerts.length} alerts to Telegram`);
      } catch (e) {
        log(`Telegram send error: ${e}`);
      }
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
