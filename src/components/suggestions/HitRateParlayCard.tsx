import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TrendingUp, Target, Zap, ChevronDown, ChevronUp, Trophy, X, AlertCircle } from "lucide-react";
import { useState } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface HitRateLeg {
  player_name: string;
  prop_type: string;
  line: number;
  recommended_side: string;
  price: number;
  hit_rate: number;
  games_analyzed: number;
  over_hits: number;
  under_hits: number;
  game_logs: any[];
  confidence_score: number;
  sport: string;
  game_description: string;
  commence_time: string;
  sharp_aligned?: boolean;
}

interface HitRateParlay {
  id: string;
  legs: HitRateLeg[];
  combined_probability: number;
  total_odds: number;
  min_hit_rate: number;
  strategy_type: string;
  sharp_optimized: boolean;
  sharp_analysis?: any[];
  sharp_analysis_attempted?: boolean;
  sport: string;
  expires_at: string;
}

interface HitRateParlayCardProps {
  parlay: HitRateParlay;
  onRunSharpAnalysis?: (parlayId: string) => void;
  onDismiss?: (parlayId: string) => void;
}

const PROP_LABELS: Record<string, string> = {
  'player_points': 'Points',
  'player_rebounds': 'Rebounds',
  'player_assists': 'Assists',
  'player_threes': '3-Pointers',
  'player_points_rebounds_assists': 'PRA',
  'player_steals': 'Steals',
  'player_blocks': 'Blocks',
  'player_pass_tds': 'Pass TDs',
  'player_pass_yds': 'Pass Yards',
  'player_rush_yds': 'Rush Yards',
  'player_receptions': 'Receptions',
  'player_goals': 'Goals',
  'player_shots_on_goal': 'Shots'
};

const SPORT_COLORS: Record<string, string> = {
  'basketball_nba': 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  'americanfootball_nfl': 'bg-green-500/20 text-green-300 border-green-500/30',
  'icehockey_nhl': 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  'mixed': 'bg-purple-500/20 text-purple-300 border-purple-500/30'
};

export function HitRateParlayCard({ parlay, onRunSharpAnalysis, onDismiss }: HitRateParlayCardProps) {
  const [expandedLeg, setExpandedLeg] = useState<number | null>(null);

  const formatOdds = (odds: number | undefined | null) => {
    if (odds === undefined || odds === null) return '-110';
    return odds > 0 ? `+${odds}` : odds.toString();
  };

  const formatHitRate = (rate: number) => {
    return `${Math.round(rate * 100)}%`;
  };

  const getHitRateDisplay = (leg: HitRateLeg) => {
    const hits = leg.recommended_side?.toLowerCase() === 'over' ? leg.over_hits : leg.under_hits;
    return `${hits}/${leg.games_analyzed}`;
  };

  const renderHitStreak = (leg: HitRateLeg) => {
    const hits = leg.recommended_side?.toLowerCase() === 'over' ? leg.over_hits : leg.under_hits;
    const total = leg.games_analyzed;
    
    return (
      <div className="flex gap-1">
        {Array.from({ length: total }).map((_, i) => (
          <div
            key={i}
            className={`w-2.5 h-2.5 rounded-full ${
              i < hits ? 'bg-neon-green' : 'bg-muted-foreground/30'
            }`}
          />
        ))}
      </div>
    );
  };

  const strategyLabel = parlay.strategy_type === '5/5_streak' 
    ? '🔥 5/5 STREAK' 
    : '✅ 4/5 CONSISTENT';

  const expiresIn = () => {
    const expires = new Date(parlay.expires_at);
    const now = new Date();
    const hours = Math.floor((expires.getTime() - now.getTime()) / (1000 * 60 * 60));
    if (hours < 1) return 'Soon';
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
  };

  return (
    <Card className="bg-card/80 backdrop-blur border-border/50 hover:border-primary/30 transition-all">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-neon-yellow" />
            <CardTitle className="text-lg font-bold">{strategyLabel}</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={SPORT_COLORS[parlay.sport] || SPORT_COLORS.mixed}>
              {parlay.sport === 'mixed' ? 'MIXED' : parlay.sport.split('_')[1]?.toUpperCase()}
            </Badge>
            {parlay.sharp_optimized && (
              <Badge className="bg-neon-purple/20 text-neon-purple border-neon-purple/30">
                <Zap className="h-3 w-3 mr-1" />
                Sharp
              </Badge>
            )}
            {parlay.sharp_analysis_attempted && !parlay.sharp_optimized && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="outline" className="bg-muted/50 text-muted-foreground border-muted-foreground/30">
                      <AlertCircle className="h-3 w-3 mr-1" />
                      No Sharp Data
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p>No sharp money movements detected for these players/games. The parlay is still valid based on historical hit rates.</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {onDismiss && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                onClick={(e) => {
                  e.stopPropagation();
                  onDismiss(parlay.id);
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
        
        <div className="flex items-center justify-between text-sm text-muted-foreground mt-2">
          <span>{parlay.legs.length} legs • Expires in {expiresIn()}</span>
          <span className="font-mono text-primary font-bold">
            {formatOdds(parlay.total_odds)}
          </span>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {parlay.legs.map((leg, index) => (
          <div 
            key={index}
            className="bg-background/50 rounded-lg p-3 border border-border/30"
          >
            <div 
              className="flex items-center justify-between cursor-pointer"
              onClick={() => setExpandedLeg(expandedLeg === index ? null : index)}
            >
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">{leg.player_name}</span>
                  {leg.sharp_aligned && (
                    <Zap className="h-3 w-3 text-neon-yellow" />
                  )}
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>
                    {(leg.recommended_side || 'OVER').toUpperCase()} {leg.line} {PROP_LABELS[leg.prop_type] || leg.prop_type}
                  </span>
                  <span className="font-mono">{formatOdds(leg.price)}</span>
                </div>
              </div>
              
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div className="flex items-center gap-1">
                    <Target className="h-3 w-3 text-neon-green" />
                    <span className="font-bold text-neon-green">{getHitRateDisplay(leg)}</span>
                  </div>
                  {renderHitStreak(leg)}
                </div>
                {expandedLeg === index ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
            </div>

            {expandedLeg === index && leg.game_logs && (
              <div className="mt-3 pt-3 border-t border-border/30">
                <div className="text-xs text-muted-foreground mb-2">Last {leg.games_analyzed} Games:</div>
                <div className="space-y-1">
                  {leg.game_logs.map((game: any, gi: number) => {
                    const hitLine = leg.recommended_side?.toLowerCase() === 'over' 
                      ? game.stat_value > leg.line 
                      : game.stat_value < leg.line;
                    
                    return (
                      <div 
                        key={gi}
                        className={`flex items-center justify-between text-sm px-2 py-1 rounded ${
                          hitLine ? 'bg-neon-green/10' : 'bg-destructive/10'
                        }`}
                      >
                        <span className="text-muted-foreground">{game.date}</span>
                        <span className={`font-mono ${hitLine ? 'text-neon-green' : 'text-destructive'}`}>
                          {game.stat_value} {hitLine ? '✓' : '✗'}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  Confidence: {leg.confidence_score}% • {leg.game_description}
                </div>
              </div>
            )}
          </div>
        ))}

        <div className="pt-3 border-t border-border/30">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm text-muted-foreground">
              Combined Hit Rate Probability
            </div>
            <div className="flex items-center gap-1">
              <TrendingUp className="h-4 w-4 text-neon-green" />
              <span className="font-bold text-neon-green">{parlay.combined_probability}%</span>
            </div>
          </div>

          {!parlay.sharp_optimized && onRunSharpAnalysis && (
            <Button 
              onClick={() => onRunSharpAnalysis(parlay.id)}
              variant="outline" 
              className="w-full border-neon-purple/30 text-neon-purple hover:bg-neon-purple/10"
            >
              <Zap className="h-4 w-4 mr-2" />
              Run Sharp Line Analysis
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
