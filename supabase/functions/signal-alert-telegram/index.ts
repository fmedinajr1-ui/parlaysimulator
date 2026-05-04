import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { formatPlayerReasoningLines, verdictBadge, buildCounterRead, type PlayerReasoning, type GroupReasoning } from '../_shared/alert-explainer.ts';
import { formatPlayerReasoningPlain } from '../_shared/alert-explainer.ts';
import { formatRoleLine, type PlayerRoleContext } from '../_shared/player-role-context.ts';
import { buildCascadeSim, formatCascadeSimLines, formatCascadeSimPlain } from '../_shared/cascade-sim.ts';
import { spikeNarrate, type SpikeActionKind } from '../_shared/spike-narrator.ts';

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

function formatAlert(a: Alert): string | string[] {
  const conf = Number(a.confidence ?? 0);
  const prop = prettyProp(a.prop_type);
  const side = a.prediction ?? '';
  const game = a.event_description ?? "Tonight's slate";
  const sport = a.sport ?? '';
  let tipoff = '';
  if (a.commence_time) {
    const t = new Date(a.commence_time);
    if (!isNaN(t.getTime())) {
      tipoff = t.toLocaleString('en-US', {
        timeZone: 'America/New_York',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
      });
    }
  }

  const meta = (a.metadata ?? {}) as Record<string, any>;

  if (a.signal_type === 'cascade') {
    const players: any[] = Array.isArray(meta.player_breakdown) ? meta.player_breakdown : [];
    const group = (meta.group_reasoning ?? null) as GroupReasoning | null;
    const counts = (meta.verdict_counts ?? {}) as { strong?: number; lean?: number; neutral?: number; weak?: number };

    // ─── Recommended action header ───
    // Reads verdict_counts to give a single-line decision instead of forcing the user
    // to interpret the WEAK/LEAN/STRONG mix themselves.
    const sN = Number(counts.strong ?? 0);
    const lN = Number(counts.lean ?? 0);
    const nN = Number(counts.neutral ?? 0);
    const wN = Number(counts.weak ?? 0);
    const total = sN + lN + nN + wN;

    // Tally the directional signals we actually trust
    const validReasons: PlayerReasoning[] = players
      .map((p) => (p?.engine_reasoning ?? null) as PlayerReasoning | null)
      .filter((r): r is PlayerReasoning => !!r);
    const modelAgree = validReasons.filter((r) => r.alignment.model_edge === 'aligned').length;
    const modelDisagree = validReasons.filter((r) => r.alignment.model_edge === 'against').length;
    const defenseAgainst = validReasons.filter((r) => r.alignment.defense === 'against').length;
    const formAgree = validReasons.filter((r) => r.alignment.form === 'aligned').length;

    let action = '';
    let actionKind: SpikeActionKind = 'REVIEW';
    if (total === 0) {
      action = `🟡 *Action: REVIEW* — no verdict data, inspect manually.`;
      actionKind = 'REVIEW';
    } else if (sN >= 2 || (sN >= 1 && (sN + lN) >= total - 1 && wN === 0)) {
      action = `🟢 *Action: TAIL* — bet ${escapeMd(side)} as alerted. ${sN} STRONG / ${lN} LEAN.`;
      actionKind = 'TAIL';
    } else if (sN >= 1 && wN <= 1) {
      action = `🟢 *Action: TAIL (small)* — ${sN} STRONG / ${lN} LEAN. Reduce stake.`;
      actionKind = 'TAIL_SMALL';
    } else if (modelDisagree >= Math.ceil(total * 0.66) && defenseAgainst >= Math.ceil(total / 2) && wN >= total - 1) {
      // True fade: model AND defense both disagree, and verdict mix is mostly WEAK.
      const fadeSide = /over|yes/i.test(side) ? 'Under' : 'Over';
      action = `🔴 *Action: FADE* — bet *${fadeSide}*. ${modelDisagree}/${total} L10 means disagree + ${defenseAgainst}/${total} tough D matchups.`;
      actionKind = 'FADE';
    } else if (modelAgree >= Math.ceil(total / 2) || formAgree >= Math.ceil(total / 2)) {
      // Thin verdicts but our own model leans the alerted side — REVIEW (lean tail)
      action = `🟡 *Action: REVIEW (lean ${escapeMd(side)})* — ${modelAgree}/${total} L10 means agree, but verdict mix is thin. Half stake max.`;
      actionKind = 'REVIEW';
    } else if (wN >= total - 1 && sN === 0 && modelAgree === 0 && modelDisagree === 0) {
      action = `⚪ *Action: SKIP* — ${wN} WEAK / ${lN} LEAN, 0 STRONG, no model signal. Don't fade — just skip.`;
      actionKind = 'SKIP';
    } else {
      action = `🟡 *Action: REVIEW* — mixed (${sN}S/${lN}L/${nN}N/${wN}W). Inspect legs before risking.`;
      actionKind = 'REVIEW';
    }
    // ─── Spike narrator (plain English) ───
    const narration = spikeNarrate({
      actionKind, side, prop,
      totalLegs: total || players.length,
      strong: sN, lean: lN, neutral: nN, weak: wN,
      modelAgree, modelDisagree, defenseAgainst,
    });

    // ─── MESSAGE A — The Call ───
    const msgA: string[] = [];
    msgA.push(`🌊 *CASCADE* — ${escapeMd(sport)}  ·  ${players.length} players, same side`);
    msgA.push(`🎯 ${escapeMd(prop)} *${escapeMd(side)}*  •  avg conf ${Math.round(conf)}%`);
    const venueLine = tipoff
      ? `🏟️ ${escapeMd(game)}  •  ${escapeMd(tipoff)}`
      : `🏟️ ${escapeMd(game)}`;
    msgA.push(venueLine);
    msgA.push('');
    msgA.push(action);
    msgA.push('');
    msgA.push(`💬 *Spike says:* ${escapeMd(narration)}`);
    if (actionKind !== 'TAIL' && validReasons.length > 0) {
      const cr = buildCounterRead(validReasons, /over|yes/i.test(side) ? 'Over' : 'Under');
      if (cr) {
        msgA.push('');
        msgA.push(`_${escapeMd(cr)}_`);
      }
    }

    // ─── MESSAGE B — The Math (sim) ───
    let msgB = '';
    try {
      const simLegs = players.map((p) => ({ verdict: p?.engine_reasoning?.verdict ?? null }));
      const sim = buildCascadeSim(counts, simLegs, 100);
      if (sim) {
        const lines = formatCascadeSimPlain(sim, players.length || total, actionKind);
        msgB = lines.join('\n');
      }
    } catch (_e) { /* non-fatal */ }

    // ─── MESSAGE C — The Players ───
    const order = { STRONG: 0, LEAN: 1, NEUTRAL: 2, WEAK: 3 } as const;
    const sorted = [...players].sort((a, b) => {
      const av = order[(a.engine_reasoning?.verdict as keyof typeof order) ?? 'LEAN'];
      const bv = order[(b.engine_reasoning?.verdict as keyof typeof order) ?? 'LEAN'];
      return av - bv;
    });
    const msgC: string[] = [];
    msgC.push(`*Players in this cascade:*`);
    if (counts && (counts.strong || counts.lean || counts.neutral || counts.weak)) {
      msgC.push(`✅ ${counts.strong ?? 0} strong  ·  👍 ${counts.lean ?? 0} lean  ·  🟡 ${counts.neutral ?? 0} neutral  ·  ⚠️ ${counts.weak ?? 0} weak`);
    }
    msgC.push('');
    const rendered = sorted.slice(0, MAX_PLAYERS_RENDERED);
    for (const p of rendered) {
      const r = p.engine_reasoning as PlayerReasoning | null | undefined;
      const roleCtx = (p.role_context ?? null) as PlayerRoleContext | null;
      const sideStr = String(p.side ?? side);
      const lineNum = Number(p.line ?? 0);
      const sideTyped: 'Over' | 'Under' = sideStr === 'Over' ? 'Over' : 'Under';
      if (r) {
        const lines = formatPlayerReasoningPlain(p.player ?? '', sideTyped, lineNum, prop, r);
        for (const ln of lines) msgC.push(escapeMd(ln));
      } else {
        msgC.push(escapeMd(`• ${p.player ?? ''} — ${sideTyped} ${lineNum}`));
      }
      const roleLine = formatRoleLine(roleCtx);
      if (roleLine) msgC.push(escapeMd(`   ${roleLine}`));
      msgC.push('');
    }
    if (sorted.length > MAX_PLAYERS_RENDERED) {
      msgC.push(`_+${sorted.length - MAX_PLAYERS_RENDERED} more players — see dashboard_`);
    }

    // Filtered legs (miss-by-1) — short footer in C
    const droppedRaw = Array.isArray((meta as any).dropped_legs) ? (meta as any).dropped_legs as Array<{ player: string; reason: string }> : [];
    const dropped = Array.from(new Map(droppedRaw.map((d) => [d.player, d])).values());
    const DROPPED_RENDER_LIMIT = 4;
    if (dropped.length > 0) {
      msgC.push('');
      msgC.push(`_Filtered ${dropped.length} miss-by-1 risk leg${dropped.length === 1 ? '' : 's'}:_`);
      for (const d of dropped.slice(0, DROPPED_RENDER_LIMIT)) {
        msgC.push(escapeMd(`   • ${d.player}`));
      }
      if (dropped.length > DROPPED_RENDER_LIMIT) msgC.push(escapeMd(`   +${dropped.length - DROPPED_RENDER_LIMIT} more`));
    }

    const messages: string[] = [];
    messages.push(msgA.join('\n'));
    if (msgB) messages.push(msgB);
    messages.push(msgC.join('\n'));
    // Trim each chunk to safety limit
    return messages.map((m) => m.length > MAX_MESSAGE_CHARS ? m.slice(0, MAX_MESSAGE_CHARS - 32) + '\n…_truncated_' : m);
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