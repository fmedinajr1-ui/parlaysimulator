import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
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

interface HedgeAccuracyRow {
  quarter: number;
  hedge_status: string;
  total_picks: number;
  hits: number;
  misses: number;
  hit_rate: number;
  avg_hit_probability: number;
}

interface CalibrationRow {
  probability_bucket: string;
  quarter: number;
  total_picks: number;
  hits: number;
  actual_hit_rate: number;
  expected_hit_rate: number;
  calibration_error: number;
}

const STATUS_CONFIG = {
  on_track: {
    label: 'On Track',
    icon: CheckCircle2,
    color: 'text-green-400',
    bgColor: 'bg-green-500/10',
  },
  monitor: {
    label: 'Monitor',
    icon: Zap,
    color: 'text-yellow-400',
    bgColor: 'bg-yellow-500/10',
  },
  alert: {
    label: 'Alert',
    icon: AlertTriangle,
    color: 'text-orange-400',
    bgColor: 'bg-orange-500/10',
  },
  urgent: {
    label: 'Urgent',
    icon: AlertCircle,
    color: 'text-red-400',
    bgColor: 'bg-red-500/10',
  },
  profit_lock: {
    label: 'Profit Lock',
    icon: TrendingUp,
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10',
  },
};

const QUARTER_LABELS = {
  1: 'Q1 End',
  2: 'Halftime',
  3: 'Q3 End',
  4: 'Late Q4',
};

export function HedgeStatusAccuracyCard() {
  const { data: accuracyData, isLoading: accuracyLoading } = useQuery({
    queryKey: ['hedge-status-accuracy'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_hedge_status_accuracy', {
        days_back: 30,
      });
      if (error) throw error;
      return data as HedgeAccuracyRow[];
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  const { data: calibrationData, isLoading: calibrationLoading } = useQuery({
    queryKey: ['hedge-probability-calibration'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_hedge_probability_calibration', {
        days_back: 30,
      });
      if (error) throw error;
      return data as CalibrationRow[];
    },
    staleTime: 5 * 60 * 1000,
  });

  const isLoading = accuracyLoading || calibrationLoading;
  const hasData = accuracyData && accuracyData.length > 0;

  // Group accuracy data by quarter
  const groupedByQuarter = (accuracyData || []).reduce((acc, row) => {
    if (!acc[row.quarter]) acc[row.quarter] = [];
    acc[row.quarter].push(row);
    return acc;
  }, {} as Record<number, HedgeAccuracyRow[]>);

  // Generate insights
  const insights = generateInsights(accuracyData || []);

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
          <div className="text-center text-muted-foreground py-8">
            Loading accuracy data...
          </div>
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
            <p className="text-xs mt-1">
              Data will appear after tracking live games with settled outcomes
            </p>
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
                quarterLabel={QUARTER_LABELS[quarter as keyof typeof QUARTER_LABELS]}
              />
            </TabsContent>
          ))}
        </Tabs>

        {/* Insights Section */}
        {insights.length > 0 && (
          <div className="border-t border-border/50 pt-3 space-y-2">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Lightbulb size={12} />
              <span>Insights</span>
            </div>
            {insights.map((insight, i) => (
              <p key={i} className="text-xs text-foreground/80">
                {insight}
              </p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function QuarterAccuracyTable({ 
  data, 
  quarterLabel 
}: { 
  data: HedgeAccuracyRow[]; 
  quarterLabel: string;
}) {
  if (data.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-4 text-xs">
        No data for {quarterLabel}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-4 gap-2 text-xs text-muted-foreground px-2">
        <div>Status</div>
        <div className="text-center">Picks</div>
        <div className="text-center">Hits</div>
        <div className="text-right">Hit Rate</div>
      </div>
      
      {data.map((row) => {
        const config = STATUS_CONFIG[row.hedge_status as keyof typeof STATUS_CONFIG] || {
          label: row.hedge_status,
          icon: AlertCircle,
          color: 'text-muted-foreground',
          bgColor: 'bg-muted/10',
        };
        const Icon = config.icon;
        
        return (
          <div 
            key={row.hedge_status}
            className={cn(
              "grid grid-cols-4 gap-2 items-center p-2 rounded-md text-sm",
              config.bgColor
            )}
          >
            <div className="flex items-center gap-1.5">
              <Icon size={14} className={config.color} />
              <span className={config.color}>{config.label}</span>
            </div>
            <div className="text-center text-muted-foreground">
              {row.total_picks}
            </div>
            <div className="text-center text-muted-foreground">
              {row.hits}
            </div>
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

function generateInsights(data: HedgeAccuracyRow[]): string[] {
  const insights: string[] = [];
  
  // Find highest accuracy status at Q3
  const q3Data = data.filter(d => d.quarter === 3);
  const q3OnTrack = q3Data.find(d => d.hedge_status === 'on_track');
  if (q3OnTrack && q3OnTrack.hit_rate >= 85) {
    insights.push(`✓ "On Track" at Q3 has ${q3OnTrack.hit_rate.toFixed(0)}% accuracy — high confidence signal`);
  }
  
  // Check halftime alert rate
  const q2Alert = data.find(d => d.quarter === 2 && d.hedge_status === 'alert');
  if (q2Alert && q2Alert.hit_rate >= 35) {
    insights.push(`⚡ "Alert" at halftime still hits ${q2Alert.hit_rate.toFixed(0)}% — don't panic early`);
  }
  
  // Check urgent at Q3
  const q3Urgent = data.find(d => d.quarter === 3 && d.hedge_status === 'urgent');
  if (q3Urgent && q3Urgent.hit_rate <= 25) {
    insights.push(`🚨 "Urgent" at Q3 only hits ${q3Urgent.hit_rate.toFixed(0)}% — hedge immediately`);
  }
  
  return insights;
}
