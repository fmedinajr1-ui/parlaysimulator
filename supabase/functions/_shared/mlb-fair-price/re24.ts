// League-average RE24 reference (spec §2.1).
// TODO: REFIT from Retrosheet for current run env before using LIVE_TOTAL.
import { BaseState } from "./state.ts";

const TABLE: Record<BaseState, [number, number, number]> = {
  [BaseState.EMPTY]:  [0.48, 0.25, 0.10],
  [BaseState.B1]:     [0.86, 0.51, 0.22],
  [BaseState.B2]:     [1.07, 0.66, 0.32],
  [BaseState.B3]:     [1.28, 0.90, 0.36],
  [BaseState.B12]:    [1.43, 0.88, 0.42],
  [BaseState.B13]:    [1.65, 1.10, 0.48],
  [BaseState.B23]:    [1.96, 1.36, 0.56],
  [BaseState.LOADED]: [2.29, 1.54, 0.75],
};

export function re24(bases: BaseState, outs: 0 | 1 | 2): number {
  return TABLE[bases][outs];
}