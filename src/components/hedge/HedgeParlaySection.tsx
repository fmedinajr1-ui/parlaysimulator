import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Shield, RefreshCw, Loader2, AlertCircle, Swords } from "lucide-react";
import { HedgeParlayCard } from "./HedgeParlayCard";
import { useHedgeParlays } from "@/hooks/useHedgeParlays";

export function HedgeParlaySection() {
  const { parlays, isLoading, isBuilding, buildParlays, refetch } = useHedgeParlays();

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            Hedge Parlays
          </h2>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {[1, 2, 3].map(i => (
            <Card key={i} className="animate-pulse">
              <CardHeader>
                <Skeleton className="h-6 w-32" />
              </CardHeader>
              <CardContent className="space-y-3">
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            Hedge Parlays
          </h2>
          <p className="text-sm text-muted-foreground">
            H2H matchup-based parlays with downside protection
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => buildParlays()}
          disabled={isBuilding}
          className="gap-2"
        >
          {isBuilding ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {isBuilding ? 'Building...' : 'Build Hedge Parlays'}
        </Button>
      </div>

      {parlays.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Swords className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="font-semibold text-lg">No Hedge Parlays Available</h3>
            <p className="text-sm text-muted-foreground max-w-md mt-1">
              Click "Build Hedge Parlays" to generate optimized parlays based on 
              head-to-head matchup history and defensive ratings.
            </p>
            <Button 
              onClick={() => buildParlays()} 
              disabled={isBuilding}
              className="mt-4 gap-2"
            >
              {isBuilding ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Shield className="h-4 w-4" />
              )}
              Generate Hedge Parlays
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {parlays.map(parlay => (
            <HedgeParlayCard key={parlay.id} parlay={parlay} />
          ))}
        </div>
      )}

      {/* Methodology Note */}
      <Card className="bg-muted/30 border-muted">
        <CardContent className="py-3 px-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
            <div className="text-sm text-muted-foreground">
              <strong>Hedge Strategy:</strong> These parlays pair opposing outcomes 
              (OVER/UNDER from same game) and diversify across games to reduce variance. 
              H2H confidence is based on player's historical performance against the 
              specific opponent. Defense grades factor in opponent's defensive ranking 
              for the stat type.
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
