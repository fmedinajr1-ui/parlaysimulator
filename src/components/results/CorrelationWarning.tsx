import { FeedCard } from "@/components/FeedCard";
import { CorrelatedLegPair, ParlayLeg } from "@/types/parlay";
import { AlertTriangle, Link2 } from "lucide-react";

interface CorrelationWarningProps {
  correlatedLegs: CorrelatedLegPair[];
  legs: ParlayLeg[];
  delay?: number;
}

export function CorrelationWarning({ correlatedLegs, legs, delay = 0 }: CorrelationWarningProps) {
  if (!correlatedLegs || correlatedLegs.length === 0) {
    return null;
  }

  return (
    <FeedCard 
      variant="full-bleed" 
      className="slide-up border-neon-orange/30 bg-neon-orange/5"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-full bg-neon-orange/20 flex items-center justify-center">
          <Link2 className="w-4 h-4 text-neon-orange" />
        </div>
        <div>
          <h3 className="font-display text-base text-foreground">CORRELATION WARNING</h3>
          <p className="text-xs text-muted-foreground">These legs are NOT independent!</p>
        </div>
      </div>

      <div className="space-y-3">
        {correlatedLegs.map((pair, idx) => (
          <div 
            key={idx} 
            className="bg-card/50 rounded-lg p-3 border border-neon-orange/20"
          >
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-neon-orange shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="flex flex-wrap gap-1 mb-2">
                  {pair.indices.map((legIdx) => (
                    <span 
                      key={legIdx}
                      className="inline-flex items-center gap-1 px-2 py-0.5 bg-neon-orange/20 rounded text-xs font-medium text-neon-orange"
                    >
                      #{legIdx + 1} {legs[legIdx]?.description.slice(0, 20)}...
                    </span>
                  ))}
                </div>
                <p className="text-sm text-foreground/80">{pair.reason}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 p-2 bg-neon-orange/10 rounded-lg">
        <p className="text-xs text-center text-neon-orange">
          ⚠️ Correlated legs mean your true odds are WORSE than shown. Books love this.
        </p>
      </div>
    </FeedCard>
  );
}
