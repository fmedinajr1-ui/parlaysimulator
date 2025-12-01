import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  Brain, 
  Target, 
  Clock, 
  Trophy,
  TrendingUp,
  Database,
  Loader2
} from 'lucide-react';
import { DataCollectionProgress } from './DataCollectionProgress';
import { AccuracyProjection } from './AccuracyProjection';

interface CategoryStats {
  sport: string;
  bet_type: string;
  total: number;
  settled: number;
  wins: number;
  accuracy: number;
  pending: number;
}

interface OverviewStats {
  totalSamples: number;
  settledSamples: number;
  overallAccuracy: number;
  totalWins: number;
  totalLosses: number;
  pendingOutcomes: number;
  sportsTracked: number;
  betTypesTracked: number;
}

export function AILearningDashboard() {
  const [categoryStats, setCategoryStats] = useState<CategoryStats[]>([]);
  const [overview, setOverview] = useState<OverviewStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [bestCategory, setBestCategory] = useState<CategoryStats | null>(null);

  useEffect(() => {
    fetchAIStats();
  }, []);

  const fetchAIStats = async () => {
    setIsLoading(true);
    try {
      // Fetch training data stats
      const { data: trainingData, error } = await supabase
        .from('parlay_training_data')
        .select('sport, bet_type, parlay_outcome, ai_confidence');

      if (error) throw error;

      // Process data to get category stats
      const categoryMap = new Map<string, CategoryStats>();
      
      trainingData?.forEach(item => {
        const key = `${item.sport || 'unknown'}-${item.bet_type || 'unknown'}`;
        const existing = categoryMap.get(key) || {
          sport: item.sport || 'Unknown',
          bet_type: item.bet_type || 'Unknown',
          total: 0,
          settled: 0,
          wins: 0,
          accuracy: 0,
          pending: 0
        };
        
        existing.total++;
        if (item.parlay_outcome !== null) {
          existing.settled++;
          if (item.parlay_outcome === true) {
            existing.wins++;
          }
        } else {
          existing.pending++;
        }
        
        categoryMap.set(key, existing);
      });

      // Calculate accuracy for each category
      const stats = Array.from(categoryMap.values()).map(cat => ({
        ...cat,
        accuracy: cat.settled > 0 ? (cat.wins / cat.settled) * 100 : 0
      })).sort((a, b) => b.accuracy - a.accuracy);

      setCategoryStats(stats);

      // Find best performing category with at least 5 settled
      const bestCat = stats.find(s => s.settled >= 5) || stats[0];
      setBestCategory(bestCat);

      // Calculate overview
      const totalSamples = trainingData?.length || 0;
      const settledItems = trainingData?.filter(d => d.parlay_outcome !== null) || [];
      const wins = settledItems.filter(d => d.parlay_outcome === true).length;
      const uniqueSports = new Set(trainingData?.map(d => d.sport).filter(Boolean));
      const uniqueBetTypes = new Set(trainingData?.map(d => d.bet_type).filter(Boolean));

      setOverview({
        totalSamples,
        settledSamples: settledItems.length,
        overallAccuracy: settledItems.length > 0 ? (wins / settledItems.length) * 100 : 0,
        totalWins: wins,
        totalLosses: settledItems.length - wins,
        pendingOutcomes: totalSamples - settledItems.length,
        sportsTracked: uniqueSports.size,
        betTypesTracked: uniqueBetTypes.size
      });

    } catch (err) {
      console.error('Error fetching AI stats:', err);
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

  return (
    <div className="space-y-6">
      {/* Overview Cards */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="bg-gradient-to-br from-primary/10 to-primary/5 border-primary/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Database className="w-4 h-4 text-primary" />
              <span className="text-xs text-muted-foreground uppercase tracking-wide">Total Samples</span>
            </div>
            <p className="text-3xl font-bold text-foreground">{overview?.totalSamples || 0}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {overview?.settledSamples || 0} settled ({overview?.totalSamples ? Math.round((overview.settledSamples / overview.totalSamples) * 100) : 0}%)
            </p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-chart-1/10 to-chart-1/5 border-chart-1/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Target className="w-4 h-4 text-chart-1" />
              <span className="text-xs text-muted-foreground uppercase tracking-wide">Accuracy</span>
            </div>
            <p className="text-3xl font-bold text-foreground">{(overview?.overallAccuracy ?? 0).toFixed(1)}%</p>
            <p className="text-xs text-muted-foreground mt-1">
              Target: 80%
            </p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-chart-2/10 to-chart-2/5 border-chart-2/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="w-4 h-4 text-chart-2" />
              <span className="text-xs text-muted-foreground uppercase tracking-wide">Pending</span>
            </div>
            <p className="text-3xl font-bold text-foreground">{overview?.pendingOutcomes || 0}</p>
            <p className="text-xs text-muted-foreground mt-1">
              Awaiting results
            </p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-chart-3/10 to-chart-3/5 border-chart-3/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Trophy className="w-4 h-4 text-chart-3" />
              <span className="text-xs text-muted-foreground uppercase tracking-wide">Best Category</span>
            </div>
            {bestCategory ? (
              <>
                <p className="text-lg font-bold text-foreground truncate">
                  {bestCategory.sport}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {(bestCategory.accuracy ?? 0).toFixed(0)}% ({bestCategory.wins}/{bestCategory.settled})
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No data yet</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Win/Loss Summary */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" />
            Performance Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between mb-3">
            <div className="text-center">
              <p className="text-2xl font-bold text-green-500">{overview?.totalWins || 0}</p>
              <p className="text-xs text-muted-foreground">Wins</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-red-500">{overview?.totalLosses || 0}</p>
              <p className="text-xs text-muted-foreground">Losses</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-muted-foreground">{overview?.pendingOutcomes || 0}</p>
              <p className="text-xs text-muted-foreground">Pending</p>
            </div>
          </div>
          <Progress 
            value={overview?.overallAccuracy || 0} 
            className="h-3"
          />
          <p className="text-xs text-muted-foreground mt-2 text-center">
            {(overview?.overallAccuracy ?? 0).toFixed(1)}% overall accuracy • Need 80% target
          </p>
        </CardContent>
      </Card>

      {/* Data Collection Progress */}
      <DataCollectionProgress categories={categoryStats} />

      {/* Accuracy Projection */}
      <AccuracyProjection 
        categories={categoryStats}
        currentAccuracy={overview?.overallAccuracy || 0}
        totalSamples={overview?.totalSamples || 0}
      />

      {/* Category Breakdown */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Brain className="w-4 h-4 text-primary" />
            Learning by Category
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {categoryStats.slice(0, 10).map((cat, idx) => (
            <div key={idx} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{cat.sport}</span>
                  <Badge variant="outline" className="text-xs">
                    {cat.bet_type}
                  </Badge>
                </div>
                <span className={`font-bold ${
                  (cat.accuracy ?? 0) >= 80 ? 'text-green-500' :
                  (cat.accuracy ?? 0) >= 60 ? 'text-yellow-500' :
                  'text-muted-foreground'
                }`}>
                  {(cat.accuracy ?? 0).toFixed(0)}%
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Progress 
                  value={Math.min(cat.accuracy / 80 * 100, 100)} 
                  className="h-2 flex-1"
                />
                <span className="text-xs text-muted-foreground w-16 text-right">
                  {cat.wins}/{cat.settled}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {cat.total} samples • {cat.pending} pending
              </p>
            </div>
          ))}
          
          {categoryStats.length === 0 && (
            <p className="text-center text-muted-foreground py-4">
              No training data yet. Upload parlays to start training!
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
