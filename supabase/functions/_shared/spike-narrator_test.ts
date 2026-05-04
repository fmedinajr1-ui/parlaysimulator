import { assertStringIncludes, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { spikeNarrate } from "./spike-narrator.ts";

Deno.test("spikeNarrate TAIL strong majority", () => {
  const out = spikeNarrate({
    actionKind: 'TAIL', side: 'Under', prop: 'Points',
    totalLegs: 7, strong: 5, lean: 1, neutral: 1, weak: 0,
    modelAgree: 6, modelDisagree: 0, defenseAgainst: 4,
  });
  assertStringIncludes(out, '5 of 7');
  assertStringIncludes(out, 'top 3');
});

Deno.test("spikeNarrate TAIL_SMALL keeps stake small", () => {
  const out = spikeNarrate({
    actionKind: 'TAIL_SMALL', side: 'Over', prop: 'Rebounds',
    totalLegs: 4, strong: 1, lean: 1, neutral: 0, weak: 2,
    modelAgree: 2, modelDisagree: 1, defenseAgainst: 1,
  });
  assertStringIncludes(out.toLowerCase(), 'small');
});

Deno.test("spikeNarrate FADE recommends opposite side", () => {
  const out = spikeNarrate({
    actionKind: 'FADE', side: 'Over', prop: 'Points',
    totalLegs: 5, strong: 0, lean: 0, neutral: 1, weak: 4,
    modelAgree: 0, modelDisagree: 5, defenseAgainst: 4,
  });
  assertStringIncludes(out, 'Under');
  assertStringIncludes(out, 'fade');
});

Deno.test("spikeNarrate SKIP says wait", () => {
  const out = spikeNarrate({
    actionKind: 'SKIP', side: 'Under', prop: 'Assists',
    totalLegs: 3, strong: 0, lean: 0, neutral: 0, weak: 3,
    modelAgree: 0, modelDisagree: 0, defenseAgainst: 0,
  });
  assertStringIncludes(out.toLowerCase(), 'skip');
});

Deno.test("spikeNarrate REVIEW with all neutral", () => {
  const out = spikeNarrate({
    actionKind: 'REVIEW', side: 'Over', prop: 'Threes',
    totalLegs: 4, strong: 0, lean: 0, neutral: 4, weak: 0,
    modelAgree: 0, modelDisagree: 0, defenseAgainst: 0,
  });
  assert(out.length > 20);
});