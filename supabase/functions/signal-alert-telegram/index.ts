import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MIN_CONFIDENCE = 60;
const LOOKBACK_HOURS = 6;          // only consider recent alerts
const PER_RUN_CAP = 25;            // hard cap on Telegram messages per run
const MIN_MINUTES_TO_TIPOFF = 5;   // skip alerts whose game already started

function easternDate(d: Date = new Date()): string {
  // YYYY-MM-DD in America/New_York
  return new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }))
    .toISOString()
    .slice(0, 10);
}

function escapeMd(s: string): string {
  // Telegram Markdown (legacy) — escape the few characters that break formatting
  return s.replace(/([_*`\[])/g, '\\$1');
}

function prettyProp(p: string | null | undefined): string {
  if (!p) return '';
  return p
    .replace(/^batter_/, '')
    .replace(/^player_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function sideEmoji(side: string | null | undefined): string {
  const s = (side ?? '').toLowerCase();
  if (s.includes('over') || s === 'yes') return '⬆️';
  if (s.includes('under') || s === 'no') return '⬇️';
  return '🎯';
}

type Alert = {
  id: string;
  player_name: string;
  event_id: string;
  signal_type: string;
  prediction: string | null;
  confidence: number | null;
  prop_type: string | null;
  sport: string | null;
  bookmaker: string | null;
  event_description: string | null;
  commence_time: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

function formatAlert(a: Alert): string {
  const conf = Number(a.confidence ?? 0);
  const prop = prettyProp(a.prop_type);
  const side = a.prediction ?? '';
  const game = a.event_description ?? 'Game TBD';
  const sport = a.sport ?? '';
  const tipoff = a.commence_time
    ? new Date(a.commence_time).toLocaleString('en-US', {
        timeZone: 'America/New_York',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
      })
    : 'TBD';

  const meta = (a.metadata ?? {}) as Record<string, any>;

  if (a.signal_type === 'cascade') {
    const players = Array.isArray(meta.player_breakdown) ? meta.player_breakdown : [];
    const lines = players
      .slice(0, 5)
      .map((p: any) => `   • ${escapeMd(p.player ?? '')} — conf ${Math.round(Number(p.confidence ?? 0))}`)
      .join('\n');
    return [
      `🌊 *CASCADE ALERT* — ${escapeMd(sport)}`,
      `Three or more plays moving the same way on the same game.`,
      ``,
      `🎯 ${escapeMd(prop)} *${escapeMd(side)}*  •  ${sideEmoji(side)} confidence ${Math.round(conf)}%`,
      `🏟️ ${escapeMd(game)}  •  ${escapeMd(tipoff)}`,
      ``,
      `*Players in the cascade:*`,
      lines || `   • ${escapeMd(a.player_name)}`,
    ].join('\n');
  }

  if (a.signal_type === 'take_it_now') {
    const gap = Number(meta.juice_gap ?? 0);
    const overP = Number(meta.over_price ?? 0);
    const underP = Number(meta.under_price ?? 0);
    const fmt = (n: number) => (n > 0 ? `+${n}` : `${n}`);
    return [
      `⚡ *TAKE IT NOW* — ${escapeMd(sport)}`,
      `Steepest juice gap in this game — the book is openly favoring one side.`,
      ``,
      `🎯 ${escapeMd(a.player_name)}  ${escapeMd(prop)}`,
      `${sideEmoji(side)} *${escapeMd(side)}*  •  confidence ${Math.round(conf)}%`,
      `💰 prices: Over ${fmt(overP)} / Under ${fmt(underP)}  •  gap ${Math.round(gap)}`,
      `🏟️ ${escapeMd(game)}  •  ${escapeMd(tipoff)}`,
    ].join('\n');
  }

  if (a.signal_type === 'velocity_spike') {
    const cohortAvg = Number(meta.cohort_avg_confidence ?? 0);
    const pct = Number(meta.percentile_rank ?? 0);
    return [
      `🚀 *SLATE OUTLIER* — ${escapeMd(sport)}`,
      `One of the rarest-priced ${escapeMd(prop)} props on the slate today.`,
      ``,
      `🎯 ${escapeMd(a.player_name)}  ${escapeMd(prop)}`,
      `${sideEmoji(side)} *${escapeMd(side)}*  •  confidence ${Math.round(conf)}%`,
      `📊 top ${pct}% of ${meta.cohort_size ?? '?'} similar props (slate avg ${cohortAvg}%)`,
      `🏟️ ${escapeMd(game)}  •  ${escapeMd(tipoff)}`,
    ].join('\n');
  }

  // Generic fallback (e.g. legacy snapback rows still in the table)
  return [
    `📡 *${escapeMd(a.signal_type.toUpperCase())}* — ${escapeMd(sport)}`,
    `🎯 ${escapeMd(a.player_name)}  ${escapeMd(prop)}  *${escapeMd(side)}*  •  ${Math.round(conf)}%`,
    `🏟️ ${escapeMd(game)}  •  ${escapeMd(tipoff)}`,
  ].join('\n');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  const adminChatId = Deno.env.get('TELEGRAM_CHAT_ID');
  if (!adminChatId) {
    return new Response(JSON.stringify({ success: false, error: 'TELEGRAM_CHAT_ID not configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const stats = { considered: 0, sent: 0, skipped_tipoff: 0, skipped_dupe: 0, skipped_low_conf: 0, errors: 0 };

  try {
    const since = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
    const { data: alerts, error } = await supabase
      .from('fanduel_prediction_alerts')
      .select('id,player_name,event_id,signal_type,prediction,confidence,prop_type,sport,bookmaker,event_description,commence_time,metadata,created_at')
      .in('signal_type', ['cascade', 'take_it_now', 'velocity_spike'])
      .gte('created_at', since)
      .gte('confidence', MIN_CONFIDENCE)
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) throw error;
    const candidates = (alerts ?? []) as Alert[];
    stats.considered = candidates.length;

    if (candidates.length === 0) {
      return new Response(JSON.stringify({ success: true, stats, message: 'no candidates' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Skip already-broadcast (same alert_id + chat)
    const { data: alreadySent } = await supabase
      .from('bot_signal_broadcasts')
      .select('alert_id')
      .in('alert_id', candidates.map((c) => c.id))
      .eq('chat_id', adminChatId);
    const sentSet = new Set((alreadySent ?? []).map((r) => r.alert_id));

    const now = Date.now();
    let sent = 0;

    for (const alert of candidates) {
      if (sent >= PER_RUN_CAP) break;
      if (sentSet.has(alert.id)) {
        stats.skipped_dupe += 1;
        continue;
      }
      if (Number(alert.confidence ?? 0) < MIN_CONFIDENCE) {
        stats.skipped_low_conf += 1;
        continue;
      }
      if (alert.commence_time) {
        const minsToTipoff = (new Date(alert.commence_time).getTime() - now) / 60000;
        if (minsToTipoff < MIN_MINUTES_TO_TIPOFF) {
          stats.skipped_tipoff += 1;
          continue;
        }
      }

      const message = formatAlert(alert);
      const { data: sendResult, error: sendErr } = await supabase.functions.invoke('bot-send-telegram', {
        body: {
          message,
          parse_mode: 'Markdown',
          type: 'signal_alert',
          reference_key: alert.id,
          format_version: 'v1',
        },
      });

      if (sendErr || !sendResult?.success) {
        console.error('[signal-alert-telegram] send failed:', sendErr ?? sendResult);
        stats.errors += 1;
        continue;
      }

      const messageId =
        typeof sendResult?.message_id === 'number' ? sendResult.message_id : null;

      const { error: logErr } = await supabase.from('bot_signal_broadcasts').insert({
        alert_id: alert.id,
        chat_id: adminChatId,
        signal_type: alert.signal_type,
        alert_date: easternDate(new Date(alert.created_at)),
        message_id: messageId,
      });
      if (logErr) {
        // unique violation = race; just count and continue
        console.error('[signal-alert-telegram] log insert failed:', logErr);
      }
      sent += 1;
      stats.sent += 1;
    }

    return new Response(JSON.stringify({ success: true, stats }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[signal-alert-telegram] fatal:', msg);
    return new Response(JSON.stringify({ success: false, error: msg, stats }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});