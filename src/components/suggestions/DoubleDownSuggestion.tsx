import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Flame, TrendingUp, Zap, Shield, Battery, ChevronRight } from "lucide-react";
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
  fatigueEdge?: string;
  fatigueBoost?: boolean;
}

interface SuggestedParlay {
  id: string;
  legs: SuggestedLeg[];
  total_odds: number;
  combined_probability: number;
  suggestion_reason: string;
  sport: string;
  confidence_score: number;
  expires_at: string;
  is_hybrid?: boolean;
}

interface DoubleDownSuggestionProps {
  suggestions: SuggestedParlay[];
}

export function DoubleDownSuggestion({ suggestions }: DoubleDownSuggestionProps) {
  const navigate = useNavigate();

  // Find the best double-down candidate
  const doubleDownPick = suggestions.find(s => 
    s.confidence_score >= 70 || 
    (s.is_hybrid && s.combined_probability >= 0.45)
  );

  if (!doubleDownPick) return null;

  const confidence = doubleDownPick.confidence_score;
  const isElite = confidence >= 80;
  const stakeMultiplier = isElite ? 2 : 1.5;

  const getConfidenceColor = () => {
    if (confidence >= 80) return "text-neon-green";
    if (confidence >= 70) return "text-neon-yellow";
    return "text-primary";
  };

  const getConfidenceLabel = () => {
    if (confidence >= 80) return "ELITE";
    if (confidence >= 70) return "HIGH";
    return "GOOD";
  };

  const formatOdds = (odds: number) => odds > 0 ? `+${odds}` : odds.toString();

  const handleAnalyze = () => {
    const parlayLegs = doubleDownPick.legs.map(leg => createLeg(leg.description, leg.odds));
    const simulation = simulateParlay(parlayLegs, 10, doubleDownPick.total_odds);
    navigate('/results', { state: { simulation } });
  };

  // Get supporting signals
  const signals: string[] = [];
  if (doubleDownPick.is_hybrid) signals.push("Hybrid intelligence aligned");
  if (doubleDownPick.legs.some(l => l.fatigueEdge)) signals.push("Fatigue edge detected");
  if (doubleDownPick.suggestion_reason.includes('OPTIMAL_MOVEMENT')) signals.push("Sharp money backing");
  if (doubleDownPick.combined_probability >= 0.5) signals.push("High hit probability");

  return (
    <Card className={cn(
      "relative overflow-hidden border-2 mb-4",
      isElite 
        ? "border-neon-green/50 bg-gradient-to-br from-neon-green/10 via-card to-neon-green/5" 
        : "border-neon-yellow/50 bg-gradient-to-br from-neon-yellow/10 via-card to-neon-yellow/5"
    )}>
      {/* Fire accent */}
      <div className={cn(
        "absolute top-0 left-0 right-0 h-1",
        isElite ? "bg-gradient-to-r from-neon-green via-neon-yellow to-neon-green" : "bg-gradient-to-r from-neon-yellow via-neon-orange to-neon-yellow"
      )} />

      <CardContent className="pt-4 pb-4 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Flame className={cn("w-5 h-5", isElite ? "text-neon-green" : "text-neon-yellow")} />
            <span className="font-display text-sm tracking-wider">DOUBLE DOWN PICK</span>
            {isElite && (
              <Badge className="bg-neon-green/20 text-neon-green border-neon-green/30 text-xs">
                ELITE
              </Badge>
            )}
          </div>
          <Badge variant="outline" className="text-xs">
            {doubleDownPick.sport} • {doubleDownPick.legs.length} Legs
          </Badge>
        </div>

        {/* Confidence Meter */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Overall Confidence</span>
            <span className={cn("font-bold", getConfidenceColor())}>
              {confidence}% {getConfidenceLabel()}
            </span>
          </div>
          <Progress 
            value={confidence} 
            className={cn(
              "h-2",
              isElite ? "[&>div]:bg-neon-green" : "[&>div]:bg-neon-yellow"
            )} 
          />
        </div>

        {/* Legs Summary */}
        <div className="space-y-1.5">
          {doubleDownPick.legs.map((leg, index) => (
            <div 
              key={index}
              className="flex items-center justify-between bg-muted/30 rounded px-2 py-1.5"
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <TrendingUp className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="text-sm truncate">{leg.description}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge variant="outline" className="text-xs">
                  {formatOdds(leg.odds)}
                </Badge>
                <span className={cn(
                  "text-xs font-medium",
                  leg.impliedProbability >= 0.6 ? "text-neon-green" : 
                  leg.impliedProbability >= 0.5 ? "text-neon-yellow" : "text-muted-foreground"
                )}>
                  {(leg.impliedProbability * 100).toFixed(0)}%
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Supporting Signals */}
        {signals.length > 0 && (
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">Supporting Signals</span>
            <div className="flex flex-wrap gap-1.5">
              {signals.map((signal, index) => (
                <Badge 
                  key={index}
                  variant="outline" 
                  className="text-xs bg-primary/10 border-primary/30"
                >
                  {signal.includes("Hybrid") && <Shield className="w-3 h-3 mr-1" />}
                  {signal.includes("Fatigue") && <Battery className="w-3 h-3 mr-1" />}
                  {signal.includes("Sharp") && <Zap className="w-3 h-3 mr-1" />}
                  {signal}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Stake Suggestion */}
        <div className={cn(
          "flex items-center justify-between p-2 rounded border",
          isElite 
            ? "bg-neon-green/10 border-neon-green/30" 
            : "bg-neon-yellow/10 border-neon-yellow/30"
        )}>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Suggested Stake:</span>
            <span className={cn("font-bold", isElite ? "text-neon-green" : "text-neon-yellow")}>
              {stakeMultiplier}x
            </span>
          </div>
          <span className="text-xs text-muted-foreground">
            $15 instead of $10
          </span>
        </div>

        {/* Action */}
        <Button 
          onClick={handleAnalyze}
          className={cn(
            "w-full group",
            isElite 
              ? "bg-neon-green/20 hover:bg-neon-green/30 text-neon-green border-neon-green/30" 
              : "bg-neon-yellow/20 hover:bg-neon-yellow/30 text-neon-yellow border-neon-yellow/30"
          )}
          variant="outline"
        >
          Analyze This Pick
          <ChevronRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
        </Button>
      </CardContent>
    </Card>
  );
}
