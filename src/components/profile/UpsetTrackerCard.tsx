import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { FeedCard } from '@/components/FeedCard';
import { Target, TrendingUp, Trophy, Zap, BarChart3, Sparkles, ChevronRight } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Link } from 'react-router-dom';

interface UpsetPattern {
  team: string;
  sport: string;
  totalUpsets: number;
  avgOdds: number;
  winRate: number;
  totalBets: number;
  lastUpset: string | null;
}

interface SportUpsetStats {
  sport: string;
  totalUpsets: number;
  totalBets: number;
  upsetRate: number;
  avgUpsetOdds: number;
}

interface MonthlyUpsetTrend {
  month: number;
  label: string;
  upsets: number;
  totalBets: number;
  upsetRate: number;
}

interface UpsetData {
  topTeamUpsets: UpsetPattern[];
  sportStats: SportUpsetStats[];
  monthlyTrends: MonthlyUpsetTrend[];
  summary: {
    totalBets: number;
    totalUpsets: number;
    overallUpsetRate: number;
    hasData: boolean;
  };
}

interface UpsetTrackerCardProps {
  userId: string;
}

interface QuickPrediction {
  gameId: string;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  underdog: string;
  underdogOdds: number;
  upsetScore: number;
  confidence: 'high' | 'medium' | 'low';
}

const SPORT_EMOJIS: Record<string, string> = {
  'NFL': '🏈',
  'NBA': '🏀',
  'MLB': '⚾',
  'NHL': '🏒',
  'NCAAB': '🏀',
  'NCAAF': '🏈',
  'MMA': '🥊',
  'Soccer': '⚽',
  'Tennis': '🎾',
  'Unknown': '🎯',
};

export function UpsetTrackerCard({ userId }: UpsetTrackerCardProps) {
  const [data, setData] = useState<UpsetData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [quickPredictions, setQuickPredictions] = useState<QuickPrediction[]>([]);
  const [predictionsLoading, setPredictionsLoading] = useState(true);

  useEffect(() => {
    fetchUpsetData();
    fetchQuickPredictions();
  }, [userId]);

  const fetchUpsetData = async () => {
    try {
      const { data: result, error } = await supabase.functions.invoke('upset-tracker', {
        body: { userId }
      });

      if (error) throw error;
      setData(result);
    } catch (error) {
      console.error('Error fetching upset data:', error);
      setData({
        topTeamUpsets: [],
        sportStats: [],
        monthlyTrends: [],
        summary: { totalBets: 0, totalUpsets: 0, overallUpsetRate: 0, hasData: false }
      });
    } finally {
      setIsLoading(false);
    }
  };

  const fetchQuickPredictions = async () => {
    try {
      const { data: result, error } = await supabase.functions.invoke('predict-upsets', {
        body: { userId }
      });

      if (error) throw error;
      setQuickPredictions((result.predictions || []).slice(0, 3));
    } catch (error) {
      console.error('Error fetching predictions:', error);
    } finally {
      setPredictionsLoading(false);
    }
  };

  const SPORT_EMOJIS_LOCAL: Record<string, string> = {
    'NFL': '🏈',
    'NBA': '🏀',
    'NHL': '🏒',
    'NCAAB': '🏀',
  };

  const getScoreColor = (score: number) => {
    if (score >= 60) return 'text-green-400';
    if (score >= 35) return 'text-yellow-400';
    return 'text-muted-foreground';
  };

  const formatOdds = (odds: number) => {
    return odds > 0 ? `+${odds}` : `${odds}`;
  };

  const getUpsetRateColor = (rate: number) => {
    if (rate >= 30) return 'text-green-400';
    if (rate >= 20) return 'text-yellow-400';
    if (rate >= 10) return 'text-orange-400';
    return 'text-muted-foreground';
  };

  const formatTimeAgo = (dateStr: string | null) => {
    if (!dateStr) return 'N/A';
    const date = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
    return `${Math.floor(diffDays / 30)}mo ago`;
  };

  if (isLoading) {
    return (
      <FeedCard variant="glow" className="space-y-4">
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-5" />
          <Skeleton className="h-6 w-44" />
        </div>
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-32 w-full" />
      </FeedCard>
    );
  }

  const maxMonthlyUpsets = Math.max(...(data?.monthlyTrends.map(m => m.upsets) || [1]), 1);

  return (
    <FeedCard variant="glow" className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Target className="w-5 h-5 text-orange-500" />
          <h3 className="font-display text-lg font-bold text-foreground">UPSET TRACKER</h3>
        </div>
        <Badge variant="outline" className="text-xs border-orange-500/30 text-orange-400">
          <Zap className="w-3 h-3 mr-1" />
          Underdog Wins
        </Badge>
      </div>

      {/* Today's Quick Alerts */}
      {!predictionsLoading && quickPredictions.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium text-purple-400">
              <Sparkles className="w-4 h-4" />
              <span>TODAY'S ALERTS</span>
            </div>
            <Link 
              to="/suggestions" 
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              See All <ChevronRight className="w-3 h-3" />
            </Link>
          </div>
          
          <div className="space-y-2">
            {quickPredictions.map((pred) => (
              <div 
                key={pred.gameId}
                className="flex items-center justify-between p-2 rounded-lg bg-purple-500/10 border border-purple-500/20"
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="text-sm">{SPORT_EMOJIS_LOCAL[pred.sport] || '🎯'}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-foreground truncate">
                      {pred.underdog} <span className="text-orange-400">+{pred.underdogOdds}</span>
                    </p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      vs {pred.underdog === pred.homeTeam ? pred.awayTeam : pred.homeTeam}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className={`text-lg font-bold ${getScoreColor(pred.upsetScore)}`}>
                    {pred.upsetScore}
                  </div>
                  <Badge 
                    variant="outline" 
                    className={`text-[9px] ${
                      pred.confidence === 'high' ? 'border-green-500/30 text-green-400' :
                      pred.confidence === 'medium' ? 'border-yellow-500/30 text-yellow-400' :
                      'border-gray-500/30 text-gray-400'
                    }`}
                  >
                    {pred.confidence}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="p-3 rounded-xl bg-muted/50 border border-border/50 text-center">
          <p className="text-2xl font-bold text-foreground">{data?.summary.totalUpsets || 0}</p>
          <p className="text-xs text-muted-foreground">Total Upsets</p>
        </div>
        <div className="p-3 rounded-xl bg-muted/50 border border-border/50 text-center">
          <p className={`text-2xl font-bold ${getUpsetRateColor(data?.summary.overallUpsetRate || 0)}`}>
            {data?.summary.overallUpsetRate || 0}%
          </p>
          <p className="text-xs text-muted-foreground">Upset Rate</p>
        </div>
        <div className="p-3 rounded-xl bg-muted/50 border border-border/50 text-center">
          <p className="text-2xl font-bold text-foreground">{data?.summary.totalBets || 0}</p>
          <p className="text-xs text-muted-foreground">Total Bets</p>
        </div>
      </div>

      {/* Sport Upset Stats */}
      {data?.sportStats && data.sportStats.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <BarChart3 className="w-4 h-4 text-blue-400" />
            <span>UPSETS BY SPORT</span>
          </div>
          
          <div className="grid grid-cols-2 gap-2">
            {data.sportStats.slice(0, 6).map((stat) => (
              <div 
                key={stat.sport}
                className="flex items-center justify-between p-2 rounded-lg bg-muted/30 border border-border/30"
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg">{SPORT_EMOJIS[stat.sport] || '🎯'}</span>
                  <span className="text-sm font-medium text-foreground">{stat.sport}</span>
                </div>
                <div className="text-right">
                  <p className={`text-sm font-bold ${getUpsetRateColor(stat.upsetRate)}`}>
                    {stat.upsetRate}%
                  </p>
                  <p className="text-[10px] text-muted-foreground">{stat.totalUpsets} wins</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top Upset Teams/Matchups */}
      {data?.topTeamUpsets && data.topTeamUpsets.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Trophy className="w-4 h-4 text-yellow-500" />
            <span>TOP UPSET PRODUCERS</span>
          </div>
          
          <div className="space-y-2">
            {data.topTeamUpsets.slice(0, 5).map((team, idx) => (
              <div 
                key={`${team.team}-${team.sport}-${idx}`}
                className="flex items-center justify-between p-2 rounded-lg bg-muted/30 border border-border/30"
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <div className="flex items-center justify-center w-6 h-6 rounded-full bg-orange-500/20 text-orange-400 text-xs font-bold">
                    {idx + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground truncate">{team.team}</p>
                    <p className="text-[10px] text-muted-foreground">{team.sport}</p>
                  </div>
                </div>
                <div className="text-right flex-shrink-0 ml-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px] border-green-500/30 text-green-400">
                      {formatOdds(team.avgOdds)} avg
                    </Badge>
                    <span className="text-sm font-bold text-orange-400">{team.totalUpsets}x</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">Last: {formatTimeAgo(team.lastUpset)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Monthly Upset Trend */}
      {data?.monthlyTrends && data.monthlyTrends.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <TrendingUp className="w-4 h-4 text-purple-400" />
            <span>MONTHLY UPSET TREND</span>
          </div>
          
          <div className="flex items-end gap-1 h-16">
            {data.monthlyTrends.map((month) => (
              <div 
                key={month.month} 
                className="flex-1 flex flex-col items-center gap-1"
                title={`${month.label}: ${month.upsets} upsets (${month.upsetRate}%)`}
              >
                <div 
                  className="w-full rounded-t bg-gradient-to-t from-orange-600 to-orange-400 transition-all"
                  style={{ 
                    height: `${Math.max((month.upsets / maxMonthlyUpsets) * 100, 5)}%`,
                    minHeight: month.upsets > 0 ? '8px' : '2px'
                  }}
                />
                <span className="text-[9px] text-muted-foreground">{month.label.slice(0, 1)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* No Data State */}
      {!data?.summary.hasData && (
        <div className="text-center py-6">
          <Target className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3" />
          <p className="text-sm text-muted-foreground">
            No upset data yet. Start betting on underdogs to track your upset wins!
          </p>
          <p className="text-xs text-muted-foreground/70 mt-1">
            Upsets are tracked when you win bets at +150 odds or higher
          </p>
        </div>
      )}
    </FeedCard>
  );
}
