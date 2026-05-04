import { assertStringIncludes, assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { formatPlayerReasoningPlain } from "./alert-explainer.ts";

function baseReasoning(overrides: any = {}): any {
  return {
    version: 'v1',
    matchup: { opponent_team: 'NYK', defense_rank: 5, position_defense_rank: 5, stat_allowed: null, game_script: null, blowout_risk: null, vegas_total: null, ...(overrides.matchup ?? {}) },
    form: { l10_hits: 10, l10_total: 10, hit_rate: 1, last_value: 5, ...(overrides.form ?? {}) },
    role: { minutes_score: 80, minutes_flag: 'stable', ...(overrides.role ?? {}) },
    pvs: { tier: null, matchup_score: null, pace_score: null },
    juice: { gap: 25, aligned_with_side: true, ...(overrides.juice ?? {}) },
    injuries: { relevant_count: 0, headlines: [] },
    alignment: { defense: 'against', form: 'aligned', pace: 'neutral', juice: 'aligned', role: 'aligned', model_edge: 'aligned' },
    aligned_count: 4,
    against_count: 1,
    verdict: 'STRONG',
    headline: 'Test',
    flags: [],
  };
}

Deno.test("plain: includes player and side", () => {
  const out = formatPlayerReasoningPlain('Mikal Bridges', 'Under', 12.5, 'player_rebounds', baseReasoning());
  assertStringIncludes(out[0], 'Mikal Bridges');
  assertStringIncludes(out[0], 'Under 12.5');
});

Deno.test("plain: 10/10 form rendered as 'all 10'", () => {
  const out = formatPlayerReasoningPlain('X', 'Under', 5, 'points', baseReasoning());
  assert(out.some((l) => l.includes('all 10')));
});

Deno.test("plain: tough defense phrasing", () => {
  const out = formatPlayerReasoningPlain('X', 'Over', 20, 'points', baseReasoning({ matchup: { defense_rank: 3, position_defense_rank: 3 } }));
  assert(out.some((l) => l.toLowerCase().includes('tough matchup')));
});

Deno.test("plain: heavy juice phrasing", () => {
  const out = formatPlayerReasoningPlain('X', 'Under', 1, 'assists', baseReasoning({ juice: { gap: 200, aligned_with_side: true } }));
  assert(out.some((l) => l.toLowerCase().includes('heavily on this side')));
});

Deno.test("plain: volatile minutes warning", () => {
  const out = formatPlayerReasoningPlain('X', 'Under', 1, 'assists', baseReasoning({ role: { minutes_flag: 'volatile' } }));
  assert(out.some((l) => l.toLowerCase().includes('bouncing around')));
});