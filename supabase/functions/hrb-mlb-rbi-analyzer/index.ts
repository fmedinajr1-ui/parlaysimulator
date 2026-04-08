import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const HALF_LIFE_MIN = 15;
const MIN_CONFIDENCE = 40;
const TELEGRAM_THRESHOLD = 70;
const RBI_LINE = 0.5;

// Price movement thresholds (American odds points)
const PRICE_MOVE_THRESHOLD = 15;
const PRICE_SPIKE_THRESHOLD = 30;
const PRICE_SNAPBACK_THRESHOLD = 50;

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

interface PlayerL10Stats {
  l10Avg: number;
  l3Avg: number;
  l10HitRate: number; // % of games with ≥1 RBI (over 0.5)
  l10Games: number;
  trend: string; // 'hot' | 'cold' | 'stable'
}

// Batch fetch L10 RBI stats for multiple players at once
async function batchFetchL10Stats(
  supabase: any,
  playerNames: string[]
): Promise<Record<string, PlayerL10Stats>> {
  const results: Record<string, PlayerL10Stats> = {};
  if (playerNames.length === 0) return results;

  // Deduplicate
  const unique = [...new Set(playerNames)];

  // Batch query - get last 10 games for all players
  const { data: gameLogs } = await supabase
    .from('mlb_player_game_logs')
    .select('player_name, rbis, game_date')
    .in('player_name', unique)
    .order('game_date', { ascending: false })
    .limit(unique.length * 12); // slightly over to ensure coverage

  if (!gameLogs || gameLogs.length === 0) return results;

  // Group by player, take first 10 per player
  const playerGames: Record<string, number[]> = {};
  for (const g of gameLogs) {
    if (!playerGames[g.player_name]) playerGames[g.player_name] = [];
    if (playerGames[g.player_name].length < 10) {
      playerGames[g.player_name].push(Number(g.rbis) || 0);
    }
  }

  for (const [name, rbis] of Object.entries(playerGames)) {
    if (rbis.length < 3) continue;
    const l10Avg = rbis.reduce((s, r) => s + r, 0) / rbis.length;
    const l3 = rbis.slice(0, 3);
    const l3Avg = l3.reduce((s, r) => s + r, 0) / l3.length;
    const l10HitRate = rbis.filter(r => r >= 1).length / rbis.length;

    // Trend: compare L3 to L10
    let trend = 'stable';
    if (l3Avg > l10Avg * 1.3) trend = 'hot';
    else if (l3Avg < l10Avg * 0.7) trend = 'cold';

    results[name] = {
      l10Avg: Math.round(l10Avg * 100) / 100,
      l3Avg: Math.round(l3Avg * 100) / 100,
      l10HitRate: Math.round(l10HitRate * 100) / 100,
      l10Games: rbis.length,
      trend,
    };
  }

  return results;
}

// Determine if a player's L10 confirms the predicted direction
function getPlayerConfirmation(
  stats: PlayerL10Stats,
  prediction: string
): 'confirmed' | 'neutral' | 'contradicted' {
  if (prediction === 'Over') {
    if (stats.l10HitRate >= 0.5) return 'confirmed';
    if (stats.l10HitRate >= 0.3) return 'neutral';
    return 'contradicted';
  } else {
    // Under
    if (stats.l10HitRate <= 0.3) return 'confirmed';
    if (stats.l10HitRate <= 0.5) return 'neutral';
    return 'contradicted';
  }
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

      // Pattern 1: Sustained Price Drift
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
            const direction = priceDrift > 0 ? 'over_price_rising' : 'over_price_dropping';
            const prediction = priceDrift > 0 ? 'Over' : 'Under';
            const confidence = Math.min(95, Math.round(
              consistency * 70 + Math.min(absPriceDrift / 2, 25)
            ));

            if (confidence >= MIN_CONFIDENCE) {
              alerts.push({
                player_name: playerName, event_id: eventId,
                signal_type: 'price_drift', prediction, confidence,
                metadata: {
                  direction, consistency: Math.round(consistency * 100),
                  snapshots_analyzed: priceChanges.length,
                  opening_over: openingOver, current_over: currentOver,
                  price_change: priceDrift, line: RBI_LINE,
                },
                event_description: latest.event_description,
                commence_time: latest.commence_time,
              });
            }
          }
        }
      }

      // Pattern 2: Price Velocity Spike
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
              player_name: playerName, event_id: eventId,
              signal_type: 'velocity_spike', prediction, confidence,
              metadata: {
                price_change: recentPriceChange, direction,
                from_price: Number(snaps[1].over_price),
                to_price: Number(snaps[0].over_price),
                line: RBI_LINE,
              },
              event_description: latest.event_description,
              commence_time: latest.commence_time,
            });
          }
        }
      }

      // Pattern 3: Snapback Candidate
      if (absPriceDrift >= PRICE_SNAPBACK_THRESHOLD) {
        const snapbackPrediction = priceDrift > 0 ? 'Under' : 'Over';
        const confidence = Math.min(90, Math.round(50 + absPriceDrift / 4));

        if (confidence >= MIN_CONFIDENCE) {
          alerts.push({
            player_name: playerName, event_id: eventId,
            signal_type: 'snapback_candidate', prediction: snapbackPrediction, confidence,
            metadata: {
              opening_over: openingOver, current_over: currentOver,
              drift_points: priceDrift,
              expected_correction: snapbackPrediction === 'Over' ? 'price_rise' : 'price_drop',
              line: RBI_LINE,
            },
            event_description: latest.event_description,
            commence_time: latest.commence_time,
          });
        }
      }
    }

    // Pattern 4: Cascade Detection
    const eventPriceMoves: Record<string, { player: string; direction: number; change: number }[]> = {};
    for (const [key, snaps] of Object.entries(groups)) {
      if (snaps.length < 2) continue;
      const latest = snaps[0];
      const openOver = Number(latest.opening_over_price) || Number(snaps[snaps.length - 1].over_price) || 0;
      const curOver = Number(latest.over_price) || 0;
      const diff = curOver - openOver;
      if (Math.abs(diff) < 10) continue;

      const eventId = latest.event_id;
      if (!eventPriceMoves[eventId]) eventPriceMoves[eventId] = [];
      eventPriceMoves[eventId].push({
        player: latest.player_name,
        direction: diff > 0 ? 1 : -1,
        change: diff,
      });
    }

    // Collect all cascade player names for batch L10 lookup
    const cascadePlayerNames: string[] = [];
    const cascadeEvents: { eventId: string; players: { player: string; direction: number; change: number }[] }[] = [];

    for (const [eventId, players] of Object.entries(eventPriceMoves)) {
      if (players.length < 2) continue;
      const upCount = players.filter(p => p.direction > 0).length;
      const downCount = players.filter(p => p.direction < 0).length;
      const alignment = Math.max(upCount, downCount) / players.length;

      if (alignment >= 0.6 && Math.max(upCount, downCount) >= 2) {
        cascadeEvents.push({ eventId, players });
        for (const p of players) cascadePlayerNames.push(p.player);
      }
    }

    // Batch fetch L10 stats for ALL players (individual alerts + cascades)
    const allPlayerNames = [
      ...alerts.filter(a => a.signal_type !== 'cascade').map(a => a.player_name),
      ...cascadePlayerNames,
    ];
    const l10Stats = await batchFetchL10Stats(supabase, allPlayerNames);
    log(`Fetched L10 stats for ${Object.keys(l10Stats).length} players`);

    // Build cascade alerts with per-player L10 enrichment
    for (const { eventId, players } of cascadeEvents) {
      const upCount = players.filter(p => p.direction > 0).length;
      const downCount = players.filter(p => p.direction < 0).length;
      const direction = upCount > downCount ? 'over_prices_rising' : 'over_prices_dropping';
      const prediction = upCount > downCount ? 'Over' : 'Under';
      const alignment = Math.max(upCount, downCount) / players.length;
      let confidence = Math.min(90, Math.round(55 + alignment * 30 + players.length * 3));

      const firstSnaps = groups[`${eventId}::${players[0].player}`];
      const eventDesc = firstSnaps?.[0]?.event_description || eventId;
      const commenceTime = firstSnaps?.[0]?.commence_time || null;

      // Per-player L10 analysis
      const playerBreakdown: { player: string; change: number; status: string; l10Avg?: number; l10HitRate?: number; l3Avg?: number; trend?: string }[] = [];
      let confirmed = 0;
      let neutral = 0;
      let contradicted = 0;

      for (const p of players) {
        const stats = l10Stats[p.player];
        if (!stats) {
          playerBreakdown.push({ player: p.player, change: p.change, status: 'no_data' });
          neutral++;
          continue;
        }

        const confirmation = getPlayerConfirmation(stats, prediction);
        if (confirmation === 'confirmed') confirmed++;
        else if (confirmation === 'neutral') neutral++;
        else contradicted++;

        playerBreakdown.push({
          player: p.player, change: p.change, status: confirmation,
          l10Avg: stats.l10Avg, l10HitRate: stats.l10HitRate,
          l3Avg: stats.l3Avg, trend: stats.trend,
        });
      }

      const totalWithData = confirmed + neutral + contradicted;
      const confirmedRatio = totalWithData > 0 ? confirmed / totalWithData : 0.5;

      // Block cascade if <40% of players confirm
      if (totalWithData >= 2 && confirmedRatio < 0.4) {
        log(`Cascade blocked: ${eventDesc} — only ${confirmed}/${totalWithData} confirm ${prediction}`);
        continue;
      }

      // Adjust confidence based on confirmation ratio
      confidence = Math.round(confidence * (confirmedRatio * 0.6 + 0.4));

      if (confidence < MIN_CONFIDENCE) continue;

      alerts.push({
        player_name: `TEAM CASCADE (${players.map(p => p.player).join(', ')})`,
        event_id: eventId,
        signal_type: 'cascade',
        prediction,
        confidence,
        metadata: {
          direction, alignment: Math.round(alignment * 100),
          players_involved: players.length,
          line: RBI_LINE,
          confirmed, neutral, contradicted,
          confirmed_ratio: Math.round(confirmedRatio * 100),
          player_breakdown: playerBreakdown,
        },
        event_description: eventDesc,
        commence_time: commenceTime,
      });
    }

    log(`Detected ${alerts.length} raw alerts`);

    // L10 validation for individual (non-cascade) alerts using batched stats
    const validatedAlerts: Alert[] = [];
    for (const alert of alerts) {
      if (alert.signal_type === 'cascade') {
        // Already validated during cascade construction
        validatedAlerts.push(alert);
        continue;
      }

      const stats = l10Stats[alert.player_name];
      if (stats) {
        // Tightened blocking: use hit rate instead of average
        if (alert.prediction === 'Over' && stats.l10HitRate < 0.3) {
          log(`L10 block: ${alert.player_name} Over — hit rate ${(stats.l10HitRate * 100).toFixed(0)}% (<30%)`);
          continue;
        }
        if (alert.prediction === 'Under' && stats.l10HitRate > 0.8) {
          log(`L10 block: ${alert.player_name} Under — hit rate ${(stats.l10HitRate * 100).toFixed(0)}% (>80%)`);
          continue;
        }

        alert.metadata.l10_rbi_avg = stats.l10Avg;
        alert.metadata.l3_rbi_avg = stats.l3Avg;
        alert.metadata.l10_hit_rate = stats.l10HitRate;
        alert.metadata.l10_sample = stats.l10Games;
        alert.metadata.trend = stats.trend;
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

        if (a.signal_type === 'cascade') {
          // Rich cascade message with per-player breakdown
          const bd = a.metadata.player_breakdown || [];
          const statusEmoji = (s: string) => s === 'confirmed' ? '✅' : s === 'contradicted' ? '❌' : '⚠️';
          const trendEmoji = (t: string) => t === 'hot' ? '🔥' : t === 'cold' ? '🧊' : '';

          const playerLines = bd.map((p: any) => {
            if (p.status === 'no_data') return `⚪ ${p.player}: No L10 data`;
            const hitPct = Math.round((p.l10HitRate || 0) * 100);
            const hitCount = Math.round((p.l10HitRate || 0) * (l10Stats[p.player]?.l10Games || 10));
            const games = l10Stats[p.player]?.l10Games || 10;
            return `${statusEmoji(p.status)} ${p.player}: L10 ${p.l10Avg} avg (${hitCount}/${games} over) ${trendEmoji(p.trend || '')}`;
          }).join('\n');

          return `${emoji} CASCADE\n${a.event_description || ''} → ${a.prediction} ${a.metadata.line} RBIs\n🎯 ${a.confidence}% conf | ${a.metadata.confirmed}/${a.metadata.players_involved} players confirm\n\n${playerLines}`;
        }

        // Individual alert with enriched L10 data
        const l10Info: string[] = [];
        if (a.metadata.l10_rbi_avg != null) {
          const hitPct = Math.round((a.metadata.l10_hit_rate || 0) * 100);
          const hitCount = Math.round((a.metadata.l10_hit_rate || 0) * (a.metadata.l10_sample || 10));
          l10Info.push(`L10: ${a.metadata.l10_rbi_avg} avg (${hitCount}/${a.metadata.l10_sample} over)`);
        }
        if (a.metadata.l3_rbi_avg != null) {
          const trendE = a.metadata.trend === 'hot' ? '🔥' : a.metadata.trend === 'cold' ? '🧊' : '';
          l10Info.push(`L3: ${a.metadata.l3_rbi_avg} ${trendE}`);
        }
        const priceInfo = a.metadata.price_change != null ? `Δ${a.metadata.price_change > 0 ? '+' : ''}${a.metadata.price_change}` : '';

        return `${emoji} ${a.signal_type.replace(/_/g, ' ').toUpperCase()}\n${a.player_name} → ${a.prediction} ${a.metadata.line} RBIs\n🎯 ${a.confidence}% conf${priceInfo ? ` | ${priceInfo}` : ''}\n${l10Info.length > 0 ? l10Info.join(' | ') + '\n' : ''}${a.event_description || ''}`;
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
      l10_players_fetched: Object.keys(l10Stats).length,
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
