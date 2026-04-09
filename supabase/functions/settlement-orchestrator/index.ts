/**
 * settlement-orchestrator
 * 
 * Unified settlement engine that replaces 16 fragmented verify functions.
 * Routes each signal to the correct settler (CLV or Outcome-based),
 * writes canonical SettlementRecords, and only triggers learning
 * when ≥85% of signals for a day are settled.
 * 
 * Runs in two waves: 1 AM ET (east coast games) and 4 AM ET (west coast).
 * Weight calibration only fires after the 4 AM wave.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── Types ──

type SignalSide = 'over' | 'under' | 'home' | 'away';
type SettlementMethod = 'clv' | 'outcome' | 'parlay_composite';

interface SettlementRecord {
  signal_id: string;
  settlement_method: SettlementMethod;
  was_correct: boolean | null;
  settled_at: string;
  evidence: Record<string, unknown>;
  settled_by: string;
}

// ── Config: which prop types use outcome-based settlement ──

const OUTCOME_SETTLED_PROPS = new Set([
  'batter_rbis',
  'batter_hits',
  'batter_home_runs',
  'batter_stolen_bases',
  'batter_runs_scored',
  'batter_total_bases',
  'pitcher_strikeouts',
  'pitcher_outs',
]);

// Map prop types to MLB game log stat columns
const MLB_PROP_STAT_MAP: Record<string, string> = {
  'batter_rbis': 'rbis',
  'batter_hits': 'hits',
  'batter_home_runs': 'home_runs',
  'batter_stolen_bases': 'stolen_bases',
  'batter_runs_scored': 'runs',
  'batter_total_bases': 'total_bases',
  'pitcher_strikeouts': 'strikeouts',
  'pitcher_outs': 'outs',
};

// NBA prop type → stat column mapping
const NBA_PROP_STAT_MAP: Record<string, string | string[]> = {
  'player_points': 'points',
  'player_rebounds': 'rebounds',
  'player_assists': 'assists',
  'player_threes': 'threes_made',
  'player_blocks': 'blocks',
  'player_steals': 'steals',
  'player_turnovers': 'turnovers',
  'player_points_rebounds': ['points', 'rebounds'],
  'player_points_assists': ['points', 'assists'],
  'player_rebounds_assists': ['rebounds', 'assists'],
  'player_points_rebounds_assists': ['points', 'rebounds', 'assists'],
};

// ── Helpers ──

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getEasternDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function parseSide(prediction: string): SignalSide | null {
  const p = (prediction || '').toLowerCase();
  if (p.includes('over') || p.includes('take')) return 'over';
  if (p.includes('under') || p.includes('fade')) return 'under';
  if (p.includes('home')) return 'home';
  if (p.includes('away')) return 'away';
  return null;
}

function namesMatch(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na === nb) return true;
  const aLast = na.split(' ').pop() || '';
  const bLast = nb.split(' ').pop() || '';
  if (aLast.length > 2 && aLast === bLast) {
    const aFirst = na.split(' ')[0] || '';
    const bFirst = nb.split(' ')[0] || '';
    if (aFirst[0] === bFirst[0]) return true;
  }
  return false;
}

// ── CLV Settler ──

async function settleCLV(
  signal: any,
  supabase: any
): Promise<SettlementRecord | null> {
  // Get timeline data for this event
  const { data: timeline } = await supabase
    .from('fanduel_line_timeline')
    .select('player_name, prop_type, line, snapshot_time')
    .eq('event_id', signal.event_id)
    .order('snapshot_time', { ascending: false })
    .limit(200);

  if (!timeline || timeline.length === 0) return null;

  // Find matching player timeline (fuzzy match)
  const normalizedSignal = normalizeName(signal.player_name);
  let playerTimeline = timeline.filter(
    (t: any) => normalizeName(t.player_name) === normalizedSignal && t.prop_type === signal.prop_type
  );

  if (playerTimeline.length === 0) {
    // Try fuzzy
    playerTimeline = timeline.filter(
      (t: any) => namesMatch(t.player_name, signal.player_name) && t.prop_type === signal.prop_type
    );
  }

  if (playerTimeline.length < 2) return null;

  const closingLine = playerTimeline[0].line;
  const openingLine = playerTimeline[playerTimeline.length - 1].line;

  // Resolve line at signal time from metadata
  const md = signal.metadata || {};
  const lineAtSignal = md.line_to ?? md.currentLine ?? md.current_line ?? md.line;

  if (lineAtSignal == null || closingLine == null) return null;

  const side = parseSide(signal.prediction);
  if (!side) return null;

  let wasCorrect: boolean | null = null;
  let evidence: Record<string, unknown> = {
    closing_line: closingLine,
    opening_line: openingLine,
    line_at_signal: lineAtSignal,
  };

  // Determine if line moved in predicted direction
  if (side === 'over' || side === 'home') {
    wasCorrect = closingLine >= Number(lineAtSignal);
    evidence.line_moved_direction = wasCorrect ? 'same' : 'opposite';
  } else {
    wasCorrect = closingLine <= Number(lineAtSignal);
    evidence.line_moved_direction = wasCorrect ? 'same' : 'opposite';
  }

  return {
    signal_id: signal.id,
    settlement_method: 'clv',
    was_correct: wasCorrect,
    settled_at: new Date().toISOString(),
    evidence,
    settled_by: 'settlement-orchestrator',
  };
}

// ── Outcome Settler (MLB) ──

async function settleOutcomeMLB(
  signal: any,
  gameLogs: Map<string, any[]>
): Promise<SettlementRecord | null> {
  const normalizedName = normalizeName(signal.player_name);
  
  // Find matching game logs
  let logs = gameLogs.get(normalizedName);
  if (!logs) {
    // Fuzzy search
    for (const [key, value] of gameLogs.entries()) {
      if (namesMatch(signal.player_name, value[0]?.player_name || key)) {
        logs = value;
        break;
      }
    }
  }

  if (!logs || logs.length === 0) return null;

  const statColumn = MLB_PROP_STAT_MAP[signal.prop_type];
  if (!statColumn) return null;

  // Find game log matching signal date
  const signalDate = signal.game_date || (signal.created_at || '').split('T')[0];
  const matchingLog = logs.find((l: any) => l.game_date === signalDate);
  if (!matchingLog) return null;

  const actualValue = matchingLog[statColumn];
  if (actualValue == null) return null;

  const side = parseSide(signal.prediction);
  if (!side) return null;

  const line = signal.line_at_alert ?? signal.metadata?.line ?? 0.5;
  let wasCorrect: boolean | null = null;

  if (side === 'over') {
    wasCorrect = actualValue > line;
  } else if (side === 'under') {
    wasCorrect = actualValue <= line;
  }

  return {
    signal_id: signal.id,
    settlement_method: 'outcome',
    was_correct: wasCorrect,
    settled_at: new Date().toISOString(),
    evidence: {
      actual_stat_value: actualValue,
      prop_threshold: line,
      stat_column: statColumn,
      game_date: matchingLog.game_date,
    },
    settled_by: 'settlement-orchestrator',
  };
}

// ── Outcome Settler (NBA) ──

async function settleOutcomeNBA(
  signal: any,
  gameLogs: Map<string, any[]>
): Promise<SettlementRecord | null> {
  const normalizedName = normalizeName(signal.player_name);
  
  let logs = gameLogs.get(normalizedName);
  if (!logs) {
    for (const [key, value] of gameLogs.entries()) {
      if (namesMatch(signal.player_name, value[0]?.player_name || key)) {
        logs = value;
        break;
      }
    }
  }

  if (!logs || logs.length === 0) return null;

  const propKey = (signal.prop_type || '').toLowerCase().replace(/\s+/g, '_');
  const statKey = NBA_PROP_STAT_MAP[propKey];
  if (!statKey) return null;

  const signalDate = signal.game_date || (signal.created_at || '').split('T')[0];
  const matchingLog = logs.find((l: any) => l.game_date === signalDate);
  if (!matchingLog) return null;

  let actualValue: number | null = null;
  if (Array.isArray(statKey)) {
    actualValue = 0;
    for (const k of statKey) {
      if (matchingLog[k] == null) { actualValue = null; break; }
      actualValue += Number(matchingLog[k]);
    }
  } else {
    actualValue = matchingLog[statKey] != null ? Number(matchingLog[statKey]) : null;
  }

  if (actualValue == null) return null;

  const side = parseSide(signal.prediction);
  if (!side) return null;

  const line = signal.line_at_alert ?? signal.metadata?.line ?? 0;
  let wasCorrect: boolean | null = null;

  if (side === 'over') {
    wasCorrect = actualValue > line;
  } else if (side === 'under') {
    wasCorrect = actualValue < line;
  }

  return {
    signal_id: signal.id,
    settlement_method: 'outcome',
    was_correct: wasCorrect,
    settled_at: new Date().toISOString(),
    evidence: {
      actual_stat_value: actualValue,
      prop_threshold: line,
      game_date: matchingLog.game_date,
    },
    settled_by: 'settlement-orchestrator',
  };
}

// ── Main ──

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const log = (msg: string) => console.log(`[settlement-orchestrator] ${msg}`);

  try {
    const body = await req.json().catch(() => ({}));
    const triggerLearning = body.trigger_learning ?? false;
    const targetDate = body.date || null;

    const todayET = getEasternDate();
    
    // Default: settle past 7 days (not today)
    const datesToSettle: string[] = [];
    if (targetDate) {
      datesToSettle.push(targetDate);
    } else {
      for (let i = 1; i <= 7; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        datesToSettle.push(new Intl.DateTimeFormat('en-CA', {
          timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
        }).format(d));
      }
    }

    log(`Settling signals for dates: ${datesToSettle.join(', ')}`);

    // 1. Get unsettled signals (not already in settlement_records)
    const { data: allUnsettled, error: fetchErr } = await supabase
      .from('fanduel_prediction_alerts')
      .select('id, player_name, prop_type, prediction, signal_type, event_id, created_at, metadata, contrarian_flip_applied')
      .is('was_correct', null)
      .gte('created_at', datesToSettle[datesToSettle.length - 1] + 'T00:00:00')
      .limit(1000);

    if (fetchErr) throw fetchErr;

    // Filter out already-settled signals
    const unsettledIds = (allUnsettled || []).map((s: any) => s.id);
    let alreadySettled = new Set<string>();

    if (unsettledIds.length > 0) {
      const chunks: string[][] = [];
      for (let i = 0; i < unsettledIds.length; i += 500) {
        chunks.push(unsettledIds.slice(i, i + 500));
      }
      for (const chunk of chunks) {
        const { data: existing } = await supabase
          .from('settlement_records')
          .select('signal_id')
          .in('signal_id', chunk);
        for (const r of existing || []) {
          alreadySettled.add(r.signal_id);
        }
      }
    }

    const unsettled = (allUnsettled || []).filter((s: any) => !alreadySettled.has(s.id));
    log(`Found ${unsettled.length} unsettled signals (${alreadySettled.size} already settled)`);

    if (unsettled.length === 0) {
      return new Response(JSON.stringify({ settled: 0, message: 'No unsettled signals' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Pre-load game logs for outcome settlement
    const startDate = datesToSettle[datesToSettle.length - 1];
    
    // MLB logs
    const { data: mlbLogs } = await supabase
      .from('mlb_player_game_logs')
      .select('player_name, game_date, rbis, hits, home_runs, stolen_bases, runs, total_bases, strikeouts')
      .gte('game_date', startDate)
      .limit(5000);

    const mlbLogMap = new Map<string, any[]>();
    for (const gl of mlbLogs || []) {
      const key = normalizeName(gl.player_name);
      if (!mlbLogMap.has(key)) mlbLogMap.set(key, []);
      mlbLogMap.get(key)!.push(gl);
    }

    // NBA logs
    const { data: nbaLogs } = await supabase
      .from('nba_player_game_logs')
      .select('player_name, game_date, points, rebounds, assists, threes_made, blocks, steals, turnovers')
      .gte('game_date', startDate)
      .limit(5000);

    const nbaLogMap = new Map<string, any[]>();
    for (const gl of nbaLogs || []) {
      const key = normalizeName(gl.player_name);
      if (!nbaLogMap.has(key)) nbaLogMap.set(key, []);
      nbaLogMap.get(key)!.push(gl);
    }

    log(`Loaded ${mlbLogs?.length || 0} MLB logs, ${nbaLogs?.length || 0} NBA logs`);

    // 3. Route each signal to the correct settler
    const results: SettlementRecord[] = [];
    let clvCount = 0;
    let outcomeCount = 0;
    let failedCount = 0;

    for (const signal of unsettled) {
      try {
        let record: SettlementRecord | null = null;

        if (OUTCOME_SETTLED_PROPS.has(signal.prop_type)) {
          // MLB outcome-based
          record = await settleOutcomeMLB(signal, mlbLogMap);
          if (record) outcomeCount++;
        } else if (signal.prop_type?.startsWith('player_') && nbaLogs && nbaLogs.length > 0) {
          // Try NBA outcome first, fall back to CLV
          record = await settleOutcomeNBA(signal, nbaLogMap);
          if (record) {
            outcomeCount++;
          } else {
            record = await settleCLV(signal, supabase);
            if (record) clvCount++;
          }
        } else {
          // CLV-based
          record = await settleCLV(signal, supabase);
          if (record) clvCount++;
        }

        if (record) {
          results.push(record);
        } else {
          failedCount++;
        }
      } catch (e) {
        log(`Error settling ${signal.id}: ${e.message}`);
        failedCount++;
      }
    }

    log(`Settled ${results.length}: ${clvCount} CLV, ${outcomeCount} outcome, ${failedCount} unresolvable`);

    // 4. Batch insert settlement records
    if (results.length > 0) {
      const chunks: SettlementRecord[][] = [];
      for (let i = 0; i < results.length; i += 100) {
        chunks.push(results.slice(i, i + 100));
      }
      for (const chunk of chunks) {
        const { error: insertErr } = await supabase
          .from('settlement_records')
          .upsert(chunk, { onConflict: 'signal_id' });
        if (insertErr) log(`Insert error: ${insertErr.message}`);
      }

      // 5. Update fanduel_prediction_alerts with settlement info
      for (const record of results) {
        await supabase
          .from('fanduel_prediction_alerts')
          .update({
            was_correct: record.was_correct,
            actual_outcome: JSON.stringify(record.evidence),
            settled_at: record.settled_at,
            settlement_method: record.settlement_method,
          })
          .eq('id', record.signal_id);
      }
    }

    // 6. Check coverage and trigger learning if ≥85%
    const coverage = unsettled.length > 0 ? results.length / unsettled.length : 0;
    log(`Coverage: ${(coverage * 100).toFixed(1)}% (${results.length}/${unsettled.length})`);

    let learningTriggered = false;
    if (triggerLearning && coverage >= 0.85) {
      log('Coverage ≥85% — triggering learning update');
      try {
        await supabase.functions.invoke('settlement-weight-updater', {
          body: { dates: datesToSettle },
        });
        learningTriggered = true;
      } catch (e) {
        log(`Learning trigger failed: ${e.message}`);
      }
    } else if (triggerLearning && coverage < 0.85) {
      log(`Coverage ${(coverage * 100).toFixed(1)}% < 85% — deferring learning`);
    }

    // 7. Refresh materialized view
    try {
      await supabase.rpc('refresh_signal_accuracy');
    } catch (e) {
      log(`Materialized view refresh failed: ${e.message}`);
    }

    const wins = results.filter(r => r.was_correct === true).length;
    const losses = results.filter(r => r.was_correct === false).length;
    const winRate = (wins + losses) > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : '0';

    const summary = {
      settled: results.length,
      clv_settled: clvCount,
      outcome_settled: outcomeCount,
      unresolvable: failedCount,
      coverage: (coverage * 100).toFixed(1),
      wins,
      losses,
      win_rate: parseFloat(winRate),
      learning_triggered: learningTriggered,
    };

    log(`Complete: ${wins}W/${losses}L (${winRate}%)`);

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    log(`Fatal error: ${err.message}`);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
