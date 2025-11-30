import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sparkles, TrendingUp, Clock, ChevronRight, Target, Layers, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import { createLeg, simulateParlay } from "@/lib/parlay-calculator";

interface SuggestedLeg {
  description: string;
  odds: number;
  impliedProbability: number;
  sport: string;
  betType: string;
  eventTime: string;
}

interface SuggestedParlayCardProps {
  legs: SuggestedLeg[];
  totalOdds: number;
  combinedProbability: number;
  suggestionReason: string;
  sport: string;
  confidenceScore: number;
  expiresAt: string;
}

export function SuggestedParlayCard({
  legs,
  totalOdds,
  combinedProbability,
  suggestionReason,
  sport,
  confidenceScore,
  expiresAt,
}: SuggestedParlayCardProps) {
  const navigate = useNavigate();

  const getRiskLabel = (prob: number) => {
    if (prob >= 0.25) return { label: "Low Risk", color: "text-neon-green bg-neon-green/10" };
    if (prob >= 0.10) return { label: "Medium", color: "text-neon-yellow bg-neon-yellow/10" };
    return { label: "High Risk", color: "text-neon-orange bg-neon-orange/10" };
  };

  const getBetTypeBadge = (betType: string) => {
    const type = betType?.toLowerCase() || '';
    if (type.includes('player') || type.includes('prop')) return { label: "Prop", icon: User };
    if (type.includes('spread')) return { label: "Spread", icon: Target };
    if (type.includes('total') || type.includes('over') || type.includes('under')) return { label: "Total", icon: Layers };
    return { label: "ML", icon: TrendingUp };
  };

  const formatOdds = (odds: number) => {
    return odds > 0 ? `+${odds}` : odds.toString();
  };

  const formatTimeUntil = (dateString: string) => {
    const eventDate = new Date(dateString);
    const now = new Date();
    const diffMs = eventDate.getTime() - now.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    
    if (diffHours < 1) return "Starting soon";
    if (diffHours < 24) return `${diffHours}h`;
    return `${Math.floor(diffHours / 24)}d`;
  };

  const handleAnalyze = () => {
    const parlayLegs = legs.map(leg => createLeg(leg.description, leg.odds));
    const simulation = simulateParlay(parlayLegs, 10, totalOdds);
    navigate('/results', { state: { simulation } });
  };

  const riskInfo = getRiskLabel(combinedProbability);

  return (
    <Card className="bg-card/50 border-border/50 hover:border-primary/30 transition-all duration-300">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <CardTitle className="text-sm font-display">{sport} PARLAY</CardTitle>
            <Badge variant="outline" className="text-xs">
              {legs.length} legs
            </Badge>
          </div>
          <Badge 
            variant="outline" 
            className={cn("text-xs", riskInfo.color)}
          >
            {riskInfo.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Legs */}
        <div className="space-y-2">
          {legs.map((leg, index) => {
            const betBadge = getBetTypeBadge(leg.betType);
            const BetIcon = betBadge.icon;
            return (
              <div 
                key={index}
                className="flex items-center justify-between text-sm bg-muted/30 rounded-lg px-3 py-2"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-foreground truncate">{leg.description}</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                    <span>{leg.sport}</span>
                    <span>•</span>
                    <div className="flex items-center gap-1">
                      <BetIcon className="w-3 h-3" />
                      <span>{betBadge.label}</span>
                    </div>
                    <span>•</span>
                    <Clock className="w-3 h-3" />
                    <span>{formatTimeUntil(leg.eventTime)}</span>
                  </div>
                </div>
                <Badge variant="secondary" className="ml-2 shrink-0">
                  {formatOdds(leg.odds)}
                </Badge>
              </div>
            );
          })}
        </div>

        {/* Stats */}
        <div className="flex items-center justify-between pt-2 border-t border-border/30">
          <div>
            <p className="text-xs text-muted-foreground">Total Odds</p>
            <p className="text-lg font-bold text-primary">
              {formatOdds(totalOdds)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Win Probability</p>
            <p className="text-lg font-bold">
              {(combinedProbability * 100).toFixed(1)}%
            </p>
          </div>
        </div>

        {/* Reason */}
        <div className="bg-primary/5 rounded-lg p-2 border border-primary/10">
          <div className="flex items-start gap-2">
            <TrendingUp className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground">{suggestionReason}</p>
          </div>
        </div>

        {/* Action */}
        <Button 
          onClick={handleAnalyze}
          className="w-full group"
          variant="outline"
        >
          Analyze This Parlay
          <ChevronRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
        </Button>
      </CardContent>
    </Card>
  );
}
