import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useTodaysElite3PTParlay } from '@/hooks/useTodaysElite3PTParlay';
import { Target, Zap, Check, TrendingUp } from 'lucide-react';

export function Elite3PTFixedParlay() {
  const { 
    picks, 
    addEliteParlay, 
    isAlreadyAdded, 
    combinedProbability,
    theoreticalOdds,
    legCount 
  } = useTodaysElite3PTParlay();

  return (
    <Card className="border-primary/30 bg-gradient-to-br from-primary/10 to-background">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Target className="h-5 w-5 text-primary" />
            Elite 3PT Parlay
          </CardTitle>
          <Badge variant="secondary" className="bg-primary/20 text-primary">
            100% L10
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {legCount}-leg parlay with verified 100% L10 hit rate picks
        </p>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Picks Grid */}
        <div className="grid grid-cols-2 gap-2">
          {picks.map((pick, index) => (
            <div 
              key={index}
              className="flex items-center justify-between p-2 rounded-md bg-muted/30 border border-primary/10"
            >
              <div className="flex flex-col">
                <span className="text-sm font-medium truncate max-w-[100px]">
                  {pick.player.split(' ')[1] || pick.player}
                </span>
                <span className="text-xs text-muted-foreground">
                  O{pick.line} 3PT
                </span>
              </div>
              <div className="flex flex-col items-end">
                <span className="text-xs text-chart-2">
                  L10: {pick.l10Avg}
                </span>
                <span className="text-xs text-muted-foreground">
                  +{pick.edge} edge
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Stats Row */}
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-1.5">
            <TrendingUp className="h-4 w-4 text-chart-2" />
            <span className="text-muted-foreground">Est. Probability:</span>
            <span className="font-semibold text-chart-2">
              {Math.round(combinedProbability * 100)}%
            </span>
          </div>
          <div className="text-muted-foreground">
            Theo: <span className="font-mono">{theoreticalOdds}</span>
          </div>
        </div>

        {/* Add Button */}
        <Button 
          onClick={addEliteParlay}
          disabled={isAlreadyAdded}
          className="w-full gap-2"
          variant="neon"
          size="lg"
        >
          {isAlreadyAdded ? (
            <>
              <Check className="h-4 w-4" />
              Added to Builder
            </>
          ) : (
            <>
              <Zap className="h-4 w-4" />
              Add {legCount}-Leg Parlay
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
