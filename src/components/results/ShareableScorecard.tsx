import { forwardRef } from "react";
import { ParlayLeg, LegAnalysis } from "@/types/parlay";

interface ShareableScorecardProps {
  probability: number;
  legs: ParlayLeg[];
  legAnalyses?: Array<LegAnalysis & { legIndex: number }>;
}

export const ShareableScorecard = forwardRef<HTMLDivElement, ShareableScorecardProps>(
  ({ probability, legs, legAnalyses }, ref) => {
    const pct = probability * 100;

    const getVerdictConfig = (legIndex: number) => {
      const analysis = legAnalyses?.find(la => la.legIndex === legIndex);
      
      if (analysis?.researchSummary) {
        const verdict = analysis.researchSummary.overallVerdict;
        switch (verdict) {
          case 'STRONG_PICK':
            return { emoji: '✅', label: 'PICK', color: 'hsl(142 70% 50%)', bg: 'hsl(142 70% 50% / 0.15)' };
          case 'LEAN_PICK':
            return { emoji: '📈', label: 'LEAN', color: 'hsl(185 80% 55%)', bg: 'hsl(185 80% 55% / 0.15)' };
          case 'NEUTRAL':
            return { emoji: '➖', label: 'HOLD', color: 'hsl(0 0% 60%)', bg: 'hsl(0 0% 60% / 0.15)' };
          case 'LEAN_FADE':
            return { emoji: '⚠️', label: 'CAUTION', color: 'hsl(35 100% 55%)', bg: 'hsl(35 100% 55% / 0.15)' };
          case 'STRONG_FADE':
            return { emoji: '❌', label: 'FADE', color: 'hsl(0 80% 55%)', bg: 'hsl(0 80% 55% / 0.15)' };
        }
      }

      if (!analysis) {
        return { emoji: '➖', label: 'N/A', color: 'hsl(0 0% 50%)', bg: 'hsl(0 0% 50% / 0.15)' };
      }

      const isTrap = analysis.sharpRecommendation === 'fade' && 
        analysis.sharpSignals?.some(s => ['BOTH_SIDES_MOVED', 'PRICE_ONLY_MOVE_TRAP'].includes(s));
      
      if (isTrap) {
        return { emoji: '🚨', label: 'TRAP', color: 'hsl(0 80% 55%)', bg: 'hsl(0 80% 55% / 0.15)' };
      }

      switch (analysis.sharpRecommendation) {
        case 'pick':
          return { emoji: '✅', label: 'PICK', color: 'hsl(142 70% 50%)', bg: 'hsl(142 70% 50% / 0.15)' };
        case 'fade':
          return { emoji: '❌', label: 'FADE', color: 'hsl(0 80% 55%)', bg: 'hsl(0 80% 55% / 0.15)' };
        case 'caution':
          return { emoji: '⚠️', label: 'CAUTION', color: 'hsl(45 100% 55%)', bg: 'hsl(45 100% 55% / 0.15)' };
        default:
          return { emoji: '➖', label: 'HOLD', color: 'hsl(0 0% 60%)', bg: 'hsl(0 0% 60% / 0.15)' };
      }
    };

    const getEdge = (legIndex: number, leg: ParlayLeg) => {
      const analysis = legAnalyses?.find(la => la.legIndex === legIndex);
      if (!analysis?.adjustedProbability) return null;
      return ((analysis.adjustedProbability - leg.impliedProbability) * 100).toFixed(1);
    };

    const getStrengthScore = (legIndex: number) => {
      const analysis = legAnalyses?.find(la => la.legIndex === legIndex);
      return analysis?.researchSummary?.strengthScore;
    };

    return (
      <div
        ref={ref}
        className="w-[420px] p-5 rounded-2xl relative overflow-hidden"
        style={{
          background: "linear-gradient(155deg, #0a0b0f 0%, #12141c 50%, #0a0b0f 100%)",
          fontFamily: "'DM Sans', sans-serif",
        }}
      >
        {/* Background glow */}
        <div 
          className="absolute inset-0 opacity-30"
          style={{
            background: `radial-gradient(ellipse at 30% 0%, hsl(185 80% 55% / 0.3) 0%, transparent 50%),
                         radial-gradient(ellipse at 70% 100%, hsl(280 70% 60% / 0.2) 0%, transparent 50%)`,
          }}
        />

        <div className="relative z-10">
          {/* Header */}
          <div className="flex items-center justify-between mb-4 pb-3" style={{ borderBottom: '1px solid hsl(240 10% 18%)' }}>
            <div className="flex items-center gap-2">
              <span className="text-xl">📊</span>
              <span 
                className="text-sm font-bold tracking-wider"
                style={{ 
                  fontFamily: "'Bebas Neue', sans-serif",
                  color: "hsl(0 0% 75%)",
                }}
              >
                PARLAY SCORECARD
              </span>
            </div>
            <div 
              className="px-3 py-1 rounded-full text-xs font-semibold"
              style={{
                background: pct >= 25 ? "hsl(142 70% 50% / 0.2)" : pct >= 10 ? "hsl(45 100% 55% / 0.2)" : "hsl(0 80% 55% / 0.2)",
                color: pct >= 25 ? "hsl(142 70% 65%)" : pct >= 10 ? "hsl(45 100% 65%)" : "hsl(0 80% 65%)",
                border: `1px solid ${pct >= 25 ? "hsl(142 70% 50% / 0.4)" : pct >= 10 ? "hsl(45 100% 55% / 0.4)" : "hsl(0 80% 55% / 0.4)"}`,
              }}
            >
              {pct.toFixed(1)}% WIN PROB
            </div>
          </div>

          {/* Legs */}
          <div className="space-y-2 mb-4">
            {legs.map((leg, idx) => {
              const verdict = getVerdictConfig(idx);
              const edge = getEdge(idx, leg);
              const strength = getStrengthScore(idx);

              return (
                <div 
                  key={leg.id}
                  className="flex items-center gap-3 p-2.5 rounded-lg"
                  style={{ 
                    background: verdict.bg,
                    border: `1px solid ${verdict.color}30`,
                  }}
                >
                  {/* Leg number */}
                  <span 
                    className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                    style={{ 
                      background: "hsl(240 12% 16%)",
                      color: "hsl(0 0% 70%)",
                    }}
                  >
                    {idx + 1}
                  </span>

                  {/* Verdict emoji */}
                  <span className="text-lg shrink-0">{verdict.emoji}</span>

                  {/* Leg description */}
                  <div className="flex-1 min-w-0">
                    <p 
                      className="text-sm truncate"
                      style={{ color: "hsl(0 0% 90%)" }}
                    >
                      {leg.description}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs" style={{ color: "hsl(0 0% 55%)" }}>
                        {leg.odds > 0 ? '+' : ''}{leg.odds}
                      </span>
                      {strength !== undefined && (
                        <span 
                          className="text-xs font-medium"
                          style={{ color: strength >= 60 ? "hsl(142 70% 55%)" : strength >= 40 ? "hsl(45 100% 55%)" : "hsl(0 80% 55%)" }}
                        >
                          {strength}/100
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Edge & Verdict */}
                  <div className="text-right shrink-0">
                    <span 
                      className="text-xs font-bold px-2 py-0.5 rounded"
                      style={{ 
                        background: verdict.bg,
                        color: verdict.color,
                      }}
                    >
                      {verdict.label}
                    </span>
                    {edge && (
                      <p 
                        className="text-xs mt-1"
                        style={{ 
                          color: parseFloat(edge) >= 0 ? "hsl(142 70% 55%)" : "hsl(0 80% 55%)",
                        }}
                      >
                        {parseFloat(edge) >= 0 ? '+' : ''}{edge}%
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div 
            className="flex items-center justify-between pt-3"
            style={{ borderTop: "1px solid hsl(240 10% 18%)" }}
          >
            <div className="flex items-center gap-1.5">
              <span className="text-lg">🔥</span>
              <span 
                className="text-xs font-bold"
                style={{ 
                  fontFamily: "'Bebas Neue', sans-serif",
                  color: "hsl(0 0% 55%)",
                }}
              >
                PARLAY FARM
              </span>
            </div>
            <div 
              className="text-xs"
              style={{ color: "hsl(0 0% 40%)" }}
            >
              {legs.length} legs analyzed
            </div>
          </div>
        </div>
      </div>
    );
  }
);

ShareableScorecard.displayName = "ShareableScorecard";