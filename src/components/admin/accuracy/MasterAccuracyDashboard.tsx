import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { AccuracyGradeCard } from './AccuracyGradeCard';
import { CategoryBreakdown } from './CategoryBreakdown';
import { AccuracyRecommendations } from './AccuracyRecommendations';
import { 
  AccuracyData, 
  TrendData,
  calculateCompositeScore, 
  CompositeScore 
} from '@/lib/accuracy-calculator';

export function MasterAccuracyDashboard() {
  const [isLoading, setIsLoading] = useState(true);
  const [compositeScore, setCompositeScore] = useState<CompositeScore | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    fetchAccuracyData();
  }, []);

  const fetchAccuracyData = async () => {
    setIsLoading(true);
    try {
      // Fetch both accuracy stats and trends in parallel
      const [statsResult, trendsResult] = await Promise.all([
        supabase.rpc('get_unified_accuracy_stats'),
        supabase.rpc('get_accuracy_trends')
      ]);

      if (statsResult.error) {
        console.error('Error fetching accuracy stats:', statsResult.error);
        toast({
          title: "Error",
          description: "Failed to load accuracy data",
          variant: "destructive"
        });
        return;
      }

      // Process trends data
      const trends: TrendData[] = (trendsResult.data || []).map((item: Record<string, unknown>) => ({
        category: item.category as string,
        current_period_accuracy: Number(item.current_period_accuracy),
        current_period_verified: item.current_period_verified as number,
        previous_period_accuracy: Number(item.previous_period_accuracy),
        previous_period_verified: item.previous_period_verified as number,
        trend_direction: item.trend_direction as string,
        trend_change: Number(item.trend_change)
      }));

      if (statsResult.data && statsResult.data.length > 0) {
        const typedData: AccuracyData[] = statsResult.data.map((item: Record<string, unknown>) => ({
          category: item.category as string,
          subcategory: item.subcategory as string,
          total_predictions: item.total_predictions as number,
          verified_predictions: item.verified_predictions as number,
          correct_predictions: item.correct_predictions as number,
          accuracy_rate: Number(item.accuracy_rate),
          sample_confidence: item.sample_confidence as string
        }));

        const score = calculateCompositeScore(typedData, trends);
        setCompositeScore(score);
      } else {
        setCompositeScore({
          overallGrade: 'N/A',
          overallAccuracy: 0,
          totalVerified: 0,
          gradeColor: 'text-muted-foreground',
          categories: [],
          bestPerformers: [],
          worstPerformers: [],
          recommendations: [],
          trends: [],
          overallTrend: { direction: 'stable', change: 0 }
        });
      }
    } catch (err) {
      console.error('Exception fetching accuracy data:', err);
      toast({
        title: "Error",
        description: "Failed to load accuracy data",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!compositeScore) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No accuracy data available
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with refresh */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-display text-foreground">PARLAY FARM AI ACCURACY</h2>
          <p className="text-sm text-muted-foreground">
            Unified accuracy rating across all prediction systems
          </p>
        </div>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={fetchAccuracyData}
          disabled={isLoading}
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Main Grade Card */}
      <AccuracyGradeCard 
        grade={compositeScore.overallGrade}
        accuracy={compositeScore.overallAccuracy}
        totalVerified={compositeScore.totalVerified}
        gradeColor={compositeScore.gradeColor}
        overallTrend={compositeScore.overallTrend}
      />

      {/* Category Breakdown */}
      <CategoryBreakdown 
        categories={compositeScore.categories} 
        trends={compositeScore.trends}
      />

      {/* Recommendations */}
      <AccuracyRecommendations 
        recommendations={compositeScore.recommendations}
        bestPerformers={compositeScore.bestPerformers}
        worstPerformers={compositeScore.worstPerformers}
      />
    </div>
  );
}
