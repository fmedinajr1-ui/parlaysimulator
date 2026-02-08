/**
 * BotActivationCard.tsx
 * 
 * Shows activation progress toward real betting mode.
 */

import React from 'react';
import { Trophy, Target, TrendingUp, DollarSign, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface BotActivationCardProps {
  consecutiveDays: number;
  requiredDays: number;
  simulatedBankroll: number;
  overallWinRate: number;
  totalParlays: number;
  isRealModeReady: boolean;
}

export function BotActivationCard({
  consecutiveDays,
  requiredDays,
  simulatedBankroll,
  overallWinRate,
  totalParlays,
  isRealModeReady,
}: BotActivationCardProps) {
  const progress = Math.min((consecutiveDays / requiredDays) * 100, 100);
  const winRateProgress = Math.min((overallWinRate / 0.60) * 100, 100);
  const parlayProgress = Math.min((totalParlays / 5) * 100, 100);
  
  const allConditionsMet = consecutiveDays >= requiredDays && 
                           overallWinRate >= 0.60 && 
                           totalParlays >= 5;

  return (
    <Card className={cn(
      "relative overflow-hidden",
      isRealModeReady && "border-green-500/50 bg-green-500/5"
    )}>
      {/* Background glow effect */}
      {isRealModeReady && (
        <div className="absolute inset-0 bg-gradient-to-br from-green-500/10 via-transparent to-transparent" />
      )}
      
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Target className="w-5 h-5 text-primary" />
            Activation Progress
          </CardTitle>
          {isRealModeReady ? (
            <Badge className="bg-green-500/20 text-green-400 border-green-500/50">
              <CheckCircle2 className="w-3 h-3 mr-1" />
              Ready
            </Badge>
          ) : (
            <Badge variant="secondary">
              Day {consecutiveDays} of {requiredDays}
            </Badge>
          )}
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Main Progress Ring */}
        <div className="flex items-center gap-6">
          <div className="relative w-24 h-24 shrink-0">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
              <circle
                cx="50"
                cy="50"
                r="42"
                fill="none"
                stroke="currentColor"
                strokeWidth="8"
                className="text-muted/30"
              />
              <circle
                cx="50"
                cy="50"
                r="42"
                fill="none"
                stroke="currentColor"
                strokeWidth="8"
                strokeDasharray={264}
                strokeDashoffset={264 - (264 * progress) / 100}
                strokeLinecap="round"
                className={cn(
                  "transition-all duration-500",
                  isRealModeReady ? "text-green-400" : "text-primary"
                )}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-bold">{consecutiveDays}</span>
              <span className="text-xs text-muted-foreground">days</span>
            </div>
          </div>
          
          <div className="flex-1 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Simulated Bankroll</span>
              <span className="font-bold text-lg text-green-400">
                ${simulatedBankroll.toLocaleString()}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <DollarSign className="w-3 h-3" />
              Started at $1,000
            </div>
          </div>
        </div>

        {/* Condition Checklist */}
        <div className="space-y-2 pt-2 border-t border-border/50">
          {/* Consecutive Days */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {consecutiveDays >= requiredDays ? (
                <CheckCircle2 className="w-4 h-4 text-green-400" />
              ) : (
                <AlertCircle className="w-4 h-4 text-amber-400" />
              )}
              <span className="text-sm">3 Profitable Days</span>
            </div>
            <span className="text-sm font-medium">{consecutiveDays}/{requiredDays}</span>
          </div>
          <Progress value={progress} className="h-1.5" />
          
          {/* Win Rate */}
          <div className="flex items-center justify-between mt-3">
            <div className="flex items-center gap-2">
              {overallWinRate >= 0.60 ? (
                <CheckCircle2 className="w-4 h-4 text-green-400" />
              ) : (
                <AlertCircle className="w-4 h-4 text-amber-400" />
              )}
              <span className="text-sm">60%+ Win Rate</span>
            </div>
            <span className="text-sm font-medium">{(overallWinRate * 100).toFixed(1)}%</span>
          </div>
          <Progress value={winRateProgress} className="h-1.5" />
          
          {/* Total Parlays */}
          <div className="flex items-center justify-between mt-3">
            <div className="flex items-center gap-2">
              {totalParlays >= 5 ? (
                <CheckCircle2 className="w-4 h-4 text-green-400" />
              ) : (
                <AlertCircle className="w-4 h-4 text-amber-400" />
              )}
              <span className="text-sm">5+ Parlays Generated</span>
            </div>
            <span className="text-sm font-medium">{totalParlays}/5</span>
          </div>
          <Progress value={parlayProgress} className="h-1.5" />
        </div>

        {/* Status Message */}
        <div className={cn(
          "text-center py-2 px-3 rounded-lg text-sm",
          isRealModeReady 
            ? "bg-green-500/10 text-green-400" 
            : "bg-amber-500/10 text-amber-400"
        )}>
          {isRealModeReady ? (
            <span className="flex items-center justify-center gap-2">
              <Trophy className="w-4 h-4" />
              All conditions met! Ready for real betting mode
            </span>
          ) : (
            <span className="flex items-center justify-center gap-2">
              <TrendingUp className="w-4 h-4" />
              {allConditionsMet 
                ? "Processing activation..."
                : `Need ${requiredDays - consecutiveDays} more profitable day(s)`
              }
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
