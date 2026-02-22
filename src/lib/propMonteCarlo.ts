/**
 * Monte Carlo simulation for prop probability estimation.
 * Uses Box-Muller transform for normal random generation.
 */

function boxMullerRandom(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/**
 * Run Monte Carlo simulation to estimate P(over).
 * @param projected - Projected final stat value (mean of distribution)
 * @param sigmaRem - Standard deviation of remaining stat production
 * @param line - The prop line
 * @param currentValue - Stats already accumulated
 * @param simCount - Number of simulations (default 10000)
 * @returns Empirical P(over) between 0.01 and 0.99
 */
export function runPropMonteCarlo(
  projected: number,
  sigmaRem: number,
  line: number,
  currentValue: number = 0,
  simCount: number = 10000
): number {
  if (sigmaRem <= 0) return projected >= line ? 0.99 : 0.01;

  const remainingMean = projected - currentValue;
  let overCount = 0;

  for (let i = 0; i < simCount; i++) {
    const simRemaining = remainingMean + boxMullerRandom() * sigmaRem;
    const simTotal = currentValue + Math.max(0, simRemaining);
    if (simTotal >= line) overCount++;
  }

  const pOver = overCount / simCount;
  return Math.min(0.99, Math.max(0.01, pOver));
}
