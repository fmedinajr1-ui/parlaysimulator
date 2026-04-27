import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { formatPlayerReasoningLines, verdictBadge, type PlayerReasoning, type GroupReasoning } from '../_shared/alert-explainer.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MIN_CONFIDENCE = 60;
const LOOKBACK_HOURS = 6;          // only consider recent alerts
const PER_RUN_CAP = 25;            // hard cap on Telegram messages per run
const MIN_MINUTES_TO_TIPOFF = 5;   // skip alerts whose game already started
const MAX_PLAYERS_RENDERED = 5;    // cap per-cascade detail to keep messages under Telegram's 4096 cap
const MAX_MESSAGE_CHARS = 3500;    // safety margin under Telegram's 4096 limit

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
    const players: any[] = Array.isArray(meta.player_breakdown) ? meta.player_breakdown : [];
    const group = (meta.group_reasoning ?? null) as GroupReasoning | null;
    const counts = (meta.verdict_counts ?? {}) as { strong?: number; lean?: number; weak?: number };

    const out: string[] = [];
    out.push(`🌊 *CASCADE ALERT* — ${escapeMd(sport)}`);
    out.push(`${players.length} players aligned on the same side.`);
    out.push('');
    out.push(`🎯 ${escapeMd(prop)} *${escapeMd(side)}*  •  ${sideEmoji(side)} avg conf ${Math.round(conf)}%`);
    out.push(`🏟️ ${escapeMd(game)}  •  ${escapeMd(tipoff)}`);

    if (group?.headline_bullets?.length) {
      out.push('');
      out.push(`*Why this side:*`);
      for (const b of group.headline_bullets.slice(0, 3)) out.push(`• ${escapeMd(b)}`);
    }

    if (counts && (counts.strong || counts.lean || counts.weak)) {
      out.push('');
      out.push(`*Verdict mix:* ✅ ${counts.strong ?? 0} strong  ·  ⚠️ ${counts.lean ?? 0} lean  ·  ❌ ${counts.weak ?? 0} weak`);
    }

    out.push('');
    out.push(`*Players in the cascade:*`);

    // Sort STRONG → LEAN → WEAK so the message leads with the highest-conviction legs
    const order = { STRONG: 0, LEAN: 1, WEAK: 2 } as const;
    const sorted = [...players].sort((a, b) => {
      const av = order[(a.engine_reasoning?.verdict as keyof typeof order) ?? 'LEAN'];
      const bv = order[(b.engine_reasoning?.verdict as keyof typeof order) ?? 'LEAN'];
      return av - bv;
    });

    const rendered = sorted.slice(0, MAX_PLAYERS_RENDERED);
    for (const p of rendered) {
      const r = p.engine_reasoning as PlayerReasoning | null | undefined;
      const sideStr = String(p.side ?? side);
      const lineNum = Number(p.line ?? 0);
      const cnf = Number(p.confidence ?? 0);
      if (r) {
        const lines = formatPlayerReasoningLines(p.player ?? '', sideStr === 'Over' ? 'Over' : 'Under', lineNum, cnf, r);
        for (const ln of lines) out.push(escapeMd(ln));
      } else {
        out.push(escapeMd(`• ${p.player ?? ''}  ${(sideStr[0] ?? '?')} ${lineNum}  conf ${Math.round(cnf)}%`));
      }
    }
    if (sorted.length > MAX_PLAYERS_RENDERED) {
      out.push(`_+${sorted.length - MAX_PLAYERS_RENDERED} more players — see dashboard_`);
    }

    let msg = out.join('\n');
    if (msg.length > MAX_MESSAGE_CHARS) {
      msg = msg.slice(0, MAX_MESSAGE_CHARS - 32) + '\n…_truncated for length_';
    }
    return msg;
  }

  if (a.signal_type === 'take_it_now') {
    const gap = Number(meta.juice_gap ?? 0);
    const overP = Number(meta.over_price ?? 0);
    const underP = Number(meta.under_price ?? 0);
    const fmt = (n: number) => (n > 0 ? `+${n}` : `${n}`);
    const r = (meta.engine_reasoning ?? null) as PlayerReasoning | null;
    const out: string[] = [
      `⚡ *TAKE IT NOW* — ${escapeMd(sport)}`,
      `Steepest juice gap in this game — the book is openly favoring one side.`,
      ``,
      `🎯 ${escapeMd(a.player_name)}  ${escapeMd(prop)}`,
      `${sideEmoji(side)} *${escapeMd(side)}*  •  confidence ${Math.round(conf)}%`,
      `💰 prices: Over ${fmt(overP)} / Under ${fmt(underP)}  •  gap ${Math.round(gap)}`,
      `🏟️ ${escapeMd(game)}  •  ${escapeMd(tipoff)}`,
    ];
    if (r) {
      out.push('');
      out.push(`*Engine reasoning:* ${verdictBadge(r.verdict)}`);
      out.push(escapeMd(`↳ ${r.headline}`));
      if (r.matchup.opponent_team && (r.matchup.position_defense_rank ?? r.matchup.defense_rank) != null) {
        const dr = r.matchup.position_defense_rank ?? r.matchup.defense_rank;
        out.push(escapeMd(`↳ vs ${r.matchup.opponent_team} D rank #${dr}${r.form.l10_total ? ` · L10 ${side} ${r.form.l10_hits}/${r.form.l10_total}` : ''}`));
      }
      if (r.flags.length > 0) out.push(escapeMd(`↳ flags: ${r.flags.join(', ')}`));
    }
    return out.join('\n');
  }

  if (a.signal_type === 'velocity_spike') {
    const cohortAvg = Number(meta.cohort_avg_confidence ?? 0);
    const pct = Number(meta.percentile_rank ?? 0);
    const r = (meta.engine_reasoning ?? null) as PlayerReasoning | null;
    const out: string[] = [
      `🚀 *SLATE OUTLIER* — ${escapeMd(sport)}`,
      `One of the rarest-priced ${escapeMd(prop)} props on the slate today.`,
      ``,
      `🎯 ${escapeMd(a.player_name)}  ${escapeMd(prop)}`,
      `${sideEmoji(side)} *${escapeMd(side)}*  •  confidence ${Math.round(conf)}%`,
      `📊 top ${pct}% of ${meta.cohort_size ?? '?'} similar props (slate avg ${cohortAvg}%)`,
      `🏟️ ${escapeMd(game)}  •  ${escapeMd(tipoff)}`,
    ];
    if (r) {
      out.push('');
      out.push(`*Engine reasoning:* ${verdictBadge(r.verdict)}`);
      out.push(escapeMd(`↳ ${r.headline}`));
      if (r.matchup.opponent_team && (r.matchup.position_defense_rank ?? r.matchup.defense_rank) != null) {
        const dr = r.matchup.position_defense_rank ?? r.matchup.defense_rank;
        out.push(escapeMd(`↳ vs ${r.matchup.opponent_team} D rank #${dr}${r.form.l10_total ? ` · L10 ${side} ${r.form.l10_hits}/${r.form.l10_total}` : ''}`));
      }
    }
    return out.join('\n');
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