import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  bayesianHitRate,
  quarterKellyStake,
  requiredDecimal,
  breakevenDecimal,
  evPerUnit,
  priorForLegCount,
} from "../kelly.ts";

function close(a: number, b: number, tol = 1e-3) {
  return Math.abs(a - b) <= tol;
}

Deno.test("bayesianHitRate smooths small samples toward the prior", () => {
  // 2 wins of 3 with prior 0.40 and α=10 → (2 + 4) / (3 + 10) = 0.4615…
  const p = bayesianHitRate(2, 3, 0.40, 10);
  assert(close(p, 6 / 13), `expected ~0.4615, got ${p}`);
});

Deno.test("quarterKellyStake matches manual calc on a +EV bet", () => {
  // p=0.55, D=2.40 → f*=(2.40·0.55 − 1)/(2.40 − 1) = 0.32/1.40 = 0.22857…
  // ¼-Kelly = 0.05714…  * 1000 bankroll = 57.14u
  const r = quarterKellyStake(0.55, 2.40, 1000, 0.25);
  assert(close(r.fStar, 0.22857, 1e-3), `fStar wrong: ${r.fStar}`);
  assert(close(r.stakeUnits, 57.143, 0.01), `stake wrong: ${r.stakeUnits}`);
});

Deno.test("quarterKellyStake clamps -EV to zero stake", () => {
  // p=0.30, D=2.00 → f*=(0.60 − 1)/1 = −0.40 → applied=0, stake=0
  const r = quarterKellyStake(0.30, 2.00, 1000, 0.25);
  assert(r.fStar < 0, "fStar should be negative on -EV bet");
  assertEquals(r.fractionApplied, 0);
  assertEquals(r.stakeUnits, 0);
});

Deno.test("requiredDecimal applies cushion above breakeven", () => {
  // p=0.40 → breakeven D=2.50, with 10% cushion → 2.75
  assert(close(breakevenDecimal(0.40), 2.50));
  assert(close(requiredDecimal(0.40, 0.10), 2.75));
});

Deno.test("evPerUnit + priorForLegCount sanity", () => {
  // p=0.50, D=2.10 → 0.50*1.10 − 0.50 = 0.05 EV per unit
  assert(close(evPerUnit(0.50, 2.10), 0.05));
  assertEquals(priorForLegCount(1), 0.52);
  assertEquals(priorForLegCount(3), 0.55);
  assertEquals(priorForLegCount(4), 0.40);
  assertEquals(priorForLegCount(5), 0.25);
  assertEquals(priorForLegCount(8), 0.04);
});