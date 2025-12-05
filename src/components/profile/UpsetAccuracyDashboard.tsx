import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { FeedCard } from '@/components/FeedCard';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  Trophy, Target, TrendingUp, BarChart3, 
  CheckCircle2, XCircle, Clock, Zap
} from 'lucide-react';

interface AccuracyData {
  total_predictions: number;
  verified_predictions: number;
  correct_predictions: number;
  overall_accuracy: number;
  high_confidence_accuracy: number;
  medium_confidence_accuracy: number;
  low_confidence_accuracy: number;
  by_sport: { sport: string; total: number; verified: number; correct: number; accuracy: number }[];
}

interface RecentPrediction {
  id: string;
  sport: string;
  underdog: string;
  favorite: string;
  upset_score: number;
  confidence: string;
  was_upset: boolean | null;
  game_completed: boolean;
  verified_at: string | null;
}

const SPORT_EMOJIS: Record<string, string> = {
  'NFL': '🏈',
  'NBA': '🏀',
  'NHL': '🏒',
  'NCAAB': '🏀',
  'NCAAF': '🏈',
  'MLB': '⚾',
};

export function UpsetAccuracyDashboard() {
  const [accuracy, setAccuracy] = useState<AccuracyData | null>(null);
  const [recentPredictions, setRecentPredictions] = useState<RecentPrediction[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchAccuracyData();
  }, []);

  const fetchAccuracyData = async () => {
    try {
      // Fetch accuracy summary
      const { data: accuracyData, error: accuracyError } = await supabase
        .rpc('get_upset_accuracy_summary');
      
      if (accuracyError) throw accuracyError;
      if (accuracyData?.[0]) {
        const data = accuracyData[0];
        setAccuracy({
          ...data,
          by_sport: (data.by_sport as unknown as AccuracyData['by_sport']) || []
        });
      }

      // Fetch recent predictions
      const { data: recentData, error: recentError } = await supabase
        .from('upset_predictions')
        .select('id, sport, underdog, favorite, upset_score, confidence, was_upset, game_completed, verified_at')
        .order('commence_time', { ascending: false })
        .limit(10);

      if (recentError) throw recentError;
      setRecentPredictions(recentData || []);

    } catch (error) {
      console.error('Error fetching accuracy data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const getAccuracyColor = (rate: number) => {
    if (rate >= 60) return 'text-green-400';
    if (rate >= 40) return 'text-yellow-400';
    if (rate >= 20) return 'text-orange-400';
    return 'text-red-400';
  };

  const getAccuracyGradient = (rate: number) => {
    if (rate >= 60) return 'from-green-500 to-emerald-500';
    if (rate >= 40) return 'from-yellow-500 to-orange-500';
    return 'from-red-500 to-orange-500';
  };

  if (isLoading) {
    return (
      <FeedCard variant="glow" className="space-y-4">
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-5" />
          <Skeleton className="h-6 w-48" />
        </div>
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-32 w-full" />
      </FeedCard>
    );
  }

  const hasData = accuracy && accuracy.total_predictions > 0;

  return (
    <FeedCard variant="glow" className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Trophy className="w-5 h-5 text-yellow-500" />
          <h3 className="font-display text-lg font-bold text-foreground">AI ACCURACY</h3>
        </div>
        <Badge variant="outline" className="text-xs border-yellow-500/30 text-yellow-400">
          <BarChart3 className="w-3 h-3 mr-1" />
          Predictions
        </Badge>
      </div>

      {hasData ? (
        <>
          {/* Overall Accuracy */}
          <div className="p-4 rounded-xl bg-gradient-to-br from-yellow-500/10 to-orange-500/10 border border-yellow-500/20">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-muted-foreground">Overall Accuracy</span>
              <span className={`text-3xl font-bold ${getAccuracyColor(accuracy.overall_accuracy)}`}>
                {accuracy.overall_accuracy}%
              </span>
            </div>
            <Progress 
              value={accuracy.overall_accuracy} 
              className="h-2"
            />
            <div className="flex justify-between mt-2 text-xs text-muted-foreground">
              <span>{accuracy.correct_predictions} correct</span>
              <span>{accuracy.verified_predictions} verified</span>
              <span>{accuracy.total_predictions} total</span>
            </div>
          </div>

          {/* Confidence Breakdown */}
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground font-medium flex items-center gap-2">
              <Target className="w-3 h-3" /> BY CONFIDENCE LEVEL
            </p>
            <div className="grid grid-cols-3 gap-2">
              <div className="p-2 rounded-lg bg-green-500/10 border border-green-500/20 text-center">
                <p className={`text-lg font-bold ${getAccuracyColor(accuracy.high_confidence_accuracy)}`}>
                  {accuracy.high_confidence_accuracy}%
                </p>
                <p className="text-[10px] text-green-400">High (60+)</p>
              </div>
              <div className="p-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-center">
                <p className={`text-lg font-bold ${getAccuracyColor(accuracy.medium_confidence_accuracy)}`}>
                  {accuracy.medium_confidence_accuracy}%
                </p>
                <p className="text-[10px] text-yellow-400">Medium</p>
              </div>
              <div className="p-2 rounded-lg bg-gray-500/10 border border-gray-500/20 text-center">
                <p className={`text-lg font-bold ${getAccuracyColor(accuracy.low_confidence_accuracy)}`}>
                  {accuracy.low_confidence_accuracy}%
                </p>
                <p className="text-[10px] text-gray-400">Low</p>
              </div>
            </div>
          </div>

          {/* By Sport */}
          {accuracy.by_sport && accuracy.by_sport.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground font-medium flex items-center gap-2">
                <Zap className="w-3 h-3" /> BY SPORT
              </p>
              <div className="space-y-1">
                {accuracy.by_sport.map((sport) => (
                  <div 
                    key={sport.sport}
                    className="flex items-center justify-between p-2 rounded-lg bg-muted/30"
                  >
                    <div className="flex items-center gap-2">
                      <span>{SPORT_EMOJIS[sport.sport] || '🎯'}</span>
                      <span className="text-sm font-medium">{sport.sport}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground">
                        {sport.correct}/{sport.verified}
                      </span>
                      <span className={`text-sm font-bold ${getAccuracyColor(sport.accuracy)}`}>
                        {sport.accuracy}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent Predictions */}
          {recentPredictions.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground font-medium flex items-center gap-2">
                <TrendingUp className="w-3 h-3" /> RECENT PREDICTIONS
              </p>
              <div className="space-y-1">
                {recentPredictions.slice(0, 5).map((pred) => (
                  <div 
                    key={pred.id}
                    className="flex items-center justify-between p-2 rounded-lg bg-muted/30"
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="text-sm">{SPORT_EMOJIS[pred.sport] || '🎯'}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium truncate">
                          {pred.underdog} <span className="text-muted-foreground">upset?</span>
                        </p>
                        <p className="text-[10px] text-muted-foreground truncate">
                          vs {pred.favorite}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge 
                        variant="outline" 
                        className={`text-[9px] ${
                          pred.confidence === 'high' ? 'border-green-500/30 text-green-400' :
                          pred.confidence === 'medium' ? 'border-yellow-500/30 text-yellow-400' :
                          'border-gray-500/30 text-gray-400'
                        }`}
                      >
                        {pred.upset_score}
                      </Badge>
                      {pred.game_completed ? (
                        pred.was_upset ? (
                          <CheckCircle2 className="w-4 h-4 text-green-400" />
                        ) : (
                          <XCircle className="w-4 h-4 text-red-400" />
                        )
                      ) : (
                        <Clock className="w-4 h-4 text-muted-foreground" />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="text-center py-8">
          <Trophy className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3" />
          <p className="text-sm text-muted-foreground">No prediction data yet</p>
          <p className="text-xs text-muted-foreground/70 mt-1">
            Accuracy stats will appear as games complete
          </p>
        </div>
      )}
    </FeedCard>
  );
}
