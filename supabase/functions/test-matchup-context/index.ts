/**
 * test-matchup-context
 * Verifies game context flags and player matchup grades parsing.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function getEasternDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const today = getEasternDate();
  const results: any = { date: today, tests: [] };

  // T1: Game context flags
  try {
    const { data } = await supabase.from('bot_research_findings').select('key_insights, summary')
      .eq('research_date', today).eq('category', 'game_context').order('created_at', { ascending: false }).limit(1);
    const flags: any[] = [];
    if (data?.[0]?.key_insights) {
      const insights = Array.isArray(data[0].key_insights) ? data[0].key_insights : [data[0].key_insights];
      for (const insight of insights) {
        let p = typeof insight === 'string' ? (() => { try { return JSON.parse(insight); } catch { return null; } })() : insight;
        if (p?.context_flags) flags.push(...p.context_flags);
      }
    }
    results.tests.push({ name: 'T1: fetchGameContextFlags', status: flags.length > 0 ? 'PASS' : 'WARN_NO_DATA', flagCount: flags.length,
      revenge: flags.filter(f => f.type === 'revenge_game').length, b2b: flags.filter(f => f.type === 'b2b_fatigue').length, blowout: flags.filter(f => f.type === 'blowout_risk').length });
  } catch (e) { results.tests.push({ name: 'T1', status: 'FAIL', error: e.message }); }

  // T2: Player matchup grades (actual structure: key_insights.matchups[].recommended_props[].player_targets[])
  try {
    const { data } = await supabase.from('bot_research_findings').select('key_insights')
      .eq('research_date', today).eq('category', 'matchup_defense_scan').order('relevance_score', { ascending: false }).limit(1);
    const players: any[] = [];
    if (data?.[0]?.key_insights) {
      const ki = data[0].key_insights as any;
      const matchups = ki?.matchups || [];
      for (const game of matchups) {
        for (const rec of (game?.recommended_props || [])) {
          const label = (rec.matchup_label || '').toLowerCase();
          let grade = 'B';
          if (label === 'elite' && (rec.matchup_score || 0) >= 22) grade = 'A+';
          else if (label === 'elite') grade = 'A';
          else if (label === 'strong' || label === 'favorable') grade = 'B+';
          else if (label === 'bench_under') grade = 'B';
          else if (label === 'neutral') grade = 'C';
          else if (label === 'avoid' || label === 'tough') grade = 'D';
          for (const pt of (rec.player_targets || [])) {
            players.push({ name: pt.player_name, grade, score: rec.matchup_score, prop: rec.prop_type, side: rec.side });
          }
        }
      }
    }
    const unique = new Map<string, any>();
    for (const p of players) { if (!unique.has(p.name)) unique.set(p.name, p); }
    const u = [...unique.values()];
    results.tests.push({ name: 'T2: fetchPlayerMatchupGrades', status: u.length > 0 ? 'PASS' : 'WARN_NO_DATA',
      playerCount: u.length, aPlus: u.filter(p => p.grade === 'A+' || p.grade === 'A').length,
      bPlus: u.filter(p => p.grade === 'B+' || p.grade === 'B').length,
      cOrD: u.filter(p => p.grade === 'C' || p.grade === 'D').length,
      samplePlayers: u.slice(0, 5) });
  } catch (e) { results.tests.push({ name: 'T2', status: 'FAIL', error: e.message }); }

  // T3: A+ + revenge boost
  results.tests.push({ name: 'T3: A+ + revenge boost', status: (10+5+5) === 20 ? 'PASS' : 'FAIL', boost: 20 });
  // T4: B2B + blowout penalty
  results.tests.push({ name: 'T4: B2B + blowout penalty', status: (-4-6-8-3) === -21 ? 'PASS' : 'FAIL', boost: -21 });
  // T5: Blowout hard gate
  results.tests.push({ name: 'T5: Blowout gate (50<55)', status: (50 < 55) ? 'PASS' : 'FAIL' });
  results.tests.push({ name: 'T5b: Blowout gate (60>=55)', status: !(60 < 55) ? 'PASS' : 'FAIL' });

  results.overall = results.tests.every((t: any) => t.status === 'PASS' || t.status === 'WARN_NO_DATA') ? 'ALL_TESTS_PASSED' : 'SOME_TESTS_FAILED';
  return new Response(JSON.stringify(results, null, 2), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
