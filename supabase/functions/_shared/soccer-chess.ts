// Soccer CHESS score: blend of Sharp Divergence, Line Movement, Total Movement,
// Lineup Impact, and Public Sentiment. Output normalized 0–100.

export interface SoccerChessInputs {
  edgePct: number;          // sharp − book in percentage points
  ahLineMove: number;       // |Δ AH line| in points (e.g. 0.25, 0.5)
  totalLineMove: number;    // |Δ total line| in points
  lineupImpact: number;     // 0..1 (placeholder until lineup feed wired)
  publicSentiment: number;  // 0..1 (placeholder; from book consensus drift)
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export function soccerChessScore(input: SoccerChessInputs): number {
  // Normalize each component to 0..1
  const SD = clamp01(input.edgePct / 10);            // 10pp edge ≈ max
  const LM = clamp01(input.ahLineMove / 1.0);        // 1.0 AH move = max
  const TM = clamp01(input.totalLineMove / 1.0);
  const LI = clamp01(input.lineupImpact);
  const PS = clamp01(input.publicSentiment);
  const raw = SD * 0.4 + LM * 0.2 + TM * 0.1 + LI * 0.2 + PS * 0.1;
  return Math.round(clamp01(raw) * 100);
}