// supabase/functions/orchestrator-daily-narrative/index.ts
//
// THE ORCHESTRATOR.
//
// This function runs on a cron every 5 minutes. On each tick it:
//   1. Reads the current day-state.
//   2. Checks what phases are due based on ET time and pending data.
//   3. Fires phases that haven't run yet.
//   4. Marks them complete.
//
// This is the function that makes the bot feel ALIVE. Instead of 30 generators
// each firing independent broadcasts, we release messages in a coherent arc:
//
//   08:00 AM  Dawn Brief       — tone of the day, games to watch, injuries
//   11:00 AM  Slate Lock       — plays are set, full breakdown
//   11:15 AM+ Pick Drops       — individual picks released with reasoning
//   T-30min   Pre-Game Pulse   — per game, 30min before start
//   Live      Live Tracker     — triggered separately by game events
//   ASAP      Settlement Story — after last game ends
//   11:30 PM  Tomorrow Tease   — preview of next day
//
// Each message references earlier ones via the reference_key system.
// The voice module maintains tone continuity.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { Pick, DayPhase } from '../_shared/constants.ts';
import { etDateKey, etMinutesOfDay, etTime, timeOfDay } from '../_shared/date-et.ts';
import {
  MessageBuilder,
  bold,
  italic,
  greeting,
  phasePrefix,
  settlementVerdict,
  callbackPhrase,
  bankrollLine,
  formOpener,
  signoff,
} from '../_shared/voice.ts';
import {
  renderPickCard,
  renderPickSummaryList,
  renderSettledLeg,
  renderPlaycard,
  renderPassedSummary,
} from '../_shared/pick-formatter.ts';
import { getSportEmoji } from '../_shared/constants.ts';
import {
  loadDayState,
  markPhaseComplete,
  phaseAlreadyFired,
  noteDayFact,
  readDayFact,
  saveDayState,
} from '../_shared/narrative-state.ts';
import { curate, persistCuration, loadBankrollState } from '../_shared/bankroll-curator.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Phase schedules in minutes-of-day (ET)
const PHASE_TIMES: Record<DayPhase, number | null> = {
  dawn_brief: 8 * 60,             // 08:00
  slate_lock: 11 * 60,            // 11:00
  pick_drops: 11 * 60 + 15,       // 11:15+ (staggered)
  pre_game_pulse: null,           // game-relative, computed per-game
  live_tracker: null,             // event-driven
  settlement_story: null,         // triggered post-last-game by separate caller
  tomorrow_tease: 23 * 60 + 30,   // 23:30
};

// ─── Helper: invoke the dispatcher ────────────────────────────────────────

async function send(params: {
  message: string;
  phase: DayPhase;
  referenceKey?: string;
  fanout?: 'none' | 'all_active';
  personalizeStakePct?: number;
}): Promise<void> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  await fetch(`${supabaseUrl}/functions/v1/bot-send-telegram`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({
      message: params.message,
      parse_mode: 'Markdown',
      narrative_phase: params.phase,
      reference_key: params.referenceKey,
      fanout: params.fanout || 'none',
      personalize_stake_pct: params.personalizeStakePct,
    }),
  });
}

// ─── PHASE 1: Dawn Brief ──────────────────────────────────────────────────

async function runDawnBrief(sb: any): Promise<void> {
  const today = etDateKey();

  // Gather slate info
  const { data: games } = await sb
    .from('games_today')
    .select('sport, game_time, home_team, away_team, status')
    .eq('game_date', today);

  const sportBreakdown: Record<string, number> = {};
  for (const g of games || []) {
    const key = String(g.sport || 'other').toLowerCase();
    sportBreakdown[key] = (sportBreakdown[key] || 0) + 1;
  }

  // Gather injury concerns (things we're watching)
  const { data: concerns } = await sb
    .from('injury_watch')
    .select('player_name, team, status, note')
    .eq('date', today)
    .order('priority', { ascending: false })
    .limit(3);

  // Build the message
  const m = new MessageBuilder();
  m.raw(`🌅 ${greeting()}`);
  m.blank();

  // Bankroll-aware opener
  try {
    const state = await loadBankrollState(sb);
    m.line(formOpener(state.current_form, today));
    m.line(bankrollLine(state));
    m.blank();
  } catch (e) {
    console.warn('[dawn_brief] bankroll state unavailable, falling back', e);
  }

  // Slate summary
  const totalGames = games?.length || 0;
  if (totalGames === 0) {
    m.line(`Quiet day — nothing on the main board.`);
  } else {
    const breakdown = Object.entries(sportBreakdown)
      .map(([sport, count]) => `${count} ${sport.toUpperCase()}`)
      .join(' · ');
    const sizeAssessment = totalGames >= 12 ? 'Loaded slate'
      : totalGames >= 7 ? 'Solid slate'
      : totalGames >= 4 ? 'Light slate'
      : 'Thin slate';
    m.line(`${sizeAssessment} — ${totalGames} games today: ${breakdown}.`);
  }
  m.blank();

  // Injury/situational watch
  if (concerns && concerns.length > 0) {
    m.line('Watching this morning:');
    for (const c of concerns) {
      m.line(`• ${bold(c.player_name)} (${c.team}) — ${c.status}${c.note ? `. ${c.note}` : ''}`);
    }
    m.blank();
  }

  // Closing tease
  if (totalGames > 0) {
    m.line(`Full slate breakdown at 11. I'll flag anything that moves before then.`);
  }

  await send({
    message: m.build(),
    phase: 'dawn_brief',
    referenceKey: 'dawn_brief',
    fanout: 'all_active',
  });

  await noteDayFact(sb, 'slate_size', totalGames);
  await noteDayFact(sb, 'morning_concerns', concerns?.map((c: any) => c.player_name) || []);
  await markPhaseComplete(sb, 'dawn_brief');
}

// ─── PHASE 2: Slate Lock ──────────────────────────────────────────────────

async function runSlateLock(sb: any): Promise<void> {
  const today = etDateKey();

  // Load today's locked picks
  const { data: pickRows } = await sb
    .from('bot_daily_picks')
    .select('*')
    .eq('pick_date', today)
    .eq('status', 'locked')
    .order('confidence', { ascending: false });

  const picks = (pickRows || []) as Pick[];
  const count = picks.length;

  const m = new MessageBuilder();
  m.raw(phasePrefix('slate_lock'));
  m.blank();

  if (count === 0) {
    m.line(`No plays I like enough to post today. Staying on the bench.`);
    m.blank();
    m.line(italic(`Sometimes the best bet is no bet.`));
    await send({
      message: m.build(),
      phase: 'slate_lock',
      referenceKey: 'slate_lock',
      fanout: 'all_active',
    });
    await markPhaseComplete(sb, 'slate_lock');
    return;
  }

  // Callback to morning concerns
  const morningConcerns: string[] = (await readDayFact(sb, 'morning_concerns')) || [];
  if (morningConcerns.length > 0) {
    const resolvedConcerns = morningConcerns.filter(name =>
      picks.some(p => p.player_name === name)
    );
    if (resolvedConcerns.length > 0) {
      m.line(`Good news on this morning's watch — ${resolvedConcerns.join(', ')} cleared. Factoring in.`);
      m.blank();
    }
  }

  // Tier breakdown
  const elite = picks.filter(p => p.confidence >= 80);
  const high = picks.filter(p => p.confidence >= 70 && p.confidence < 80);
  const medium = picks.filter(p => p.confidence >= 60 && p.confidence < 70);
  const exploration = picks.filter(p => p.confidence < 60);

  m.line(`Locking in ${bold(`${count} plays`)} across the board:`);
  if (elite.length) m.line(`🏆 ${elite.length} elite conviction`);
  if (high.length) m.line(`🔥 ${high.length} high conviction`);
  if (medium.length) m.line(`📊 ${medium.length} solid`);
  if (exploration.length) m.line(`🎲 ${exploration.length} longshots`);
  m.blank();

  // Top pick callout (the "play of the day")
  const topPick = picks[0];
  if (topPick && topPick.confidence >= 75) {
    m.section('🎯 Play of the day', `${bold(topPick.player_name)} — it's the one I like most today. Full write-up dropping in a few minutes.`);
  }

  // Quick list
  m.blank();
  m.line('Full list:');
  m.raw(renderPickSummaryList(picks, 15));
  m.blank();

  m.aside(`Individual cards coming through shortly with the reasoning for each.`);

  await send({
    message: m.build(),
    phase: 'slate_lock',
    referenceKey: 'slate_lock',
    fanout: 'all_active',
  });

  await noteDayFact(sb, 'slate_pick_count', count);
  await noteDayFact(sb, 'top_pick_id', topPick?.id);
  await markPhaseComplete(sb, 'slate_lock');
}

// ─── PHASE 3: Pick Drops ──────────────────────────────────────────────────
// Staggered individual pick cards, released every ~3 minutes after slate lock.
// Each customer sees their own stake figure based on their bankroll.

async function runPickDrops(sb: any): Promise<void> {
  const today = etDateKey();
  const state = await loadDayState(sb);

  const { data: pickRows } = await sb
    .from('bot_daily_picks')
    .select('*')
    .eq('pick_date', today)
    .eq('status', 'locked')
    .order('confidence', { ascending: false });

  const picks = (pickRows || []) as Pick[];
  if (picks.length === 0) return;

  // Release the next pick in the queue (one per tick, staggered)
  const nextIdx = state.picks_released;
  if (nextIdx >= picks.length) {
    await markPhaseComplete(sb, 'pick_drops');
    return;
  }

  const pick = picks[nextIdx];

  // Render — note: the per-customer personalization happens in the dispatcher
  // via personalize_stake_pct, which reads each customer's bankroll.
  const stakePct = pick.suggested_stake_pct ?? estimateStakePct(pick);
  const rendered = renderPickCard(pick /* no bankroll for admin version */);

  await send({
    message: rendered,
    phase: 'pick_drops',
    referenceKey: `pick_${pick.id}`,
    fanout: 'all_active',
    personalizeStakePct: stakePct,
  });

  // Update state
  state.picks_released += 1;
  await saveDayState(sb, state);

  // Mark phase complete when all released
  if (state.picks_released >= picks.length) {
    await markPhaseComplete(sb, 'pick_drops');
  }
}

function estimateStakePct(pick: Pick): number {
  // Default stake sizing by tier if the generator didn't specify
  const c = pick.confidence || 60;
  if (c >= 80) return 0.02;
  if (c >= 70) return 0.015;
  if (c >= 60) return 0.01;
  return 0.005;
}

// ─── PHASE 4: Pre-Game Pulse ──────────────────────────────────────────────
// Fires ~30 minutes before each game. Per-game, not per-day.

async function runPreGamePulse(sb: any): Promise<void> {
  const now = new Date();
  const thirtyMinFromNow = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
  const thirtyFiveMinFromNow = new Date(now.getTime() + 35 * 60 * 1000).toISOString();

  // Games starting in the next 30-35 min
  const { data: upcomingGames } = await sb
    .from('games_today')
    .select('game_id, sport, home_team, away_team, game_time, pulse_fired')
    .gte('game_time', thirtyMinFromNow)
    .lte('game_time', thirtyFiveMinFromNow)
    .eq('pulse_fired', false);

  for (const game of upcomingGames || []) {
    // Find our picks tied to this game
    const { data: picks } = await sb
      .from('bot_daily_picks')
      .select('*')
      .eq('game_id', game.game_id)
      .eq('status', 'locked');

    if (!picks || picks.length === 0) continue;

    // Line movement + scratches since slate lock
    const { data: movements } = await sb
      .from('line_movements')
      .select('player_name, prop_type, old_line, new_line, moved_at')
      .eq('game_id', game.game_id)
      .gte('moved_at', new Date(Date.now() - 6 * 3600 * 1000).toISOString());

    const { data: scratches } = await sb
      .from('lineup_news')
      .select('player_name, status, impact')
      .eq('game_id', game.game_id)
      .eq('priority', 'high');

    const m = new MessageBuilder();
    m.raw(`⏰ *Pre-game pulse* — ${game.away_team} @ ${game.home_team}`);
    m.blank();

    if (scratches && scratches.length > 0) {
      for (const s of scratches) {
        const emoji = s.impact === 'positive' ? '✅' : '⚠️';
        m.line(`${emoji} ${bold(s.player_name)} — ${s.status}`);
      }
      m.blank();
    }

    if (movements && movements.length > 0) {
      m.line('Line movement since lock:');
      for (const mv of movements) {
        const arrow = mv.new_line > mv.old_line ? '↑' : '↓';
        m.line(`• ${mv.player_name} ${mv.prop_type}: ${mv.old_line} ${arrow} ${mv.new_line}`);
      }
      m.blank();
    }

    // Reference the earlier pick drops
    const priorPickKeys = picks.map((p: Pick) => `pick_${p.id}`);
    const callback = await callbackPhrase(sb, priorPickKeys[0], (t) =>
      `I posted these at ${t}. Thesis still holds on all of them.`
    );
    if (callback) m.line(callback);
    else m.line(`Still in on all ${picks.length} plays for this one. Good luck.`);

    await send({
      message: m.build(),
      phase: 'pre_game_pulse',
      referenceKey: `pulse_${game.game_id}`,
      fanout: 'all_active',
    });

    await sb.from('games_today')
      .update({ pulse_fired: true })
      .eq('game_id', game.game_id);
  }
}

// ─── PHASE 5: Settlement Story ────────────────────────────────────────────
// Triggered when last game ends. Honest recap.

async function runSettlementStory(sb: any): Promise<void> {
  const today = etDateKey();
  const { data: parlays } = await sb
    .from('bot_daily_parlays')
    .select('*, legs:bot_parlay_legs(*)')
    .eq('parlay_date', today)
    .in('outcome', ['won', 'lost']);

  if (!parlays || parlays.length === 0) return;

  const won = parlays.filter((p: any) => p.outcome === 'won').length;
  const lost = parlays.filter((p: any) => p.outcome === 'lost').length;
  const total = won + lost;
  const winRate = total > 0 ? Math.round((won / total) * 100) : 0;
  const pnl = parlays.reduce((s: number, p: any) => s + (p.profit_loss || 0), 0);
  const pnlSign = pnl >= 0 ? '+' : '';
  const pnlIcon = pnl >= 0 ? '🟢' : '🔴';

  const m = new MessageBuilder();
  m.raw(`${pnlIcon} ${phasePrefix('settlement_story')}`);
  m.blank();

  m.line(settlementVerdict(winRate, total));
  m.blank();
  m.line(`${bold(won)}/${total} parlays hit (${winRate}%) · P/L ${bold(`${pnlSign}$${Math.abs(pnl).toFixed(0)}`)}`);
  m.blank();

  // "What worked / what busted" narrative
  const hits: any[] = [];
  const misses: any[] = [];
  for (const p of parlays) {
    for (const leg of (p.legs || [])) {
      if (leg.outcome === 'hit') hits.push(leg);
      else if (leg.outcome === 'miss') misses.push(leg);
    }
  }

  if (hits.length > 0) {
    const topHit = hits[0];
    const callback = await callbackPhrase(sb, `pick_${topHit.pick_id}`, (t) =>
      `The ${topHit.player_name} call I made at ${t}? Landed clean.`
    );
    m.section('What worked', callback || `${topHit.player_name} hit as called.`);
  }

  if (misses.length > 0) {
    const topMiss = misses[0];
    m.section('What busted', `${bold(topMiss.player_name)} was the killer — missed ${topMiss.side} ${topMiss.line} by ${Math.abs(topMiss.actual_value - topMiss.line).toFixed(1)}.`);
  }

  // Per-parlay breakdown
  m.blank();
  m.line(bold('Leg-by-leg:'));
  for (let i = 0; i < parlays.length; i++) {
    const p = parlays[i];
    const icon = p.outcome === 'won' ? '✅' : '❌';
    m.line(`${icon} Parlay #${i + 1} (${p.strategy_name || 'standard'})`);
    for (const leg of (p.legs || [])) {
      m.line(`  ${renderSettledLeg(leg)}`);
    }
  }

  m.blank();
  m.aside(`Tomorrow's read comes after midnight.`);

  await send({
    message: m.build(),
    phase: 'settlement_story',
    referenceKey: 'settlement_story',
    fanout: 'all_active',
  });

  await markPhaseComplete(sb, 'settlement_story');
}

// ─── PHASE 6: Tomorrow Tease ──────────────────────────────────────────────

async function runTomorrowTease(sb: any): Promise<void> {
  const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
  const tomorrowKey = etDateKey(tomorrow);

  const { data: games } = await sb
    .from('games_tomorrow')
    .select('sport, home_team, away_team')
    .eq('game_date', tomorrowKey);

  const count = games?.length || 0;

  const m = new MessageBuilder();
  m.raw(`🌙 One last note before bed.`);
  m.blank();
  if (count === 0) {
    m.line(`Quiet tomorrow — no games on the main board. I'll be back when there's something worth posting.`);
  } else {
    const sports = new Set((games || []).map((g: any) => (g.sport || '').toLowerCase()));
    m.line(`Tomorrow: ${count} games across ${[...sports].join('/')}.`);
    m.line(`I'll have a read by 8am. Rest up.`);
  }

  await send({
    message: m.build(),
    phase: 'tomorrow_tease',
    referenceKey: 'tomorrow_tease',
    fanout: 'all_active',
  });

  await markPhaseComplete(sb, 'tomorrow_tease');
}

// ─── Main handler ─────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const sb = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({}));
    const forcePhase: DayPhase | undefined = body.force_phase;

    const now = new Date();
    const minutesOfDay = etMinutesOfDay(now);
    const fired: DayPhase[] = [];

    // Force a specific phase (for manual testing / webhook-triggered settlement)
    if (forcePhase) {
      switch (forcePhase) {
        case 'dawn_brief': await runDawnBrief(sb); break;
        case 'slate_lock': await runSlateLock(sb); break;
        case 'pick_drops': await runPickDrops(sb); break;
        case 'pre_game_pulse': await runPreGamePulse(sb); break;
        case 'settlement_story': await runSettlementStory(sb); break;
        case 'tomorrow_tease': await runTomorrowTease(sb); break;
      }
      fired.push(forcePhase);
    } else {
      // Regular scheduled tick
      if (minutesOfDay >= PHASE_TIMES.dawn_brief! && !(await phaseAlreadyFired(sb, 'dawn_brief'))) {
        await runDawnBrief(sb); fired.push('dawn_brief');
      }
      if (minutesOfDay >= PHASE_TIMES.slate_lock! && !(await phaseAlreadyFired(sb, 'slate_lock'))) {
        await runSlateLock(sb); fired.push('slate_lock');
      }
      if (minutesOfDay >= PHASE_TIMES.pick_drops! && !(await phaseAlreadyFired(sb, 'pick_drops'))) {
        // Pick drops run iteratively — one pick per tick
        await runPickDrops(sb); fired.push('pick_drops');
      }
      // Pre-game pulse is game-relative, runs every tick
      await runPreGamePulse(sb);
      fired.push('pre_game_pulse');

      if (minutesOfDay >= PHASE_TIMES.tomorrow_tease! && !(await phaseAlreadyFired(sb, 'tomorrow_tease'))) {
        await runTomorrowTease(sb); fired.push('tomorrow_tease');
      }
    }

    return new Response(JSON.stringify({
      success: true,
      tick_at: now.toISOString(),
      minutes_of_day: minutesOfDay,
      phases_fired: fired,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (e: any) {
    console.error('[orchestrator] Error:', e);
    return new Response(JSON.stringify({ success: false, error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
