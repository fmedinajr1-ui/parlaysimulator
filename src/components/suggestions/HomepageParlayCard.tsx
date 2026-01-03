import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Shield, TrendingUp, Target, Zap } from "lucide-react";

interface Leg {
  player_name: string;
  prop_type: string;
  stat_type: string;
  line: number;
  direction: string;
  hit_rate: number;
  edge: number;
  confidence_tier: string;
  defense_code: number;
  game_description: string;
}

interface HomepageParlayCardProps {
  parlay: {
    id: string;
    legs: Leg[];
    total_odds: number;
    win_probability_est: number;
    risk_label: string;
    tags: string[];
  };
  onAnalyze?: () => void;
}

function getDefenseLabel(code: number): { label: string; color: string } {
  if (code >= 80) return { label: 'Hard', color: 'text-red-400' };
  if (code >= 60) return { label: 'Neutral', color: 'text-yellow-400' };
  return { label: 'Soft', color: 'text-green-400' };
}

function getTierColor(tier: string): string {
  switch (tier) {
    case 'A': return 'bg-green-500/20 text-green-400 border-green-500/30';
    case 'B': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
    case 'C': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
    default: return 'bg-muted text-muted-foreground';
  }
}

function formatStatType(stat: string): string {
  return stat
    .replace(/_/g, ' ')
    .replace(/\b\w/g, l => l.toUpperCase())
    .replace('Pra', 'PRA')
    .replace('Points Rebounds Assists', 'PRA');
}

function formatOdds(odds: number): string {
  return odds >= 0 ? `+${odds}` : `${odds}`;
}

export function HomepageParlayCard({ parlay, onAnalyze }: HomepageParlayCardProps) {
  const { legs, total_odds, win_probability_est, risk_label, tags } = parlay;

  return (
    <Card className="bg-card/50 border-border/50 hover:border-primary/30 transition-all duration-200">
      <CardContent className="p-4 space-y-3">
        {/* Header with odds and probability */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">
              <Zap className="w-3 h-3 mr-1" />
              {formatOdds(total_odds)}
            </Badge>
            <Badge 
              variant="outline" 
              className={
                risk_label === 'LOW' ? 'bg-green-500/10 text-green-400 border-green-500/30' :
                risk_label === 'MED' ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30' :
                'bg-red-500/10 text-red-400 border-red-500/30'
              }
            >
              {risk_label} Risk
            </Badge>
          </div>
          <span className="text-xs text-muted-foreground">
            {(win_probability_est * 100).toFixed(0)}% Win Est.
          </span>
        </div>

        {/* Tags */}
        <div className="flex flex-wrap gap-1.5">
          {tags.includes('HITRATE+MEDIAN') && (
            <Badge variant="secondary" className="text-xs bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
              <Target className="w-3 h-3 mr-1" />
              Unified Agreement
            </Badge>
          )}
          {tags.includes('TIER_A') && (
            <Badge variant="secondary" className="text-xs bg-green-500/10 text-green-400 border-green-500/30">
              Tier A
            </Badge>
          )}
          {tags.includes('TIER_B+') && !tags.includes('TIER_A') && (
            <Badge variant="secondary" className="text-xs bg-blue-500/10 text-blue-400 border-blue-500/30">
              Tier B+
            </Badge>
          )}
        </div>

        {/* Legs */}
        <div className="space-y-2">
          {legs.map((leg, index) => {
            const defense = getDefenseLabel(leg.defense_code);
            return (
              <div 
                key={index}
                className="bg-background/50 rounded-lg p-3 border border-border/30"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm truncate">{leg.player_name}</span>
                      <Badge variant="outline" className={`text-xs ${getTierColor(leg.confidence_tier)}`}>
                        {leg.confidence_tier}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className={leg.direction === 'OVER' ? 'text-green-400' : 'text-red-400'}>
                        {leg.direction} {leg.line}
                      </span>
                      <span>•</span>
                      <span>{formatStatType(leg.stat_type)}</span>
                    </div>
                    {leg.game_description && (
                      <div className="text-xs text-muted-foreground mt-1 truncate">
                        {leg.game_description}
                      </div>
                    )}
                  </div>
                  
                  <div className="flex flex-col items-end gap-1">
                    <div className="flex items-center gap-1">
                      <TrendingUp className="w-3 h-3 text-primary" />
                      <span className="text-xs font-medium text-primary">
                        {(leg.hit_rate * 100).toFixed(0)}%
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-muted-foreground">
                        Edge: {leg.edge >= 0 ? '+' : ''}{leg.edge.toFixed(1)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Shield className={`w-3 h-3 ${defense.color}`} />
                      <span className={`text-xs ${defense.color}`}>
                        {defense.label}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Leg count indicator */}
        <div className="text-center text-xs text-muted-foreground">
          {legs.length}-Leg Parlay • Uncorrelated
        </div>
      </CardContent>
    </Card>
  );
}
