import React, { useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from 'recharts';

type ViewMode = 'bankroll' | 'daily';

export function BotPerformanceChart() {
  const [viewMode, setViewMode] = useState<ViewMode>('bankroll');

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
  }));

  if (isLoading) {
    return (
      <Card>
        <CardHeader><Skeleton className="h-6 w-48" /></CardHeader>
        <CardContent><Skeleton className="h-48 w-full" /></CardContent>
      </Card>
    );
  }

  const tooltipStyle = {
    backgroundColor: 'hsl(var(--card))',
    border: '1px solid hsl(var(--border))',
    borderRadius: '8px',
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-primary" />
            Performance
          </CardTitle>
          <div className="flex gap-1 bg-muted/50 rounded-lg p-0.5">
            <Button
              variant={viewMode === 'bankroll' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-6 text-xs px-2"
              onClick={() => setViewMode('bankroll')}
            >
              Bankroll
            </Button>
            <Button
              variant={viewMode === 'daily' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-6 text-xs px-2"
              onClick={() => setViewMode('daily')}
            >
              Daily P&L
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {chartData.length > 0 ? (
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              {viewMode === 'bankroll' ? (
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="bankrollGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} tickFormatter={(v) => `$${v}`} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`$${v.toFixed(0)}`, 'Bankroll']} />
                  <Area type="monotone" dataKey="bankroll" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#bankrollGrad)" />
                </AreaChart>
              ) : (
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} tickFormatter={(v) => `$${v}`} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`$${v.toFixed(0)}`, 'P&L']} />
                  <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
                  <Bar
                    dataKey="profit"
                    radius={[4, 4, 0, 0]}
                    fill="hsl(var(--primary))"
                  />
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-48 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <BarChart3 className="w-10 h-10 mx-auto mb-2 opacity-50" />
              <p>No performance data yet</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
