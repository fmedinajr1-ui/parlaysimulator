import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { FeedCard } from '@/components/FeedCard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  Loader2, RefreshCw, Sparkles, Target, TrendingUp, 
  AlertTriangle, Zap, Clock, ChevronDown, ChevronUp,
  BarChart3, Calendar
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface UpsetSignal {
  type: 'sharp_money' | 'line_movement' | 'historical_pattern' | 'trap_alert' | 'day_pattern';
  description: string;
  weight: number;
}

interface UpsetPrediction {
  gameId: string;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  underdog: string;
  underdogOdds: number;
  favorite: string;
  favoriteOdds: number;
  commenceTime: string;
  upsetScore: number;
  signals: UpsetSignal[];
  aiReasoning: string | null;
  confidence: 'high' | 'medium' | 'low';
}

interface PredictionSummary {
  totalGames: number;
  highUpsetPotential: number;
  mediumUpsetPotential: number;
  lowUpsetPotential: number;
  sportBreakdown: { sport: string; count: number }[];
}

interface TodaysUpsetPredictionsProps {
  userId: string;
}

const SPORT_EMOJIS: Record<string, string> = {
  'NFL': '🏈',
  'NBA': '🏀',
  'MLB': '⚾',
  'NHL': '🏒',
  'NCAAB': '🏀',
  'NCAAF': '🏈',
};

const SIGNAL_ICONS: Record<string, { icon: React.ReactNode; color: string }> = {
  'sharp_money': { icon: <Target className="w-3 h-3" />, color: 'bg-green-500/20 text-green-400 border-green-500/30' },
  'line_movement': { icon: <TrendingUp className="w-3 h-3" />, color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  'historical_pattern': { icon: <BarChart3 className="w-3 h-3" />, color: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
  'trap_alert': { icon: <AlertTriangle className="w-3 h-3" />, color: 'bg-orange-500/20 text-orange-400 border-orange-500/30' },
  'day_pattern': { icon: <Calendar className="w-3 h-3" />, color: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30' },
};

export function TodaysUpsetPredictions({ userId }: TodaysUpsetPredictionsProps) {
  const [predictions, setPredictions] = useState<UpsetPrediction[]>([]);
  const [summary, setSummary] = useState<PredictionSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [expandedGame, setExpandedGame] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    fetchPredictions();
  }, [userId]);

  const fetchPredictions = async (showRefresh = false) => {
    if (showRefresh) setIsRefreshing(true);
    
    try {
      const { data, error } = await supabase.functions.invoke('predict-upsets', {
        body: { userId }
      });

      if (error) throw error;
      
      setPredictions(data.predictions || []);
      setSummary(data.summary || null);
    } catch (error) {
      console.error('Error fetching predictions:', error);
      toast({
        title: "Error",
        description: "Failed to load upset predictions",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  const formatOdds = (odds: number) => odds > 0 ? `+${odds}` : `${odds}`;
  
  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  const getScoreColor = (score: number) => {
    if (score >= 60) return 'from-green-500 to-emerald-500';
    if (score >= 35) return 'from-yellow-500 to-orange-500';
    return 'from-gray-500 to-gray-600';
  };

  const getScoreTextColor = (score: number) => {
    if (score >= 60) return 'text-green-400';
    if (score >= 35) return 'text-yellow-400';
    return 'text-muted-foreground';
  };

  const getConfidenceBadge = (confidence: string) => {
    switch (confidence) {
      case 'high':
        return <Badge className="bg-green-500/20 text-green-400 border-green-500/30">High Confidence</Badge>;
      case 'medium':
        return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">Medium</Badge>;
      default:
        return <Badge className="bg-gray-500/20 text-gray-400 border-gray-500/30">Low</Badge>;
    }
  };

  if (isLoading) {
    return (
      <FeedCard variant="glow" className="space-y-4">
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-5" />
          <Skeleton className="h-6 w-48" />
        </div>
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </FeedCard>
    );
  }

  return (
    <FeedCard variant="glow" className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-purple-500" />
          <h3 className="font-display text-lg font-bold text-foreground">TODAY'S UPSET WATCH</h3>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs border-purple-500/30 text-purple-400">
            {predictions.length} Games
          </Badge>
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-8 w-8"
            onClick={() => fetchPredictions(true)}
            disabled={isRefreshing}
          >
            {isRefreshing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Summary Stats */}
      {summary && summary.totalGames > 0 && (
        <div className="grid grid-cols-3 gap-2">
          <div className="p-3 rounded-xl bg-green-500/10 border border-green-500/20 text-center">
            <p className="text-2xl font-bold text-green-400">{summary.highUpsetPotential}</p>
            <p className="text-[10px] text-green-400/70">High Potential</p>
          </div>
          <div className="p-3 rounded-xl bg-yellow-500/10 border border-yellow-500/20 text-center">
            <p className="text-2xl font-bold text-yellow-400">{summary.mediumUpsetPotential}</p>
            <p className="text-[10px] text-yellow-400/70">Medium</p>
          </div>
          <div className="p-3 rounded-xl bg-muted/50 border border-border/50 text-center">
            <p className="text-2xl font-bold text-muted-foreground">{summary.lowUpsetPotential}</p>
            <p className="text-[10px] text-muted-foreground">Low</p>
          </div>
        </div>
      )}

      {/* Sport Breakdown */}
      {summary && summary.sportBreakdown.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {summary.sportBreakdown.map(({ sport, count }) => (
            <Badge 
              key={sport} 
              variant="outline" 
              className="text-xs border-border/50"
            >
              {SPORT_EMOJIS[sport] || '🎯'} {sport}: {count}
            </Badge>
          ))}
        </div>
      )}

      {/* Predictions List */}
      {predictions.length > 0 ? (
        <div className="space-y-3">
          {predictions.map((prediction) => (
            <div 
              key={prediction.gameId}
              className="rounded-xl bg-card/60 border border-border/30 overflow-hidden"
            >
              {/* Game Header */}
              <div 
                className="p-3 cursor-pointer"
                onClick={() => setExpandedGame(expandedGame === prediction.gameId ? null : prediction.gameId)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    {/* Sport & Time */}
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm">{SPORT_EMOJIS[prediction.sport] || '🎯'}</span>
                      <span className="text-xs text-muted-foreground">{prediction.sport}</span>
                      <span className="text-xs text-muted-foreground">•</span>
                      <Clock className="w-3 h-3 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">{formatTime(prediction.commenceTime)}</span>
                    </div>
                    
                    {/* Matchup */}
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-medium ${prediction.underdog === prediction.awayTeam ? 'text-orange-400' : 'text-foreground'}`}>
                          {prediction.awayTeam}
                        </span>
                        {prediction.underdog === prediction.awayTeam && (
                          <Badge className="text-[9px] px-1.5 py-0 bg-orange-500/20 text-orange-400 border-orange-500/30">
                            DOG {formatOdds(prediction.underdogOdds)}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">@</span>
                        <span className={`text-sm font-medium ${prediction.underdog === prediction.homeTeam ? 'text-orange-400' : 'text-foreground'}`}>
                          {prediction.homeTeam}
                        </span>
                        {prediction.underdog === prediction.homeTeam && (
                          <Badge className="text-[9px] px-1.5 py-0 bg-orange-500/20 text-orange-400 border-orange-500/30">
                            DOG {formatOdds(prediction.underdogOdds)}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Upset Score */}
                  <div className="flex flex-col items-end gap-1">
                    <div className={`text-2xl font-bold ${getScoreTextColor(prediction.upsetScore)}`}>
                      {prediction.upsetScore}
                    </div>
                    <div className="w-16">
                      <Progress 
                        value={prediction.upsetScore} 
                        className="h-1.5"
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      {expandedGame === prediction.gameId ? (
                        <ChevronUp className="w-3 h-3 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="w-3 h-3 text-muted-foreground" />
                      )}
                    </div>
                  </div>
                </div>

                {/* Signal Badges (always visible) */}
                <div className="flex flex-wrap gap-1 mt-2">
                  {prediction.signals.slice(0, 3).map((signal, idx) => (
                    <Badge 
                      key={idx}
                      variant="outline"
                      className={`text-[10px] px-1.5 py-0 ${SIGNAL_ICONS[signal.type]?.color || ''}`}
                    >
                      {SIGNAL_ICONS[signal.type]?.icon}
                      <span className="ml-1">{signal.type.replace('_', ' ')}</span>
                    </Badge>
                  ))}
                  {prediction.signals.length > 3 && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                      +{prediction.signals.length - 3} more
                    </Badge>
                  )}
                </div>
              </div>

              {/* Expanded Details */}
              {expandedGame === prediction.gameId && (
                <div className="px-3 pb-3 pt-0 space-y-3 border-t border-border/30">
                  {/* Confidence */}
                  <div className="flex items-center justify-between pt-2">
                    <span className="text-xs text-muted-foreground">Confidence Level</span>
                    {getConfidenceBadge(prediction.confidence)}
                  </div>

                  {/* All Signals */}
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground font-medium">Upset Signals:</p>
                    {prediction.signals.map((signal, idx) => (
                      <div 
                        key={idx}
                        className="flex items-center justify-between p-2 rounded-lg bg-muted/30"
                      >
                        <div className="flex items-center gap-2">
                          <div className={`p-1 rounded ${SIGNAL_ICONS[signal.type]?.color || 'bg-muted'}`}>
                            {SIGNAL_ICONS[signal.type]?.icon}
                          </div>
                          <span className="text-xs text-foreground">{signal.description}</span>
                        </div>
                        <Badge variant="outline" className="text-[10px]">
                          +{Math.round(signal.weight)} pts
                        </Badge>
                      </div>
                    ))}
                  </div>

                  {/* AI Reasoning */}
                  {prediction.aiReasoning && (
                    <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/20">
                      <div className="flex items-center gap-2 mb-2">
                        <Sparkles className="w-3 h-3 text-purple-400" />
                        <span className="text-xs font-medium text-purple-400">AI Analysis</span>
                      </div>
                      <p className="text-xs text-foreground/90">{prediction.aiReasoning}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-8">
          <Target className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3" />
          <p className="text-sm text-muted-foreground">No games scheduled today</p>
          <p className="text-xs text-muted-foreground/70 mt-1">
            Check back later for upset predictions
          </p>
        </div>
      )}
    </FeedCard>
  );
}
