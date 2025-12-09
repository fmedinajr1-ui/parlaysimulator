import React from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TrendingUp, TrendingDown, Zap, Plus, Check, Target, AlertTriangle, X } from 'lucide-react';
import { motion } from 'framer-motion';
import { useParlayBuilder } from '@/contexts/ParlayBuilderContext';
import { cn } from '@/lib/utils';

interface TrackedProp {
  id: string;
  event_id: string | null;
  sport: string;
  game_description: string;
  player_name: string;
  prop_type: string;
  bookmaker: string;
  opening_line: number;
  opening_over_price: number;
  opening_under_price: number;
  current_line: number | null;
  current_over_price: number | null;
  current_under_price: number | null;
  price_movement_over: number | null;
  ai_recommendation: string | null;
  ai_direction: string | null;
  ai_confidence: number | null;
  ai_reasoning: string | null;
  ai_signals: unknown;
  status: string;
  commence_time: string | null;
  created_at: string;
}

interface GodModePropCardProps {
  prop: TrackedProp;
}

export function GodModePropCard({ prop }: GodModePropCardProps) {
  const { addLeg, hasLeg } = useParlayBuilder();

  const getOdds = () => {
    if (prop.ai_direction === 'over') {
      return prop.current_over_price || prop.opening_over_price;
    }
    return prop.current_under_price || prop.opening_under_price;
  };

  const description = `${prop.player_name} ${prop.ai_direction?.toUpperCase() || 'OVER'} ${prop.current_line || prop.opening_line} ${prop.prop_type}`;
  const odds = getOdds();
  const isAdded = hasLeg(description);

  const handleAddToParlay = () => {
    if (isAdded) return;
    
    addLeg({
      description,
      odds,
      source: 'sharp',
      playerName: prop.player_name,
      propType: prop.prop_type,
      line: prop.current_line || prop.opening_line,
      side: (prop.ai_direction as 'over' | 'under') || 'over',
      sport: prop.sport,
      eventId: prop.event_id || undefined,
      confidenceScore: prop.ai_confidence || undefined,
    });
  };

  const signals = prop.ai_signals as {
    godMode?: boolean;
    sharpPressure?: number;
    trapPressure?: number;
    nmes?: number;
    sharpProbability?: number;
    godModeScore?: number;
  } | null;

  const sharpPressure = signals?.sharpPressure || 0;
  const trapPressure = signals?.trapPressure || 0;
  const sharpProb = signals?.sharpProbability || 0.5;
  const godModeScore = signals?.godModeScore || 0;
  const nmes = signals?.nmes || 0;

  const formatPrice = (price: number | null | undefined) => {
    if (price === null || price === undefined) return '--';
    return price > 0 ? `+${price}` : price.toString();
  };

  const formatPropType = (propType: string) => {
    return propType
      .replace(/_/g, ' ')
      .replace(/player /gi, '')
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  };

  const getRecommendationStyles = (rec: string | null) => {
    switch (rec) {
      case 'pick':
        return { bg: 'bg-green-500/20', text: 'text-green-400', border: 'border-green-500/30', icon: Target };
      case 'fade':
        return { bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-500/30', icon: X };
      default:
        return { bg: 'bg-yellow-500/20', text: 'text-yellow-400', border: 'border-yellow-500/30', icon: AlertTriangle };
    }
  };

  const recStyles = getRecommendationStyles(prop.ai_recommendation);
  const RecIcon = recStyles.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card className={cn(
        "overflow-hidden border transition-all hover:shadow-lg",
        prop.ai_recommendation === 'pick' && "border-green-500/30 bg-green-500/5",
        prop.ai_recommendation === 'fade' && "border-red-500/30 bg-red-500/5",
        prop.ai_recommendation === 'caution' && "border-yellow-500/30 bg-yellow-500/5"
      )}>
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              {/* Badges Row - Sport and Bookmaker */}
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <Badge variant="outline" className="text-xs font-medium">
                  {prop.sport === 'basketball_nba' ? 'NBA' : prop.sport === 'americanfootball_nfl' ? 'NFL' : prop.sport.toUpperCase()}
                </Badge>
                {prop.ai_recommendation && (
                  <Badge className={cn("text-xs", recStyles.bg, recStyles.text, recStyles.border)}>
                    <RecIcon className="w-3 h-3 mr-1" />
                    {prop.ai_recommendation.toUpperCase()}
                  </Badge>
                )}
                {prop.ai_direction && (
                  <Badge variant="secondary" className="text-xs font-mono">
                    {prop.ai_direction.toUpperCase()}
                  </Badge>
                )}
                <span className="text-xs text-muted-foreground ml-auto">{prop.bookmaker}</span>
              </div>
              
              {/* Player Name - Prominent */}
              <h3 className="font-bold text-xl text-foreground">
                {prop.player_name || 'Unknown Player'}
              </h3>
              
              {/* Prop Type and Line - Clear display */}
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="outline" className="text-sm font-semibold bg-primary/10 border-primary/30 text-primary">
                  {formatPropType(prop.prop_type)} {prop.ai_direction?.toUpperCase() || 'O'} {prop.current_line || prop.opening_line}
                </Badge>
              </div>
              
              {/* Game Description */}
              <p className="text-sm text-muted-foreground mt-2 truncate">{prop.game_description}</p>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Odds Comparison with Line Values */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-lg bg-muted/30 text-center">
              <p className="text-xs text-muted-foreground mb-1">Opening</p>
              <p className="font-mono text-lg font-bold text-foreground">
                {prop.opening_line}
              </p>
              <div className="flex justify-center gap-2 mt-1">
                <span className="text-xs font-mono text-green-500">O {formatPrice(prop.opening_over_price)}</span>
                <span className="text-xs text-muted-foreground">/</span>
                <span className="text-xs font-mono text-red-400">U {formatPrice(prop.opening_under_price)}</span>
              </div>
            </div>
            <div className="p-3 rounded-lg bg-muted/30 text-center">
              <p className="text-xs text-muted-foreground mb-1">Current</p>
              <p className="font-mono text-lg font-bold text-foreground">
                {prop.current_line ?? prop.opening_line}
              </p>
              <div className="flex justify-center gap-2 mt-1">
                <span className="text-xs font-mono text-green-500">O {formatPrice(prop.current_over_price ?? prop.opening_over_price)}</span>
                <span className="text-xs text-muted-foreground">/</span>
                <span className="text-xs font-mono text-red-400">U {formatPrice(prop.current_under_price ?? prop.opening_under_price)}</span>
              </div>
            </div>
          </div>

          {/* Movement Indicator */}
          {prop.price_movement_over !== null && prop.price_movement_over !== 0 && (
            <div className="flex items-center gap-2 text-sm">
              {prop.price_movement_over < 0 ? (
                <TrendingDown className="w-4 h-4 text-green-400" />
              ) : (
                <TrendingUp className="w-4 h-4 text-red-400" />
              )}
              <span>
                Over moved {prop.price_movement_over > 0 ? '+' : ''}{prop.price_movement_over} pts
              </span>
            </div>
          )}

          {/* GOD MODE Metrics */}
          {signals?.godMode && (
            <div className="space-y-3 p-3 rounded-lg bg-primary/5 border border-primary/20">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-primary" />
                  <span className="text-sm font-medium">GOD MODE SCORE</span>
                </div>
                <span className={cn(
                  "font-mono font-bold text-lg",
                  godModeScore >= 35 && "text-green-400",
                  godModeScore <= -25 && "text-red-400",
                  godModeScore > -25 && godModeScore < 35 && "text-yellow-400"
                )}>
                  {godModeScore >= 0 ? '+' : ''}{godModeScore.toFixed(1)}
                </span>
              </div>

              {/* Pressure Bars */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs w-16 text-muted-foreground">Sharp</span>
                  <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(sharpPressure, 100)}%` }}
                      className="h-full bg-green-500"
                    />
                  </div>
                  <span className="text-xs font-mono w-10 text-right">{sharpPressure.toFixed(0)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs w-16 text-muted-foreground">Trap</span>
                  <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(trapPressure, 100)}%` }}
                      className="h-full bg-red-500"
                    />
                  </div>
                  <span className="text-xs font-mono w-10 text-right">{trapPressure.toFixed(0)}</span>
                </div>
              </div>

              {/* Probability Meter */}
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Sharp Probability</span>
                <span className={cn(
                  "font-mono font-medium",
                  sharpProb >= 0.62 && "text-green-400",
                  sharpProb <= 0.35 && "text-red-400"
                )}>
                  {(sharpProb * 100).toFixed(0)}%
                </span>
              </div>

              {/* NMES */}
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">NMES</span>
                <span className="font-mono">{nmes.toFixed(1)}</span>
              </div>
            </div>
          )}

          {/* AI Reasoning */}
          {prop.ai_reasoning && (
            <p className="text-xs text-muted-foreground line-clamp-2">{prop.ai_reasoning}</p>
          )}

          {/* Add to Parlay Button */}
          {prop.ai_recommendation && (
            <Button
              onClick={handleAddToParlay}
              disabled={isAdded}
              className={cn(
                "w-full",
                isAdded && "opacity-50"
              )}
              variant={isAdded ? "outline" : "default"}
            >
              {isAdded ? (
                <>
                  <Check className="w-4 h-4 mr-2" />
                  Added to Parlay
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4 mr-2" />
                  Add to Parlay
                </>
              )}
            </Button>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
