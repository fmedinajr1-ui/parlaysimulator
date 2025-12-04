import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { TrendingUp, TrendingDown, AlertTriangle, Activity, Minus, Zap, Target, Trophy, XCircle, Lightbulb, CheckCircle, Ban, Info } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

interface MovementBucketStats {
  bucket: string;
  total: number;
  wins: number;
  traps: number;
  winRate: number;
  trapRate: number;
}

interface Recommendation {
  type: 'optimal' | 'caution' | 'avoid';
  bucket: string;
  label: string;
  winRate: number;
  confidence: 'high' | 'medium' | 'low';
  sampleSize: number;
  reason: string;
}

const BUCKET_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string; barColor: string }> = {
  extreme: { 
    label: 'Extreme (20+)', 
    icon: <AlertTriangle className="h-4 w-4" />, 
    color: 'text-red-500',
    barColor: 'hsl(0, 84%, 60%)'
  },
  large: { 
    label: 'Large (15-20)', 
    icon: <Zap className="h-4 w-4" />, 
    color: 'text-emerald-500',
    barColor: 'hsl(152, 69%, 50%)'
  },
  moderate: { 
    label: 'Moderate (10-15)', 
    icon: <Activity className="h-4 w-4" />, 
    color: 'text-amber-500',
    barColor: 'hsl(38, 92%, 50%)'
  },
  small: { 
    label: 'Small (5-10)', 
    icon: <TrendingUp className="h-4 w-4" />, 
    color: 'text-blue-500',
    barColor: 'hsl(217, 91%, 60%)'
  },
  minimal: { 
    label: 'Minimal (<5)', 
    icon: <Minus className="h-4 w-4" />, 
    color: 'text-muted-foreground',
    barColor: 'hsl(215, 16%, 47%)'
  },
};

export function MovementAccuracyDashboard() {
  const [selectedSport, setSelectedSport] = useState<string>('all');

  const { data: bucketStats, isLoading } = useQuery({
    queryKey: ['movement-accuracy-by-bucket', selectedSport],
    queryFn: async () => {
      let query = supabase
        .from('trap_patterns')
        .select('movement_bucket, confirmed_trap, movement_size');
      
      if (selectedSport !== 'all') {
        query = query.eq('sport', selectedSport);
      }

      const { data, error } = await query;
      
      if (error) throw error;

      // Group by movement bucket
      const bucketMap = new Map<string, { total: number; traps: number; wins: number }>();
      
      (data || []).forEach((pattern) => {
        const bucket = pattern.movement_bucket || classifyMovement(pattern.movement_size);
        if (!bucket) return;
        
        const existing = bucketMap.get(bucket) || { total: 0, traps: 0, wins: 0 };
        existing.total += 1;
        if (pattern.confirmed_trap) {
          existing.traps += 1;
        } else {
          existing.wins += 1;
        }
        bucketMap.set(bucket, existing);
      });

      // Convert to array with calculated rates
      const stats: MovementBucketStats[] = [];
      const orderedBuckets = ['extreme', 'large', 'moderate', 'small', 'minimal'];
      
      orderedBuckets.forEach((bucket) => {
        const data = bucketMap.get(bucket);
        if (data && data.total > 0) {
          stats.push({
            bucket,
            total: data.total,
            wins: data.wins,
            traps: data.traps,
            winRate: Math.round((data.wins / data.total) * 100),
            trapRate: Math.round((data.traps / data.total) * 100),
          });
        }
      });

      return stats;
    },
  });

  const { data: sports } = useQuery({
    queryKey: ['available-sports-trap-patterns'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trap_patterns')
        .select('sport')
        .not('sport', 'is', null);
      
      if (error) throw error;
      
      const uniqueSports = [...new Set(data?.map(d => d.sport).filter(Boolean))];
      return uniqueSports as string[];
    },
  });

  const totalPatterns = bucketStats?.reduce((sum, s) => sum + s.total, 0) || 0;
  const avgWinRate = bucketStats?.length 
    ? Math.round(bucketStats.reduce((sum, s) => sum + s.winRate * s.total, 0) / totalPatterns)
    : 0;

  // Recommendation Engine
  const recommendations = useMemo((): Recommendation[] => {
    if (!bucketStats || bucketStats.length === 0) return [];

    const recs: Recommendation[] = [];
    const MIN_SAMPLE_HIGH = 20;
    const MIN_SAMPLE_MEDIUM = 10;
    const WIN_RATE_OPTIMAL = 55;
    const WIN_RATE_CAUTION = 45;

    bucketStats.forEach((stat) => {
      const config = BUCKET_CONFIG[stat.bucket];
      const confidence: 'high' | 'medium' | 'low' = 
        stat.total >= MIN_SAMPLE_HIGH ? 'high' : 
        stat.total >= MIN_SAMPLE_MEDIUM ? 'medium' : 'low';

      if (stat.winRate >= WIN_RATE_OPTIMAL && stat.total >= MIN_SAMPLE_MEDIUM) {
        recs.push({
          type: 'optimal',
          bucket: stat.bucket,
          label: config?.label || stat.bucket,
          winRate: stat.winRate,
          confidence,
          sampleSize: stat.total,
          reason: `${stat.winRate}% historical win rate with ${stat.total} samples suggests this is a reliable movement range.`
        });
      } else if (stat.winRate < WIN_RATE_CAUTION && stat.total >= MIN_SAMPLE_MEDIUM) {
        recs.push({
          type: 'avoid',
          bucket: stat.bucket,
          label: config?.label || stat.bucket,
          winRate: stat.winRate,
          confidence,
          sampleSize: stat.total,
          reason: `${stat.trapRate}% trap rate indicates high risk. Consider fading or avoiding bets in this range.`
        });
      } else if (stat.total >= MIN_SAMPLE_MEDIUM) {
        recs.push({
          type: 'caution',
          bucket: stat.bucket,
          label: config?.label || stat.bucket,
          winRate: stat.winRate,
          confidence,
          sampleSize: stat.total,
          reason: `Mixed results with ${stat.winRate}% win rate. Use additional signals before betting.`
        });
      }
    });

    // Sort by type priority: optimal first, then caution, then avoid
    const typePriority = { optimal: 0, caution: 1, avoid: 2 };
    return recs.sort((a, b) => typePriority[a.type] - typePriority[b.type]);
  }, [bucketStats]);

  const optimalRanges = recommendations.filter(r => r.type === 'optimal');
  const cautionRanges = recommendations.filter(r => r.type === 'caution');
  const avoidRanges = recommendations.filter(r => r.type === 'avoid');

  const chartData = bucketStats?.map(s => ({
    name: BUCKET_CONFIG[s.bucket]?.label || s.bucket,
    bucket: s.bucket,
    'Win Rate': s.winRate,
    'Trap Rate': s.trapRate,
    total: s.total,
  })) || [];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5 text-primary" />
              Movement Accuracy by Bucket
            </CardTitle>
            <CardDescription>
              Historical win rates based on line movement size classification
            </CardDescription>
          </div>
          <Select value={selectedSport} onValueChange={setSelectedSport}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="All Sports" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sports</SelectItem>
              {sports?.map(sport => (
                <SelectItem key={sport} value={sport}>{sport.toUpperCase()}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-[200px] w-full" />
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-24" />
              ))}
            </div>
          </div>
        ) : (
          <>
            {/* Summary Stats */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <Card className="bg-muted/30">
                <CardContent className="pt-4">
                  <div className="text-2xl font-bold">{totalPatterns}</div>
                  <div className="text-sm text-muted-foreground">Total Patterns</div>
                </CardContent>
              </Card>
              <Card className="bg-muted/30">
                <CardContent className="pt-4">
                  <div className="text-2xl font-bold text-emerald-500">{avgWinRate}%</div>
                  <div className="text-sm text-muted-foreground">Avg Win Rate</div>
                </CardContent>
              </Card>
              <Card className="bg-muted/30">
                <CardContent className="pt-4">
                  <div className="text-2xl font-bold">{bucketStats?.length || 0}</div>
                  <div className="text-sm text-muted-foreground">Active Buckets</div>
                </CardContent>
              </Card>
            </div>

            {/* Chart */}
            {chartData.length > 0 ? (
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                    <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 12 }} />
                    <Tooltip 
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const data = payload[0].payload;
                        return (
                          <div className="bg-popover border rounded-lg p-3 shadow-lg">
                            <p className="font-medium">{data.name}</p>
                            <p className="text-emerald-500">Win Rate: {data['Win Rate']}%</p>
                            <p className="text-red-500">Trap Rate: {data['Trap Rate']}%</p>
                            <p className="text-muted-foreground text-sm">Sample: {data.total}</p>
                          </div>
                        );
                      }}
                    />
                    <Legend />
                    <Bar 
                      dataKey="Win Rate" 
                      fill="hsl(152, 69%, 50%)" 
                      radius={[0, 4, 4, 0]}
                    />
                    <Bar 
                      dataKey="Trap Rate" 
                      fill="hsl(0, 84%, 60%)" 
                      radius={[0, 4, 4, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                No movement patterns recorded yet
              </div>
            )}

            {/* Bucket Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {bucketStats?.map((stat) => {
                const config = BUCKET_CONFIG[stat.bucket];
                return (
                  <Card key={stat.bucket} className="relative overflow-hidden">
                    <div 
                      className="absolute inset-0 opacity-5"
                      style={{ backgroundColor: config?.barColor }}
                    />
                    <CardContent className="pt-4 relative">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span className={config?.color}>{config?.icon}</span>
                          <span className="font-medium">{config?.label || stat.bucket}</span>
                        </div>
                        <Badge variant="outline">{stat.total} samples</Badge>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4">
                        <div className="flex items-center gap-2">
                          <Trophy className="h-4 w-4 text-emerald-500" />
                          <div>
                            <div className="text-lg font-bold text-emerald-500">{stat.winRate}%</div>
                            <div className="text-xs text-muted-foreground">Win Rate</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <XCircle className="h-4 w-4 text-red-500" />
                          <div>
                            <div className="text-lg font-bold text-red-500">{stat.trapRate}%</div>
                            <div className="text-xs text-muted-foreground">Trap Rate</div>
                          </div>
                        </div>
                      </div>
                      
                      {/* Win Rate Bar */}
                      <div className="mt-3 h-2 bg-muted rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-emerald-500 transition-all"
                          style={{ width: `${stat.winRate}%` }}
                        />
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Recommendation Engine */}
            {recommendations.length > 0 && (
              <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Lightbulb className="h-5 w-5 text-primary" />
                    Recommendation Engine
                  </CardTitle>
                  <CardDescription>
                    AI-powered suggestions based on {totalPatterns} historical patterns
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Optimal Ranges */}
                  {optimalRanges.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm font-medium text-emerald-500">
                        <CheckCircle className="h-4 w-4" />
                        Optimal Movement Ranges
                      </div>
                      {optimalRanges.map((rec) => (
                        <div key={rec.bucket} className="ml-6 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-medium">{rec.label}</span>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-emerald-500 border-emerald-500/30">
                                {rec.winRate}% Win Rate
                              </Badge>
                              <Badge variant="secondary" className="text-xs">
                                {rec.confidence} confidence
                              </Badge>
                            </div>
                          </div>
                          <p className="text-sm text-muted-foreground">{rec.reason}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Caution Ranges */}
                  {cautionRanges.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm font-medium text-amber-500">
                        <Info className="h-4 w-4" />
                        Exercise Caution
                      </div>
                      {cautionRanges.map((rec) => (
                        <div key={rec.bucket} className="ml-6 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-medium">{rec.label}</span>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-amber-500 border-amber-500/30">
                                {rec.winRate}% Win Rate
                              </Badge>
                              <Badge variant="secondary" className="text-xs">
                                {rec.confidence} confidence
                              </Badge>
                            </div>
                          </div>
                          <p className="text-sm text-muted-foreground">{rec.reason}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Avoid Ranges */}
                  {avoidRanges.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm font-medium text-red-500">
                        <Ban className="h-4 w-4" />
                        Avoid These Ranges
                      </div>
                      {avoidRanges.map((rec) => (
                        <div key={rec.bucket} className="ml-6 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-medium">{rec.label}</span>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-red-500 border-red-500/30">
                                {rec.winRate}% Win Rate
                              </Badge>
                              <Badge variant="secondary" className="text-xs">
                                {rec.confidence} confidence
                              </Badge>
                            </div>
                          </div>
                          <p className="text-sm text-muted-foreground">{rec.reason}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Quick Summary */}
                  <div className="pt-3 border-t border-border/50">
                    <p className="text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">Quick Summary: </span>
                      {optimalRanges.length > 0 
                        ? `Focus on ${optimalRanges.map(r => r.label).join(', ')} for best results.`
                        : 'Not enough data to recommend optimal ranges yet.'}
                      {avoidRanges.length > 0 && ` Avoid ${avoidRanges.map(r => r.label).join(', ')}.`}
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Insights */}
            {bucketStats && bucketStats.length > 0 && (
              <Card className="bg-muted/30">
                <CardContent className="pt-4">
                  <h4 className="font-medium mb-2 flex items-center gap-2">
                    <Activity className="h-4 w-4" />
                    Key Insights
                  </h4>
                  <ul className="space-y-1 text-sm text-muted-foreground">
                    {(() => {
                      const bestBucket = bucketStats.reduce((best, curr) => 
                        curr.winRate > best.winRate ? curr : best
                      );
                      const worstBucket = bucketStats.reduce((worst, curr) => 
                        curr.trapRate > worst.trapRate ? curr : worst
                      );
                      
                      return (
                        <>
                          <li>
                            <span className="text-emerald-500">Best performer:</span>{' '}
                            {BUCKET_CONFIG[bestBucket.bucket]?.label} with {bestBucket.winRate}% win rate
                          </li>
                          <li>
                            <span className="text-red-500">Highest trap risk:</span>{' '}
                            {BUCKET_CONFIG[worstBucket.bucket]?.label} with {worstBucket.trapRate}% trap rate
                          </li>
                          <li>
                            Large movements (15-20 cents) typically indicate sharp action
                          </li>
                          <li>
                            Extreme movements may signal public money traps
                          </li>
                        </>
                      );
                    })()}
                  </ul>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function classifyMovement(movementSize: number | null): string {
  if (!movementSize) return 'minimal';
  const absMovement = Math.abs(movementSize);
  if (absMovement >= 20) return 'extreme';
  if (absMovement >= 15) return 'large';
  if (absMovement >= 10) return 'moderate';
  if (absMovement >= 5) return 'small';
  return 'minimal';
}
