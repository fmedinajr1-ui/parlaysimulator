import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Sparkles, TrendingUp, Clock, ChevronRight, Target, Layers, User, BarChart3, Shield } from "lucide-react";
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
  hybridScore?: number;
  hybridBreakdown?: {
    sharp: number;
    user: number;
    ai: number;
  };
  recommendation?: string;
}

interface SuggestedParlayCardProps {
  legs: SuggestedLeg[];
  totalOdds: number;
  combinedProbability: number;
  suggestionReason: string;
  sport: string;
  confidenceScore: number;
  expiresAt: string;
  isDataDriven?: boolean;
  isHybrid?: boolean;
}

export function SuggestedParlayCard({
  legs,
  totalOdds,
  combinedProbability,
  suggestionReason,
  sport,
  confidenceScore,
  expiresAt,
  isDataDriven,
  isHybrid,
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

  const getOddsColor = (odds: number) => {
    if (odds <= -400) return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
    if (odds <= -300) return "bg-green-500/20 text-green-400 border-green-500/30";
    if (odds <= -200) return "bg-lime-500/20 text-lime-400 border-lime-500/30";
    if (odds <= -150) return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
    if (odds <= -100) return "bg-orange-500/20 text-orange-400 border-orange-500/30";
    return "bg-red-500/20 text-red-400 border-red-500/30";
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
  
  // Check if suggestion reason indicates data-driven or hybrid
  const isDataDrivenSuggestion = isDataDriven || 
    suggestionReason.includes('DATA-DRIVEN') || 
    suggestionReason.includes('PATTERN MATCHED') || 
    suggestionReason.includes('AI LOW RISK');
  
  const isHybridSuggestion = isHybrid || suggestionReason.includes('HYBRID PARLAY');

  return (
    <Card className={cn(
      "bg-card/50 border-border/50 hover:border-primary/30 transition-all duration-300",
      isHybridSuggestion && "border-neon-purple/50 bg-neon-purple/5",
      isDataDrivenSuggestion && !isHybridSuggestion && "border-primary/40 bg-primary/5"
    )}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <CardTitle className="text-sm font-display">{sport} PARLAY</CardTitle>
            <Badge variant="outline" className="text-xs">
              {legs.length} legs
            </Badge>
          </div>
          <div className="flex items-center gap-1">
            {isHybridSuggestion && (
              <Badge 
                variant="outline" 
                className="text-xs text-neon-purple bg-neon-purple/10 border-neon-purple/30"
              >
                <Shield className="w-3 h-3 mr-1" />
                Hybrid
              </Badge>
            )}
            {isDataDrivenSuggestion && !isHybridSuggestion && (
              <Badge 
                variant="outline" 
                className="text-xs text-primary bg-primary/10 border-primary/30"
              >
                <BarChart3 className="w-3 h-3 mr-1" />
                Your Data
              </Badge>
            )}
            <Badge 
              variant="outline" 
              className={cn("text-xs", riskInfo.color)}
            >
              {riskInfo.label}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Legs */}
        <div className="space-y-2">
          {legs.map((leg, index) => {
            const betBadge = getBetTypeBadge(leg.betType);
            const BetIcon = betBadge.icon;
            const oddsColor = getOddsColor(leg.odds);
            const probPercent = (leg.impliedProbability * 100).toFixed(0);
            return (
              <div 
                key={index}
                className="bg-muted/30 rounded-lg px-3 py-2.5 space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground leading-tight">{leg.description}</p>
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
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <Badge 
                      variant="outline" 
                      className={cn("text-sm font-bold px-2.5 py-0.5 border", oddsColor)}
                    >
                      {formatOdds(leg.odds)}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{probPercent}% hit</span>
                  </div>
                </div>
                
                {/* Probability bar */}
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div 
                    className={cn(
                      "h-full rounded-full transition-all",
                      leg.impliedProbability >= 0.75 ? "bg-emerald-500" :
                      leg.impliedProbability >= 0.65 ? "bg-green-500" :
                      leg.impliedProbability >= 0.55 ? "bg-lime-500" :
                      leg.impliedProbability >= 0.50 ? "bg-yellow-500" :
                      "bg-orange-500"
                    )}
                    style={{ width: `${Math.min(leg.impliedProbability * 100, 100)}%` }}
                  />
                </div>
                
                {/* Hybrid Score Breakdown */}
                {leg.hybridScore && leg.hybridBreakdown && (
                  <div className="mt-2 p-2 bg-neon-purple/10 rounded border border-neon-purple/20">
                    <div className="flex justify-between text-xs mb-2">
                      <span className="text-muted-foreground">Sharp: {leg.hybridBreakdown.sharp}/40</span>
                      <span className="text-muted-foreground">User: {leg.hybridBreakdown.user}/35</span>
                      <span className="text-muted-foreground">AI: {leg.hybridBreakdown.ai}/25</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Progress value={leg.hybridScore} className="h-2" />
                      <Badge 
                        variant={leg.recommendation === 'STRONG_PICK' ? 'default' : 'secondary'}
                        className="text-xs"
                      >
                        {leg.recommendation}
                      </Badge>
                    </div>
                  </div>
                )}
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
