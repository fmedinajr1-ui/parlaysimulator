import { FeedCard } from "../FeedCard";
import { LegAnalysis } from "@/types/parlay";
import { AlertTriangle } from "lucide-react";

interface TrapAvoidanceCardProps {
  legAnalyses?: Array<LegAnalysis & { legIndex: number }>;
  delay?: number;
}

const TRAP_SIGNALS = [
  'BOTH_SIDES_MOVED',
  'PRICE_ONLY_MOVE_TRAP',
  'SINGLE_BOOK_DIVERGENCE',
  'EARLY_MORNING_OVER',
  'FAKE_SHARP_TAG'
];

export function TrapAvoidanceCard({ legAnalyses, delay = 0 }: TrapAvoidanceCardProps) {
  // Filter for trap bets
  const traps = legAnalyses?.filter(la => 
    la.sharpRecommendation === 'fade' && 
    la.sharpSignals?.some(s => TRAP_SIGNALS.includes(s))
  );
  
  if (!traps || traps.length === 0) return null;
  
  return (
    <FeedCard delay={delay}>
      <div className="flex items-center gap-2 text-neon-red mb-4">
        <AlertTriangle className="w-5 h-5" />
        <span className="text-sm font-bold uppercase tracking-wider">⚠️ Trap Avoidance Alerts</span>
      </div>
      
      <p className="text-xs text-muted-foreground mb-4">
        Our sharp line movement analysis has detected potential trap bets in your parlay. These legs show signs of fake sharp action designed to mislead bettors.
      </p>
      
      <div className="space-y-3">
        {traps.map(trap => (
          <div 
            key={trap.legIndex}
            className="p-3 bg-neon-red/10 rounded-lg border border-neon-red/30"
          >
            <div className="flex items-start gap-2">
              <span className="text-xs font-bold text-neon-red mt-0.5">
                LEG #{trap.legIndex + 1}
              </span>
              <div className="flex-1 min-w-0">
                {trap.sharpFinalPick && (
                  <p className="text-sm font-medium text-foreground mb-1">
                    {trap.sharpFinalPick}
                  </p>
                )}
                <p className="text-xs text-muted-foreground mb-2">
                  {trap.sharpReason}
                </p>
                {trap.sharpSignals && trap.sharpSignals.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {trap.sharpSignals.filter(s => TRAP_SIGNALS.includes(s)).map((signal, idx) => (
                      <span 
                        key={idx} 
                        className="text-xs px-1.5 py-0.5 rounded bg-neon-red/20 text-neon-red border border-neon-red/30"
                      >
                        {signal}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      
      <div className="mt-4 p-3 bg-background/50 rounded-lg">
        <p className="text-xs text-muted-foreground">
          💡 <span className="font-medium">Recommendation:</span> Consider removing these legs or fading them (betting the opposite side) to avoid falling into trap bets set by sportsbooks.
        </p>
      </div>
    </FeedCard>
  );
}
