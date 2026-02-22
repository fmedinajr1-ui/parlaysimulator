/**
 * Web Worker for Monte Carlo prop simulation.
 * Receives simulation params, runs Box-Muller MC, posts back pOver.
 */

function boxMullerRandom(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

interface MCParams {
  id: string;
  projected: number;
  sigmaRem: number;
  line: number;
  currentValue: number;
  simCount: number;
}

self.onmessage = (e: MessageEvent<MCParams>) => {
  const { id, projected, sigmaRem, line, currentValue, simCount } = e.data;

  if (sigmaRem <= 0) {
    self.postMessage({ id, pOver: projected >= line ? 0.99 : 0.01 });
    return;
  }

  const remainingMean = projected - currentValue;
  let overCount = 0;

  for (let i = 0; i < simCount; i++) {
    const simRemaining = remainingMean + boxMullerRandom() * sigmaRem;
    const simTotal = currentValue + Math.max(0, simRemaining);
    if (simTotal >= line) overCount++;
  }

  const pOver = Math.min(0.99, Math.max(0.01, overCount / simCount));
  self.postMessage({ id, pOver });
};
