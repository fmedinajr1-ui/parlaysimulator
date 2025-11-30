import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sparkles, TrendingUp, Clock, ChevronRight } from "lucide-react";
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

  const getConfidenceColor = (score: number) => {
    if (score >= 0.6) return "text-neon-green";
    if (score >= 0.4) return "text-neon-yellow";
    return "text-neon-orange";
  };

  const getConfidenceLabel = (score: number) => {
    if (score >= 0.6) return "High Confidence";
    if (score >= 0.4) return "Medium";
    return "Risky";
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
    // Convert suggested legs to ParlayLeg format and simulate
    const parlayLegs = legs.map(leg => createLeg(leg.description, leg.odds));
    const simulation = simulateParlay(parlayLegs, 10, totalOdds);
    navigate('/results', { state: { simulation } });
  };

  return (
    <Card className="bg-card/50 border-border/50 hover:border-primary/30 transition-all duration-300">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <CardTitle className="text-sm font-display">{sport} PARLAY</CardTitle>
          </div>
          <Badge 
            variant="outline" 
            className={cn("text-xs", getConfidenceColor(confidenceScore))}
          >
            {getConfidenceLabel(confidenceScore)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Legs */}
        <div className="space-y-2">
          {legs.map((leg, index) => (
            <div 
              key={index}
              className="flex items-center justify-between text-sm bg-muted/30 rounded-lg px-3 py-2"
            >
              <div className="flex-1 min-w-0">
                <p className="text-foreground truncate">{leg.description}</p>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{leg.sport}</span>
                  <span>•</span>
                  <Clock className="w-3 h-3" />
                  <span>{formatTimeUntil(leg.eventTime)}</span>
                </div>
              </div>
              <Badge variant="secondary" className="ml-2 shrink-0">
                {formatOdds(leg.odds)}
              </Badge>
            </div>
          ))}
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
