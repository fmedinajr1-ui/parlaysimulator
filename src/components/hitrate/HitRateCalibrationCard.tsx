import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Target, Activity, TrendingUp, TrendingDown, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CalibrationCurveChart } from '@/components/results/CalibrationCurveChart';
import { 
  CalibrationBucket, 
  fetchCalibrationBuckets, 
  calculateECE, 
  calculateMCE,
  getCalibrationGrade 
} from '@/lib/calibration-engine';
import { supabase } from '@/integrations/supabase/client';

interface HitRateCalibrationCardProps {
  compact?: boolean;
  defaultExpanded?: boolean;
}

interface StrategyCalibration {
  strategy: string;
  buckets: CalibrationBucket[];
  brierScore: number;
  sampleSize: number;
}

export function HitRateCalibrationCard({ 
  compact = false,
  defaultExpanded = false 
}: HitRateCalibrationCardProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [isLoading, setIsLoading] = useState(true);
  const [buckets, setBuckets] = useState<CalibrationBucket[]>([]);
  const [brierScores, setBrierScores] = useState<any[]>([]);
  const [selectedEngine, setSelectedEngine] = useState('hitrate');

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        // Fetch calibration buckets for hitrate engine
        const bucketsData = await fetchCalibrationBuckets('hitrate');
        setBuckets(bucketsData);

        // Fetch Brier scores
        const { data: brierData } = await supabase
          .from('engine_brier_scores')
          .select('*')
          .or('engine_name.ilike.%hitrate%,engine_name.ilike.%hit_rate%')
          .order('brier_score', { ascending: true });

        setBrierScores(brierData || []);
      } catch (error) {
        console.error('Error fetching calibration data:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, []);

  const ece = buckets.length > 0 ? calculateECE(buckets) : 0;
  const mce = buckets.length > 0 ? calculateMCE(buckets) : 0;
  const avgBrier = brierScores.length > 0 
    ? brierScores.reduce((sum, s) => sum + Number(s.brier_score), 0) / brierScores.length 
    : null;
  const grade = avgBrier ? getCalibrationGrade(avgBrier) : null;

  // Determine calibration direction
  const calibrationDirection = buckets.length > 0 
    ? (() => {
        const totalCount = buckets.reduce((sum, b) => sum + b.count, 0);
        if (totalCount === 0) return null;
        const avgDiff = buckets.reduce((sum, b) => {
          return sum + (b.actualAvg - b.predictedAvg) * b.count;
        }, 0) / totalCount;
        if (avgDiff > 0.03) return 'underconfident';
        if (avgDiff < -0.03) return 'overconfident';
        return 'calibrated';
      })()
    : null;

  if (isLoading) {
    return (
      <Card className="bg-card/60 backdrop-blur border-border/50">
        <CardHeader className="pb-3">
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (compact) {
    return (
      <Card className="bg-card/60 backdrop-blur border-border/50">
        <CardContent className="py-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">Calibration</span>
            </div>
            {grade && (
              <Badge variant="outline" className={grade.color}>
                {grade.grade} - {grade.label}
              </Badge>
            )}
          </div>
          
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-muted/30 rounded-lg p-2 text-center">
              <p className="text-[10px] text-muted-foreground uppercase">Brier</p>
              <p className="text-sm font-bold font-mono">
                {avgBrier ? avgBrier.toFixed(3) : 'N/A'}
              </p>
            </div>
            <div className="bg-muted/30 rounded-lg p-2 text-center">
              <p className="text-[10px] text-muted-foreground uppercase">ECE</p>
              <p className="text-sm font-bold font-mono">{(ece * 100).toFixed(1)}%</p>
            </div>
            <div className="bg-muted/30 rounded-lg p-2 text-center">
              <p className="text-[10px] text-muted-foreground uppercase">MCE</p>
              <p className="text-sm font-bold font-mono">{(mce * 100).toFixed(1)}%</p>
            </div>
          </div>

          {calibrationDirection && calibrationDirection !== 'calibrated' && (
            <div className={`mt-3 flex items-center gap-2 text-xs p-2 rounded-lg ${
              calibrationDirection === 'overconfident' 
                ? 'bg-orange-500/10 text-orange-400' 
                : 'bg-blue-500/10 text-blue-400'
            }`}>
              {calibrationDirection === 'overconfident' ? (
                <>
                  <TrendingUp className="h-3 w-3" />
                  <span>Tends overconfident - reduce estimates</span>
                </>
              ) : (
                <>
                  <TrendingDown className="h-3 w-3" />
                  <span>Tends underconfident - can increase estimates</span>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card/60 backdrop-blur border-border/50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            Probability Calibration
          </CardTitle>
          <div className="flex items-center gap-2">
            {grade && (
              <Badge variant="outline" className={grade.color}>
                {grade.grade}
              </Badge>
            )}
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => setIsExpanded(!isExpanded)}
              className="h-8 px-2"
            >
              {isExpanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary Metrics */}
        <div className="grid grid-cols-4 gap-3">
          <div className="bg-muted/30 rounded-lg p-3 text-center">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Brier Score</p>
            <p className="text-lg font-bold font-mono">
              {avgBrier ? avgBrier.toFixed(4) : 'N/A'}
            </p>
            <p className="text-[10px] text-muted-foreground">Lower is better</p>
          </div>
          <div className="bg-muted/30 rounded-lg p-3 text-center">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">ECE</p>
            <p className="text-lg font-bold font-mono">{(ece * 100).toFixed(2)}%</p>
            <p className="text-[10px] text-muted-foreground">Avg error</p>
          </div>
          <div className="bg-muted/30 rounded-lg p-3 text-center">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">MCE</p>
            <p className="text-lg font-bold font-mono">{(mce * 100).toFixed(2)}%</p>
            <p className="text-[10px] text-muted-foreground">Max error</p>
          </div>
          <div className="bg-muted/30 rounded-lg p-3 text-center">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Grade</p>
            <p className={`text-lg font-bold ${grade?.color || 'text-muted-foreground'}`}>
              {grade?.grade || 'N/A'}
            </p>
            <p className="text-[10px] text-muted-foreground">{grade?.label || 'No data'}</p>
          </div>
        </div>

        {/* Calibration Direction */}
        {calibrationDirection && (
          <div className={`flex items-center gap-2 text-sm p-3 rounded-lg ${
            calibrationDirection === 'overconfident' 
              ? 'bg-orange-500/10 text-orange-400 border border-orange-500/20' 
              : calibrationDirection === 'underconfident'
              ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
              : 'bg-neon-green/10 text-neon-green border border-neon-green/20'
          }`}>
            {calibrationDirection === 'overconfident' ? (
              <>
                <TrendingUp className="h-4 w-4" />
                <div>
                  <strong>Overconfident</strong> - Predicted probabilities tend to be higher than actual outcomes. 
                  Consider applying a small discount to estimates.
                </div>
              </>
            ) : calibrationDirection === 'underconfident' ? (
              <>
                <TrendingDown className="h-4 w-4" />
                <div>
                  <strong>Underconfident</strong> - Actual outcomes are better than predicted. 
                  Model is conservative, actual edge may be higher.
                </div>
              </>
            ) : (
              <>
                <Target className="h-4 w-4" />
                <div>
                  <strong>Well Calibrated</strong> - Predicted probabilities align well with actual outcomes.
                </div>
              </>
            )}
          </div>
        )}

        {/* Expanded Calibration Chart */}
        {isExpanded && buckets.length > 0 && (
          <div className="pt-4 border-t border-border/50">
            <CalibrationCurveChart 
              buckets={buckets} 
              brierScore={avgBrier || undefined}
              engineName="Hit Rate Engine"
            />
          </div>
        )}

        {isExpanded && buckets.length === 0 && (
          <div className="py-8 text-center text-muted-foreground border-t border-border/50">
            <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>No calibration data available yet</p>
            <p className="text-xs mt-1">Calibration data is calculated from verified outcomes</p>
          </div>
        )}

        {/* Interpretation Guide */}
        <div className="bg-muted/20 rounded-lg p-3 text-xs text-muted-foreground">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div>
              <strong>Understanding Calibration:</strong> A well-calibrated model means when it predicts 
              70% probability, the outcome should occur ~70% of the time. The closer the calibration 
              curve is to the diagonal line, the better. ECE (Expected Calibration Error) and MCE 
              (Maximum Calibration Error) measure deviation from perfect calibration.
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
