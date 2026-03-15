import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import { 
  CheckCircle2, 
  AlertTriangle, 
  AlertCircle, 
  Zap,
  TrendingUp,
  BarChart3,
  Lightbulb,
  ArrowRightLeft
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface AltLineRow {
  side: string;
  quarter: number;
  hedge_status: string;
  total_picks: number;
  hits_original: number;
  misses_original: number;
  hit_rate_original: number;
  hits_at_live_line: number;
  misses_at_live_line: number;
  hit_rate_at_live_line: number | null;
  avg_projected_final: number;
  avg_gap_to_line: number;
  avg_live_book_line: number | null;
  avg_line_movement: number | null;
}

const STATUS_CONFIG = {
  on_track: { label: 'Hold', icon: CheckCircle2, color: 'text-green-400', bgColor: 'bg-green-500/10' },
  monitor: { label: 'Monitor', icon: Zap, color: 'text-yellow-400', bgColor: 'bg-yellow-500/10' },
  alert: { label: 'Alert', icon: AlertTriangle, color: 'text-orange-400', bgColor: 'bg-orange-500/10' },
  urgent: { label: 'Urgent', icon: AlertCircle, color: 'text-red-400', bgColor: 'bg-red-500/10' },
  profit_lock: { label: 'Profit Lock', icon: TrendingUp, color: 'text-emerald-400', bgColor: 'bg-emerald-500/10' },
};

const QUARTER_LABELS: Record<number, string> = { 1: 'Q1 End', 2: 'Halftime', 3: 'Q3 End', 4: 'Late Q4' };

export function HedgeStatusAccuracyCard() {
  const [sideFilter, setSideFilter] = useState<string>('all');

  const { data: sideData, isLoading } = useQuery({
    queryKey: ['hedge-alt-line-accuracy'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_hedge_accuracy_with_alt_lines', { days_back: 30 });
      if (error) throw error;
      return data as AltLineRow[];
    },
    staleTime: 5 * 60 * 1000,
  });

  const hasData = sideData && sideData.length > 0;

  const filtered = (sideData || []).filter(
    row => sideFilter === 'all' || row.side === sideFilter
  );

  const aggregated = sideFilter === 'all' ? aggregateRows(filtered) : filtered;

  const groupedByQuarter = aggregated.reduce((acc, row) => {
    if (!acc[row.quarter]) acc[row.quarter] = [];
    acc[row.quarter].push(row);
    return acc;
  }, {} as Record<number, AltLineRow[]>);

  const insights = generateAltLineInsights(sideData || []);

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
              <span>Smart Line Intelligence</span>
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

function QuarterAccuracyTable({ data, quarterLabel }: { data: AltLineRow[]; quarterLabel: string }) {
  if (data.length === 0) {
    return <div className="text-center text-muted-foreground py-4 text-xs">No data for {quarterLabel}</div>;
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-5 gap-2 text-xs text-muted-foreground px-2">
        <div>Status</div>
        <div className="text-center">Picks</div>
        <div className="text-center">Original</div>
        <div className="text-center flex items-center justify-center gap-0.5">
          <ArrowRightLeft size={10} />
          Live Line
        </div>
        <div className="text-right">Δ</div>
      </div>

      {data.map((row, idx) => {
        const config = STATUS_CONFIG[row.hedge_status as keyof typeof STATUS_CONFIG] || {
          label: row.hedge_status, icon: AlertCircle, color: 'text-muted-foreground', bgColor: 'bg-muted/10',
        };
        const Icon = config.icon;

        const hasLiveData = row.hit_rate_at_live_line !== null && (row.hits_at_live_line + row.misses_at_live_line) > 0;
        const liveRate = row.hit_rate_at_live_line ?? 0;
        const originalRate = row.hit_rate_original ?? 0;
        const delta = hasLiveData ? liveRate - originalRate : null;
        const hasDivergence = delta !== null && Math.abs(delta) >= 10;

        return (
          <TooltipProvider key={`${row.hedge_status}-${idx}`}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className={cn(
                    "grid grid-cols-5 gap-2 items-center p-2 rounded-md text-sm cursor-help",
                    config.bgColor,
                    hasDivergence && delta! < 0 ? 'ring-1 ring-orange-500/30' : ''
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <Icon size={14} className={config.color} />
                    <span className={config.color}>{config.label}</span>
                  </div>
                  <div className="text-center text-muted-foreground">{row.total_picks}</div>
                  <div className="text-center">
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-xs",
                        originalRate >= 70 ? "border-green-500/50 text-green-400" :
                        originalRate >= 50 ? "border-yellow-500/50 text-yellow-400" :
                        originalRate >= 30 ? "border-orange-500/50 text-orange-400" :
                        "border-red-500/50 text-red-400"
                      )}
                    >
                      {originalRate?.toFixed(1) ?? '—'}%
                    </Badge>
                  </div>
                  <div className="text-center">
                    {hasLiveData ? (
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-xs",
                          liveRate >= 70 ? "border-green-500/50 text-green-400" :
                          liveRate >= 50 ? "border-yellow-500/50 text-yellow-400" :
                          liveRate >= 30 ? "border-orange-500/50 text-orange-400" :
                          "border-red-500/50 text-red-400"
                        )}
                      >
                        {liveRate.toFixed(1)}%
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground/50">—</span>
                    )}
                  </div>
                  <div className="text-right">
                    {delta !== null ? (
                      <span className={cn(
                        "text-xs font-mono font-semibold",
                        delta > 5 ? "text-green-400" :
                        delta < -5 ? "text-orange-400" :
                        "text-muted-foreground"
                      )}>
                        {delta > 0 ? '+' : ''}{delta.toFixed(0)}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground/50">—</span>
                    )}
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[250px] text-xs">
                <p className="font-semibold mb-1">{config.label} at {quarterLabel}</p>
                <p>Original line hit rate: {originalRate?.toFixed(1)}% ({row.hits_original}H / {row.misses_original}M)</p>
                {hasLiveData && (
                  <>
                    <p>Live line hit rate: {liveRate.toFixed(1)}% ({row.hits_at_live_line}H / {row.misses_at_live_line}M)</p>
                    {row.avg_live_book_line && <p>Avg live line: {row.avg_live_book_line}</p>}
                    {row.avg_line_movement && <p>Avg movement: {row.avg_line_movement > 0 ? '+' : ''}{row.avg_line_movement}</p>}
                    {hasDivergence && delta! < 0 && (
                      <p className="text-orange-400 mt-1">⚠️ Live line accuracy is {Math.abs(delta!).toFixed(0)}% lower — consider locking early</p>
                    )}
                  </>
                )}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      })}
    </div>
  );
}

function aggregateRows(rows: AltLineRow[]): AltLineRow[] {
  const map = new Map<string, AltLineRow>();
  for (const r of rows) {
    const key = `${r.quarter}_${r.hedge_status}`;
    const existing = map.get(key);
    if (existing) {
      existing.total_picks += r.total_picks;
      existing.hits_original += r.hits_original;
      existing.misses_original += r.misses_original;
      existing.hits_at_live_line += r.hits_at_live_line;
      existing.misses_at_live_line += r.misses_at_live_line;
      existing.hit_rate_original = existing.total_picks > 0
        ? Math.round((existing.hits_original / (existing.hits_original + existing.misses_original)) * 1000) / 10
        : 0;
      const liveTotal = existing.hits_at_live_line + existing.misses_at_live_line;
      existing.hit_rate_at_live_line = liveTotal > 0
        ? Math.round((existing.hits_at_live_line / liveTotal) * 1000) / 10
        : null;
    } else {
      const liveTotal = r.hits_at_live_line + r.misses_at_live_line;
      map.set(key, { 
        ...r, 
        side: 'all',
        hit_rate_at_live_line: liveTotal > 0 
          ? Math.round((r.hits_at_live_line / liveTotal) * 1000) / 10 
          : null
      });
    }
  }
  return Array.from(map.values());
}

function generateAltLineInsights(data: AltLineRow[]): string[] {
  const insights: string[] = [];

  // Compare overall OVER vs UNDER hit rates
  const overRows = data.filter(d => d.side === 'over');
  const underRows = data.filter(d => d.side === 'under');

  const overTotal = overRows.reduce((s, r) => s + r.hits_original + r.misses_original, 0);
  const overHits = overRows.reduce((s, r) => s + r.hits_original, 0);
  const underTotal = underRows.reduce((s, r) => s + r.hits_original + r.misses_original, 0);
  const underHits = underRows.reduce((s, r) => s + r.hits_original, 0);

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

  // Alt-line divergence insights
  for (const row of data) {
    if (
      row.hit_rate_at_live_line !== null &&
      row.hit_rate_original !== null &&
      row.total_picks >= 3 &&
      (row.hits_at_live_line + row.misses_at_live_line) >= 3
    ) {
      const delta = row.hit_rate_at_live_line - row.hit_rate_original;
      if (delta <= -15) {
        const qLabel = QUARTER_LABELS[row.quarter] || `Q${row.quarter}`;
        const statusLabel = STATUS_CONFIG[row.hedge_status as keyof typeof STATUS_CONFIG]?.label || row.hedge_status;
        insights.push(
          `⚠️ ${row.side.toUpperCase()} "${statusLabel}" at ${qLabel}: original line hits ${row.hit_rate_original.toFixed(0)}% but live line only ${row.hit_rate_at_live_line.toFixed(0)}% — lock profit at original line early`
        );
      }
      if (delta >= 15) {
        const qLabel = QUARTER_LABELS[row.quarter] || `Q${row.quarter}`;
        const statusLabel = STATUS_CONFIG[row.hedge_status as keyof typeof STATUS_CONFIG]?.label || row.hedge_status;
        insights.push(
          `💡 ${row.side.toUpperCase()} "${statusLabel}" at ${qLabel}: live line hits ${row.hit_rate_at_live_line.toFixed(0)}% vs original ${row.hit_rate_original.toFixed(0)}% — live line offers better value`
        );
      }
    }
  }

  return insights.slice(0, 4); // Cap at 4 insights
}
