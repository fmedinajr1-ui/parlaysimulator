import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, Target, Lock, Zap, ArrowUp, ArrowDown, Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface AccuracyStat {
  category: string;
  total_picks: number;
  verified_picks: number;
  hits: number;
  misses: number;
  hit_rate: number;
  sample_confidence: string;
}

export function MedianLockAccuracyCard() {
  const [stats, setStats] = useState<AccuracyStat[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAccuracyStats();
  }, []);

  const fetchAccuracyStats = async () => {
    try {
      const { data, error } = await supabase.rpc('get_median_lock_accuracy_stats');
      
      if (error) {
        console.error('Error fetching accuracy stats:', error);
        // Fallback to direct query if RPC not available yet
        const { data: fallbackData, error: fallbackError } = await supabase
          .from('median_lock_candidates')
          .select('classification, bet_side, outcome, parlay_grade')
          .in('classification', ['LOCK', 'STRONG'])
          .in('outcome', ['hit', 'miss']);
        
        if (!fallbackError && fallbackData) {
          const overall = fallbackData.filter(d => d.outcome);
          const locks = fallbackData.filter(d => d.classification === 'LOCK');
          const parlayGrade = fallbackData.filter(d => d.parlay_grade === true);
          const overs = fallbackData.filter(d => d.bet_side === 'OVER');
          const unders = fallbackData.filter(d => d.bet_side === 'UNDER');
          
          const calcStats = (data: typeof fallbackData, cat: string): AccuracyStat => ({
            category: cat,
            total_picks: data.length,
            verified_picks: data.length,
            hits: data.filter(d => d.outcome === 'hit').length,
            misses: data.filter(d => d.outcome === 'miss').length,
            hit_rate: data.length > 0 
              ? Math.round(data.filter(d => d.outcome === 'hit').length / data.length * 1000) / 10 
              : 0,
            sample_confidence: data.length >= 100 ? 'high' : data.length >= 30 ? 'medium' : 'low',
          });
          
          setStats([
            calcStats(overall, 'overall'),
            calcStats(parlayGrade, 'PARLAY_GRADE'),
            calcStats(locks, 'LOCK'),
            calcStats(overs, 'OVER'),
            calcStats(unders, 'UNDER'),
          ]);
        }
      } else if (data) {
        setStats(data as AccuracyStat[]);
      }
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const getHitRateColor = (rate: number) => {
    if (rate >= 65) return 'text-emerald-400';
    if (rate >= 55) return 'text-green-400';
    if (rate >= 50) return 'text-yellow-400';
    return 'text-red-400';
  };

  const getHitRateBg = (rate: number, isParlayGrade = false) => {
    if (isParlayGrade) {
      if (rate >= 65) return 'bg-emerald-500/20 border-emerald-500/50 ring-1 ring-emerald-500/30';
      if (rate >= 55) return 'bg-green-500/15 border-green-500/40';
    }
    if (rate >= 60) return 'bg-green-500/10 border-green-500/30';
    if (rate >= 50) return 'bg-yellow-500/10 border-yellow-500/30';
    return 'bg-red-500/10 border-red-500/30';
  };

  const getConfidenceBadge = (confidence: string) => {
    switch (confidence) {
      case 'high':
        return <Badge variant="outline" className="text-green-400 border-green-500/30">High Confidence</Badge>;
      case 'medium':
        return <Badge variant="outline" className="text-yellow-400 border-yellow-500/30">Medium</Badge>;
      case 'low':
        return <Badge variant="outline" className="text-orange-400 border-orange-500/30">Low Sample</Badge>;
      default:
        return <Badge variant="outline" className="text-muted-foreground">Insufficient Data</Badge>;
    }
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'overall':
        return <Target className="h-4 w-4" />;
      case 'PARLAY_GRADE':
        return <Trophy className="h-4 w-4 text-emerald-400" />;
      case 'LOCK':
        return <Lock className="h-4 w-4" />;
      case 'OVER':
        return <ArrowUp className="h-4 w-4" />;
      case 'UNDER':
        return <ArrowDown className="h-4 w-4" />;
      default:
        return <Zap className="h-4 w-4" />;
    }
  };

  if (loading) {
    return (
      <Card className="bg-gradient-to-br from-primary/5 to-primary/10 border-primary/20">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <Target className="h-5 w-5" />
            Historical Accuracy
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[1, 2, 3, 4, 5].map(i => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const overallStat = stats.find(s => s.category === 'overall');
  const parlayGradeStat = stats.find(s => s.category === 'PARLAY_GRADE');
  const lockStat = stats.find(s => s.category === 'LOCK');
  const overStat = stats.find(s => s.category === 'OVER');
  const underStat = stats.find(s => s.category === 'UNDER');

  return (
    <Card className="bg-gradient-to-br from-primary/5 to-primary/10 border-primary/20">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            Historical Accuracy
          </CardTitle>
          {overallStat && getConfidenceBadge(overallStat.sample_confidence)}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* PARLAY GRADE - Featured prominently */}
        {parlayGradeStat && parlayGradeStat.verified_picks > 0 && (
          <div className={`p-4 rounded-lg border-2 ${getHitRateBg(parlayGradeStat.hit_rate, true)}`}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Trophy className="h-5 w-5 text-emerald-400" />
                <span className="font-semibold text-emerald-400">PARLAY GRADE</span>
                <Badge variant="secondary" className="text-xs bg-emerald-500/20 text-emerald-300">
                  65-70% Target
                </Badge>
              </div>
              {getConfidenceBadge(parlayGradeStat.sample_confidence)}
            </div>
            <div className="flex items-baseline gap-3">
              <span className={`text-4xl font-bold ${getHitRateColor(parlayGradeStat.hit_rate)}`}>
                {parlayGradeStat.hit_rate?.toFixed(1)}%
              </span>
              <span className="text-sm text-muted-foreground">
                {parlayGradeStat.hits}/{parlayGradeStat.verified_picks} verified picks
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Filtered picks optimized for parlay building (UNDER rebounds/assists, sweet-spot gaps)
            </p>
          </div>
        )}
        
        {/* Other stats grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { stat: overallStat, label: 'Overall' },
            { stat: lockStat, label: 'LOCKs' },
            { stat: overStat, label: 'OVER' },
            { stat: underStat, label: 'UNDER' },
          ].filter(s => s.stat?.category).map(({ stat, label }) => (
            <div
              key={stat?.category}
              className={`p-3 rounded-lg border ${getHitRateBg(stat?.hit_rate || 0)}`}
            >
              <div className="flex items-center gap-1.5 mb-1.5">
                {getCategoryIcon(stat?.category || '')}
                <span className="text-xs font-medium text-muted-foreground">
                  {label}
                </span>
              </div>
              <div className={`text-2xl font-bold ${getHitRateColor(stat?.hit_rate || 0)}`}>
                {stat?.hit_rate?.toFixed(1) || 0}%
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {stat?.hits || 0}/{stat?.verified_picks || 0} verified
              </div>
            </div>
          ))}
        </div>
        
        {/* OVER vs UNDER comparison */}
        {overStat && underStat && (
          <div className="pt-3 border-t border-border/50">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <ArrowUp className="h-4 w-4 text-green-400" />
                <span className="text-muted-foreground">OVER:</span>
                <span className={getHitRateColor(overStat.hit_rate)}>
                  {overStat.hit_rate?.toFixed(1)}% ({overStat.verified_picks} picks)
                </span>
              </div>
              <div className="flex items-center gap-2">
                <ArrowDown className="h-4 w-4 text-blue-400" />
                <span className="text-muted-foreground">UNDER:</span>
                <span className={getHitRateColor(underStat.hit_rate)}>
                  {underStat.hit_rate?.toFixed(1)}% ({underStat.verified_picks} picks)
                </span>
              </div>
            </div>
            {underStat.hit_rate > overStat.hit_rate + 10 && (
              <div className="mt-2 text-xs text-blue-400 flex items-center gap-1">
                <TrendingUp className="h-3 w-3" />
                UNDER bets outperforming by {(underStat.hit_rate - overStat.hit_rate).toFixed(1)}%
              </div>
            )}
            {overStat.hit_rate > underStat.hit_rate + 10 && (
              <div className="mt-2 text-xs text-green-400 flex items-center gap-1">
                <TrendingUp className="h-3 w-3" />
                OVER bets outperforming by {(overStat.hit_rate - underStat.hit_rate).toFixed(1)}%
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}