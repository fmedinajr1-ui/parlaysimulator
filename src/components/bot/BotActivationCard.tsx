import React from 'react';
import { Target, CheckCircle2, AlertCircle } from 'lucide-react';
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
  overallWinRate,
  totalParlays,
  isRealModeReady,
}: BotActivationCardProps) {
  const conditions = [
    { label: `${requiredDays} Days`, met: consecutiveDays >= requiredDays, value: `${consecutiveDays}/${requiredDays}` },
    { label: '60% WR', met: overallWinRate >= 0.60, value: `${(overallWinRate * 100).toFixed(0)}%` },
    { label: '5+ Parlays', met: totalParlays >= 5, value: `${totalParlays}/5` },
  ];

  if (isRealModeReady) {
    return (
      <div className="flex items-center gap-2 p-3 rounded-xl bg-green-500/10 border border-green-500/30">
        <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0" />
        <span className="text-sm font-medium text-green-400">All activation conditions met — Real mode ready</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 p-3 rounded-xl bg-card border border-border/50 overflow-x-auto">
      {/* Progress ring */}
      <div className="relative w-10 h-10 shrink-0">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
          <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="3" className="text-muted/30" />
          <circle
            cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="3"
            strokeDasharray={94}
            strokeDashoffset={94 - (94 * Math.min(consecutiveDays / requiredDays, 1))}
            strokeLinecap="round"
            className="text-primary transition-all duration-500"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <Target className="w-3.5 h-3.5 text-primary" />
        </div>
      </div>

      {/* Conditions inline */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {conditions.map((c) => (
          <Badge
            key={c.label}
            variant="outline"
            className={cn(
              'text-[10px] gap-1 shrink-0',
              c.met ? 'text-green-400 border-green-500/30' : 'text-amber-400 border-amber-500/30'
            )}
          >
            {c.met ? <CheckCircle2 className="w-2.5 h-2.5" /> : <AlertCircle className="w-2.5 h-2.5" />}
            {c.value}
          </Badge>
        ))}
      </div>
    </div>
  );
}
