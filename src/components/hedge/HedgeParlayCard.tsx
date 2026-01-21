import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Shield, TrendingUp, TrendingDown, Target, Users, Swords } from "lucide-react";
import { cn } from "@/lib/utils";

interface HedgeParlayLeg {
  player_name: string;
  prop_type: string;
  line: number;
  side: string;
  odds: number;
  h2h_games: number;
  h2h_avg: number;
  h2h_hit_rate: number;
  defense_grade: string;
  hedge_role: string;
  team_name: string;
  opponent: string;
  composite_score: number;
}

interface HedgeParlay {
  id: string;
  parlay_date: string;
  parlay_type: 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';
  legs: HedgeParlayLeg[];
  hedge_score: number;
  correlation_score: number;
  h2h_confidence: number;
  total_odds: number;
  outcome: string;
}

interface HedgeParlayCardProps {
  parlay: HedgeParlay;
}

const PARLAY_CONFIG = {
  CONSERVATIVE: {
    icon: Shield,
    label: 'Conservative',
    description: 'High H2H confidence, lower variance',
    gradient: 'from-emerald-500/20 to-emerald-600/10',
    border: 'border-emerald-500/30',
    badge: 'bg-emerald-500/20 text-emerald-400'
  },
  BALANCED: {
    icon: Target,
    label: 'Balanced',
    description: 'Optimal risk/reward hedge',
    gradient: 'from-blue-500/20 to-blue-600/10',
    border: 'border-blue-500/30',
    badge: 'bg-blue-500/20 text-blue-400'
  },
  AGGRESSIVE: {
    icon: Swords,
    label: 'Aggressive',
    description: 'Higher upside, more legs',
    gradient: 'from-orange-500/20 to-orange-600/10',
    border: 'border-orange-500/30',
    badge: 'bg-orange-500/20 text-orange-400'
  }
};

const DEFENSE_GRADE_COLORS: Record<string, string> = {
  'A': 'text-emerald-400 bg-emerald-500/20',
  'B': 'text-blue-400 bg-blue-500/20',
  'C': 'text-yellow-400 bg-yellow-500/20',
  'D': 'text-orange-400 bg-orange-500/20',
  'F': 'text-red-400 bg-red-500/20'
};

const HEDGE_ROLE_BADGES: Record<string, { label: string; color: string }> = {
  'ANCHOR': { label: 'Anchor', color: 'bg-primary/20 text-primary' },
  'HEDGE': { label: 'Hedge', color: 'bg-purple-500/20 text-purple-400' },
  'VALUE': { label: 'Value', color: 'bg-muted text-muted-foreground' }
};

function formatOdds(odds: number): string {
  return odds > 0 ? `+${odds}` : `${odds}`;
}

function formatPropType(propType: string): string {
  return propType
    .replace('player_', '')
    .replace(/_/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function HedgeParlayCard({ parlay }: HedgeParlayCardProps) {
  const config = PARLAY_CONFIG[parlay.parlay_type];
  const Icon = config.icon;

  return (
    <Card className={cn(
      "overflow-hidden border",
      config.border,
      `bg-gradient-to-br ${config.gradient}`
    )}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={cn("p-2 rounded-lg", config.badge)}>
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-lg">{config.label} Hedge</CardTitle>
              <p className="text-xs text-muted-foreground">{config.description}</p>
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-primary">
              {formatOdds(parlay.total_odds)}
            </div>
            <Badge variant="outline" className="text-xs">
              {parlay.legs.length} Legs
            </Badge>
          </div>
        </div>

        {/* Hedge Metrics */}
        <div className="flex gap-4 mt-3 pt-3 border-t border-border/50">
          <div className="text-center">
            <div className="text-xs text-muted-foreground">H2H Confidence</div>
            <div className="text-sm font-semibold text-emerald-400">
              {Math.round(parlay.h2h_confidence * 100)}%
            </div>
          </div>
          <div className="text-center">
            <div className="text-xs text-muted-foreground">Hedge Score</div>
            <div className="text-sm font-semibold text-blue-400">
              {parlay.hedge_score.toFixed(1)}
            </div>
          </div>
          <div className="text-center">
            <div className="text-xs text-muted-foreground">Correlation</div>
            <div className="text-sm font-semibold text-purple-400">
              {Math.round(parlay.correlation_score * 100)}%
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {parlay.legs.map((leg, index) => (
          <div 
            key={index} 
            className="p-3 rounded-lg bg-background/50 border border-border/50"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium">{leg.player_name}</span>
                  <Badge 
                    variant="outline" 
                    className={cn("text-xs", HEDGE_ROLE_BADGES[leg.hedge_role]?.color)}
                  >
                    {HEDGE_ROLE_BADGES[leg.hedge_role]?.label || leg.hedge_role}
                  </Badge>
                </div>
                
                <div className="flex items-center gap-2 text-sm">
                  {leg.side.toLowerCase() === 'over' ? (
                    <TrendingUp className="h-4 w-4 text-emerald-400" />
                  ) : (
                    <TrendingDown className="h-4 w-4 text-red-400" />
                  )}
                  <span className="text-muted-foreground">
                    {formatPropType(leg.prop_type)}
                  </span>
                  <span className="font-medium">
                    {leg.side.toUpperCase()} {leg.line}
                  </span>
                </div>

                <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Users className="h-3 w-3" />
                    vs {leg.opponent}
                  </span>
                  {leg.h2h_games > 0 && (
                    <span className="text-blue-400">
                      H2H: {leg.h2h_games}G @ {leg.h2h_avg.toFixed(1)} avg
                    </span>
                  )}
                </div>
              </div>

              <div className="text-right space-y-1">
                <div className="font-mono text-sm font-medium">
                  {formatOdds(leg.odds)}
                </div>
                <div className="flex gap-1 justify-end">
                  <Badge 
                    variant="outline" 
                    className={cn("text-xs", DEFENSE_GRADE_COLORS[leg.defense_grade])}
                  >
                    Def: {leg.defense_grade}
                  </Badge>
                </div>
                {leg.h2h_hit_rate > 0 && (
                  <div className="text-xs text-emerald-400">
                    {Math.round(leg.h2h_hit_rate * 100)}% H2H
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}

        {parlay.outcome !== 'pending' && (
          <div className={cn(
            "text-center py-2 rounded-lg font-medium",
            parlay.outcome === 'win' ? 'bg-emerald-500/20 text-emerald-400' :
            parlay.outcome === 'loss' ? 'bg-red-500/20 text-red-400' :
            'bg-muted text-muted-foreground'
          )}>
            {parlay.outcome.toUpperCase()}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
