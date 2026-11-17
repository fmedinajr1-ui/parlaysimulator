import { statValue, type GameLog, type StatKey } from "@/utils/nbaBoxScoreMath";

/** Display-only Monte Carlo for one prop. Never feeds picks or MODEL_VERSION. */
export interface PropSim {
  runs: number;
  p10: number;
  p50: number;
  p90: number;
  /** Chance the result lands over the line. */
  over: number;
  /** Games used for the shape. */
  games: number;
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (s: string) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

/**
 * Each run draws tonight's minutes (projected minutes ± his recent spread) and a
 * per-minute rate resampled from one of his recent games, scaled so the average
 * matches the model projection. The spread comes from his real games.
 */
export function simulateProp(
  games: GameLog[], stat: StatKey, line: number, projection: number, projMinutes: number | null, runs = 2000,
): PropSim | null {
  const played = games.filter((g) => (Number(g.minutes_played) || 0) >= 5).slice(0, 20);
  if (played.length < 5 || !(projection > 0)) return null;
  const mins = played.map((g) => Number(g.minutes_played));
  const rates = played.map((g, i) => statValue(g, stat) / mins[i]);
  const meanMin = mins.reduce((a, b) => a + b, 0) / mins.length;
  const sdMin = Math.max(2, Math.sqrt(mins.reduce((a, b) => a + (b - meanMin) ** 2, 0) / mins.length));
  const center = projMinutes && projMinutes > 0 ? projMinutes : meanMin;
  const meanRate = rates.reduce((a, b) => a + b, 0) / rates.length;
  if (!(meanRate > 0)) return null;
  const scale = projection / (meanRate * center);
  const r = rng(hash(`${played[0].player_name}|${stat}|${line}`));
  const out: number[] = new Array(runs);
  let over = 0;
  for (let i = 0; i < runs; i++) {
    const z = Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
    const m = Math.min(48, Math.max(0, center + z * sdMin));
    const v = rates[Math.floor(r() * rates.length)] * m * scale;
    out[i] = v;
    if (v > line) over++;
  }
  out.sort((a, b) => a - b);
  const q = (p: number) => Math.round(out[Math.floor(p * (runs - 1))] * 10) / 10;
  return { runs, p10: q(0.1), p50: q(0.5), p90: q(0.9), over: over / runs, games: played.length };
}
