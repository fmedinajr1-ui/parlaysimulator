/**
 * BotParlayCard.tsx
 * 
 * Displays a single bot-generated parlay with simulation metrics,
 * odds value scoring, and leg details.
 */

import React, { useState } from 'react';
import { ChevronDown, ChevronUp, TrendingUp, Target, Percent, DollarSign, CheckCircle, XCircle, Clock, Minus, Zap, ArrowUpRight, MapPin } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import type { BotParlay, BotLeg } from '@/hooks/useBotEngine';

const TEAM_CATEGORIES = ['SHARP_SPREAD', 'UNDER_TOTAL', 'OVER_TOTAL', 'ML_UNDERDOG', 'ML_FAVORITE'];

function isTeamLeg(leg: BotLeg): boolean {
  return leg.type === 'team' ||
    TEAM_CATEGORIES.includes(leg.category ?? '') ||
    (!!leg.home_team && !!leg.away_team);
}

function getTeamLegName(leg: BotLeg): string {
  if (leg.bet_type === 'total' && leg.home_team && leg.away_team) {
    return `${leg.home_team} vs ${leg.away_team}`;
  }
  if (leg.home_team && leg.away_team) {
    return leg.side === 'home' ? leg.home_team : (leg.side === 'away' ? leg.away_team : leg.home_team);
  }
  return leg.category ?? 'Team Bet';
}

// Format American odds for display
function formatOdds(odds?: number): string {
  if (!odds) return '-110';
  return odds > 0 ? `+${odds}` : `${odds}`;
}

interface BotParlayCardProps {
  parlay: BotParlay;
}

export function BotParlayCard({ parlay }: BotParlayCardProps) {
  const [isOpen, setIsOpen] = useState(false);
  
  const getOutcomeStyle = (outcome: string) => {
    switch (outcome) {
      case 'won':
        return 'bg-green-500/20 text-green-400 border-green-500/50';
      case 'lost':
        return 'bg-red-500/20 text-red-400 border-red-500/50';
      case 'partial':
        return 'bg-amber-500/20 text-amber-400 border-amber-500/50';
      case 'push':
        return 'bg-blue-500/20 text-blue-400 border-blue-500/50';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  const getOutcomeIcon = (outcome: string) => {
    switch (outcome) {
      case 'won':
        return <CheckCircle className="w-4 h-4" />;
      case 'lost':
        return <XCircle className="w-4 h-4" />;
      case 'push':
        return <Minus className="w-4 h-4" />;
      default:
        return <Clock className="w-4 h-4" />;
    }
  };

  const getLegOutcomeStyle = (outcome?: string) => {
    switch (outcome) {
      case 'hit':
        return 'text-green-400';
      case 'miss':
        return 'text-red-400';
      case 'push':
        return 'text-blue-400';
      default:
        return 'text-muted-foreground';
    }
  };

  const legs = parlay.legs as BotLeg[];

  return (
    <Card className={cn(
      "transition-all duration-200",
      parlay.outcome === 'won' && "border-green-500/30 bg-green-500/5",
      parlay.outcome === 'lost' && "border-red-500/30 bg-red-500/5"
    )}>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            className="w-full p-4 h-auto flex items-start justify-between hover:bg-transparent"
          >
            <div className="flex-1 text-left space-y-2">
              {/* Header Row */}
              <div className="flex items-center gap-2">
                <Badge className={getOutcomeStyle(parlay.outcome)}>
                  {getOutcomeIcon(parlay.outcome)}
                  <span className="ml-1 capitalize">{parlay.outcome}</span>
                </Badge>
                <span className="text-sm text-muted-foreground">
                  {parlay.leg_count}-leg parlay
                </span>
              </div>
              
              {/* Metrics Row */}
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div className="flex items-center gap-1.5">
                  <Target className="w-3.5 h-3.5 text-primary" />
                  <span className="text-muted-foreground">Win:</span>
                  <span className="font-medium">
                    {((parlay.simulated_win_rate || 0) * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <TrendingUp className="w-3.5 h-3.5 text-green-400" />
                  <span className="text-muted-foreground">Edge:</span>
                  <span className="font-medium text-green-400">
                    +{((parlay.simulated_edge || 0) * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Percent className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-muted-foreground">Sharpe:</span>
                  <span className="font-medium">
                    {(parlay.simulated_sharpe || 0).toFixed(2)}
                  </span>
                </div>
              </div>
              
              {/* Stake/Payout Row */}
              <div className="flex items-center gap-4 text-sm">
                <div className="flex items-center gap-1.5">
                  <DollarSign className="w-3.5 h-3.5" />
                  <span className="text-muted-foreground">Stake:</span>
                  <span className="font-medium">${parlay.simulated_stake || 50}</span>
                </div>
                {parlay.outcome === 'won' && (
                  <div className="flex items-center gap-1.5 text-green-400">
                    <span>→</span>
                    <span className="font-medium">+${(parlay.profit_loss || 0).toFixed(0)}</span>
                  </div>
                )}
                {parlay.outcome === 'lost' && (
                  <div className="flex items-center gap-1.5 text-red-400">
                    <span>→</span>
                    <span className="font-medium">-${parlay.simulated_stake || 50}</span>
                  </div>
                )}
              </div>
            </div>
            
            {isOpen ? (
              <ChevronUp className="w-5 h-5 text-muted-foreground shrink-0" />
            ) : (
              <ChevronDown className="w-5 h-5 text-muted-foreground shrink-0" />
            )}
          </Button>
        </CollapsibleTrigger>
        
        <CollapsibleContent>
          <CardContent className="pt-0 pb-4">
            <div className="border-t border-border/50 pt-3 space-y-2">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                Legs ({parlay.legs_hit || 0} hit / {parlay.legs_missed || 0} missed)
              </div>
              
                {legs.map((leg, idx) => {
                  const hasAltLine = leg.original_line && leg.selected_line && leg.original_line !== leg.selected_line;
                  const oddsImprovement = leg.odds_improvement || 0;
                  
                  return (
                    <div
                      key={leg.id || idx}
                      className={cn(
                        "py-2 px-3 rounded-lg bg-muted/30",
                        getLegOutcomeStyle(leg.outcome),
                        hasAltLine && "border-l-2 border-l-amber-500/50"
                      )}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="font-medium text-sm">
                            {isTeamLeg(leg)
                              ? getTeamLegName(leg)
                              : (leg.player_name ?? 'Unknown')}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {isTeamLeg(leg) ? (
                              <>
                                {(leg.bet_type ?? 'spread').charAt(0).toUpperCase() + (leg.bet_type ?? 'spread').slice(1)}{' '}
                                {leg.bet_type === 'total'
                                  ? `${(leg.side ?? 'over').toUpperCase()} ${leg.line ?? 0}`
                                  : `${leg.line ?? 0}`}
                              </>
                            ) : (
                              <>
                                {leg.prop_type ?? 'Prop'} {(leg.side ?? 'over').toUpperCase()} {leg.line ?? 0}
                                {hasAltLine && (
                                  <span className="text-amber-400 ml-1">
                                    (alt from {leg.original_line})
                                  </span>
                                )}
                                <span className="ml-1">• {leg.team_name}</span>
                              </>
                            )}
                          </div>
                          
                          {/* Odds and value display */}
                          <div className="flex items-center flex-wrap gap-3 mt-1 text-xs">
                            <span className="text-muted-foreground">
                              Odds: <span className={cn(
                                "font-medium",
                                (leg.american_odds || -110) > 0 ? "text-green-400" : "text-muted-foreground"
                              )}>
                                {formatOdds(leg.american_odds)}
                              </span>
                              {hasAltLine && oddsImprovement > 0 && (
                                <span className="text-green-400 ml-1">
                                  (+{oddsImprovement})
                                </span>
                              )}
                            </span>
                            
                            {leg.odds_value_score !== undefined && (
                              <span className="flex items-center gap-1">
                                <Zap className="w-3 h-3 text-amber-400" />
                                <span className={cn(
                                  "font-medium",
                                  leg.odds_value_score >= 60 ? "text-green-400" :
                                  leg.odds_value_score >= 45 ? "text-amber-400" : "text-red-400"
                                )}>
                                  {leg.odds_value_score}/100
                                </span>
                              </span>
                            )}
                            
                            {/* Projection buffer for alt lines */}
                            {hasAltLine && leg.projection_buffer !== undefined && (
                              <span className="flex items-center gap-1 text-amber-400">
                                <ArrowUpRight className="w-3 h-3" />
                                <span className="font-medium">
                                  +{leg.projection_buffer.toFixed(1)} buffer
                                </span>
                              </span>
                            )}
                            
                            {/* Line source verification */}
                            {(leg as any).line_source && (leg as any).line_source !== 'projected' && (
                              <span className="flex items-center gap-1 text-primary">
                                <MapPin className="w-3 h-3" />
                                <span className="font-medium capitalize">
                                  {(leg as any).line_source}
                                </span>
                              </span>
                            )}
                          </div>
                          
                          {/* Line selection reason for aggressive parlays */}
                          {leg.line_selection_reason && leg.line_selection_reason !== 'main_line' && (
                            <div className="text-xs text-amber-400/80 mt-0.5">
                              {leg.line_selection_reason === 'aggressive_plus_money' && '⚡ Plus money selection'}
                              {leg.line_selection_reason === 'best_ev_alt' && '📈 Best EV alternate'}
                            </div>
                          )}
                        </div>
                        
                        <div className="text-right shrink-0">
                          <Badge variant="outline" className="text-xs h-5">
                            {leg.category}
                          </Badge>
                          {leg.actual_value !== undefined && (
                            <div className="text-xs mt-1">
                              Actual: {leg.actual_value}
                            </div>
                          )}
                          {leg.projected_value !== undefined && !leg.actual_value && (
                            <div className="text-xs mt-1 text-muted-foreground">
                              Proj: {leg.projected_value}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              
              {/* Strategy Info */}
              <div className="text-xs text-muted-foreground pt-2 border-t border-border/50 mt-3">
                Strategy: {parlay.strategy_name} v{parlay.strategy_version || 1}
              </div>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
