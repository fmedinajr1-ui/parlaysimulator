import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { FeedCard } from '@/components/FeedCard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  Target, 
  RefreshCw, 
  ChevronRight, 
  Shield, 
  CheckCircle, 
  AlertTriangle, 
  Flame,
  TrendingUp,
  Brain,
  XCircle,
  Lightbulb,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

interface AISuggestionsCardProps {
  userId: string;
}

interface VerdictSignal {
  engine: string;
  signal: string;
  confidence: number;
}

type VerdictType = 'strong_pick' | 'lean_pick' | 'hold' | 'lean_fade' | 'strong_fade';

interface Suggestion {
  id: string;
  sport: string;
  combined_probability: number;
  total_odds: number;
  suggestion_reason: string;
  confidence_score: number;
  legs: any[];
  verdict?: VerdictType | string | null;
  verdict_signals?: VerdictSignal[] | any;
  verdict_score?: number | null;
}

interface LearningInsights {
  bestPatterns: { sport: string; betType: string; winRate: number; record: string }[];
  avoidPatterns: { sport: string; betType: string; winRate: number; record: string; reason: string }[];
  totalBets: number;
  totalWins: number;
  totalLosses: number;
  overallWinRate: number;
  message: string;
}

const getRiskTier = (probability: number) => {
  if (probability >= 0.60) return { 
    label: 'Very Low (60%+)', 
    shortLabel: 'Very Low',
    color: 'bg-neon-green/20 text-neon-green border-neon-green/30', 
    icon: Shield,
    dotColor: 'bg-neon-green'
  };
  if (probability >= 0.50) return { 
    label: 'Low (50%+)', 
    shortLabel: 'Low',
    color: 'bg-primary/20 text-primary border-primary/30', 
    icon: CheckCircle,
    dotColor: 'bg-primary'
  };
  if (probability >= 0.25) return { 
    label: 'Medium (25-50%)', 
    shortLabel: 'Medium',
    color: 'bg-neon-yellow/20 text-neon-yellow border-neon-yellow/30', 
    icon: AlertTriangle,
    dotColor: 'bg-neon-yellow'
  };
  return { 
    label: 'High (<25%)', 
    shortLabel: 'High',
    color: 'bg-neon-red/20 text-neon-red border-neon-red/30', 
    icon: Flame,
    dotColor: 'bg-neon-red'
  };
};

const getVerdictConfig = (verdict?: string) => {
  switch (verdict) {
    case 'strong_pick':
      return { label: 'STRONG PICK', color: 'bg-neon-green/20 text-neon-green border-neon-green/30', icon: CheckCircle };
    case 'lean_pick':
      return { label: 'PICK', color: 'bg-primary/20 text-primary border-primary/30', icon: TrendingUp };
    case 'hold':
      return { label: 'HOLD', color: 'bg-neon-yellow/20 text-neon-yellow border-neon-yellow/30', icon: AlertTriangle };
    case 'lean_fade':
      return { label: 'LEAN FADE', color: 'bg-orange-500/20 text-orange-400 border-orange-500/30', icon: XCircle };
    case 'strong_fade':
      return { label: 'FADE', color: 'bg-neon-red/20 text-neon-red border-neon-red/30', icon: XCircle };
    default:
      return null;
  }
};

const formatOdds = (odds: number) => {
  return odds >= 0 ? `+${odds}` : odds.toString();
};

export function AISuggestionsCard({ userId }: AISuggestionsCardProps) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [learningInsights, setLearningInsights] = useState<LearningInsights | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showInsights, setShowInsights] = useState(true);

  useEffect(() => {
    fetchSuggestions();
    fetchLearningInsights();
  }, [userId]);

  const fetchSuggestions = async () => {
    try {
      const { data, error } = await supabase
        .from('suggested_parlays')
        .select('*')
        .eq('is_active', true)
        .or(`user_id.eq.${userId},user_id.is.null`)
        .order('combined_probability', { ascending: false })
        .limit(10);

      if (error) throw error;
      
      setSuggestions((data || []).map(s => ({
        ...s,
        legs: Array.isArray(s.legs) ? s.legs : []
      })));
    } catch (error) {
      console.error('Error fetching suggestions:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchLearningInsights = async () => {
    try {
      // Fetch user's betting history to calculate learning insights
      const { data, error } = await supabase
        .from('parlay_training_data')
        .select('sport, bet_type, odds, parlay_outcome')
        .eq('user_id', userId);

      if (error) throw error;

      if (data && data.length > 0) {
        const sportStats: Record<string, { wins: number; losses: number }> = {};
        const betTypeStats: Record<string, { wins: number; losses: number }> = {};
        let totalWins = 0;
        let totalLosses = 0;

        for (const leg of data) {
          if (leg.parlay_outcome !== null) {
            // Sport stats
            if (leg.sport) {
              if (!sportStats[leg.sport]) sportStats[leg.sport] = { wins: 0, losses: 0 };
              if (leg.parlay_outcome) {
                sportStats[leg.sport].wins++;
                totalWins++;
              } else {
                sportStats[leg.sport].losses++;
                totalLosses++;
              }
            }
            // Bet type stats
            if (leg.bet_type) {
              if (!betTypeStats[leg.bet_type]) betTypeStats[leg.bet_type] = { wins: 0, losses: 0 };
              if (leg.parlay_outcome) {
                betTypeStats[leg.bet_type].wins++;
              } else {
                betTypeStats[leg.bet_type].losses++;
              }
            }
          }
        }

        // Build best patterns (>50% win rate)
        const bestPatterns = Object.entries(sportStats)
          .filter(([_, stats]) => {
            const total = stats.wins + stats.losses;
            return total >= 2 && (stats.wins / total) >= 0.5;
          })
          .sort((a, b) => {
            const rateA = a[1].wins / (a[1].wins + a[1].losses);
            const rateB = b[1].wins / (b[1].wins + b[1].losses);
            return rateB - rateA;
          })
          .slice(0, 3)
          .map(([sport, stats]) => ({
            sport,
            betType: 'mixed',
            winRate: Math.round((stats.wins / (stats.wins + stats.losses)) * 100),
            record: `${stats.wins}-${stats.losses}`,
          }));

        // Build avoid patterns (<40% win rate)
        const avoidPatterns = Object.entries(sportStats)
          .filter(([_, stats]) => {
            const total = stats.wins + stats.losses;
            return total >= 2 && (stats.wins / total) < 0.4;
          })
          .sort((a, b) => {
            const rateA = a[1].wins / (a[1].wins + a[1].losses);
            const rateB = b[1].wins / (b[1].wins + b[1].losses);
            return rateA - rateB;
          })
          .slice(0, 3)
          .map(([sport, stats]) => ({
            sport,
            betType: 'mixed',
            winRate: Math.round((stats.wins / (stats.wins + stats.losses)) * 100),
            record: `${stats.wins}-${stats.losses}`,
            reason: stats.wins === 0 ? 'Zero wins' : `Only ${Math.round((stats.wins / (stats.wins + stats.losses)) * 100)}% win rate`,
          }));

        const totalBets = totalWins + totalLosses;
        setLearningInsights({
          bestPatterns,
          avoidPatterns,
          totalBets,
          totalWins,
          totalLosses,
          overallWinRate: totalBets > 0 ? Math.round((totalWins / totalBets) * 100) : 0,
          message: bestPatterns.length > 0 
            ? `Focusing on ${bestPatterns.map(p => p.sport).slice(0, 2).join(', ')}`
            : 'Building your betting profile...',
        });
      }
    } catch (error) {
      console.error('Error fetching learning insights:', error);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-suggestions', {
        body: { userId }
      });

      if (error) throw error;

      // Update learning insights from response
      if (data?.learningInsights) {
        setLearningInsights(data.learningInsights);
      }

      toast({
        title: "Suggestions refreshed!",
        description: "New AI-generated parlays are ready"
      });

      await fetchSuggestions();
    } catch (error) {
      console.error('Error generating suggestions:', error);
      toast({
        title: "Error",
        description: "Failed to generate new suggestions",
        variant: "destructive"
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  // Group suggestions by risk tier
  const tierCounts = {
    veryLow: suggestions.filter(s => s.combined_probability >= 0.60).length,
    low: suggestions.filter(s => s.combined_probability >= 0.50 && s.combined_probability < 0.60).length,
    medium: suggestions.filter(s => s.combined_probability >= 0.25 && s.combined_probability < 0.50).length,
    high: suggestions.filter(s => s.combined_probability < 0.25).length,
  };

  // Get top 3 suggestions (prioritize high probability)
  const topSuggestions = suggestions.slice(0, 3);

  if (isLoading) {
    return (
      <FeedCard>
        <div className="flex items-center justify-between mb-4">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-8 w-20" />
        </div>
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      </FeedCard>
    );
  }

  return (
    <FeedCard variant="glow">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Target className="w-5 h-5 text-primary" />
          <h3 className="font-display text-lg text-foreground">AI SUGGESTIONS</h3>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="h-8 px-2"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          </Button>
          <Link to="/suggestions">
            <Button variant="ghost" size="sm" className="h-8 px-2">
              <ChevronRight className="w-4 h-4" />
            </Button>
          </Link>
        </div>
      </div>

      {/* Learning Insights Section */}
      {learningInsights && (learningInsights.bestPatterns.length > 0 || learningInsights.avoidPatterns.length > 0) && (
        <Collapsible open={showInsights} onOpenChange={setShowInsights} className="mb-4">
          <CollapsibleTrigger asChild>
            <button className="w-full flex items-center justify-between p-3 rounded-lg bg-primary/5 border border-primary/20 hover:bg-primary/10 transition-colors">
              <div className="flex items-center gap-2">
                <Brain className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium text-foreground">AI Learning Insights</span>
                {learningInsights.totalBets > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    {learningInsights.totalBets} bets • {learningInsights.overallWinRate}% win rate
                  </Badge>
                )}
              </div>
              {showInsights ? (
                <ChevronUp className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              )}
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2">
            <div className="space-y-2 p-3 rounded-lg bg-muted/30 border border-border/50">
              {/* Best Patterns */}
              {learningInsights.bestPatterns.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1">
                    <Lightbulb className="w-3 h-3" />
                    AI is focusing on:
                  </p>
                  <div className="space-y-1">
                    {learningInsights.bestPatterns.map((pattern, idx) => (
                      <div 
                        key={idx}
                        className="flex items-center justify-between text-sm bg-neon-green/10 rounded px-2 py-1"
                      >
                        <span className="flex items-center gap-1.5">
                          <CheckCircle className="w-3 h-3 text-neon-green" />
                          <span className="text-foreground">{pattern.sport}</span>
                        </span>
                        <span className="text-xs text-neon-green font-mono">
                          {pattern.winRate}% ({pattern.record})
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Avoid Patterns */}
              {learningInsights.avoidPatterns.length > 0 && (
                <div className="mt-2">
                  <p className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    AI is avoiding:
                  </p>
                  <div className="space-y-1">
                    {learningInsights.avoidPatterns.map((pattern, idx) => (
                      <div 
                        key={idx}
                        className="flex items-center justify-between text-sm bg-neon-red/10 rounded px-2 py-1"
                      >
                        <span className="flex items-center gap-1.5">
                          <XCircle className="w-3 h-3 text-neon-red" />
                          <span className="text-foreground">{pattern.sport}</span>
                        </span>
                        <span className="text-xs text-neon-red font-mono">
                          {pattern.winRate}% ({pattern.record})
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {learningInsights.message && (
                <p className="text-xs text-muted-foreground italic mt-2 pt-2 border-t border-border/30">
                  {learningInsights.message}
                </p>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Risk Tier Badges */}
      <div className="flex flex-wrap gap-2 mb-4">
        {tierCounts.veryLow > 0 && (
          <Badge variant="outline" className="bg-neon-green/20 text-neon-green border-neon-green/30">
            <div className="w-2 h-2 rounded-full bg-neon-green mr-1.5" />
            Very Low: {tierCounts.veryLow}
          </Badge>
        )}
        {tierCounts.low > 0 && (
          <Badge variant="outline" className="bg-primary/20 text-primary border-primary/30">
            <div className="w-2 h-2 rounded-full bg-primary mr-1.5" />
            Low: {tierCounts.low}
          </Badge>
        )}
        {tierCounts.medium > 0 && (
          <Badge variant="outline" className="bg-neon-yellow/20 text-neon-yellow border-neon-yellow/30">
            <div className="w-2 h-2 rounded-full bg-neon-yellow mr-1.5" />
            Medium: {tierCounts.medium}
          </Badge>
        )}
        {tierCounts.high > 0 && (
          <Badge variant="outline" className="bg-neon-red/20 text-neon-red border-neon-red/30">
            <div className="w-2 h-2 rounded-full bg-neon-red mr-1.5" />
            High: {tierCounts.high}
          </Badge>
        )}
      </div>

      {/* No Suggestions State */}
      {suggestions.length === 0 ? (
        <div className="text-center py-6">
          <TrendingUp className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground mb-3">No active suggestions</p>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
            Generate Suggestions
          </Button>
        </div>
      ) : (
        <>
          {/* Top Suggestions */}
          <div className="space-y-3">
{topSuggestions.map((suggestion) => {
              const tier = getRiskTier(suggestion.combined_probability);
              const TierIcon = tier.icon;
              const verdictConfig = getVerdictConfig(suggestion.verdict);
              const VerdictIcon = verdictConfig?.icon;
              
              return (
                <div 
                  key={suggestion.id}
                  className={cn(
                    "bg-background/50 rounded-xl p-3 border",
                    suggestion.verdict?.includes('pick') ? "border-l-4 border-l-neon-green border-border/50" :
                    suggestion.verdict?.includes('fade') ? "border-l-4 border-l-neon-red border-border/50" :
                    "border-border/50"
                  )}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <TierIcon className={cn(
                        "w-4 h-4",
                        suggestion.combined_probability >= 0.60 ? "text-neon-green" :
                        suggestion.combined_probability >= 0.50 ? "text-primary" :
                        suggestion.combined_probability >= 0.25 ? "text-neon-yellow" : "text-neon-red"
                      )} />
                      <span className="font-mono text-lg font-bold text-foreground">
                        {(suggestion.combined_probability * 100).toFixed(1)}%
                      </span>
                      <span className="text-xs text-muted-foreground">Win Probability</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {verdictConfig && VerdictIcon && (
                        <Badge variant="outline" className={verdictConfig.color}>
                          <VerdictIcon className="w-3 h-3 mr-1" />
                          {verdictConfig.label}
                        </Badge>
                      )}
                      <Badge variant="outline" className={tier.color}>
                        {tier.shortLabel}
                      </Badge>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="capitalize">{suggestion.sport.replace(/_/g, ' ')}</span>
                    <span>•</span>
                    <span className="font-mono">{formatOdds(Math.round(suggestion.total_odds))} odds</span>
                    <span>•</span>
                    <span>{suggestion.legs.length} legs</span>
                  </div>
                  
                  {/* Verdict Signals */}
                  {suggestion.verdict_signals && suggestion.verdict_signals.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {suggestion.verdict_signals.slice(0, 3).map((signal, idx) => (
                        <Badge 
                          key={idx} 
                          variant="secondary" 
                          className={cn(
                            "text-[10px]",
                            signal.signal === 'PICK' || signal.signal === 'CONFIRMED' ? "bg-neon-green/10 text-neon-green" :
                            signal.signal === 'FADE' || signal.signal === 'TRAP_DETECTED' ? "bg-neon-red/10 text-neon-red" :
                            "bg-muted text-muted-foreground"
                          )}
                        >
                          {signal.engine}: {signal.signal}
                        </Badge>
                      ))}
                    </div>
                  )}
                  
                  {suggestion.suggestion_reason && (
                    <p className="text-xs text-muted-foreground mt-2 line-clamp-2 italic">
                      "{suggestion.suggestion_reason}"
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {/* View All Link */}
          <Link to="/suggestions" className="block mt-4">
            <Button variant="outline" className="w-full">
              View All Suggestions
              <ChevronRight className="w-4 h-4 ml-2" />
            </Button>
          </Link>
        </>
      )}
    </FeedCard>
  );
}