import React from 'react';
import { DollarSign, Target, Flame, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BotQuickStatsProps {
  totalPnL: number;
  winRate: number;
  streak: number;
  bankroll: number;
}

export function BotQuickStats({ totalPnL, winRate, streak, bankroll }: BotQuickStatsProps) {
  const stats = [
    {
      icon: DollarSign,
      label: 'P&L',
      value: `${totalPnL >= 0 ? '+' : ''}$${Math.abs(totalPnL).toFixed(0)}`,
      color: totalPnL >= 0 ? 'text-green-400' : 'text-red-400',
    },
    {
      icon: Target,
      label: 'Win Rate',
      value: `${(winRate * 100).toFixed(0)}%`,
      color: winRate >= 0.6 ? 'text-green-400' : 'text-amber-400',
    },
    {
      icon: Flame,
      label: 'Streak',
      value: `${streak}W`,
      color: streak > 0 ? 'text-orange-400' : 'text-muted-foreground',
    },
    {
      icon: TrendingUp,
      label: 'Bankroll',
      value: `$${bankroll.toLocaleString()}`,
      color: bankroll > 1000 ? 'text-green-400' : 'text-muted-foreground',
    },
  ];

  return (
    <div className="grid grid-cols-4 gap-2">
      {stats.map((stat) => {
        const Icon = stat.icon;
        return (
          <div
            key={stat.label}
            className="rounded-xl bg-card border border-border/50 p-2.5 text-center"
          >
            <Icon className={cn('w-3.5 h-3.5 mx-auto mb-1', stat.color)} />
            <p className={cn('text-sm font-bold tabular-nums', stat.color)}>
              {stat.value}
            </p>
            <p className="text-[10px] text-muted-foreground">{stat.label}</p>
          </div>
        );
      })}
    </div>
  );
}
