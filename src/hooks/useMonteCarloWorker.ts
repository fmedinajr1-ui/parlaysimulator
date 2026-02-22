import { useRef, useCallback, useEffect } from 'react';
import { runPropMonteCarlo } from '@/lib/propMonteCarlo';

interface MCParams {
  id: string;
  projected: number;
  sigmaRem: number;
  line: number;
  currentValue: number;
  simCount?: number;
}

export function useMonteCarloWorker() {
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef<Map<string, (pOver: number) => void>>(new Map());

  useEffect(() => {
    try {
      const worker = new Worker(
        new URL('../workers/monteCarlo.worker.ts', import.meta.url),
        { type: 'module' }
      );
      worker.onmessage = (e: MessageEvent<{ id: string; pOver: number }>) => {
        const resolve = pendingRef.current.get(e.data.id);
        if (resolve) {
          resolve(e.data.pOver);
          pendingRef.current.delete(e.data.id);
        }
      };
      workerRef.current = worker;
    } catch {
      console.warn('[useMonteCarloWorker] Worker not available, using sync fallback');
    }

    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
      pendingRef.current.clear();
    };
  }, []);

  const runSimulation = useCallback((params: MCParams): Promise<number> => {
    const simCount = params.simCount ?? 10000;

    if (!workerRef.current) {
      // Sync fallback
      const pOver = runPropMonteCarlo(
        params.projected,
        params.sigmaRem,
        params.line,
        params.currentValue,
        simCount
      );
      return Promise.resolve(pOver);
    }

    return new Promise<number>((resolve) => {
      pendingRef.current.set(params.id, resolve);
      workerRef.current!.postMessage({ ...params, simCount });
    });
  }, []);

  return { runSimulation };
}
