import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscription } from "@/hooks/useSubscription";
import { useNavigate } from "react-router-dom";
import { BottomNav } from "@/components/BottomNav";
import { SuggestionPerformanceCard } from "@/components/suggestions/SuggestionPerformanceCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { 
  Sparkles, 
  Loader2, 
  RefreshCw, 
  Lock, 
  Filter,
  TrendingUp,
  Target,
  Brain,
  ChevronRight,
  Clock,
  Flame,
  Shield,
  BarChart3
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { createLeg, simulateParlay } from "@/lib/parlay-calculator";

interface SuggestedLeg {
  description: string;
  odds: number;
  impliedProbability: number;
  sport: string;
  betType: string;
  eventTime: string;
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
  created_at: string;
}

interface UserPattern {
  favorite_sports: string[];
  favorite_bet_types: string[];
  avg_odds_range: { min: number; max: number };
  win_rate_by_sport: Record<string, number>;
}

const SPORTS = ["All", "NBA", "NFL", "NHL", "MLB", "NCAAB", "NCAAF", "Soccer"];
const CONFIDENCE_LEVELS = ["All", "High", "Medium", "Low"];

const Suggestions = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { isSubscribed, isAdmin, startCheckout } = useSubscription();
  
  const [suggestions, setSuggestions] = useState<SuggestedParlay[]>([]);
  const [filteredSuggestions, setFilteredSuggestions] = useState<SuggestedParlay[]>([]);
  const [userPattern, setUserPattern] = useState<UserPattern | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  
  // Filters
  const [sportFilter, setSportFilter] = useState("All");
  const [confidenceFilter, setConfidenceFilter] = useState("All");
  const [oddsRange, setOddsRange] = useState<[number, number]>([-500, 1000]);
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    if (user && (isSubscribed || isAdmin)) {
      fetchSuggestions();
      fetchUserPattern();
    }
  }, [user, isSubscribed, isAdmin]);

  useEffect(() => {
    applyFilters();
  }, [suggestions, sportFilter, confidenceFilter, oddsRange]);

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

      const typedData = (data || []).map(item => ({
        ...item,
        legs: item.legs as unknown as SuggestedLeg[],
      }));

      setSuggestions(typedData);
    } catch (error) {
      console.error('Error fetching suggestions:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchUserPattern = async () => {
    if (!user) return;
    
    try {
      const { data, error } = await supabase
        .from('parlay_training_data')
        .select('sport, bet_type, odds, parlay_outcome')
        .eq('user_id', user.id);

      if (error) throw error;

      if (data && data.length > 0) {
        const sportCounts: Record<string, number> = {};
        const betTypeCounts: Record<string, number> = {};
        const sportWins: Record<string, { wins: number; total: number }> = {};
        let totalOdds = 0;
        let oddsCount = 0;

        for (const leg of data) {
          if (leg.sport) {
            sportCounts[leg.sport] = (sportCounts[leg.sport] || 0) + 1;
            if (!sportWins[leg.sport]) sportWins[leg.sport] = { wins: 0, total: 0 };
            if (leg.parlay_outcome !== null) {
              sportWins[leg.sport].total++;
              if (leg.parlay_outcome) sportWins[leg.sport].wins++;
            }
          }
          if (leg.bet_type) {
            betTypeCounts[leg.bet_type] = (betTypeCounts[leg.bet_type] || 0) + 1;
          }
          if (leg.odds) {
            totalOdds += leg.odds;
            oddsCount++;
          }
        }

        const winRates: Record<string, number> = {};
        for (const [sport, stats] of Object.entries(sportWins)) {
          if (stats.total > 0) {
            winRates[sport] = stats.wins / stats.total;
          }
        }

        setUserPattern({
          favorite_sports: Object.entries(sportCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([sport]) => sport),
          favorite_bet_types: Object.entries(betTypeCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 2)
            .map(([type]) => type),
          avg_odds_range: {
            min: oddsCount > 0 ? Math.round(totalOdds / oddsCount) - 100 : -200,
            max: oddsCount > 0 ? Math.round(totalOdds / oddsCount) + 100 : 200,
          },
          win_rate_by_sport: winRates,
        });
      }
    } catch (error) {
      console.error('Error fetching user pattern:', error);
    }
  };

  const applyFilters = () => {
    let filtered = [...suggestions];

    if (sportFilter !== "All") {
      filtered = filtered.filter(s => s.sport === sportFilter);
    }

    if (confidenceFilter !== "All") {
      filtered = filtered.filter(s => {
        if (confidenceFilter === "High") return s.confidence_score >= 0.6;
        if (confidenceFilter === "Medium") return s.confidence_score >= 0.4 && s.confidence_score < 0.6;
        return s.confidence_score < 0.4;
      });
    }

    filtered = filtered.filter(s => 
      s.total_odds >= oddsRange[0] && s.total_odds <= oddsRange[1]
    );

    setFilteredSuggestions(filtered);
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
        if (data.userPattern) {
          setUserPattern(data.userPattern);
        }
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
    }
  };

  const handleAnalyze = (suggestion: SuggestedParlay) => {
    const parlayLegs = suggestion.legs.map(leg => createLeg(leg.description, leg.odds));
    const simulation = simulateParlay(parlayLegs, 10, suggestion.total_odds);
    // Pass suggested_parlay_id to track performance when user saves
    navigate('/results', { state: { simulation, suggestedParlayId: suggestion.id } });
  };

  const formatOdds = (odds: number) => odds > 0 ? `+${odds}` : odds.toString();

  const getConfidenceColor = (score: number) => {
    if (score >= 0.6) return "text-neon-green";
    if (score >= 0.4) return "text-neon-yellow";
    return "text-neon-orange";
  };

  const getConfidenceLabel = (score: number) => {
    if (score >= 0.6) return "High";
    if (score >= 0.4) return "Medium";
    return "Risky";
  };

  const formatTimeUntil = (dateString: string) => {
    const eventDate = new Date(dateString);
    const now = new Date();
    const diffMs = eventDate.getTime() - now.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    
    if (diffHours < 1) return "Starting soon";
    if (diffHours < 24) return `${diffHours}h`;
    return `${Math.floor(diffHours / 24)}d`;
  };

  // Not logged in
  if (!user) {
    return (
      <div className="min-h-screen bg-background pb-24">
        <main className="max-w-lg mx-auto px-3 py-4">
          <div className="text-center py-12">
            <Lock className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h1 className="text-xl font-display text-foreground mb-2">SIGN IN REQUIRED</h1>
            <p className="text-muted-foreground mb-6">Sign in to access AI-powered parlay suggestions</p>
            <Button onClick={() => navigate('/auth')}>Sign In</Button>
          </div>
        </main>
        <BottomNav />
      </div>
    );
  }

  // Not subscribed
  if (!isSubscribed && !isAdmin) {
    return (
      <div className="min-h-screen bg-background pb-24">
        <main className="max-w-lg mx-auto px-3 py-4">
          <div className="text-center py-8">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary/20 to-primary/10 flex items-center justify-center mx-auto mb-4">
              <Sparkles className="w-8 h-8 text-primary" />
            </div>
            <h1 className="text-2xl font-display text-foreground mb-2">AI SUGGESTIONS</h1>
            <p className="text-muted-foreground mb-6">Pro Feature</p>
          </div>

          <Card className="bg-gradient-to-br from-primary/10 to-primary/5 border-primary/20">
            <CardContent className="p-6 text-center">
              <h3 className="font-semibold text-foreground mb-3">Unlock AI-Powered Suggestions</h3>
              <ul className="text-sm text-muted-foreground space-y-2 mb-6 text-left">
                <li className="flex items-center gap-2">
                  <Target className="w-4 h-4 text-primary" />
                  Personalized based on your betting history
                </li>
                <li className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-primary" />
                  Real-time odds from major sportsbooks
                </li>
                <li className="flex items-center gap-2">
                  <Brain className="w-4 h-4 text-primary" />
                  AI pattern analysis for optimal picks
                </li>
                <li className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-primary" />
                  Confidence scoring for each suggestion
                </li>
              </ul>
              <Button onClick={startCheckout} className="w-full gradient-fire">
                Upgrade to Pro - $5/mo
              </Button>
            </CardContent>
          </Card>
        </main>
        <BottomNav />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      <main className="max-w-lg mx-auto px-3 py-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-primary" />
            <h1 className="text-xl font-display text-foreground">AI SUGGESTIONS</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFilters(!showFilters)}
            >
              <Filter className="w-4 h-4" />
            </Button>
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
            </Button>
          </div>
        </div>

        {/* AI Suggestion Performance Stats */}
        <div className="mb-4">
          <SuggestionPerformanceCard />
        </div>

        {/* User Pattern Analytics */}
        {userPattern && (
          <Card className="mb-4 bg-card/50 border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-display flex items-center gap-2">
                <Brain className="w-4 h-4 text-primary" />
                YOUR BETTING PROFILE
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-muted/30 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground mb-1">Favorite Sports</p>
                  <div className="flex flex-wrap gap-1">
                    {userPattern.favorite_sports.length > 0 ? (
                      userPattern.favorite_sports.map(sport => (
                        <Badge key={sport} variant="secondary" className="text-xs">
                          {sport}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-xs text-muted-foreground">No data yet</span>
                    )}
                  </div>
                </div>
                <div className="bg-muted/30 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground mb-1">Preferred Bet Types</p>
                  <div className="flex flex-wrap gap-1">
                    {userPattern.favorite_bet_types.length > 0 ? (
                      userPattern.favorite_bet_types.map(type => (
                        <Badge key={type} variant="secondary" className="text-xs capitalize">
                          {type.replace('_', ' ')}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-xs text-muted-foreground">No data yet</span>
                    )}
                  </div>
                </div>
              </div>

              {Object.keys(userPattern.win_rate_by_sport).length > 0 && (
                <div className="bg-muted/30 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground mb-2">Win Rate by Sport</p>
                  <div className="space-y-2">
                    {Object.entries(userPattern.win_rate_by_sport)
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 3)
                      .map(([sport, rate]) => (
                        <div key={sport} className="flex items-center justify-between">
                          <span className="text-sm">{sport}</span>
                          <div className="flex items-center gap-2">
                            <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
                              <div 
                                className={cn(
                                  "h-full rounded-full",
                                  rate >= 0.5 ? "bg-neon-green" : "bg-neon-orange"
                                )}
                                style={{ width: `${rate * 100}%` }}
                              />
                            </div>
                            <span className={cn(
                              "text-xs font-medium",
                              rate >= 0.5 ? "text-neon-green" : "text-neon-orange"
                            )}>
                              {(rate * 100).toFixed(0)}%
                            </span>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              <div className="bg-primary/5 rounded-lg p-3 border border-primary/10">
                <div className="flex items-start gap-2">
                  <BarChart3 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                  <p className="text-xs text-muted-foreground">
                    Suggestions are tailored to your betting patterns. The more you bet, the smarter the recommendations become.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Filters */}
        {showFilters && (
          <Card className="mb-4 bg-card/50 border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-display">FILTERS</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Sport</label>
                  <Select value={sportFilter} onValueChange={setSportFilter}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SPORTS.map(sport => (
                        <SelectItem key={sport} value={sport}>{sport}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Confidence</label>
                  <Select value={confidenceFilter} onValueChange={setConfidenceFilter}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CONFIDENCE_LEVELS.map(level => (
                        <SelectItem key={level} value={level}>{level}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs text-muted-foreground">Odds Range</label>
                  <span className="text-xs text-muted-foreground">
                    {formatOdds(oddsRange[0])} to {formatOdds(oddsRange[1])}
                  </span>
                </div>
                <Slider
                  value={oddsRange}
                  onValueChange={(value) => setOddsRange(value as [number, number])}
                  min={-500}
                  max={2000}
                  step={50}
                  className="w-full"
                />
              </div>

              <Button 
                variant="ghost" 
                size="sm" 
                className="w-full"
                onClick={() => {
                  setSportFilter("All");
                  setConfidenceFilter("All");
                  setOddsRange([-500, 1000]);
                }}
              >
                Reset Filters
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Suggestions */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : filteredSuggestions.length > 0 ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {filteredSuggestions.length} suggestion{filteredSuggestions.length !== 1 ? 's' : ''} found
              </p>
            </div>

            {filteredSuggestions.map((suggestion) => (
              <Card 
                key={suggestion.id} 
                className="bg-card/50 border-border/50 hover:border-primary/30 transition-all"
              >
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Flame className="w-4 h-4 text-primary" />
                      <CardTitle className="text-sm font-display">{suggestion.sport} PARLAY</CardTitle>
                    </div>
                    <Badge 
                      variant="outline" 
                      className={cn("text-xs", getConfidenceColor(suggestion.confidence_score))}
                    >
                      {getConfidenceLabel(suggestion.confidence_score)} ({(suggestion.confidence_score * 100).toFixed(0)}%)
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Legs */}
                  <div className="space-y-2">
                    {suggestion.legs.map((leg, index) => (
                      <div 
                        key={index}
                        className="flex items-center justify-between text-sm bg-muted/30 rounded-lg px-3 py-2"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-foreground truncate">{leg.description}</p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span>{leg.sport}</span>
                            <span>•</span>
                            <span className="capitalize">{leg.betType.replace('_', ' ')}</span>
                            <span>•</span>
                            <Clock className="w-3 h-3" />
                            <span>{formatTimeUntil(leg.eventTime)}</span>
                          </div>
                        </div>
                        <div className="text-right ml-2">
                          <Badge variant="secondary" className="mb-1">
                            {formatOdds(leg.odds)}
                          </Badge>
                          <p className="text-xs text-muted-foreground">
                            {(leg.impliedProbability * 100).toFixed(0)}%
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Stats */}
                  <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border/30">
                    <div className="text-center">
                      <p className="text-xs text-muted-foreground">Total Odds</p>
                      <p className="text-lg font-bold text-primary">
                        {formatOdds(suggestion.total_odds)}
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-muted-foreground">Win Prob</p>
                      <p className="text-lg font-bold">
                        {(suggestion.combined_probability * 100).toFixed(1)}%
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-muted-foreground">$10 Wins</p>
                      <p className="text-lg font-bold text-neon-green">
                        ${suggestion.total_odds > 0 
                          ? ((suggestion.total_odds / 100) * 10 + 10).toFixed(0)
                          : ((100 / Math.abs(suggestion.total_odds)) * 10 + 10).toFixed(0)
                        }
                      </p>
                    </div>
                  </div>

                  {/* Reason */}
                  <div className="bg-primary/5 rounded-lg p-3 border border-primary/10">
                    <div className="flex items-start gap-2">
                      <Brain className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs font-medium text-foreground mb-1">Why This Parlay?</p>
                        <p className="text-xs text-muted-foreground">{suggestion.suggestion_reason}</p>
                      </div>
                    </div>
                  </div>

                  {/* Action */}
                  <Button 
                    onClick={() => handleAnalyze(suggestion)}
                    className="w-full group"
                    variant="outline"
                  >
                    Run Full Analysis
                    <ChevronRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="bg-card/50 border border-border/50 rounded-xl p-8 text-center">
            <Sparkles className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="font-semibold text-foreground mb-2">No Suggestions Yet</h3>
            <p className="text-sm text-muted-foreground mb-6">
              {suggestions.length > 0 
                ? "No parlays match your current filters. Try adjusting them."
                : "Generate personalized parlay suggestions based on your betting history and real-time odds."
              }
            </p>
            {suggestions.length === 0 && (
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
      </main>
      <BottomNav />
    </div>
  );
};

export default Suggestions;
