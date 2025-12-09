import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Sparkles, TrendingUp, Clock, ChevronRight, Target, Layers, User, BarChart3, Shield, Activity, AlertTriangle, Zap, Minus, Battery } from "lucide-react";
import { DogAvatar } from "@/components/avatars/DogAvatar";
import { WolfAvatar } from "@/components/avatars/WolfAvatar";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import { createLeg, simulateParlay } from "@/lib/parlay-calculator";
import { FatigueDifferentialBadge } from "@/components/fatigue/FatigueDifferentialBadge";
import { extractTeamsFromDescription } from "@/hooks/useFatigueData";
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
    fatigue?: number;
  };
  recommendation?: string;
  bestBook?: string;
  lineEdge?: number;
  availableAt?: string[];
  fatigueEdge?: string;
  fatigueScore?: number;
  fatigueBoost?: boolean;
}

interface FatigueInfo {
  teamName: string;
  fatigueScore: number;
  fatigueCategory: string;
  hasFatigueEdge: boolean;
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
  fatigueInfo?: FatigueInfo[];
}

// Helper to extract movement bucket from suggestion reason or signals
const getMovementBucket = (reason: string): { 
  bucket: 'extreme' | 'large' | 'moderate' | 'small' | 'minimal' | null;
  label: string;
  icon: typeof Activity;
  className: string;
  description: string;
} | null => {
  if (reason.includes('EXCESSIVE_MOVEMENT') || reason.includes('Extreme movement')) {
    return { 
      bucket: 'extreme', 
      label: 'Extreme', 
      icon: AlertTriangle,
      className: 'bg-red-500/20 text-red-400 border-red-500/30',
      description: '50+ pts move - often a trap'
    };
  }
  if (reason.includes('OPTIMAL_MOVEMENT') || reason.includes('Optimal movement zone')) {
    return { 
      bucket: 'large', 
      label: 'Optimal', 
      icon: Zap,
      className: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
      description: '30-50 pts - highest accuracy zone'
    };
  }
  if (reason.includes('MODERATE_SHARP') || reason.includes('Good movement size')) {
    return { 
      bucket: 'moderate', 
      label: 'Moderate', 
      icon: Activity,
      className: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
      description: '15-30 pts - solid movement'
    };
  }
  if (reason.includes('MINIMAL_MOVEMENT') || reason.includes('minimal')) {
    return { 
      bucket: 'minimal', 
      label: 'Minimal', 
      icon: Minus,
      className: 'bg-muted text-muted-foreground border-border',
      description: '<10 pts - may be noise'
    };
  }
  // Check for historical pattern signals
  if (reason.includes('HISTORICAL_TRAP_PATTERN')) {
    return { 
      bucket: 'extreme', 
      label: 'Trap Pattern', 
      icon: AlertTriangle,
      className: 'bg-red-500/20 text-red-400 border-red-500/30',
      description: 'Historical trap detected'
    };
  }
  if (reason.includes('HISTORICAL_WIN_PATTERN')) {
    return { 
      bucket: 'large', 
      label: 'Win Pattern', 
      icon: Zap,
      className: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
      description: 'Historical win pattern'
    };
  }
  return null;
};

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
  fatigueInfo,
}: SuggestedParlayCardProps) {
  const navigate = useNavigate();
  
  // Check if NBA game with fatigue edge
  const hasNBAFatigueEdge = sport === 'NBA' && fatigueInfo?.some(f => f.hasFatigueEdge);
  const maxFatigue = fatigueInfo?.reduce((max, f) => f.fatigueScore > max ? f.fatigueScore : max, 0) || 0;

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
  
  // Get movement bucket from suggestion reason
  const movementBucket = getMovementBucket(suggestionReason);

  return (
    <Card className={cn(
      "bg-card/50 border-border/50 hover:border-primary/30 transition-all duration-300",
      isHybridSuggestion && "border-neon-purple/50 bg-neon-purple/5",
      isDataDrivenSuggestion && !isHybridSuggestion && "border-primary/40 bg-primary/5",
      movementBucket?.bucket === 'extreme' && "border-red-500/30",
      movementBucket?.bucket === 'large' && "border-emerald-500/30"
    )}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            {/* Dog for regular picks, Wolf for sharp/hybrid picks */}
            {isHybridSuggestion || movementBucket?.bucket === 'large' || movementBucket?.bucket === 'extreme' ? (
              <WolfAvatar 
                size="sm" 
                variant={isHybridSuggestion ? 'alpha' : 'default'} 
              />
            ) : (
              <DogAvatar 
                size="sm" 
                variant={isDataDrivenSuggestion ? 'winner' : 'default'} 
              />
            )}
            <CardTitle className="text-sm font-display">{sport} PARLAY</CardTitle>
            <Badge variant="outline" className="text-xs">
              {legs.length} legs
            </Badge>
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            {/* Fatigue Indicator for NBA */}
            {sport === 'NBA' && hasNBAFatigueEdge && (
              <Badge 
                variant="outline" 
                className="text-xs bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
                title={`Max fatigue: ${maxFatigue}`}
              >
                <Battery className="w-3 h-3 mr-1" />
                Fatigue Edge
              </Badge>
            )}
            {/* Movement Bucket Indicator */}
            {movementBucket && (
              <Badge 
                variant="outline" 
                className={cn("text-xs border", movementBucket.className)}
                title={movementBucket.description}
              >
                <movementBucket.icon className="w-3 h-3 mr-1" />
                {movementBucket.label}
              </Badge>
            )}
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
                    {leg.bestBook && leg.lineEdge && leg.lineEdge > 0 && (
                      <Badge 
                        variant="outline" 
                        className="text-xs bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                      >
                        +{leg.lineEdge} edge
                      </Badge>
                    )}
                  </div>
                </div>
                
                {/* Best Line Indicator */}
                {leg.bestBook && (
                  <div className="flex items-center gap-2 text-xs">
                    <div className="flex items-center gap-1 text-emerald-400">
                      <TrendingUp className="w-3 h-3" />
                      <span className="font-medium">Best line:</span>
                    </div>
                    <span className="text-muted-foreground">{leg.bestBook}</span>
                    {leg.lineEdge && leg.lineEdge > 0 && (
                      <span className="text-emerald-400">
                        ({leg.lineEdge > 0 ? '+' : ''}{leg.lineEdge} vs avg)
                      </span>
                    )}
                    {leg.availableAt && leg.availableAt.length > 1 && (
                      <span className="text-muted-foreground">
                        • {leg.availableAt.length} books
                      </span>
                    )}
                  </div>
                )}
                
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
                
                {/* Fatigue Edge Indicator */}
                {leg.fatigueEdge && (
                  <div className={cn(
                    "mt-2 p-2 rounded border flex items-center gap-2",
                    leg.fatigueBoost 
                      ? "bg-yellow-500/10 border-yellow-500/30" 
                      : "bg-orange-500/10 border-orange-500/30"
                  )}>
                    <Battery className={cn(
                      "w-4 h-4",
                      leg.fatigueBoost ? "text-yellow-400" : "text-orange-400"
                    )} />
                    <span className={cn(
                      "text-xs",
                      leg.fatigueBoost ? "text-yellow-400" : "text-orange-400"
                    )}>
                      {leg.fatigueEdge}
                    </span>
                    {leg.fatigueBoost && (
                      <Badge variant="outline" className="text-xs bg-yellow-500/20 text-yellow-400 border-yellow-500/30 ml-auto">
                        +BOOST
                      </Badge>
                    )}
                  </div>
                )}
                
                {/* Real-time Fatigue Differential for NBA legs */}
                {leg.sport === 'NBA' && (() => {
                  const teams = extractTeamsFromDescription(leg.description);
                  if (teams) {
                    return (
                      <FatigueDifferentialBadge 
                        homeTeam={teams.team2} 
                        awayTeam={teams.team1} 
                      />
                    );
                  }
                  return null;
                })()}
                
                {/* Hybrid Score Breakdown */}
                {leg.hybridScore && leg.hybridBreakdown && (
                  <div className="mt-2 p-2 bg-neon-purple/10 rounded border border-neon-purple/20">
                    <div className="flex flex-wrap justify-between text-xs mb-2 gap-1">
                      <span className="text-muted-foreground">Sharp: {leg.hybridBreakdown.sharp}/40</span>
                      <span className="text-muted-foreground">User: {leg.hybridBreakdown.user}/35</span>
                      <span className="text-muted-foreground">AI: {leg.hybridBreakdown.ai}/25</span>
                      {leg.hybridBreakdown.fatigue !== undefined && leg.hybridBreakdown.fatigue !== 0 && (
                        <span className={cn(
                          "font-medium",
                          leg.hybridBreakdown.fatigue > 0 ? "text-yellow-400" : "text-orange-400"
                        )}>
                          Fatigue: {leg.hybridBreakdown.fatigue > 0 ? '+' : ''}{leg.hybridBreakdown.fatigue}
                        </span>
                      )}
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
