import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { HomepageParlayCard } from "./HomepageParlayCard";
import { AISuggestionHistory } from "./AISuggestionHistory";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Sparkles, RefreshCw, Lock, History, Shield, Zap, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useSubscription } from "@/hooks/useSubscription";
import { useNavigate } from "react-router-dom";

interface UnifiedLeg {
  player_name: string;
  prop_type: string;
  stat_type: string;
  line: number;
  odds: number;
  direction: string;
  hit_rate: number;
  median10: number;
  median5: number;
  adjusted_median: number;
  edge: number;
  confidence_tier: string;
  defense_code: number;
  event_id: string;
  game_description: string;
  commence_time: string;
}

interface UnifiedParlay {
  id: string;
  legs: UnifiedLeg[];
  total_odds: number;
  win_probability_est: number;
  risk_label: string;
  tags: string[];
}

export function SuggestedParlays() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { isSubscribed, isAdmin } = useSubscription();
  const [parlays, setParlays] = useState<UnifiedParlay[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState<'safe' | 'high_risk'>('safe');
  const [noBetReason, setNoBetReason] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  useEffect(() => {
    if (user && (isSubscribed || isAdmin)) {
      fetchHomepageSuggestions(mode);
    }
  }, [user, isSubscribed, isAdmin]);

  const fetchHomepageSuggestions = async (selectedMode: 'safe' | 'high_risk') => {
    setIsLoading(true);
    setNoBetReason(null);
    
    try {
      const { data, error } = await supabase.functions.invoke('homepage-suggestions-engine', {
        body: { mode: selectedMode },
      });

      if (error) throw error;

      if (data?.success && data.parlays?.length > 0) {
        // Sort by win probability for deterministic display
        const sortedParlays = [...data.parlays].sort(
          (a: UnifiedParlay, b: UnifiedParlay) => b.win_probability_est - a.win_probability_est
        );
        setParlays(sortedParlays);
        setNoBetReason(null);
      } else {
        setParlays([]);
        setNoBetReason(data?.no_bet_reason || 'No qualifying plays today');
      }
    } catch (error) {
      console.error('Error fetching homepage suggestions:', error);
      setParlays([]);
      setNoBetReason('Failed to load suggestions');
      toast({
        title: "Error",
        description: "Failed to load suggestions. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
      setHasLoaded(true);
    }
  };

  const handleModeChange = (newMode: 'safe' | 'high_risk') => {
    setMode(newMode);
    fetchHomepageSuggestions(newMode);
  };

  const handleRefresh = () => {
    fetchHomepageSuggestions(mode);
  };

  // Not logged in
  if (!user) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-display text-foreground">AI SUGGESTED PARLAYS</h2>
        </div>
        <div className="bg-card/50 border border-border/50 rounded-xl p-6 text-center">
          <Lock className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground mb-4">Sign in to get AI-powered parlay suggestions</p>
          <Button onClick={() => navigate('/auth')}>Sign In</Button>
        </div>
      </div>
    );
  }

  // Not subscribed
  if (!isSubscribed && !isAdmin) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-display text-foreground">AI SUGGESTED PARLAYS</h2>
        </div>
        <div className="bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/20 rounded-xl p-6 text-center">
          <Sparkles className="w-8 h-8 text-primary mx-auto mb-3" />
          <h3 className="font-semibold text-foreground mb-2">Pro Feature</h3>
          <p className="text-muted-foreground text-sm mb-4">
            Get AI-powered parlay suggestions using unified HitRate + Median engine agreement
          </p>
          <Button onClick={() => navigate('/profile')} className="gradient-fire">
            Upgrade to Pro
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-display text-foreground">AI SUGGESTED PARLAYS</h2>
        </div>
      </div>

      <Tabs defaultValue="today" className="w-full">
        <TabsList className="grid w-full grid-cols-2 h-9 mb-4">
          <TabsTrigger value="today" className="text-xs flex items-center gap-1">
            <Sparkles className="w-3 h-3" />
            Today's Picks
          </TabsTrigger>
          <TabsTrigger value="history" className="text-xs flex items-center gap-1">
            <History className="w-3 h-3" />
            Results
          </TabsTrigger>
        </TabsList>

        <TabsContent value="today" className="space-y-4">
          {/* Mode Toggle + Refresh */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge 
                variant={mode === 'safe' ? 'default' : 'outline'} 
                onClick={() => handleModeChange('safe')}
                className={`cursor-pointer transition-all ${
                  mode === 'safe' 
                    ? 'bg-green-500/20 text-green-400 border-green-500/30 hover:bg-green-500/30' 
                    : 'hover:bg-muted'
                }`}
              >
                <Shield className="w-3 h-3 mr-1" />
                Safe AI
              </Badge>
              <Badge 
                variant={mode === 'high_risk' ? 'default' : 'outline'}
                onClick={() => handleModeChange('high_risk')}
                className={`cursor-pointer transition-all ${
                  mode === 'high_risk' 
                    ? 'bg-orange-500/20 text-orange-400 border-orange-500/30 hover:bg-orange-500/30' 
                    : 'hover:bg-muted'
                }`}
              >
                <Zap className="w-3 h-3 mr-1" />
                High Risk
              </Badge>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isLoading}
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              Refresh
            </Button>
          </div>

          {/* Mode Description */}
          <div className="text-xs text-muted-foreground">
            {mode === 'safe' 
              ? '2-leg uncorrelated parlays from different games • HitRate + Median agreement required'
              : 'Up to 3 legs allowed • Same game allowed (no same player)'
            }
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : noBetReason ? (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-6 text-center">
              <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto mb-3" />
              <h3 className="font-semibold text-foreground mb-2">No Bet Today</h3>
              <p className="text-muted-foreground text-sm mb-4">{noBetReason}</p>
              <Button variant="outline" onClick={handleRefresh}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Check Again
              </Button>
            </div>
          ) : parlays.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2">
              {parlays.map((parlay) => (
                <HomepageParlayCard
                  key={parlay.id}
                  parlay={parlay}
                />
              ))}
            </div>
          ) : hasLoaded ? (
            <div className="bg-card/50 border border-border/50 rounded-xl p-6 text-center">
              <Sparkles className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">
                No unified picks available. Check back when more games are scheduled.
              </p>
            </div>
          ) : null}
        </TabsContent>

        <TabsContent value="history">
          <AISuggestionHistory />
        </TabsContent>
      </Tabs>
    </div>
  );
}
