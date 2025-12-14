import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Area,
  ComposedChart,
} from 'recharts';
import { Target, TrendingUp, TrendingDown, Info } from 'lucide-react';
import { 
  CalibrationBucket, 
  calculateECE, 
  calculateMCE,
  getCalibrationGrade 
} from '@/lib/calibration-engine';

interface CalibrationCurveChartProps {
  buckets: CalibrationBucket[];
  brierScore?: number;
  engineName?: string;
  compact?: boolean;
}

export function CalibrationCurveChart({
  buckets,
  brierScore,
  engineName = 'Engine',
  compact = false,
}: CalibrationCurveChartProps) {
  const chartData = useMemo(() => {
    return buckets.map(bucket => ({
      predicted: (bucket.predictedAvg * 100).toFixed(0),
      actual: (bucket.actualAvg * 100).toFixed(1),
      perfect: (bucket.predictedAvg * 100).toFixed(0),
      count: bucket.count,
      lower: (bucket.confidenceLower * 100).toFixed(1),
      upper: (bucket.confidenceUpper * 100).toFixed(1),
      bucketLabel: `${(bucket.bucketStart * 100).toFixed(0)}-${(bucket.bucketEnd * 100).toFixed(0)}%`,
    }));
  }, [buckets]);

  const ece = calculateECE(buckets);
  const mce = calculateMCE(buckets);
  const grade = brierScore ? getCalibrationGrade(brierScore) : null;

  // Determine if model is over/underconfident overall
  const calibrationDirection = useMemo(() => {
    if (buckets.length === 0) return null;
    
    const avgDiff = buckets.reduce((sum, b) => {
      return sum + (b.actualAvg - b.predictedAvg) * b.count;
    }, 0) / buckets.reduce((sum, b) => sum + b.count, 0);
    
    if (avgDiff > 0.03) return 'underconfident';
    if (avgDiff < -0.03) return 'overconfident';
    return 'calibrated';
  }, [buckets]);

  if (buckets.length === 0) {
    return (
      <Card className="bg-card/50 backdrop-blur border-border/50">
        <CardContent className="py-8 text-center text-muted-foreground">
          <Target className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>No calibration data available</p>
        </CardContent>
      </Card>
    );
  }

  if (compact) {
    return (
      <Card className="bg-card/50 backdrop-blur border-border/50">
        <CardContent className="py-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Calibration</span>
            {grade && (
              <Badge variant="outline" className={grade.color}>
                {grade.grade}
              </Badge>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-muted-foreground">ECE:</span>{' '}
              <span className="font-mono">{(ece * 100).toFixed(1)}%</span>
            </div>
            <div>
              <span className="text-muted-foreground">MCE:</span>{' '}
              <span className="font-mono">{(mce * 100).toFixed(1)}%</span>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card/50 backdrop-blur border-border/50">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            Calibration Curve
            {engineName && (
              <Badge variant="secondary" className="ml-2">
                {engineName}
              </Badge>
            )}
          </CardTitle>
          {grade && (
            <div className="flex items-center gap-2">
              <Badge variant="outline" className={grade.color}>
                {grade.grade} - {grade.label}
              </Badge>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Metrics Row */}
        <div className="grid grid-cols-3 gap-4 text-center">
          <div className="bg-background/50 rounded-lg p-3">
            <div className="text-xs text-muted-foreground uppercase tracking-wider">Brier Score</div>
            <div className="text-xl font-bold font-mono">
              {brierScore ? brierScore.toFixed(4) : 'N/A'}
            </div>
            <div className="text-xs text-muted-foreground">Lower is better</div>
          </div>
          <div className="bg-background/50 rounded-lg p-3">
            <div className="text-xs text-muted-foreground uppercase tracking-wider">ECE</div>
            <div className="text-xl font-bold font-mono">{(ece * 100).toFixed(2)}%</div>
            <div className="text-xs text-muted-foreground">Avg error</div>
          </div>
          <div className="bg-background/50 rounded-lg p-3">
            <div className="text-xs text-muted-foreground uppercase tracking-wider">MCE</div>
            <div className="text-xl font-bold font-mono">{(mce * 100).toFixed(2)}%</div>
            <div className="text-xs text-muted-foreground">Max error</div>
          </div>
        </div>

        {/* Calibration Direction Indicator */}
        {calibrationDirection && (
          <div className={`flex items-center gap-2 text-sm p-2 rounded-lg ${
            calibrationDirection === 'overconfident' 
              ? 'bg-orange-500/10 text-orange-400' 
              : calibrationDirection === 'underconfident'
              ? 'bg-blue-500/10 text-blue-400'
              : 'bg-green-500/10 text-green-400'
          }`}>
            {calibrationDirection === 'overconfident' ? (
              <>
                <TrendingUp className="h-4 w-4" />
                <span>Model tends to be <strong>overconfident</strong> - reduce predicted probabilities</span>
              </>
            ) : calibrationDirection === 'underconfident' ? (
              <>
                <TrendingDown className="h-4 w-4" />
                <span>Model tends to be <strong>underconfident</strong> - increase predicted probabilities</span>
              </>
            ) : (
              <>
                <Target className="h-4 w-4" />
                <span>Model is <strong>well calibrated</strong></span>
              </>
            )}
          </div>
        )}

        {/* Chart */}
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
              <XAxis
                dataKey="predicted"
                label={{ value: 'Predicted Probability (%)', position: 'bottom', offset: 0 }}
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                axisLine={{ stroke: 'hsl(var(--border))' }}
              />
              <YAxis
                label={{ value: 'Actual Outcome Rate (%)', angle: -90, position: 'insideLeft' }}
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                axisLine={{ stroke: 'hsl(var(--border))' }}
                domain={[0, 100]}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                }}
                formatter={(value: number, name: string) => {
                  if (name === 'actual') return [`${value}%`, 'Actual Rate'];
                  if (name === 'perfect') return [`${value}%`, 'Perfect Calibration'];
                  return [value, name];
                }}
                labelFormatter={(label) => `Predicted: ${label}%`}
              />
              
              {/* Perfect calibration line */}
              <ReferenceLine
                segment={[{ x: '0', y: 0 }, { x: '100', y: 100 }]}
                stroke="hsl(var(--muted-foreground))"
                strokeDasharray="5 5"
                opacity={0.5}
              />
              
              {/* Confidence interval area */}
              <Area
                type="monotone"
                dataKey="upper"
                stroke="none"
                fill="hsl(var(--primary))"
                fillOpacity={0.1}
              />
              <Area
                type="monotone"
                dataKey="lower"
                stroke="none"
                fill="hsl(var(--background))"
                fillOpacity={1}
              />
              
              {/* Actual calibration line */}
              <Line
                type="monotone"
                dataKey="actual"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                dot={{ fill: 'hsl(var(--primary))', strokeWidth: 2, r: 4 }}
                activeDot={{ r: 6, strokeWidth: 0 }}
              />
              
              {/* Perfect line (diagonal) */}
              <Line
                type="monotone"
                dataKey="perfect"
                stroke="hsl(var(--muted-foreground))"
                strokeWidth={1}
                strokeDasharray="5 5"
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Legend */}
        <div className="flex items-center justify-center gap-6 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <div className="w-3 h-0.5 bg-primary" />
            <span>Actual Calibration</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-0.5 bg-muted-foreground border-dashed" style={{ borderTop: '2px dashed' }} />
            <span>Perfect Calibration</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-primary/20 rounded" />
            <span>95% Confidence</span>
          </div>
        </div>

        {/* Sample counts per bucket */}
        <div className="flex items-center gap-1 text-xs">
          <Info className="h-3 w-3 text-muted-foreground" />
          <span className="text-muted-foreground">
            Sample sizes: {chartData.map(d => d.count).join(', ')} (n={buckets.reduce((sum, b) => sum + b.count, 0)})
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
