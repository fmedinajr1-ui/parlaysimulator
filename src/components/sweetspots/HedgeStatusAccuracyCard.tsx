import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { 
  CheckCircle2, 
  AlertTriangle, 
  AlertCircle, 
  Zap,
  TrendingUp,
  BarChart3,
  Lightbulb
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface HedgeSideRow {
  side: string;
  quarter: number;
  hedge_status: string;
  total_picks: number;
  hits: number;
  misses: number;
  hit_rate: number;
  avg_projected_final: number;
  avg_gap_to_line: number;
}

const STATUS_CONFIG = {
  on_track: { label: 'On Track', icon: CheckCircle2, color: 'text-green-400', bgColor: 'bg-green-500/10' },
  monitor: { label: 'Monitor', icon: Zap, color: 'text-yellow-400', bgColor: 'bg-yellow-500/10' },
  alert: { label: 'Alert', icon: AlertTriangle, color: 'text-orange-400', bgColor: 'bg-orange-500/10' },
  urgent: { label: 'Urgent', icon: AlertCircle, color: 'text-red-400', bgColor: 'bg-red-500/10' },
  profit_lock: { label: 'Profit Lock', icon: TrendingUp, color: 'text-emerald-400', bgColor: 'bg-emerald-500/10' },
};

const QUARTER_LABELS: Record<number, string> = { 1: 'Q1 End', 2: 'Halftime', 3: 'Q3 End', 4: 'Late Q4' };

export function HedgeStatusAccuracyCard() {
  const [sideFilter, setSideFilter] = useState<string>('all');

  const { data: sideData, isLoading } = useQuery({
    queryKey: ['hedge-side-performance'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_hedge_side_performance', { days_back: 30 });
      if (error) throw error;
      return data as HedgeSideRow[];
    },
    staleTime: 5 * 60 * 1000,
  });

  const hasData = sideData && sideData.length > 0;

  // Filter by selected side
  const filtered = (sideData || []).filter(
    row => sideFilter === 'all' || row.side === sideFilter
  );

  // Aggregate when "all" — group by quarter + status, sum picks/hits/misses
  const aggregated = sideFilter === 'all' ? aggregateRows(filtered) : filtered;

  // Group by quarter
  const groupedByQuarter = aggregated.reduce((acc, row) => {
    if (!acc[row.quarter]) acc[row.quarter] = [];
    acc[row.quarter].push(row);
    return acc;
  }, {} as Record<number, HedgeSideRow[]>);

  const insights = generateSideInsights(sideData || []);

  if (isLoading) {
    return (
      <Card className="bg-card/50 border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <BarChart3 size={16} className="text-primary" />
            Hedge Status Accuracy
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center text-muted-foreground py-8">Loading accuracy data...</div>
        </CardContent>
      </Card>
    );
  }

  if (!hasData) {
    return (
      <Card className="bg-card/50 border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <BarChart3 size={16} className="text-primary" />
            Hedge Status Accuracy
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center text-muted-foreground py-8">
            <p className="text-sm">No accuracy data yet</p>
            <p className="text-xs mt-1">Data will appear after tracking live games with settled outcomes</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card/50 border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <BarChart3 size={16} className="text-primary" />
          Hedge Status Accuracy (Last 30 Days)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Side Toggle */}
        <ToggleGroup
          type="single"
          value={sideFilter}
          onValueChange={(v) => v && setSideFilter(v)}
          size="sm"
          variant="outline"
          className="justify-start"
        >
          <ToggleGroupItem value="all" className="text-xs px-3 h-7">ALL</ToggleGroupItem>
          <ToggleGroupItem value="over" className="text-xs px-3 h-7">OVER</ToggleGroupItem>
          <ToggleGroupItem value="under" className="text-xs px-3 h-7">UNDER</ToggleGroupItem>
        </ToggleGroup>

        <Tabs defaultValue="halftime" className="w-full">
          <TabsList className="grid w-full grid-cols-4 h-8">
            <TabsTrigger value="q1" className="text-xs">Q1</TabsTrigger>
            <TabsTrigger value="halftime" className="text-xs">Halftime</TabsTrigger>
            <TabsTrigger value="q3" className="text-xs">Q3</TabsTrigger>
            <TabsTrigger value="q4" className="text-xs">Late Q4</TabsTrigger>
          </TabsList>

          {[1, 2, 3, 4].map((quarter) => (
            <TabsContent
              key={quarter}
              value={quarter === 1 ? 'q1' : quarter === 2 ? 'halftime' : quarter === 3 ? 'q3' : 'q4'}
              className="mt-3"
            >
              <QuarterAccuracyTable
                data={groupedByQuarter[quarter] || []}
                quarterLabel={QUARTER_LABELS[quarter]}
              />
            </TabsContent>
          ))}
        </Tabs>

        {insights.length > 0 && (
          <div className="border-t border-border/50 pt-3 space-y-2">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Lightbulb size={12} />
              <span>Side Intelligence</span>
            </div>
            {insights.map((insight, i) => (
              <p key={i} className="text-xs text-foreground/80">{insight}</p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function QuarterAccuracyTable({ data, quarterLabel }: { data: HedgeSideRow[]; quarterLabel: string }) {
  if (data.length === 0) {
    return <div className="text-center text-muted-foreground py-4 text-xs">No data for {quarterLabel}</div>;
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-4 gap-2 text-xs text-muted-foreground px-2">
        <div>Status</div>
        <div className="text-center">Picks</div>
        <div className="text-center">Hits</div>
        <div className="text-right">Hit Rate</div>
      </div>

      {data.map((row, idx) => {
        const config = STATUS_CONFIG[row.hedge_status as keyof typeof STATUS_CONFIG] || {
          label: row.hedge_status, icon: AlertCircle, color: 'text-muted-foreground', bgColor: 'bg-muted/10',
        };
        const Icon = config.icon;

        return (
          <div
            key={`${row.hedge_status}-${idx}`}
            className={cn("grid grid-cols-4 gap-2 items-center p-2 rounded-md text-sm", config.bgColor)}
          >
            <div className="flex items-center gap-1.5">
              <Icon size={14} className={config.color} />
              <span className={config.color}>{config.label}</span>
            </div>
            <div className="text-center text-muted-foreground">{row.total_picks}</div>
            <div className="text-center text-muted-foreground">{row.hits}</div>
            <div className="text-right">
              <Badge
                variant="outline"
                className={cn(
                  "text-xs",
                  row.hit_rate >= 70 ? "border-green-500/50 text-green-400" :
                  row.hit_rate >= 50 ? "border-yellow-500/50 text-yellow-400" :
                  row.hit_rate >= 30 ? "border-orange-500/50 text-orange-400" :
                  "border-red-500/50 text-red-400"
                )}
              >
                {row.hit_rate?.toFixed(1) ?? '—'}%
              </Badge>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function aggregateRows(rows: HedgeSideRow[]): HedgeSideRow[] {
  const map = new Map<string, HedgeSideRow>();
  for (const r of rows) {
    const key = `${r.quarter}_${r.hedge_status}`;
    const existing = map.get(key);
    if (existing) {
      existing.total_picks += r.total_picks;
      existing.hits += r.hits;
      existing.misses += r.misses;
      existing.hit_rate = existing.total_picks > 0
        ? Math.round((existing.hits / (existing.hits + existing.misses)) * 1000) / 10
        : 0;
    } else {
      map.set(key, { ...r, side: 'all' });
    }
  }
  return Array.from(map.values());
}

function generateSideInsights(data: HedgeSideRow[]): string[] {
  const insights: string[] = [];

  // Compare overall OVER vs UNDER hit rates
  const overRows = data.filter(d => d.side === 'over');
  const underRows = data.filter(d => d.side === 'under');

  const overTotal = overRows.reduce((s, r) => s + r.hits + r.misses, 0);
  const overHits = overRows.reduce((s, r) => s + r.hits, 0);
  const underTotal = underRows.reduce((s, r) => s + r.hits + r.misses, 0);
  const underHits = underRows.reduce((s, r) => s + r.hits, 0);

  const overRate = overTotal > 0 ? (overHits / overTotal) * 100 : 0;
  const underRate = underTotal > 0 ? (underHits / underTotal) * 100 : 0;

  if (overTotal >= 5 && underTotal >= 5) {
    const diff = Math.abs(overRate - underRate);
    if (diff >= 10) {
      const better = overRate > underRate ? 'OVER' : 'UNDER';
      const worse = better === 'OVER' ? 'UNDER' : 'OVER';
      insights.push(
        `📊 ${better} hedges hit ${Math.max(overRate, underRate).toFixed(0)}% vs ${worse} at ${Math.min(overRate, underRate).toFixed(0)}% — focus hedge logic on ${worse} side`
      );
    }
  }

  // Check Q3 urgent by side
  const overQ3Urgent = data.find(d => d.side === 'over' && d.quarter === 3 && d.hedge_status === 'urgent');
  const underQ3Urgent = data.find(d => d.side === 'under' && d.quarter === 3 && d.hedge_status === 'urgent');
  if (overQ3Urgent && overQ3Urgent.hit_rate <= 20 && overQ3Urgent.total_picks >= 3) {
    insights.push(`🚨 OVER "Urgent" at Q3 hits only ${overQ3Urgent.hit_rate.toFixed(0)}% — hedge immediately`);
  }
  if (underQ3Urgent && underQ3Urgent.hit_rate >= 30 && underQ3Urgent.total_picks >= 3) {
    insights.push(`⚡ UNDER "Urgent" at Q3 still hits ${underQ3Urgent.hit_rate.toFixed(0)}% — wait before hedging`);
  }

  // Halftime alert difference
  const overHtAlert = data.find(d => d.side === 'over' && d.quarter === 2 && d.hedge_status === 'alert');
  const underHtAlert = data.find(d => d.side === 'under' && d.quarter === 2 && d.hedge_status === 'alert');
  if (overHtAlert && underHtAlert && overHtAlert.total_picks >= 3 && underHtAlert.total_picks >= 3) {
    if (Math.abs(overHtAlert.hit_rate - underHtAlert.hit_rate) >= 15) {
      const better = overHtAlert.hit_rate > underHtAlert.hit_rate ? 'OVER' : 'UNDER';
      insights.push(
        `⏸️ ${better} "Alert" at halftime holds better (${Math.max(overHtAlert.hit_rate, underHtAlert.hit_rate).toFixed(0)}% vs ${Math.min(overHtAlert.hit_rate, underHtAlert.hit_rate).toFixed(0)}%) — don't panic on ${better} side`
      );
    }
  }

  return insights;
}
