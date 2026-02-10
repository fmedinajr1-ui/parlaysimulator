/**
 * BotPerformanceChart.tsx
 * 
 * Displays historical performance charts for the bot.
 */

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, TrendingUp, DollarSign, Target } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';

export function BotPerformanceChart() {
  const { data: activationHistory = [], isLoading } = useQuery({
    queryKey: ['bot-activation-history'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bot_activation_status')
        .select('*')
        .order('check_date', { ascending: true })
        .limit(30);
      
      if (error) throw error;
      return data || [];
    },
  });

  const chartData = activationHistory.map((day) => ({
    date: (() => {
      const [y, m, d] = day.check_date.split('-').map(Number);
      return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    })(),
    bankroll: day.simulated_bankroll || 1000,
    profit: day.daily_profit_loss || 0,
    winRate: ((day.parlays_won || 0) / Math.max(1, (day.parlays_won || 0) + (day.parlays_lost || 0))) * 100,
  }));

  // Calculate summary stats
  const stats = React.useMemo(() => {
    if (activationHistory.length === 0) {
      return {
        totalProfit: 0,
        winDays: 0,
        lossDays: 0,
        currentBankroll: 1000,
        roi: 0,
      };
    }

    const lastDay = activationHistory[activationHistory.length - 1];
    const winDays = activationHistory.filter(d => d.is_profitable_day).length;
    const lossDays = activationHistory.length - winDays;
    const totalProfit = (lastDay?.simulated_bankroll || 1000) - 1000;
    const roi = (totalProfit / 1000) * 100;

    return {
      totalProfit,
      winDays,
      lossDays,
      currentBankroll: lastDay?.simulated_bankroll || 1000,
      roi,
    };
  }, [activationHistory]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64 mt-1" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-48 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-primary" />
            Performance History
          </CardTitle>
        </div>
        <CardDescription>
          Simulated bankroll growth over time
        </CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Stats Summary */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-lg bg-muted/30">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <DollarSign className="w-3.5 h-3.5" />
              Total Profit
            </div>
            <div className={cn(
              "text-xl font-bold",
              stats.totalProfit >= 0 ? "text-green-400" : "text-red-400"
            )}>
              {stats.totalProfit >= 0 ? '+' : ''}${stats.totalProfit.toFixed(0)}
            </div>
          </div>
          
          <div className="p-3 rounded-lg bg-muted/30">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <TrendingUp className="w-3.5 h-3.5" />
              ROI
            </div>
            <div className={cn(
              "text-xl font-bold",
              stats.roi >= 0 ? "text-green-400" : "text-red-400"
            )}>
              {stats.roi >= 0 ? '+' : ''}{stats.roi.toFixed(1)}%
            </div>
          </div>
          
          <div className="p-3 rounded-lg bg-muted/30">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <Target className="w-3.5 h-3.5" />
              Win Days
            </div>
            <div className="text-xl font-bold text-green-400">
              {stats.winDays}
            </div>
          </div>
          
          <div className="p-3 rounded-lg bg-muted/30">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <Target className="w-3.5 h-3.5" />
              Loss Days
            </div>
            <div className="text-xl font-bold text-red-400">
              {stats.lossDays}
            </div>
          </div>
        </div>

        {/* Bankroll Chart */}
        {chartData.length > 0 ? (
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="bankrollGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis 
                  dataKey="date" 
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  axisLine={{ stroke: 'hsl(var(--border))' }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  axisLine={{ stroke: 'hsl(var(--border))' }}
                  tickLine={false}
                  domain={['dataMin - 50', 'dataMax + 50']}
                  tickFormatter={(value) => `$${value}`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                  }}
                  labelStyle={{ color: 'hsl(var(--foreground))' }}
                  formatter={(value: number) => [`$${value.toFixed(0)}`, 'Bankroll']}
                />
                <Area
                  type="monotone"
                  dataKey="bankroll"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  fill="url(#bankrollGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-48 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <BarChart3 className="w-10 h-10 mx-auto mb-2 opacity-50" />
              <p>No performance data yet</p>
              <p className="text-sm mt-1">Data will appear after daily settlements</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
