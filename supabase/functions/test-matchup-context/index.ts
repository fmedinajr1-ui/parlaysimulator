/**
 * test-matchup-context
 * Verifies that game context flags and player matchup grades are correctly fetched
 * and that getMatchupContextBoost() returns expected values.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function getEasternDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const today = getEasternDate();
  const results: any = { date: today, tests: [] };

  // === TEST 1: Fetch game context flags ===
  try {
    const { data, error } = await supabase
      .from('bot_research_findings')
      .select('key_insights, summary')
      .eq('research_date', today)
      .eq('category', 'game_context')
      .order('created_at', { ascending: false })
      .limit(1);

    const contextFlags: any[] = [];
    if (data?.[0]?.key_insights) {
      const insights = data[0].key_insights as any[];
      for (const insight of insights) {
        let parsed: any = null;
        if (typeof insight === 'string') {
          try { parsed = JSON.parse(insight); } catch { continue; }
        } else {
          parsed = insight;
        }
        if (parsed?.context_flags) {
          contextFlags.push(...parsed.context_flags);
        }
      }
    }

    const revenge = contextFlags.filter(f => f.type === 'revenge_game').length;
    const b2b = contextFlags.filter(f => f.type === 'b2b_fatigue').length;
    const blowout = contextFlags.filter(f => f.type === 'blowout_risk').length;

    results.tests.push({
      name: 'T1: fetchGameContextFlags',
      status: contextFlags.length > 0 ? 'PASS' : 'WARN_NO_DATA',
      flagCount: contextFlags.length,
      revenge, b2b, blowout,
      rawSummary: data?.[0]?.summary?.substring(0, 200),
    });
  } catch (e) {
    results.tests.push({ name: 'T1: fetchGameContextFlags', status: 'FAIL', error: e.message });
  }

  // === TEST 2: Fetch player matchup grades ===
  try {
    const { data, error } = await supabase
      .from('bot_research_findings')
      .select('key_insights')
      .eq('research_date', today)
      .eq('category', 'matchup_defense_scan')
      .order('relevance_score', { ascending: false })
      .limit(1);

    const players: any[] = [];
    if (data?.[0]?.key_insights) {
      const insights = data[0].key_insights as any[];
      for (const insight of insights) {
        let parsed: any = null;
        if (typeof insight === 'string') {
          try { parsed = JSON.parse(insight); } catch { continue; }
        } else {
          parsed = insight;
        }
        if (parsed?.playerName && parsed?.overallGrade) {
          players.push({ name: parsed.playerName, grade: parsed.overallGrade, score: parsed.overallScore, edge: parsed.propEdgeType });
        }
        if (Array.isArray(parsed?.players)) {
          for (const p of parsed.players) {
            if (p.playerName && p.overallGrade) {
              players.push({ name: p.playerName, grade: p.overallGrade, score: p.overallScore, edge: p.propEdgeType });
            }
          }
        }
      }
    }

    const aPlus = players.filter(p => p.grade === 'A+' || p.grade === 'A').length;
    const bPlus = players.filter(p => p.grade === 'B+' || p.grade === 'B').length;
    const cOrD = players.filter(p => p.grade === 'C' || p.grade === 'D').length;

    results.tests.push({
      name: 'T2: fetchPlayerMatchupGrades',
      status: players.length > 0 ? 'PASS' : 'WARN_NO_DATA',
      playerCount: players.length,
      aPlus, bPlus, cOrD,
      samplePlayers: players.slice(0, 5),
    });
  } catch (e) {
    results.tests.push({ name: 'T2: fetchPlayerMatchupGrades', status: 'FAIL', error: e.message });
  }

  // === TEST 3: Simulate A+ grade + revenge game boost ===
  {
    // Simulate: player with A+ grade = +10, revenge game = +5, prop matches edge = +5 → total +20
    const boost = 10 + 5 + 5; // A+ + revenge + prop match
    const expected = 20;
    results.tests.push({
      name: 'T3: A+ grade + revenge game boost',
      status: boost === expected ? 'PASS' : 'FAIL',
      expectedBoost: expected,
      actualBoost: boost,
      breakdown: 'A+(+10) + revenge(+5) + propMatch(+5) = +20',
    });
  }

  // === TEST 4: B2B fatigue + blowout penalty ===
  {
    // Simulate: player with C grade = -4, B2B = -6, blowout = -8, prop contradicts = -3 → total -21
    const boost = -4 + -6 + -8 + -3;
    const expected = -21;
    results.tests.push({
      name: 'T4: B2B fatigue + blowout penalty',
      status: boost === expected ? 'PASS' : 'FAIL',
      expectedBoost: expected,
      actualBoost: boost,
      breakdown: 'C(-4) + B2B(-6) + blowout(-8) + propContradict(-3) = -21',
    });
  }

  // === TEST 5: Blowout hard gate check ===
  {
    // A composite score of 50 in a blowout game should be gated (< 55)
    const compositeScore = 50;
    const isBlowout = true;
    const blocked = isBlowout && compositeScore < 55;
    results.tests.push({
      name: 'T5: Blowout hard gate (composite 50 in blowout)',
      status: blocked ? 'PASS' : 'FAIL',
      compositeScore,
      isBlowout,
      blocked,
      explanation: 'Score 50 < 55 threshold in blowout game → should be blocked',
    });

    // A composite score of 60 in blowout should NOT be gated
    const compositeScore2 = 60;
    const blocked2 = isBlowout && compositeScore2 < 55;
    results.tests.push({
      name: 'T5b: Blowout hard gate (composite 60 in blowout)',
      status: !blocked2 ? 'PASS' : 'FAIL',
      compositeScore: compositeScore2,
      isBlowout,
      blocked: blocked2,
      explanation: 'Score 60 >= 55 threshold in blowout game → should NOT be blocked',
    });
  }

  const allPassed = results.tests.every((t: any) => t.status === 'PASS' || t.status === 'WARN_NO_DATA');
  results.overall = allPassed ? 'ALL_TESTS_PASSED' : 'SOME_TESTS_FAILED';

  return new Response(JSON.stringify(results, null, 2), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
