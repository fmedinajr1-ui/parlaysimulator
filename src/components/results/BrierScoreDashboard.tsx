import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { Activity, RefreshCw, Award, Target, TrendingDown } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { getCalibrationGrade } from '@/lib/calibration-engine';

interface EngineBrierScore {
  engineName: string;
  sport: string | null;
  brierScore: number;
  logLoss: number;
  sampleSize: number;
  calibrationError: number;
  reliabilityScore: number;
  resolutionScore: number;
  periodStart: string;
  periodEnd: string;
}

interface BrierScoreDashboardProps {
  onRefresh?: () => void;
}

export function BrierScoreDashboard({ onRefresh }: BrierScoreDashboardProps) {
  const [scores, setScores] = useState<EngineBrierScore[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchScores = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('engine_brier_scores')
        .select('*')
        .order('brier_score', { ascending: true })
        .limit(20);

      if (error) throw error;

      setScores(
        (data || []).map(row => ({
          engineName: row.engine_name,
          sport: row.sport,
          brierScore: Number(row.brier_score),
          logLoss: Number(row.log_loss) || 0,
          sampleSize: row.sample_size,
          calibrationError: Number(row.calibration_error) || 0,
          reliabilityScore: Number(row.reliability_score) || 0,
          resolutionScore: Number(row.resolution_score) || 0,
          periodStart: row.period_start,
          periodEnd: row.period_end,
        }))
      );
    } catch (error) {
      console.error('Error fetching Brier scores:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchScores();
  }, []);

  const handleRefresh = () => {
    fetchScores();
    onRefresh?.();
  };

  // Best performing engine
  const bestEngine = scores.length > 0 ? scores[0] : null;

  // Prepare chart data
  const chartData = scores.slice(0, 8).map(score => ({
    name: score.engineName.replace(/_/g, ' ').slice(0, 15),
    brierScore: score.brierScore,
    samples: score.sampleSize,
    grade: getCalibrationGrade(score.brierScore),
  }));

  if (isLoading) {
    return (
      <Card className="bg-card/50 backdrop-blur border-border/50">
        <CardHeader>
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-[200px] w-full" />
          <div className="grid grid-cols-3 gap-4">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (scores.length === 0) {
    return (
      <Card className="bg-card/50 backdrop-blur border-border/50">
        <CardContent className="py-8 text-center">
          <Activity className="h-8 w-8 mx-auto mb-2 text-muted-foreground opacity-50" />
          <p className="text-muted-foreground">No Brier score data available</p>
          <p className="text-xs text-muted-foreground mt-1">
            Scores are calculated from verified predictions
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card/50 backdrop-blur border-border/50">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            Engine Calibration Scores
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={handleRefresh}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Best Engine Highlight */}
        {bestEngine && (
          <div className="bg-gradient-to-r from-primary/10 to-transparent rounded-lg p-4 border border-primary/20">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/20 rounded-full">
                <Award className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{bestEngine.engineName.replace(/_/g, ' ')}</span>
                  <Badge variant="outline" className={getCalibrationGrade(bestEngine.brierScore).color}>
                    {getCalibrationGrade(bestEngine.brierScore).grade}
                  </Badge>
                </div>
                <div className="text-sm text-muted-foreground">
                  Best calibrated engine • Brier: {bestEngine.brierScore.toFixed(4)} • n={bestEngine.sampleSize}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Brier Score Chart */}
        <div className="h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" margin={{ left: 80, right: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
              <XAxis 
                type="number" 
                domain={[0, 0.5]}
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                axisLine={{ stroke: 'hsl(var(--border))' }}
              />
              <YAxis 
                type="category" 
                dataKey="name"
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                axisLine={{ stroke: 'hsl(var(--border))' }}
                width={75}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                }}
                formatter={(value: number) => [value.toFixed(4), 'Brier Score']}
                labelFormatter={(label) => `Engine: ${label}`}
              />
              <Bar dataKey="brierScore" radius={[0, 4, 4, 0]}>
                {chartData.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={
                      entry.brierScore <= 0.15
                        ? 'hsl(142, 76%, 36%)'
                        : entry.brierScore <= 0.25
                        ? 'hsl(48, 96%, 53%)'
                        : 'hsl(0, 84%, 60%)'
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Score Legend */}
        <div className="flex items-center justify-center gap-4 text-xs">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-green-500" />
            <span>Good (≤0.15)</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-yellow-500" />
            <span>Average (≤0.25)</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-red-500" />
            <span>Poor (&gt;0.25)</span>
          </div>
        </div>

        {/* Detailed Metrics Table */}
        <div className="space-y-2">
          <h4 className="text-sm font-medium flex items-center gap-2">
            <Target className="h-4 w-4" />
            Detailed Metrics
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-1">Engine</th>
                  <th className="text-right py-2 px-1">Brier</th>
                  <th className="text-right py-2 px-1">Log Loss</th>
                  <th className="text-right py-2 px-1">Cal. Error</th>
                  <th className="text-right py-2 px-1">Samples</th>
                  <th className="text-center py-2 px-1">Grade</th>
                </tr>
              </thead>
              <tbody>
                {scores.slice(0, 6).map((score, idx) => {
                  const grade = getCalibrationGrade(score.brierScore);
                  return (
                    <tr key={idx} className="border-b border-border/50">
                      <td className="py-2 px-1 font-medium">
                        {score.engineName.replace(/_/g, ' ')}
                        {score.sport && (
                          <span className="text-muted-foreground ml-1">({score.sport})</span>
                        )}
                      </td>
                      <td className="text-right py-2 px-1 font-mono">{score.brierScore.toFixed(4)}</td>
                      <td className="text-right py-2 px-1 font-mono">{score.logLoss.toFixed(4)}</td>
                      <td className="text-right py-2 px-1 font-mono">{(score.calibrationError * 100).toFixed(1)}%</td>
                      <td className="text-right py-2 px-1">{score.sampleSize}</td>
                      <td className="text-center py-2 px-1">
                        <Badge variant="outline" className={`${grade.color} text-[10px]`}>
                          {grade.grade}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Interpretation Guide */}
        <div className="bg-muted/30 rounded-lg p-3 text-xs text-muted-foreground">
          <div className="flex items-start gap-2">
            <TrendingDown className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div>
              <strong>Lower Brier scores = better calibration.</strong> A Brier score of 0.25 means random guessing
              for binary outcomes. Scores below 0.15 indicate strong predictive accuracy. Calibration error shows
              the average difference between predicted probabilities and actual outcome rates.
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
