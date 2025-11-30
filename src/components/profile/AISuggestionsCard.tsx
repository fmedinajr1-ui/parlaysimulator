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
  TrendingUp
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';

interface AISuggestionsCardProps {
  userId: string;
}

interface Suggestion {
  id: string;
  sport: string;
  combined_probability: number;
  total_odds: number;
  suggestion_reason: string;
  confidence_score: number;
  legs: any[];
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

const formatOdds = (odds: number) => {
  return odds >= 0 ? `+${odds}` : odds.toString();
};

export function AISuggestionsCard({ userId }: AISuggestionsCardProps) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    fetchSuggestions();
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

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const { error } = await supabase.functions.invoke('generate-suggestions', {
        body: { userId }
      });

      if (error) throw error;

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
              
              return (
                <div 
                  key={suggestion.id}
                  className="bg-background/50 rounded-xl p-3 border border-border/50"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <TierIcon className="w-4 h-4" style={{ color: `hsl(var(--${tier.dotColor.replace('bg-', '')}))` }} />
                      <span className="font-mono text-lg font-bold text-foreground">
                        {(suggestion.combined_probability * 100).toFixed(1)}%
                      </span>
                      <span className="text-xs text-muted-foreground">Win Probability</span>
                    </div>
                    <Badge variant="outline" className={tier.color}>
                      {tier.shortLabel}
                    </Badge>
                  </div>
                  
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="capitalize">{suggestion.sport.replace(/_/g, ' ')}</span>
                    <span>•</span>
                    <span className="font-mono">{formatOdds(Math.round(suggestion.total_odds))} odds</span>
                    <span>•</span>
                    <span>{suggestion.legs.length} legs</span>
                  </div>
                  
                  {suggestion.suggestion_reason && (
                    <p className="text-xs text-muted-foreground mt-2 line-clamp-1 italic">
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
