import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, LineChart, Line, CartesianGrid } from "recharts";
import { TrendingUp, Target, ChevronDown, ChevronUp, BarChart3, Activity } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface AccuracyStats {
  total: number;
  correct: number;
  accuracy: number;
}

interface ConfidenceBucket {
  label: string;
  range: string;
  total: number;
  correct: number;
  accuracy: number;
}

interface SportAccuracy {
  sport: string;
  total: number;
  correct: number;
  accuracy: number;
}

interface DailyAccuracy {
  date: string;
  accuracy: number;
  total: number;
}

interface RecommendationAccuracy {
  recommendation: string;
  total: number;
  correct: number;
  accuracy: number;
}

export function SharpAccuracyTracker() {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | 'all'>('30d');
  
  const [overallStats, setOverallStats] = useState<AccuracyStats>({ total: 0, correct: 0, accuracy: 0 });
  const [confidenceBuckets, setConfidenceBuckets] = useState<ConfidenceBucket[]>([]);
  const [sportAccuracy, setSportAccuracy] = useState<SportAccuracy[]>([]);
  const [dailyTrend, setDailyTrend] = useState<DailyAccuracy[]>([]);
  const [recommendationAccuracy, setRecommendationAccuracy] = useState<RecommendationAccuracy[]>([]);

  useEffect(() => {
    fetchAccuracyData();
  }, [timeRange]);

  const fetchAccuracyData = async () => {
    setIsLoading(true);
    
    try {
      // Calculate date filter
      let dateFilter = new Date();
      if (timeRange === '7d') {
        dateFilter.setDate(dateFilter.getDate() - 7);
      } else if (timeRange === '30d') {
        dateFilter.setDate(dateFilter.getDate() - 30);
      } else {
        dateFilter = new Date('2020-01-01');
      }

      const { data: movements, error } = await supabase
        .from('line_movements')
        .select('authenticity_confidence, outcome_verified, outcome_correct, sport, recommendation, detected_at')
        .eq('outcome_verified', true)
        .gte('detected_at', dateFilter.toISOString())
        .order('detected_at', { ascending: false });

      if (error) throw error;

      if (!movements || movements.length === 0) {
        setOverallStats({ total: 0, correct: 0, accuracy: 0 });
        setConfidenceBuckets([]);
        setSportAccuracy([]);
        setDailyTrend([]);
        setRecommendationAccuracy([]);
        setIsLoading(false);
        return;
      }

      // Calculate overall stats
      const total = movements.length;
      const correct = movements.filter(m => m.outcome_correct === true).length;
      const accuracy = total > 0 ? (correct / total) * 100 : 0;
      setOverallStats({ total, correct, accuracy });

      // Calculate confidence buckets
      const buckets: ConfidenceBucket[] = [
        { label: '80%+', range: '80-100', total: 0, correct: 0, accuracy: 0 },
        { label: '70-79%', range: '70-79', total: 0, correct: 0, accuracy: 0 },
        { label: '60-69%', range: '60-69', total: 0, correct: 0, accuracy: 0 },
        { label: '50-59%', range: '50-59', total: 0, correct: 0, accuracy: 0 },
        { label: '<50%', range: '0-49', total: 0, correct: 0, accuracy: 0 },
      ];

      movements.forEach(m => {
        const conf = (m.authenticity_confidence || 0) * 100;
        let bucketIndex = 4;
        if (conf >= 80) bucketIndex = 0;
        else if (conf >= 70) bucketIndex = 1;
        else if (conf >= 60) bucketIndex = 2;
        else if (conf >= 50) bucketIndex = 3;
        
        buckets[bucketIndex].total++;
        if (m.outcome_correct === true) buckets[bucketIndex].correct++;
      });

      buckets.forEach(b => {
        b.accuracy = b.total > 0 ? (b.correct / b.total) * 100 : 0;
      });
      setConfidenceBuckets(buckets);

      // Calculate sport accuracy
      const sportMap = new Map<string, { total: number; correct: number }>();
      movements.forEach(m => {
        const sport = m.sport || 'unknown';
        if (!sportMap.has(sport)) {
          sportMap.set(sport, { total: 0, correct: 0 });
        }
        const stats = sportMap.get(sport)!;
        stats.total++;
        if (m.outcome_correct === true) stats.correct++;
      });

      const sportData: SportAccuracy[] = Array.from(sportMap.entries())
        .map(([sport, stats]) => ({
          sport: sport.replace('basketball_', '').replace('icehockey_', '').replace('americanfootball_', '').toUpperCase(),
          total: stats.total,
          correct: stats.correct,
          accuracy: stats.total > 0 ? (stats.correct / stats.total) * 100 : 0,
        }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 6);
      setSportAccuracy(sportData);

      // Calculate daily trend
      const dailyMap = new Map<string, { total: number; correct: number }>();
      movements.forEach(m => {
        const date = new Date(m.detected_at).toISOString().split('T')[0];
        if (!dailyMap.has(date)) {
          dailyMap.set(date, { total: 0, correct: 0 });
        }
        const stats = dailyMap.get(date)!;
        stats.total++;
        if (m.outcome_correct === true) stats.correct++;
      });

      const dailyData: DailyAccuracy[] = Array.from(dailyMap.entries())
        .map(([date, stats]) => ({
          date: new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          accuracy: stats.total > 0 ? (stats.correct / stats.total) * 100 : 0,
          total: stats.total,
        }))
        .slice(0, 14)
        .reverse();
      setDailyTrend(dailyData);

      // Calculate recommendation accuracy
      const recMap = new Map<string, { total: number; correct: number }>();
      movements.forEach(m => {
        const rec = m.recommendation || 'unknown';
        if (!recMap.has(rec)) {
          recMap.set(rec, { total: 0, correct: 0 });
        }
        const stats = recMap.get(rec)!;
        stats.total++;
        if (m.outcome_correct === true) stats.correct++;
      });

      const recData: RecommendationAccuracy[] = Array.from(recMap.entries())
        .filter(([rec]) => rec !== 'unknown')
        .map(([recommendation, stats]) => ({
          recommendation: recommendation.toUpperCase(),
          total: stats.total,
          correct: stats.correct,
          accuracy: stats.total > 0 ? (stats.correct / stats.total) * 100 : 0,
        }))
        .sort((a, b) => b.total - a.total);
      setRecommendationAccuracy(recData);

    } catch (error) {
      console.error('Error fetching accuracy data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const getAccuracyColor = (accuracy: number) => {
    if (accuracy >= 55) return 'text-neon-green';
    if (accuracy >= 45) return 'text-neon-yellow';
    return 'text-neon-red';
  };

  const getAccuracyBgColor = (accuracy: number) => {
    if (accuracy >= 55) return 'bg-neon-green';
    if (accuracy >= 45) return 'bg-neon-yellow';
    return 'bg-neon-red';
  };

  const chartConfig = {
    accuracy: {
      label: "Accuracy",
      color: "hsl(var(--primary))",
    },
  };

  if (isLoading && !isExpanded) {
    return (
      <Card className="bg-card/50 border-border/50 backdrop-blur-sm">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-8 w-8" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-6">
            <Skeleton className="h-12 w-24" />
            <Skeleton className="h-12 w-32" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card/50 border-border/50 backdrop-blur-sm overflow-hidden">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-primary" />
            Accuracy Tracker
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
            className="h-8 w-8 p-0"
          >
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </Button>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Summary Row - Always Visible */}
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Overall:</span>
            <span className={`text-lg font-bold ${getAccuracyColor(overallStats.accuracy)}`}>
              {overallStats.accuracy.toFixed(1)}%
            </span>
            <span className="text-xs text-muted-foreground">
              ({overallStats.correct}/{overallStats.total})
            </span>
          </div>
          
          {confidenceBuckets.length > 0 && confidenceBuckets[0].total > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">High Conf:</span>
              <span className={`font-bold ${getAccuracyColor(confidenceBuckets[0].accuracy)}`}>
                {confidenceBuckets[0].accuracy.toFixed(1)}%
              </span>
            </div>
          )}
          
          {/* Time Range Pills */}
          <div className="flex gap-1 ml-auto">
            {(['7d', '30d', 'all'] as const).map((range) => (
              <Button
                key={range}
                variant={timeRange === range ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setTimeRange(range)}
                className="h-6 px-2 text-xs"
              >
                {range === 'all' ? 'All' : range}
              </Button>
            ))}
          </div>
        </div>

        {/* Expanded Content */}
        {isExpanded && (
          <div className="space-y-6 pt-4 border-t border-border/50">
            {isLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-32 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : (
              <>
                {/* Confidence Level Accuracy */}
                <div className="space-y-3">
                  <h4 className="text-sm font-medium flex items-center gap-2">
                    <Target className="w-4 h-4" />
                    Accuracy by Confidence Level
                  </h4>
                  <div className="space-y-2">
                    {confidenceBuckets.map((bucket) => (
                      <div key={bucket.label} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">{bucket.label}</span>
                          <span className={`font-medium ${getAccuracyColor(bucket.accuracy)}`}>
                            {bucket.accuracy.toFixed(1)}% ({bucket.correct}/{bucket.total})
                          </span>
                        </div>
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${getAccuracyBgColor(bucket.accuracy)}`}
                            style={{ width: `${Math.min(bucket.accuracy, 100)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Sport Accuracy */}
                {sportAccuracy.length > 0 && (
                  <div className="space-y-3">
                    <h4 className="text-sm font-medium flex items-center gap-2">
                      <TrendingUp className="w-4 h-4" />
                      Accuracy by Sport
                    </h4>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {sportAccuracy.map((sport) => (
                        <div
                          key={sport.sport}
                          className="p-2 rounded-lg bg-muted/50 border border-border/50"
                        >
                          <div className="text-xs text-muted-foreground truncate">{sport.sport}</div>
                          <div className={`text-lg font-bold ${getAccuracyColor(sport.accuracy)}`}>
                            {sport.accuracy.toFixed(1)}%
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            {sport.correct}/{sport.total} picks
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recommendation Accuracy */}
                {recommendationAccuracy.length > 0 && (
                  <div className="space-y-3">
                    <h4 className="text-sm font-medium">Recommendation Reliability</h4>
                    <div className="flex gap-2 flex-wrap">
                      {recommendationAccuracy.map((rec) => (
                        <Badge
                          key={rec.recommendation}
                          variant="outline"
                          className={`${
                            rec.recommendation === 'PICK' ? 'border-neon-green/50' :
                            rec.recommendation === 'FADE' ? 'border-neon-red/50' :
                            'border-neon-yellow/50'
                          }`}
                        >
                          <span className="mr-1">{rec.recommendation}</span>
                          <span className={getAccuracyColor(rec.accuracy)}>
                            {rec.accuracy.toFixed(0)}%
                          </span>
                          <span className="text-muted-foreground ml-1">({rec.total})</span>
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Daily Trend Chart */}
                {dailyTrend.length > 0 && (
                  <div className="space-y-3">
                    <h4 className="text-sm font-medium flex items-center gap-2">
                      <Activity className="w-4 h-4" />
                      Accuracy Trend
                    </h4>
                    <ChartContainer config={chartConfig} className="h-32 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={dailyTrend}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                          <XAxis 
                            dataKey="date" 
                            tick={{ fontSize: 10 }} 
                            className="text-muted-foreground"
                          />
                          <YAxis 
                            domain={[0, 100]} 
                            tick={{ fontSize: 10 }}
                            className="text-muted-foreground"
                          />
                          <ChartTooltip content={<ChartTooltipContent />} />
                          <Line
                            type="monotone"
                            dataKey="accuracy"
                            stroke="hsl(var(--primary))"
                            strokeWidth={2}
                            dot={{ fill: "hsl(var(--primary))", r: 3 }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </ChartContainer>
                  </div>
                )}

                {overallStats.total === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    <p className="text-sm">No verified outcomes yet for this time period.</p>
                    <p className="text-xs mt-1">Outcomes are verified after games complete.</p>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
