import { AlertTriangle, TrendingDown, TrendingUp, Minus, Snowflake, Flame, Target, Clock, CheckCircle, AlertCircle, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DeepSweetSpot, ShotChartAnalysis, HedgeStatus, TrendDirection, EnhancedHedgeAction } from "@/types/sweetSpot";
import { ShotChartMatchup } from "./ShotChartMatchup";

interface HedgeRecommendationProps {
  spot: DeepSweetSpot;
}

// Format zone name for display
function formatZoneName(zone: string): string {
  const names: Record<string, string> = {
    restricted_area: 'Restricted Area',
    paint: 'Paint',
    mid_range: 'Mid-Range',
    corner_3: 'Corner 3',
    above_break_3: 'Above Break 3',
  };
  return names[zone] || zone;
}

// Get defense label from shot chart
function getDefenseLabel(shotChart: ShotChartAnalysis): string {
  const primaryZone = shotChart.zones.find(z => z.zone === shotChart.primaryZone);
  if (!primaryZone) return 'unknown';
  return `${primaryZone.defenseRating} (#${primaryZone.defenseRank})`;
}

// Calculate remaining time in readable format
function formatTimeRemaining(period: string, clock: string, gameProgress: number): string {
  // Estimate minutes remaining based on game progress (48 min game)
  const totalGameMinutes = 48;
  const minutesRemaining = Math.max(0, totalGameMinutes * (1 - gameProgress / 100));
  
  if (clock && period) {
    return `${clock} left in ${period}`;
  }
  
  if (minutesRemaining < 1) return "< 1 min left";
  return `~${minutesRemaining.toFixed(0)} min remaining`;
}

// Calculate hit probability based on rate vs needed
function calculateHitProbability(
  current: number, 
  line: number, 
  ratePerMin: number, 
  gameProgress: number,
  side: 'over' | 'under'
): number {
  const totalGameMinutes = 48;
  const minutesRemaining = Math.max(0, totalGameMinutes * (1 - gameProgress / 100));
  
  if (side === 'over') {
    const needed = line - current;
    if (needed <= 0) return 100; // Already hit
    const projected = current + (ratePerMin * minutesRemaining);
    const buffer = projected - line;
    // Scale probability based on buffer
    if (buffer >= 3) return 85;
    if (buffer >= 1) return 70;
    if (buffer >= 0) return 55;
    if (buffer >= -1) return 40;
    if (buffer >= -2) return 25;
    return 15;
  } else {
    // UNDER: probability of staying under
    const projected = current + (ratePerMin * minutesRemaining);
    const buffer = line - projected;
    if (buffer >= 3) return 85;
    if (buffer >= 1) return 70;
    if (buffer >= 0) return 55;
    if (buffer >= -1) return 40;
    return 25;
  }
}

// Determine hedge sizing recommendation
function calculateHedgeSizing(gap: number, hitProbability: number): string {
  if (hitProbability >= 70) return "No hedge needed";
  if (hitProbability >= 50) return "$10-25 (light hedge)";
  if (hitProbability >= 30) return "$25-50 (moderate)";
  return "$50-100 (strong hedge)";
}

// Get trend description
function getTrendDescription(trend: TrendDirection, isPositive: boolean): string {
  if (trend === 'improving') return isPositive ? "Trending up ↑" : "Trending up (bad for under)";
  if (trend === 'worsening') return isPositive ? "Trending down ↓" : "Trending down (good for under)";
  return "Holding steady";
}

// Calculate enhanced hedge action with all details
function calculateEnhancedHedgeAction(spot: DeepSweetSpot): EnhancedHedgeAction {
  const { liveData, line, side, propType } = spot;
  
  // Default values when no live data
  if (!liveData) {
    return {
      status: 'on_track',
      headline: 'Pre-Game',
      message: 'Game has not started yet. Waiting for live data.',
      action: 'Hold position - monitor at tip-off',
      urgency: 'none',
      trendDirection: 'stable',
      hitProbability: 50,
      rateNeeded: 0,
      currentRate: 0,
      timeRemaining: 'Not started',
      gapToLine: 0,
    };
  }
  
  const { currentValue, projectedFinal, paceRating, riskFlags, gameProgress, trend, ratePerMinute, minutesPlayed, shotChartMatchup } = liveData;
  
  const oppositeSide = side === 'over' ? 'UNDER' : 'OVER';
  const totalGameMinutes = 48;
  const minutesRemaining = Math.max(0, totalGameMinutes * (1 - gameProgress / 100));
  
  // Calculate gap to line (positive = good for your bet)
  const gapToLine = side === 'over' 
    ? projectedFinal - line 
    : line - projectedFinal;
  
  // Calculate rate needed vs current rate
  const needed = side === 'over' ? line - currentValue : 0;
  const rateNeeded = minutesRemaining > 0 ? needed / minutesRemaining : 0;
  const currentRate = ratePerMinute || 0;
  
  // Calculate hit probability
  const hitProbability = calculateHitProbability(currentValue, line, currentRate, gameProgress, side);
  
  // Map live trend to our trend direction
  const trendDirection: TrendDirection = 
    trend === 'up' ? (side === 'over' ? 'improving' : 'worsening') :
    trend === 'down' ? (side === 'over' ? 'worsening' : 'improving') :
    'stable';
  
  const timeRemaining = formatTimeRemaining(liveData.period, liveData.clock, gameProgress);
  
  // Determine status based on multiple factors
  let status: HedgeStatus;
  let headline: string;
  let message: string;
  let action: string;
  let urgency: 'high' | 'medium' | 'low' | 'none';
  
  // Check for profit lock opportunity (already hit the line)
  const alreadyHit = side === 'over' ? currentValue >= line : currentValue < line && projectedFinal < line;
  if (alreadyHit && side === 'over') {
    status = 'profit_lock';
    headline = '💰 PROFIT LOCK AVAILABLE';
    message = `Current ${currentValue} already exceeds line ${line}. Bet ${oppositeSide} now to guarantee profit regardless of outcome.`;
    action = `BET ${oppositeSide} ${line} NOW - Lock in guaranteed profit`;
    urgency = 'high';
    return { status, headline, message, action, urgency, trendDirection, hitProbability: 100, rateNeeded, currentRate, timeRemaining, gapToLine };
  }
  
  // Check for severe risk factors
  const hasBlowoutRisk = riskFlags.includes('blowout');
  const hasFoulTrouble = riskFlags.includes('foul_trouble');
  const hasGarbageTime = riskFlags.includes('garbage_time');
  const hasSlowPace = paceRating < 95 && side === 'over';
  const hasZoneDisadvantage = shotChartMatchup && shotChartMatchup.overallMatchupScore < -3;
  
  const severeRiskCount = [hasBlowoutRisk, hasFoulTrouble, hasGarbageTime].filter(Boolean).length;
  
  // URGENT: Multiple risk factors or very low probability
  if (severeRiskCount >= 2 || hitProbability < 25 || (hasBlowoutRisk && gameProgress > 60)) {
    status = 'urgent';
    headline = '🚨 HEDGE NOW';
    
    if (hasBlowoutRisk) {
      message = `Blowout detected (${gameProgress.toFixed(0)}% through game). High chance starters sit. Only ${minutesRemaining.toFixed(0)} min of meaningful play remaining.`;
    } else if (hasFoulTrouble) {
      message = `Player in foul trouble. Minutes at risk. Current: ${currentValue}, need ${line}. ${hitProbability}% chance to hit.`;
    } else {
      message = `Only ${hitProbability}% chance to hit ${line}. Producing ${currentRate.toFixed(2)}/min but need ${rateNeeded.toFixed(2)}/min with ${minutesRemaining.toFixed(0)} min left.`;
    }
    
    action = `🚨 BET ${oppositeSide} ${line} NOW - ${calculateHedgeSizing(Math.abs(gapToLine), hitProbability)}`;
    urgency = 'high';
  }
  // ALERT: Single risk factor or moderate concern
  else if (severeRiskCount >= 1 || hitProbability < 45 || hasSlowPace || hasZoneDisadvantage) {
    status = 'alert';
    headline = '⚠️ HEDGE ALERT';
    
    if (hasSlowPace) {
      message = `Slow pace (${paceRating.toFixed(0)}) reducing possessions. Projected ${projectedFinal.toFixed(1)} vs line ${line}. Gap: ${gapToLine.toFixed(1)}`;
    } else if (hasZoneDisadvantage && shotChartMatchup) {
      message = `Shot chart mismatch: ${shotChartMatchup.recommendation}. Projected ${projectedFinal.toFixed(1)} vs line ${line}.`;
    } else {
      message = `Trailing by ${Math.abs(gapToLine).toFixed(1)} with ${minutesRemaining.toFixed(0)} min left. Current rate ${currentRate.toFixed(2)}/min vs needed ${rateNeeded.toFixed(2)}/min.`;
    }
    
    action = `⚠️ Consider ${oppositeSide} ${line} - ${calculateHedgeSizing(Math.abs(gapToLine), hitProbability)}`;
    urgency = 'medium';
  }
  // MONITOR: Slightly off pace but recoverable
  else if (hitProbability < 65 || (gapToLine < 0 && gapToLine > -2)) {
    status = 'monitor';
    headline = '⚡ MONITOR CLOSELY';
    message = `Slightly off pace. Projected ${projectedFinal.toFixed(1)} vs line ${line} (${hitProbability}% probability). ${getTrendDescription(trendDirection, side === 'over')}`;
    action = `Watch for next ${(minutesRemaining / 4).toFixed(0)} minutes. Prepare ${oppositeSide} hedge if trend worsens.`;
    urgency = 'low';
  }
  // ON TRACK: Looking good
  else {
    status = 'on_track';
    headline = '✓ ON TRACK';
    message = `Projected ${projectedFinal.toFixed(1)} exceeds line ${line} by ${gapToLine.toFixed(1)}. ${hitProbability}% probability. Rate: ${currentRate.toFixed(2)}/min.`;
    action = `Hold position. No hedge needed currently.`;
    urgency = 'none';
  }
  
  return { status, headline, message, action, urgency, trendDirection, hitProbability, rateNeeded, currentRate, timeRemaining, gapToLine };
}

// Get status colors
function getStatusColors(status: HedgeStatus): { bg: string; border: string; text: string; badge: string } {
  switch (status) {
    case 'on_track':
      return { bg: 'bg-primary/10', border: 'border-primary/30', text: 'text-primary', badge: 'bg-primary text-primary-foreground' };
    case 'monitor':
      return { bg: 'bg-warning/10', border: 'border-warning/30', text: 'text-warning', badge: 'bg-warning text-warning-foreground' };
    case 'alert':
      return { bg: 'bg-orange-500/10', border: 'border-orange-500/30', text: 'text-orange-500', badge: 'bg-orange-500 text-white' };
    case 'urgent':
      return { bg: 'bg-destructive/10', border: 'border-destructive/30', text: 'text-destructive', badge: 'bg-destructive text-destructive-foreground' };
    case 'profit_lock':
      return { bg: 'bg-purple-500/10', border: 'border-purple-500/30', text: 'text-purple-500', badge: 'bg-purple-500 text-white' };
    default:
      return { bg: 'bg-muted/10', border: 'border-muted/30', text: 'text-muted-foreground', badge: 'bg-muted text-muted-foreground' };
  }
}

// Get trend icon component
function TrendIcon({ trend, side }: { trend: TrendDirection; side: 'over' | 'under' }) {
  const isGood = (trend === 'improving' && side === 'over') || (trend === 'worsening' && side === 'under');
  const isBad = (trend === 'worsening' && side === 'over') || (trend === 'improving' && side === 'under');
  
  if (trend === 'stable') {
    return <Minus className="w-4 h-4 text-muted-foreground" />;
  }
  
  if (isGood) {
    return <TrendingUp className="w-4 h-4 text-primary" />;
  }
  
  return <TrendingDown className="w-4 h-4 text-destructive" />;
}

export function HedgeRecommendation({ spot }: HedgeRecommendationProps) {
  // Always show for live games - no early return!
  if (!spot.liveData?.isLive) return null;
  
  const hedgeAction = calculateEnhancedHedgeAction(spot);
  const colors = getStatusColors(hedgeAction.status);
  const { currentValue, projectedFinal, paceRating, gameProgress, shotChartMatchup, confidence } = spot.liveData;
  const isScoring = spot.propType === 'points' || spot.propType === 'threes';
  
  return (
    <div className={cn("mt-2 p-3 rounded-lg border", colors.bg, colors.border)}>
      {/* Status Badge Header */}
      <div className="flex items-center justify-between mb-2">
        <span className={cn("px-2 py-0.5 rounded text-xs font-bold", colors.badge)}>
          {hedgeAction.headline}
        </span>
        <span className="text-xs text-muted-foreground">
          {hedgeAction.hitProbability}% hit probability
        </span>
      </div>
      
      {/* Progress with Trend */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm text-muted-foreground">Current:</span>
        <span className="font-mono font-bold text-foreground">{currentValue}</span>
        <TrendIcon trend={hedgeAction.trendDirection} side={spot.side} />
        <span className="text-sm text-muted-foreground">→ Projected:</span>
        <span className={cn(
          "font-mono font-bold",
          hedgeAction.gapToLine >= 0 ? "text-primary" : "text-destructive"
        )}>
          {projectedFinal.toFixed(1)}
        </span>
      </div>
      
      {/* Line and Gap Info */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground mb-2">
        <span>Line: <span className="font-mono font-semibold text-foreground">{spot.line}</span></span>
        <span>|</span>
        <span>Gap: <span className={cn(
          "font-mono font-semibold",
          hedgeAction.gapToLine >= 0 ? "text-primary" : "text-destructive"
        )}>
          {hedgeAction.gapToLine >= 0 ? '+' : ''}{hedgeAction.gapToLine.toFixed(1)}
        </span></span>
        <span>|</span>
        <span>Confidence: <span className="font-semibold text-foreground">{confidence}%</span></span>
      </div>
      
      {/* Time and Pace Context */}
      <div className="flex items-center gap-3 text-xs mb-2">
        <div className="flex items-center gap-1">
          <Clock className="w-3 h-3 text-muted-foreground" />
          <span className="text-muted-foreground">{hedgeAction.timeRemaining}</span>
        </div>
        <span className="text-muted-foreground">|</span>
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground">Pace:</span>
          {paceRating >= 102 ? (
            <Flame className="w-3 h-3 text-primary" />
          ) : paceRating < 98 ? (
            <Snowflake className="w-3 h-3 text-accent" />
          ) : null}
          <span className={cn(
            "font-medium",
            paceRating >= 102 ? "text-primary" : 
            paceRating >= 98 ? "text-warning" : "text-accent"
          )}>
            {paceRating >= 102 ? 'FAST' : paceRating >= 98 ? 'NORMAL' : 'SLOW'}
            ({paceRating.toFixed(0)})
          </span>
        </div>
      </div>
      
      {/* Rate Analysis */}
      <div className="flex items-center gap-2 text-xs mb-2">
        <Zap className="w-3 h-3 text-muted-foreground" />
        <span className="text-muted-foreground">
          Rate: <span className="font-mono font-semibold text-foreground">{hedgeAction.currentRate.toFixed(2)}</span>/min
          {spot.side === 'over' && hedgeAction.rateNeeded > 0 && (
            <>
              {' | '}Need: <span className={cn(
                "font-mono font-semibold",
                hedgeAction.currentRate >= hedgeAction.rateNeeded ? "text-primary" : "text-destructive"
              )}>{hedgeAction.rateNeeded.toFixed(2)}</span>/min
            </>
          )}
        </span>
      </div>
      
      {/* Trend Indicator */}
      <div className="flex items-center gap-2 text-xs mb-3">
        {hedgeAction.trendDirection === 'improving' ? (
          <TrendingUp className="w-3 h-3 text-primary" />
        ) : hedgeAction.trendDirection === 'worsening' ? (
          <TrendingDown className="w-3 h-3 text-destructive" />
        ) : (
          <Minus className="w-3 h-3 text-muted-foreground" />
        )}
        <span className={cn(
          "font-medium",
          hedgeAction.trendDirection === 'improving' ? "text-primary" :
          hedgeAction.trendDirection === 'worsening' ? "text-destructive" :
          "text-muted-foreground"
        )}>
          {hedgeAction.trendDirection === 'improving' ? 'Trend: Improving' :
           hedgeAction.trendDirection === 'worsening' ? 'Trend: Worsening' :
           'Trend: Stable'}
        </span>
      </div>
      
      {/* Detailed Message */}
      <p className="text-xs text-muted-foreground mb-2">{hedgeAction.message}</p>
      
      {/* Action Recommendation Box */}
      <div className={cn(
        "p-2 rounded text-xs font-semibold",
        hedgeAction.urgency === 'high' ? "bg-destructive/20 text-destructive" :
        hedgeAction.urgency === 'medium' ? "bg-orange-500/20 text-orange-500" :
        hedgeAction.urgency === 'low' ? "bg-warning/20 text-warning" :
        "bg-primary/20 text-primary"
      )}>
        {hedgeAction.action}
      </div>
      
      {/* Shot Chart Section (only for points/threes props with matchup data) */}
      {shotChartMatchup && isScoring && (
        <div className="mt-3 pt-3 border-t border-border/30">
          <div className="flex items-center gap-2 mb-2">
            <Target className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs font-medium">Shot Chart vs Defense</span>
          </div>
          <div className="flex gap-3 items-start">
            <ShotChartMatchup analysis={shotChartMatchup} />
            <div className="flex-1 text-xs space-y-1">
              <p className="text-muted-foreground">
                Primary Zone: <span className="text-foreground font-medium">
                  {formatZoneName(shotChartMatchup.primaryZone)}
                </span>
                <span className="text-muted-foreground ml-1">
                  ({Math.round(shotChartMatchup.primaryZonePct * 100)}% of shots)
                </span>
              </p>
              <p className={cn(
                "font-medium",
                shotChartMatchup.overallMatchupScore > 0 ? "text-primary" : "text-destructive"
              )}>
                {shotChartMatchup.recommendation}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
