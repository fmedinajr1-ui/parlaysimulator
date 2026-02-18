import React, { useState } from 'react';
import { ChevronDown, ChevronUp, TrendingUp, Target, Percent, DollarSign, CheckCircle, XCircle, Clock, Minus, Zap, ArrowUpRight, MapPin } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import type { BotParlay, BotLeg } from '@/hooks/useBotEngine';

const TEAM_CATEGORIES = ['SHARP_SPREAD', 'UNDER_TOTAL', 'OVER_TOTAL', 'ML_UNDERDOG', 'ML_FAVORITE'];

function isTeamLeg(leg: BotLeg): boolean {
  return leg.type === 'team' || TEAM_CATEGORIES.includes(leg.category ?? '') || (!!leg.home_team && !!leg.away_team);
}

function getTeamLegName(leg: BotLeg): string {
  if (leg.bet_type === 'total' && leg.home_team && leg.away_team) return `${leg.home_team} vs ${leg.away_team}`;
  if (leg.home_team && leg.away_team) return leg.side === 'home' ? leg.home_team : (leg.side === 'away' ? leg.away_team : leg.home_team);
  return leg.category ?? 'Team Bet';
}

function computePayout(stake: number, americanOdds: number): number {
  if (!americanOdds || !stake) return 0;
  if (americanOdds > 0) return stake + (stake * americanOdds / 100);
  return stake + (stake * 100 / Math.abs(americanOdds));
}

function formatOdds(odds?: number): string {
  if (!odds) return '-110';
  return odds > 0 ? `+${odds}` : `${odds}`;
}

function getTierColor(strategyName: string): string {
  const sn = strategyName.toLowerCase();
  if (sn.includes('monster_parlay')) return 'border-l-red-500';
  if (sn.includes('bankroll_doubler') || sn.includes('round_robin')) return 'border-l-yellow-500';
  if (sn.includes('exploration')) return 'border-l-blue-500';
  if (sn.includes('validation')) return 'border-l-amber-500';
  return 'border-l-green-500';
}

interface BotParlayCardProps {
  parlay: BotParlay;
}

export function BotParlayCard({ parlay }: BotParlayCardProps) {
  const [isOpen, setIsOpen] = useState(false);

  const getOutcomeStyle = (outcome: string) => {
    switch (outcome) {
      case 'won': return 'bg-green-500/20 text-green-400 border-green-500/50';
      case 'lost': return 'bg-red-500/20 text-red-400 border-red-500/50';
      case 'partial': return 'bg-amber-500/20 text-amber-400 border-amber-500/50';
      case 'push': return 'bg-blue-500/20 text-blue-400 border-blue-500/50';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  const getOutcomeIcon = (outcome: string) => {
    switch (outcome) {
      case 'won': return <CheckCircle className="w-3.5 h-3.5" />;
      case 'lost': return <XCircle className="w-3.5 h-3.5" />;
      case 'push': return <Minus className="w-3.5 h-3.5" />;
      default: return <Clock className="w-3.5 h-3.5" />;
    }
  };

  const getLegOutcomeStyle = (outcome?: string) => {
    switch (outcome) {
      case 'hit': return 'text-green-400';
      case 'miss': return 'text-red-400';
      case 'push': return 'text-blue-400';
      default: return 'text-muted-foreground';
    }
  };

  const legs = parlay.legs as BotLeg[];

  return (
    <Card className={cn(
      'transition-all duration-200 border-l-4',
      getTierColor(parlay.strategy_name),
      parlay.outcome === 'won' && 'bg-green-500/5',
      parlay.outcome === 'lost' && 'bg-red-500/5'
    )}>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className="w-full p-3 h-auto flex items-center justify-between hover:bg-transparent">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <Badge className={cn('text-xs', getOutcomeStyle(parlay.outcome))}>
                {getOutcomeIcon(parlay.outcome)}
                <span className="ml-1 capitalize">{parlay.outcome}</span>
              </Badge>
              <span className="text-xs text-muted-foreground">{parlay.leg_count}L</span>
              {(parlay.created_at || parlay.parlay_date) && (
                <span className="text-xs text-muted-foreground">
                  · {parlay.created_at
                    ? format(parseISO(parlay.created_at), 'MMM d h:mm a')
                    : format(parseISO(parlay.parlay_date), 'MMM d')}
                </span>
              )}
              <div className="flex items-center gap-2 text-xs">
                <span className="text-green-400 font-medium">+{((parlay.simulated_edge || 0) * 100).toFixed(1)}%</span>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/15 text-primary text-xs font-bold border border-primary/30">
                  <DollarSign className="w-3 h-3" />
                  {parlay.simulated_stake || 10}
                </span>
                {parlay.outcome === 'won' && (
                  <span className="text-green-400 font-medium">→ +${(parlay.profit_loss || 0).toFixed(0)}</span>
                )}
                {parlay.outcome === 'lost' && (
                  <span className="text-red-400 font-medium">→ -${parlay.simulated_stake || 10}</span>
                )}
              </div>
            </div>
            {isOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
          </Button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="pt-0 pb-3">
            <div className="border-t border-border/50 pt-2 space-y-1.5">
              <div className="flex items-center justify-between py-2 px-2.5 rounded bg-primary/10 border border-primary/20 text-xs mb-2">
                <div className="flex items-center gap-1.5 text-primary font-semibold">
                  <DollarSign className="w-3.5 h-3.5" />
                  <span>Bet ${parlay.simulated_stake || 10}</span>
                </div>
                <div className="flex items-center gap-3 text-muted-foreground">
                  <span>To win <span className="text-green-400 font-semibold">${(parlay.simulated_payout || computePayout(parlay.simulated_stake || 10, parlay.expected_odds || 0)).toFixed(0)}</span></span>
                  <span className="capitalize">{parlay.tier || 'explore'} tier</span>
                </div>
              </div>
              <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
                Legs ({parlay.legs_hit || 0} hit / {parlay.legs_missed || 0} missed)
              </div>
              {legs.map((leg, idx) => {
                const hasAltLine = leg.original_line && leg.selected_line && leg.original_line !== leg.selected_line;
                return (
                  <div
                    key={leg.id || idx}
                    className={cn('py-1.5 px-2.5 rounded bg-muted/30 text-xs', getLegOutcomeStyle(leg.outcome))}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <span className="font-medium">
                          {isTeamLeg(leg) ? getTeamLegName(leg) : (leg.player_name ?? 'Unknown')}
                        </span>
                        <span className="text-muted-foreground ml-1.5">
                          {isTeamLeg(leg)
                            ? leg.bet_type === 'total'
                              ? <>Total <span className={(leg.side ?? 'over') === 'over' ? 'text-green-400 font-semibold' : 'text-red-400 font-semibold'}>{(leg.side ?? 'over').toUpperCase()}</span> {leg.line ?? 0}</>
                              : `${(leg.bet_type ?? 'spread').charAt(0).toUpperCase() + (leg.bet_type ?? 'spread').slice(1)} ${leg.line ?? 0}`
                            : <>{leg.prop_type ?? 'Prop'} <span className={(leg.side ?? 'over') === 'over' ? 'text-green-400 font-semibold' : 'text-red-400 font-semibold'}>{(leg.side ?? 'over').toUpperCase()}</span> {leg.line ?? 0}</>}
                          {hasAltLine && <span className="text-amber-400 ml-1">(alt)</span>}
                        </span>
                      </div>
                      <span className="font-medium tabular-nums ml-2">{formatOdds(leg.american_odds)}</span>
                    </div>
                  </div>
                );
              })}
              <div className="text-[10px] text-muted-foreground pt-1">
                {parlay.strategy_name} v{parlay.strategy_version || 1}
              </div>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
