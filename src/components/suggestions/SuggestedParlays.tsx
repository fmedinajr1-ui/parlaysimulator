import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { SuggestedParlayCard } from "./SuggestedParlayCard";
import { DoubleDownSuggestion } from "./DoubleDownSuggestion";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles, RefreshCw, Lock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useSubscription } from "@/hooks/useSubscription";
import { useNavigate } from "react-router-dom";

interface SuggestedLeg {
  description: string;
  odds: number;
  impliedProbability: number;
  sport: string;
  betType: string;
  eventTime: string;
  bestBook?: string;
  lineEdge?: number;
  availableAt?: string[];
}

interface SuggestedParlay {
  id: string;
  legs: SuggestedLeg[];
  total_odds: number;
  combined_probability: number;
  suggestion_reason: string;
  sport: string;
  confidence_score: number;
  expires_at: string;
  is_hybrid?: boolean;
}

export function SuggestedParlays() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { isSubscribed, isAdmin } = useSubscription();
  const [suggestions, setSuggestions] = useState<SuggestedParlay[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);

  useEffect(() => {
    if (user && (isSubscribed || isAdmin)) {
      fetchSuggestions();
    }
  }, [user, isSubscribed, isAdmin]);

  const fetchSuggestions = async () => {
    if (!user) return;
    
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('suggested_parlays')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .gte('expires_at', new Date().toISOString())
        .order('confidence_score', { ascending: false });

      if (error) throw error;

      // Type cast the legs properly
      const typedData = (data || []).map(item => ({
        ...item,
        legs: item.legs as unknown as SuggestedLeg[],
      }));

      setSuggestions(typedData);
      setHasGenerated(typedData.length > 0);
    } catch (error) {
      console.error('Error fetching suggestions:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const generateSuggestions = async () => {
    if (!user) {
      navigate('/auth');
      return;
    }

    setIsGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-suggestions', {
        body: { userId: user.id },
      });

      if (error) throw error;

      if (data.suggestions && data.suggestions.length > 0) {
        toast({
          title: "Suggestions Generated!",
          description: `Found ${data.suggestions.length} parlays based on your betting patterns`,
        });
        await fetchSuggestions();
      } else {
        toast({
          title: "No Suggestions",
          description: data.message || "No games found. Try again later.",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('Error generating suggestions:', error);
      toast({
        title: "Error",
        description: "Failed to generate suggestions. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
      setHasGenerated(true);
    }
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
          <p className="text-muted-foreground mb-4">Sign in to get personalized parlay suggestions</p>
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
            Get AI-powered parlay suggestions based on your betting patterns and real-time odds
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
        <Button
          variant="outline"
          size="sm"
          onClick={generateSuggestions}
          disabled={isGenerating}
        >
          {isGenerating ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4" />
          )}
          {hasGenerated ? "Refresh" : "Generate"}
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : suggestions.length > 0 ? (
        <div className="space-y-4">
          {/* Double Down Pick at top */}
          <DoubleDownSuggestion suggestions={suggestions} />
          
          <div className="grid gap-4 md:grid-cols-2">
            {suggestions.map((suggestion) => (
              <SuggestedParlayCard
                key={suggestion.id}
                legs={suggestion.legs}
                totalOdds={suggestion.total_odds}
                combinedProbability={suggestion.combined_probability}
                suggestionReason={suggestion.suggestion_reason}
                sport={suggestion.sport}
                confidenceScore={suggestion.confidence_score}
                expiresAt={suggestion.expires_at}
                isHybrid={suggestion.is_hybrid}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-card/50 border border-border/50 rounded-xl p-6 text-center">
          <Sparkles className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground mb-4">
            {hasGenerated 
              ? "No suggestions available right now. Try again when more games are scheduled."
              : "Click Generate to get personalized parlay suggestions based on your betting history and live odds"
            }
          </p>
          {!hasGenerated && (
            <Button onClick={generateSuggestions} disabled={isGenerating}>
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Generate Suggestions
                </>
              )}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
