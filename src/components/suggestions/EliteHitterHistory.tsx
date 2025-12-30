import { useEliteHitterHistory, type HistoricalParlay } from '@/hooks/useEliteHitterHistory';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { CheckCircle, XCircle, Clock, HelpCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { formatUnits, americanToDecimal } from '@/utils/roiCalculator';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useState } from 'react';

const sportEmojis: Record<string, string> = {
  'NBA': '🏀',
  'NFL': '🏈',
  'NHL': '🏒',
  'MLB': '⚾',
  'basketball_nba': '🏀',
  'americanfootball_nfl': '🏈',
  'icehockey_nhl': '🏒',
  'baseball_mlb': '⚾',
};

function getOutcomeIcon(outcome: string) {
  switch (outcome) {
    case 'won':
      return <CheckCircle className="w-4 h-4 text-green-500" />;
    case 'lost':
      return <XCircle className="w-4 h-4 text-red-500" />;
    case 'pending':
      return <Clock className="w-4 h-4 text-yellow-500" />;
    default:
      return <HelpCircle className="w-4 h-4 text-muted-foreground" />;
  }
}

function getOutcomeLabel(outcome: string): string {
  switch (outcome) {
    case 'won': return 'HIT';
    case 'lost': return 'MISS';
    case 'pending': return 'PENDING';
    case 'push': return 'PUSH';
    case 'no_data': return 'NO DATA';
    case 'partial': return 'PARTIAL';
    default: return outcome.toUpperCase();
  }
}

function ParlayCard({ parlay }: { parlay: HistoricalParlay }) {
  const [isOpen, setIsOpen] = useState(false);
  
  const displayDate = format(parseISO(parlay.parlay_date), 'MMM d');
  const probPercent = (parlay.combined_probability * 100).toFixed(1);
  
  // Calculate profit/loss for this parlay
  let profitLoss = 0;
  if (parlay.outcome === 'won') {
    const decimalOdds = americanToDecimal(parlay.total_odds);
    profitLoss = decimalOdds - 1; // Profit on 1 unit
  } else if (parlay.outcome === 'lost') {
    profitLoss = -1;
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <div className="p-3 rounded-lg bg-muted/30 border border-border/50 cursor-pointer hover:bg-muted/40 transition-colors">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {getOutcomeIcon(parlay.outcome)}
              <span className="font-medium text-sm">{displayDate}</span>
              <Badge 
                variant="outline" 
                className={cn(
                  "text-[10px]",
                  parlay.outcome === 'won' ? "text-green-500 border-green-500/30" :
                  parlay.outcome === 'lost' ? "text-red-500 border-red-500/30" :
                  "text-muted-foreground"
                )}
              >
                {getOutcomeLabel(parlay.outcome)}
              </Badge>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">{probPercent}%</span>
              <span className="text-xs text-blue-500">
                {parlay.total_odds > 0 ? '+' : ''}{Math.round(parlay.total_odds)}
              </span>
              {parlay.outcome === 'won' || parlay.outcome === 'lost' ? (
                <span className={cn(
                  "text-xs font-medium",
                  profitLoss >= 0 ? "text-green-500" : "text-red-500"
                )}>
                  {formatUnits(profitLoss)}
                </span>
              ) : null}
              {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </div>
          </div>
        </div>
      </CollapsibleTrigger>
      
      <CollapsibleContent>
        <div className="pl-4 pr-2 py-2 space-y-2 border-l-2 border-border/50 ml-4 mt-1">
          {(!parlay.leg_outcomes || parlay.leg_outcomes.length === 0) && parlay.outcome !== 'pending' ? (
            <p className="text-xs text-muted-foreground italic">
              Leg details not yet verified
            </p>
          ) : (
            parlay.legs.map((leg, idx) => {
              const legOutcome = parlay.leg_outcomes?.find(lo => lo.leg_index === idx);
              
              return (
                <div 
                  key={idx} 
                  className="flex items-start justify-between text-sm gap-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span>{sportEmojis[leg.sport] || '🎯'}</span>
                    <span className="truncate text-muted-foreground">
                      {leg.playerName} {leg.side.charAt(0).toUpperCase()} {leg.line} {leg.propType}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {legOutcome?.outcome ? (
                      <>
                        {legOutcome.outcome === 'hit' ? (
                          <CheckCircle className="w-3 h-3 text-green-500" />
                        ) : legOutcome.outcome === 'miss' ? (
                          <XCircle className="w-3 h-3 text-red-500" />
                        ) : (
                          <HelpCircle className="w-3 h-3 text-muted-foreground" />
                        )}
                        {legOutcome.actual_value !== null && (
                          <span className="text-xs text-muted-foreground">
                            ({legOutcome.actual_value})
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">--</span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function EliteHitterHistory() {
  const { data, isLoading } = useEliteHitterHistory();

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4, 5].map(i => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (!data || data.parlays.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No parlay history yet.
      </div>
    );
  }

  return (
    <div className="space-y-2 max-h-[400px] overflow-y-auto">
      {data.parlays.map((parlay) => (
        <ParlayCard key={parlay.id} parlay={parlay} />
      ))}
    </div>
  );
}
