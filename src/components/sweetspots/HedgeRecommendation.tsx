import { AlertTriangle, TrendingDown, TrendingUp, Minus, Snowflake, Flame, Target, Clock, Zap, Coffee, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DeepSweetSpot, ShotChartAnalysis, HedgeStatus, TrendDirection, EnhancedHedgeAction } from "@/types/sweetSpot";
import { ShotChartMatchup } from "./ShotChartMatchup";
import { QuarterTransitionCard } from "./QuarterTransitionCard";
import { HalftimeRecalibrationCard } from "./HalftimeRecalibrationCard";
import { QuarterProgressSparkline } from "./QuarterProgressSparkline";
import { PaceMomentumTracker } from "./PaceMomentumTracker";
import { RotationStatusBadge } from "./RotationStatusBadge";
import { 
  calculateRotationMinutes, 
  inferPlayerTier, 
  isApproachingRestWindow,
  type RotationEstimate,
  type PlayerTier
} from "@/lib/rotation-patterns";

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

// Calculate remaining time in readable format
function formatTimeRemaining(period: string, clock: string, gameProgress: number): string {
  const totalGameMinutes = 48;
  const minutesRemaining = Math.max(0, totalGameMinutes * (1 - gameProgress / 100));
  
  if (clock && period) {
    return `${clock} left in ${period}`;
  }
  
  if (minutesRemaining < 1) return "< 1 min left";
  return `~${minutesRemaining.toFixed(0)} min remaining`;
}

// Parse clock string to minutes
function parseClockMinutes(clock: string): number {
  if (!clock) return 12;
  const parts = clock.split(':');
  return parseInt(parts[0]) || 12;
}

// Calculate hit probability with zone matchup factor
function calculateHitProbability(
  current: number, 
  line: number, 
  ratePerMin: number, 
  gameProgress: number,
  side: 'over' | 'under',
  zoneScore?: number,
  rotationMinutes?: number
): number {
  // Use rotation-aware minutes if provided, otherwise fallback to linear
  const minutesRemaining = rotationMinutes !== undefined 
    ? rotationMinutes 
    : Math.max(0, 48 * (1 - gameProgress / 100));
  
  let baseProbability: number;
  
  if (side === 'over') {
    const needed = line - current;
    if (needed <= 0) return 100; // Already hit
    const projected = current + (ratePerMin * minutesRemaining);
    const buffer = projected - line;
    // Scale probability based on buffer
    if (buffer >= 3) baseProbability = 85;
    else if (buffer >= 1) baseProbability = 70;
    else if (buffer >= 0) baseProbability = 55;
    else if (buffer >= -1) baseProbability = 40;
    else if (buffer >= -2) baseProbability = 25;
    else baseProbability = 15;
  } else {
    // UNDER: probability of staying under
    const projected = current + (ratePerMin * minutesRemaining);
    const buffer = line - projected;
    if (buffer >= 3) baseProbability = 85;
    else if (buffer >= 1) baseProbability = 70;
    else if (buffer >= 0) baseProbability = 55;
    else if (buffer >= -1) baseProbability = 40;
    else baseProbability = 25;
  }
  
  // Apply zone matchup modifier (±15% max)
  if (zoneScore !== undefined) {
    const zoneModifier = Math.max(-15, Math.min(15, zoneScore * 3));
    // For OVER: positive zone score = higher probability
    // For UNDER: positive zone score = LOWER probability (player more likely to score)
    if (side === 'over') {
      baseProbability += zoneModifier;
    } else {
      baseProbability -= zoneModifier;
    }
  }
  
  return Math.max(5, Math.min(95, baseProbability));
}

// Extended hedge action with rotation context
interface ExtendedHedgeAction extends EnhancedHedgeAction {
  rotationEstimate?: RotationEstimate;
  playerTier?: PlayerTier;
  rotationMinutes?: number;
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

// Get zone insight text for messaging
function getZoneInsight(shotChart: ShotChartAnalysis | undefined, side: 'over' | 'under'): string | null {
  if (!shotChart || !shotChart.zones.length) return null;
  
  const primaryZone = shotChart.zones.find(z => z.zone === shotChart.primaryZone);
  if (!primaryZone) return null;
  
  const zoneName = formatZoneName(shotChart.primaryZone);
  const defenseRank = primaryZone.defenseRank;
  const shotPct = Math.round(shotChart.primaryZonePct * 100);
  
  if (shotChart.overallMatchupScore > 3) {
    return `Zone advantage in ${zoneName} (${shotPct}% of shots vs #${defenseRank} defense)`;
  } else if (shotChart.overallMatchupScore < -3) {
    return `Zone disadvantage in ${zoneName} (${shotPct}% of shots vs #${defenseRank} defense)`;
  }
  
  return null;
}

// Calculate enhanced hedge action with all details
function calculateEnhancedHedgeAction(spot: DeepSweetSpot): ExtendedHedgeAction {
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
  
  const { currentValue, projectedFinal, paceRating, riskFlags, gameProgress, trend, ratePerMinute, shotChartMatchup, period, clock, minutesPlayed } = liveData;
  
  const oppositeSide = side === 'over' ? 'UNDER' : 'OVER';
  
  // --- ROTATION-AWARE MINUTES CALCULATION ---
  const currentQuarter = parseInt(period) || 1;
  const clockMinutes = parseClockMinutes(clock);
  const playerTier = inferPlayerTier(minutesPlayed || 0, gameProgress);
  
  // Get rotation estimate
  const rotationEstimate = calculateRotationMinutes(
    playerTier,
    currentQuarter,
    clockMinutes,
    0, // scoreDiff - TODO: add to liveData
    minutesPlayed || 0
  );
  
  // Use rotation-aware minutes instead of linear
  const minutesRemaining = rotationEstimate.expectedRemaining;
  const linearMinutes = Math.max(0, 48 * (1 - gameProgress / 100));
  const isInRestWindow = rotationEstimate.currentPhase === 'rest';
  const isApproachingRest = isApproachingRestWindow(playerTier, currentQuarter, clockMinutes);
  // --- END ROTATION LOGIC ---
  
  // Calculate gap to line (positive = good for your bet)
  const gapToLine = side === 'over' 
    ? projectedFinal - line 
    : line - projectedFinal;
  
  // Calculate rate needed vs current rate
  const needed = side === 'over' ? line - currentValue : 0;
  const rateNeeded = minutesRemaining > 0 ? needed / minutesRemaining : 0;
  const currentRate = ratePerMinute || 0;
  
  // Get zone score for probability calculation
  const zoneScore = shotChartMatchup?.overallMatchupScore;
  
  // Calculate hit probability WITH zone factor
  const hitProbability = calculateHitProbability(currentValue, line, currentRate, gameProgress, side, zoneScore, minutesRemaining);
  
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
  
  // Zone-based risk modifiers
  const hasZoneDisadvantage = shotChartMatchup && shotChartMatchup.overallMatchupScore < -3;
  const hasZoneAdvantage = shotChartMatchup && shotChartMatchup.overallMatchupScore > 3;
  
  const severeRiskCount = [hasBlowoutRisk, hasFoulTrouble, hasGarbageTime].filter(Boolean).length;
  
  // ROTATION-BASED RISK MODIFIERS
  const hasRotationRisk = isInRestWindow || (isApproachingRest && side === 'over');
  
  // Adjust thresholds based on zone advantage/disadvantage
  let urgentThreshold = 25;
  let alertThreshold = 45;
  let monitorThreshold = 65;
  
  // Rotation context adjustments
  if (isInRestWindow && side === 'over') {
    // Player benched - harder to hit OVER
    urgentThreshold += 15;
    alertThreshold += 15;
    monitorThreshold += 10;
  } else if (isApproachingRest && side === 'over') {
    // About to sit - moderate concern for OVER
    urgentThreshold += 8;
    alertThreshold += 8;
    monitorThreshold += 5;
  }
  
  if (hasZoneAdvantage && side === 'over') {
    // Zone advantage for OVER: be more patient, less urgent
    urgentThreshold -= 10;
    alertThreshold -= 10;
    monitorThreshold -= 5;
  } else if (hasZoneDisadvantage && side === 'over') {
    // Zone disadvantage for OVER: be more aggressive with hedging
    urgentThreshold += 10;
    alertThreshold += 10;
    monitorThreshold += 5;
  } else if (hasZoneAdvantage && side === 'under') {
    // Zone advantage for UNDER target = player likely to produce = bad for under
    urgentThreshold += 10;
    alertThreshold += 10;
    monitorThreshold += 5;
  } else if (hasZoneDisadvantage && side === 'under') {
    // Zone disadvantage for UNDER target = player suppressed = good for under
    urgentThreshold -= 10;
    alertThreshold -= 10;
    monitorThreshold -= 5;
  }
  
  // Get zone insight for messaging
  const zoneInsight = getZoneInsight(shotChartMatchup, side);
  
  // --- ROTATION-AWARE STATUS LOGIC ---
  
  // URGENT: Currently benched and behind pace for OVER
  if (isInRestWindow && side === 'over' && hitProbability < 60) {
    status = 'urgent';
    headline = '🪑 PLAYER BENCHED';
    message = `Currently on bench (${rotationEstimate.rotationPhase} rotation rest). ${rotationEstimate.nextTransition}. Producing ${currentRate.toFixed(2)}/min - need ${rateNeeded.toFixed(2)}/min with ~${minutesRemaining.toFixed(0)} play minutes remaining.`;
    action = `🚨 BET ${oppositeSide} ${line} NOW - Limited remaining court time`;
    urgency = 'high';
  }
  // URGENT: Multiple risk factors or very low probability
  else if (severeRiskCount >= 2 || hitProbability < urgentThreshold || (hasBlowoutRisk && gameProgress > 60)) {
    status = 'urgent';
    headline = '🚨 HEDGE NOW';
    
    if (hasBlowoutRisk) {
      message = `Blowout detected (${gameProgress.toFixed(0)}% through game). High chance starters sit. Only ${minutesRemaining.toFixed(0)} min of meaningful play remaining.`;
    } else if (hasFoulTrouble) {
      message = `Player in foul trouble. Minutes at risk. Current: ${currentValue}, need ${line}. ${hitProbability}% chance to hit.`;
    } else {
      message = `Only ${hitProbability}% chance to hit ${line}. Producing ${currentRate.toFixed(2)}/min but need ${rateNeeded.toFixed(2)}/min with ${minutesRemaining.toFixed(0)} min left.`;
    }
    
    if (zoneInsight && hasZoneDisadvantage) {
      message += ` ${zoneInsight} amplifies risk.`;
    }
    
    action = `🚨 BET ${oppositeSide} ${line} NOW - ${calculateHedgeSizing(Math.abs(gapToLine), hitProbability)}`;
    urgency = 'high';
  }
  // ALERT: Approaching rest window while behind
  else if (isApproachingRest && side === 'over' && hitProbability < 55) {
    status = 'alert';
    headline = '⏰ REST APPROACHING';
    message = `Approaching bench rotation. Current: ${currentValue}, need ${line}. Only ~${minutesRemaining.toFixed(0)} play minutes projected (vs ${linearMinutes.toFixed(0)} linear).`;
    
    if (zoneInsight) {
      message += ` ${zoneInsight}.`;
    }
    
    action = `⚠️ Prepare ${oppositeSide} ${line} hedge before rest window`;
    urgency = 'medium';
  }
  // ALERT: Single risk factor or moderate concern
  else if (severeRiskCount >= 1 || hitProbability < alertThreshold || hasSlowPace || hasZoneDisadvantage) {
    status = 'alert';
    headline = '⚠️ HEDGE ALERT';
    
    if (hasSlowPace) {
      message = `Slow pace (${paceRating.toFixed(0)}) reducing possessions. Projected ${projectedFinal.toFixed(1)} vs line ${line}. Gap: ${gapToLine.toFixed(1)}`;
    } else if (hasZoneDisadvantage && shotChartMatchup) {
      message = `Shot chart mismatch: ${shotChartMatchup.recommendation}. Projected ${projectedFinal.toFixed(1)} vs line ${line}.`;
    } else {
      message = `Trailing by ${Math.abs(gapToLine).toFixed(1)} with ${minutesRemaining.toFixed(0)} min left. Current rate ${currentRate.toFixed(2)}/min vs needed ${rateNeeded.toFixed(2)}/min.`;
    }
    
    if (zoneInsight) {
      message += ` ${zoneInsight}.`;
    }
    
    action = `⚠️ Consider ${oppositeSide} ${line} - ${calculateHedgeSizing(Math.abs(gapToLine), hitProbability)}`;
    urgency = 'medium';
  }
  // MONITOR: Slightly off pace but recoverable
  else if (hitProbability < monitorThreshold || (gapToLine < 0 && gapToLine > -2)) {
    status = 'monitor';
    headline = '⚡ MONITOR CLOSELY';
    message = `Slightly off pace. Projected ${projectedFinal.toFixed(1)} vs line ${line} (${hitProbability}% probability). ${getTrendDescription(trendDirection, side === 'over')}`;
    
    if (zoneInsight) {
      message += ` ${zoneInsight}.`;
    }
    
    action = `Watch for next ${(minutesRemaining / 4).toFixed(0)} minutes. Prepare ${oppositeSide} hedge if trend worsens.`;
    urgency = 'low';
  }
  // ON TRACK: Looking good
  else {
    status = 'on_track';
    headline = '✓ ON TRACK';
    message = `Projected ${projectedFinal.toFixed(1)} exceeds line ${line} by ${gapToLine.toFixed(1)}. ${hitProbability}% probability. Rate: ${currentRate.toFixed(2)}/min.`;
    
    if (zoneInsight && hasZoneAdvantage) {
      message += ` ${zoneInsight} provides additional support.`;
    }
    
    action = `Hold position. No hedge needed currently.`;
    urgency = 'none';
  }
  
  return { 
    status, headline, message, action, urgency, trendDirection, hitProbability, rateNeeded, currentRate, timeRemaining, gapToLine,
    rotationEstimate,
    playerTier,
    rotationMinutes: minutesRemaining
  };
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

// Get matchup score color
function getMatchupColor(score: number): string {
  if (score > 3) return 'text-primary';
  if (score > 0) return 'text-emerald-500';
  if (score > -3) return 'text-warning';
  return 'text-destructive';
}

// Get matchup label
function getMatchupLabel(score: number): string {
  if (score > 3) return 'Strong Advantage';
  if (score > 0) return 'Slight Advantage';
  if (score > -3) return 'Slight Disadvantage';
  return 'Strong Disadvantage';
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
  // Show for live games and during halftime
  if (!spot.liveData?.isLive && spot.liveData?.gameStatus !== 'halftime') return null;
  
  const hedgeAction = calculateEnhancedHedgeAction(spot);
  const colors = getStatusColors(hedgeAction.status);
  const { currentValue, projectedFinal, paceRating, gameProgress, shotChartMatchup, confidence } = spot.liveData;
  const isScoring = spot.propType === 'points' || spot.propType === 'threes';
  
  return (
    <div className={cn("mt-2 p-3 rounded-lg border", colors.bg, colors.border)}>
      {/* Quarter Transition Alert (if active) */}
      {spot.liveData?.quarterTransition && (
        <QuarterTransitionCard 
          transition={spot.liveData.quarterTransition} 
          spot={spot} 
        />
      )}
      
      {/* Halftime Recalibration Card (replaces simple halftime indicator) */}
      {spot.liveData?.halftimeRecalibration && (
        <HalftimeRecalibrationCard
          recalibration={spot.liveData.halftimeRecalibration}
          spot={spot}
        />
      )}
      
      {/* Fallback Halftime Indicator (only if no recalibration data and no transition alert) */}
      {spot.liveData?.gameStatus === 'halftime' && !spot.liveData?.quarterTransition && !spot.liveData?.halftimeRecalibration && (
        <div className="mb-2 flex items-center gap-2 text-xs text-warning">
          <Clock className="w-3 h-3" />
          <span className="font-medium">HALFTIME - Data from 1st half</span>
        </div>
      )}
      
      {/* Rotation Status Badge - Shows rotation phase and timing */}
      {hedgeAction.rotationEstimate && hedgeAction.playerTier && (
        <RotationStatusBadge 
          rotationEstimate={hedgeAction.rotationEstimate}
          playerTier={hedgeAction.playerTier}
          className="mb-2"
        />
      )}
      
      {/* Status Badge Header */}
      <div className="flex items-center justify-between mb-2">
        <span className={cn("px-2 py-0.5 rounded text-xs font-bold", colors.badge)}>
          {hedgeAction.headline}
        </span>
        <span className="text-xs text-muted-foreground">
          {Math.round(hedgeAction.hitProbability)}% hit probability
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
      
      {/* Quarter Progress Sparkline - visual trajectory */}
      <div className="mb-3 p-2 rounded bg-background/50 border border-border/30">
        <QuarterProgressSparkline spot={spot} />
      </div>
      
      {/* Pace Momentum Tracker - game pace evolution */}
      <PaceMomentumTracker spot={spot} className="mb-3" />
      
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
      
      {/* Shot Chart Section - NOW POSITIONED HIGHER for scoring props */}
      {shotChartMatchup && isScoring && (
        <div className="mb-3 p-2 rounded bg-background/50 border border-border/30">
          <div className="flex items-center gap-2 mb-2">
            <Target className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs font-medium">Shot Chart Factor</span>
            <span className={cn(
              "ml-auto text-xs font-bold px-1.5 py-0.5 rounded",
              shotChartMatchup.overallMatchupScore > 3 ? "bg-primary/20 text-primary" :
              shotChartMatchup.overallMatchupScore > 0 ? "bg-emerald-500/20 text-emerald-500" :
              shotChartMatchup.overallMatchupScore > -3 ? "bg-warning/20 text-warning" :
              "bg-destructive/20 text-destructive"
            )}>
              {shotChartMatchup.overallMatchupScore >= 0 ? '+' : ''}{shotChartMatchup.overallMatchupScore.toFixed(1)} ({getMatchupLabel(shotChartMatchup.overallMatchupScore)})
            </span>
          </div>
          <div className="flex gap-3 items-start">
            <ShotChartMatchup analysis={shotChartMatchup} />
            <div className="flex-1 text-xs space-y-1">
              <p className="text-muted-foreground">
                Primary: <span className="text-foreground font-medium">
                  {formatZoneName(shotChartMatchup.primaryZone)}
                </span>
                <span className="text-muted-foreground ml-1">
                  ({Math.round(shotChartMatchup.primaryZonePct * 100)}% of shots)
                </span>
              </p>
              <p className={cn(
                "font-medium",
                getMatchupColor(shotChartMatchup.overallMatchupScore)
              )}>
                {shotChartMatchup.recommendation}
              </p>
            </div>
          </div>
        </div>
      )}
      
      {/* Time and Pace Context */}
      <div className="flex items-center gap-3 text-xs mb-2">
        <div className="flex items-center gap-1">
          {hedgeAction.rotationEstimate?.currentPhase === 'rest' ? (
            <>
              <Coffee className="w-3 h-3 text-muted-foreground" />
              <span className="text-muted-foreground">
                Bench (~{Math.ceil(hedgeAction.rotationEstimate.restWindowRemaining)}m)
              </span>
            </>
          ) : hedgeAction.rotationEstimate?.currentPhase === 'returning' ? (
            <>
              <RefreshCw className="w-3 h-3 text-warning" />
              <span className="text-warning">Returning soon</span>
            </>
          ) : (
            <>
              <Clock className="w-3 h-3 text-muted-foreground" />
              <span className="text-muted-foreground">{hedgeAction.timeRemaining}</span>
            </>
          )}
        </div>
        <span className="text-muted-foreground">|</span>
        {hedgeAction.rotationMinutes !== undefined && (
          <>
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground">Play:</span>
              <span className="font-mono font-medium text-foreground">
                ~{Math.round(hedgeAction.rotationMinutes)}m
              </span>
            </div>
            <span className="text-muted-foreground">|</span>
          </>
        )}
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
    </div>
  );
}
