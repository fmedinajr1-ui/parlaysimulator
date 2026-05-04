// audit-verdict-backfill
// Replays the alert-explainer (NEUTRAL + model_edge logic) against the last N
// days of fanduel_prediction_alerts and scores each verdict bucket against
// actual game-log outcomes. Read-only — does not write back to the production
// settlement column. Admin-gated via x-admin-secret header.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { buildPlayerReasoning, type PlayerReasoning, type Side } from '../_shared/alert-explainer.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-admin-secret',
};

interface AuditRow {
  id: string;
  player: string;
  prop: string;
  side: Side;
  line: number;
  sport: string;
  signal_type: string;
  actual: number | null;
  was_correct: boolean | null;
  verdict: PlayerReasoning['verdict'] | null;
  aligned: number;
  against: number;
  model_edge: number | null;
  alignment: PlayerReasoning['alignment'] | null;
  reason: string;
}

function parseLine(metadata: Record<string, unknown> | null, prediction: string): { side: Side | null; line: number | null } {
  const sideRaw = (prediction || '').trim();
  let side: Side | null = null;
  if (/^over$/i.test(sideRaw)) side = 'Over';
  else if (/^under$/i.test(sideRaw)) side = 'Under';
  let line: number | null = null;
  const ml = metadata?.line;
  if (ml != null) {
    const n = Number(ml);
    if (Number.isFinite(n)) line = n;
  }
  if (line == null) {
    const m = sideRaw.match(/(\d+(?:\.\d+)?)/);
    if (m) line = Number(m[1]);
  }
  return { side, line };
}

function logField(prop: string): { table: string; field: string } | null {
  const p = prop.toLowerCase();
  if (p.includes('rebound')) return { table: 'nba_player_game_logs', field: 'rebounds' };
  if (p.includes('assist'))  return { table: 'nba_player_game_logs', field: 'assists' };
  if (p.includes('three'))   return { table: 'nba_player_game_logs', field: 'threes_made' };
  if (p.includes('block'))   return { table: 'nba_player_game_logs', field: 'blocks' };
  if (p.includes('steal'))   return { table: 'nba_player_game_logs', field: 'steals' };
  if (p.includes('point'))   return { table: 'nba_player_game_logs', field: 'points' };
  if (p.includes('home_run')) return { table: 'mlb_player_game_logs', field: 'home_runs' };
  if (p.includes('rbi'))      return { table: 'mlb_player_game_logs', field: 'rbis' };
  if (p.includes('total_base')) return { table: 'mlb_player_game_logs', field: 'total_bases' };
  if (p.includes('hit'))      return { table: 'mlb_player_game_logs', field: 'hits' };
  if (p.includes('strikeout')) return { table: 'mlb_player_game_logs', field: 'pitcher_strikeouts' };
  if (p.includes('stolen_base')) return { table: 'mlb_player_game_logs', field: 'stolen_bases' };
  return null;
}

// ET date for a given timestamp
function etDate(ts: string): string {
  const d = new Date(ts);
  // toLocaleDateString with en-CA gives YYYY-MM-DD format
  return d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

function pct(n: number, d: number): string {
  if (!d) return 'n/a';
  return `${((n / d) * 100).toFixed(1)}%`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const adminSecret = Deno.env.get('ADMIN_AUDIT_SECRET') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const provided = req.headers.get('x-admin-secret') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!provided || provided !== adminSecret) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const url = new URL(req.url);
  const days = Math.min(30, Math.max(1, Number(url.searchParams.get('days') || 7)));
  const sportFilter = url.searchParams.get('sport') || null;

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  let q = supabase
    .from('fanduel_prediction_alerts')
    .select('id, player_name, prop_type, prediction, sport, signal_type, event_id, commence_time, metadata, created_at')
    .in('signal_type', ['cascade', 'take_it_now', 'velocity_spike'])
    .gte('created_at', since)
    .lt('commence_time', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(2000);
  if (sportFilter) q = q.eq('sport', sportFilter);

  const { data: alerts, error } = await q;
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const rows: AuditRow[] = [];
  let unparseable = 0;
  let unsettleable = 0;

  for (const a of (alerts || [])) {
    const { side, line } = parseLine((a.metadata || null) as Record<string, unknown> | null, a.prediction);
    if (!side || line == null) {
      unparseable++;
      continue;
    }
    const lf = logField(a.prop_type || '');
    let actual: number | null = null;
    let was_correct: boolean | null = null;
    if (lf && a.commence_time) {
      const gameDate = etDate(a.commence_time);
      try {
        const { data: log } = await supabase
          .from(lf.table)
          .select(`game_date, ${lf.field}`)
          .eq('player_name', a.player_name)
          .eq('game_date', gameDate)
          .limit(1)
          .maybeSingle();
        if (log) {
          actual = Number((log as Record<string, number>)[lf.field] ?? 0);
          was_correct = side === 'Over' ? actual > line : actual < line;
        }
      } catch (_e) { /* leave null */ }
    }
    if (was_correct == null) unsettleable++;

    let reasoning: PlayerReasoning | null = null;
    try {
      reasoning = await buildPlayerReasoning(supabase, {
        player_name: a.player_name,
        prop_type: a.prop_type || '',
        side,
        line,
        event_id: a.event_id,
        sport: (a.sport || 'NBA').toUpperCase(),
        juice_gap: ((a.metadata as Record<string, unknown> | null)?.juice_gap as number) ?? null,
      });
    } catch (_e) { /* leave null */ }

    rows.push({
      id: a.id,
      player: a.player_name,
      prop: a.prop_type || '',
      side,
      line,
      sport: a.sport || 'NBA',
      signal_type: a.signal_type,
      actual,
      was_correct,
      verdict: reasoning?.verdict ?? null,
      aligned: reasoning?.aligned_count ?? 0,
      against: reasoning?.against_count ?? 0,
      model_edge: reasoning?.model_edge_value ?? null,
      alignment: reasoning?.alignment ?? null,
      reason: reasoning?.headline ?? '',
    });
  }

  // Bucket aggregations
  const verdicts: Array<PlayerReasoning['verdict']> = ['STRONG', 'LEAN', 'NEUTRAL', 'WEAK'];
  const settled = rows.filter((r) => r.was_correct != null);
  const baselineHit = settled.length ? settled.filter((r) => r.was_correct).length / settled.length : 0;

  const byVerdict: Record<string, { n: number; settled: number; hit: number; flip_hit: number; edge_pp: number }> = {};
  for (const v of verdicts) {
    const subset = rows.filter((r) => r.verdict === v);
    const sub = subset.filter((r) => r.was_correct != null);
    const hits = sub.filter((r) => r.was_correct).length;
    const flipHits = sub.filter((r) => r.was_correct === false).length;
    const hitRate = sub.length ? hits / sub.length : 0;
    byVerdict[v] = {
      n: subset.length,
      settled: sub.length,
      hit: hitRate,
      flip_hit: sub.length ? flipHits / sub.length : 0,
      edge_pp: (hitRate - baselineHit) * 100,
    };
  }

  const bySignalVerdict: Record<string, { n: number; settled: number; hit: number }> = {};
  for (const r of rows) {
    const k = `${r.signal_type}/${r.verdict ?? 'NULL'}`;
    if (!bySignalVerdict[k]) bySignalVerdict[k] = { n: 0, settled: 0, hit: 0 };
    bySignalVerdict[k].n++;
    if (r.was_correct != null) {
      bySignalVerdict[k].settled++;
      if (r.was_correct) bySignalVerdict[k].hit++;
    }
  }
  for (const k of Object.keys(bySignalVerdict)) {
    const b = bySignalVerdict[k];
    b.hit = b.settled ? b.hit / b.settled : 0;
  }

  // Axis isolation: hit% on alerts where THIS axis was 'aligned' vs not
  const axes: Array<keyof PlayerReasoning['alignment']> = ['defense', 'form', 'pace', 'juice', 'role', 'model_edge'];
  const axisLift: Record<string, { aligned_n: number; aligned_hit: number; against_n: number; against_hit: number }> = {};
  for (const ax of axes) {
    const aligned = settled.filter((r) => r.alignment?.[ax] === 'aligned');
    const against = settled.filter((r) => r.alignment?.[ax] === 'against');
    axisLift[ax] = {
      aligned_n: aligned.length,
      aligned_hit: aligned.length ? aligned.filter((r) => r.was_correct).length / aligned.length : 0,
      against_n: against.length,
      against_hit: against.length ? against.filter((r) => r.was_correct).length / against.length : 0,
    };
  }

  // Decisions / health checks
  const neutralHit = byVerdict.NEUTRAL.hit;
  const weakFlip = byVerdict.WEAK.flip_hit;
  const decisions = {
    neutral_in_band: neutralHit >= 0.45 && neutralHit <= 0.55,
    neutral_hit_pct: neutralHit,
    weak_flip_beats_52: weakFlip >= 0.52,
    weak_flip_pct: weakFlip,
    model_edge_aligned_lift_pp: (axisLift.model_edge.aligned_hit - baselineHit) * 100,
    model_edge_against_lift_pp: (axisLift.model_edge.against_hit - baselineHit) * 100,
  };

  // Pretty text report
  const lines: string[] = [];
  lines.push(`Window: last ${days}d  (alerts=${rows.length}  settled=${settled.length}  unparseable=${unparseable}  unsettleable=${unsettleable})`);
  lines.push(`Baseline hit rate: ${pct(settled.filter(r => r.was_correct).length, settled.length)}`);
  lines.push('');
  lines.push('By verdict (alerted-side hit %):');
  for (const v of verdicts) {
    const b = byVerdict[v];
    lines.push(`  ${v.padEnd(8)} n=${String(b.n).padStart(4)}  settled=${String(b.settled).padStart(4)}  hit=${pct(b.hit * b.settled, b.settled)}  edge=${b.edge_pp >= 0 ? '+' : ''}${b.edge_pp.toFixed(1)}pp${v === 'WEAK' ? `  flip=${pct(b.flip_hit * b.settled, b.settled)}` : ''}`);
  }
  lines.push('');
  lines.push('Axis-isolated hit%:');
  for (const ax of axes) {
    const a = axisLift[ax];
    lines.push(`  ${ax.padEnd(11)} aligned n=${String(a.aligned_n).padStart(4)} hit=${pct(a.aligned_hit * a.aligned_n, a.aligned_n)}  |  against n=${String(a.against_n).padStart(4)} hit=${pct(a.against_hit * a.against_n, a.against_n)}`);
  }
  lines.push('');
  lines.push('Decisions:');
  lines.push(`  NEUTRAL in [45%,55%]:           ${decisions.neutral_in_band ? 'YES ✓' : 'NO  ✗'}  (${(neutralHit * 100).toFixed(1)}%)`);
  lines.push(`  WEAK flip-side beats 52%:        ${decisions.weak_flip_beats_52 ? 'YES ✓' : 'NO  ✗'}  (${(weakFlip * 100).toFixed(1)}%)`);
  lines.push(`  model_edge aligned lift:         ${decisions.model_edge_aligned_lift_pp >= 0 ? '+' : ''}${decisions.model_edge_aligned_lift_pp.toFixed(1)}pp`);
  lines.push(`  model_edge against lift:         ${decisions.model_edge_against_lift_pp >= 0 ? '+' : ''}${decisions.model_edge_against_lift_pp.toFixed(1)}pp`);

  // CSV
  const csvHeader = 'id,player,prop,side,line,sport,signal_type,actual,was_correct,verdict,aligned,against,model_edge,align_defense,align_form,align_pace,align_juice,align_role,align_model_edge,reason';
  const csvLines = [csvHeader];
  for (const r of rows) {
    const a = r.alignment;
    csvLines.push([
      r.id, JSON.stringify(r.player), JSON.stringify(r.prop), r.side, r.line, r.sport, r.signal_type,
      r.actual ?? '', r.was_correct == null ? '' : (r.was_correct ? 'true' : 'false'),
      r.verdict ?? '', r.aligned, r.against, r.model_edge?.toFixed(3) ?? '',
      a?.defense ?? '', a?.form ?? '', a?.pace ?? '', a?.juice ?? '', a?.role ?? '', a?.model_edge ?? '',
      JSON.stringify(r.reason),
    ].join(','));
  }

  return new Response(JSON.stringify({
    ok: true,
    window_days: days,
    summary: {
      total: rows.length,
      settled: settled.length,
      unparseable,
      unsettleable,
      baseline_hit: baselineHit,
    },
    by_verdict: byVerdict,
    by_signal_verdict: bySignalVerdict,
    axis_lift: axisLift,
    decisions,
    text_report: lines.join('\n'),
    csv: csvLines.join('\n'),
  }, null, 2), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});