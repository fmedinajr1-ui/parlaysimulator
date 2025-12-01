import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscription } from "@/hooks/useSubscription";
import { useNavigate } from "react-router-dom";
import { BottomNav } from "@/components/BottomNav";
import { SuggestionPerformanceCard } from "@/components/suggestions/SuggestionPerformanceCard";
import { SuggestionHistoryFeed } from "@/components/suggestions/SuggestionHistoryFeed";
import { StrategyPerformanceCard } from "@/components/suggestions/StrategyPerformanceCard";
import { CalibrationDashboard } from "@/components/results/CalibrationDashboard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  BarChart3,
  History,
  User,
  Layers,
  CheckCircle,
  XCircle,
  Lightbulb,
  AlertTriangle,
  Zap,
  ThumbsUp,
  ThumbsDown
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
  winning_sports?: string[];
  losing_sports?: string[];
  sport_records?: Record<string, { wins: number; losses: number; rate: number }>;
  bet_type_records?: Record<string, { wins: number; losses: number; rate: number }>;
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

// Sport groups for filtering
const SPORT_GROUPS = {
  "All": [],
  "Football": ["NFL", "NCAAF"],
  "Basketball": ["NBA", "NCAAB"],
  "Hockey": ["NHL"],
  "Baseball": ["MLB"],
  "Soccer": ["Soccer"],
};

const SPORTS = ["All", "Football", "Basketball", "Hockey", "Baseball", "Soccer", "NFL", "NBA", "NHL", "MLB", "NCAAB", "NCAAF"];
const RISK_LEVELS = ["All", "Very Low (60%+)", "Low (50%+)", "Medium", "High"];
const BET_TYPES = ["All", "Moneyline", "Spreads", "Totals", "Player Props"];
const LEG_COUNTS = [
  { label: "Any", value: "any" },
  { label: "3 legs", value: "3" },
  { label: "4 legs", value: "4" },
  { label: "5 legs", value: "5" },
  { label: "6 legs", value: "6" },
  { label: "3-4 legs", value: "3-4" },
  { label: "5-6 legs", value: "5-6" },
];

const Suggestions = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { isSubscribed, isAdmin, startCheckout } = useSubscription();
  
  const [suggestions, setSuggestions] = useState<SuggestedParlay[]>([]);
  const [filteredSuggestions, setFilteredSuggestions] = useState<SuggestedParlay[]>([]);
  const [userPattern, setUserPattern] = useState<UserPattern | null>(null);
  const [learningInsights, setLearningInsights] = useState<LearningInsights | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeTab, setActiveTab] = useState("suggestions");
  
  // Filters - Default to Low Risk for best suggestions first
  const [sportFilter, setSportFilter] = useState("All");
  const [riskFilter, setRiskFilter] = useState("Low (50%+)");
  const [betTypeFilter, setBetTypeFilter] = useState("All");
  const [legCountFilter, setLegCountFilter] = useState("any");
  const [oddsRange, setOddsRange] = useState<[number, number]>([-500, 2000]);
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    if (user && (isSubscribed || isAdmin)) {
      fetchSuggestions();
      fetchUserPattern();
      fetchLearningInsights();
    }
  }, [user, isSubscribed, isAdmin]);

  useEffect(() => {
    applyFilters();
  }, [suggestions, sportFilter, riskFilter, betTypeFilter, legCountFilter, oddsRange]);

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

  const fetchLearningInsights = async () => {
    if (!user) return;
    
    try {
      const { data, error } = await supabase
        .from('parlay_training_data')
        .select('sport, bet_type, odds, parlay_outcome')
        .eq('user_id', user.id);

      if (error) throw error;

      if (data && data.length > 0) {
        const sportStats: Record<string, { wins: number; losses: number }> = {};
        let totalWins = 0;
        let totalLosses = 0;

        for (const leg of data) {
          if (leg.parlay_outcome !== null) {
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

  const applyFilters = () => {
    let filtered = [...suggestions];

    // Sport filter (including groups)
    if (sportFilter !== "All") {
      const sportGroup = SPORT_GROUPS[sportFilter as keyof typeof SPORT_GROUPS];
      if (sportGroup && sportGroup.length > 0) {
        // It's a sport group
        filtered = filtered.filter(s => 
          sportGroup.includes(s.sport) || 
          s.legs.some(leg => sportGroup.includes(leg.sport))
        );
      } else {
        // Individual sport
        filtered = filtered.filter(s => 
          s.sport === sportFilter || 
          s.legs.some(leg => leg.sport === sportFilter)
        );
      }
    }

    // Risk filter (based on combined probability)
    if (riskFilter !== "All") {
      filtered = filtered.filter(s => {
        const prob = s.combined_probability;
        if (riskFilter === "Very Low (60%+)") return prob >= 0.60; // 60%+ win probability (highest confidence)
        if (riskFilter === "Low (50%+)") return prob >= 0.50; // 50%+ win probability (high confidence)
        if (riskFilter === "Medium") return prob >= 0.25 && prob < 0.50; // 25-50%
        return prob < 0.25; // High risk: <25%
      });
    }

    // Bet type filter
    if (betTypeFilter !== "All") {
      const betTypeMap: Record<string, string[]> = {
        "Moneyline": ["moneyline", "h2h"],
        "Spreads": ["spread", "spreads"],
        "Totals": ["total", "totals", "over", "under"],
        "Player Props": ["player_points", "player_rebounds", "player_assists", "player_pass_tds", "player_rush_yds", "player_goals", "player_prop"],
      };
      const targetTypes = betTypeMap[betTypeFilter] || [];
      filtered = filtered.filter(s => 
        s.legs.some(leg => 
          targetTypes.some(t => leg.betType?.toLowerCase().includes(t))
        )
      );
    }

    // Leg count filter
    if (legCountFilter !== "any") {
      if (legCountFilter.includes("-")) {
        const [min, max] = legCountFilter.split("-").map(Number);
        filtered = filtered.filter(s => s.legs.length >= min && s.legs.length <= max);
      } else {
        const exactCount = parseInt(legCountFilter);
        filtered = filtered.filter(s => s.legs.length === exactCount);
      }
    }

    // Odds range filter
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
        if (data.learningInsights) {
          setLearningInsights(data.learningInsights);
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

  const getRiskLabel = (prob: number) => {
    if (prob >= 0.25) return { label: "Low Risk", color: "text-neon-green bg-neon-green/10" };
    if (prob >= 0.10) return { label: "Medium", color: "text-neon-yellow bg-neon-yellow/10" };
    return { label: "High Risk", color: "text-neon-orange bg-neon-orange/10" };
  };

  const getBetTypeBadge = (betType: string) => {
    const type = betType?.toLowerCase() || '';
    if (type.includes('player') || type.includes('prop')) return { label: "Player Prop", icon: User };
    if (type.includes('spread')) return { label: "Spread", icon: Target };
    if (type.includes('total') || type.includes('over') || type.includes('under')) return { label: "Total", icon: Layers };
    return { label: "Moneyline", icon: TrendingUp };
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

  const resetFilters = () => {
    setSportFilter("All");
    setRiskFilter("Low (50%+)"); // Keep Low Risk as default
    setBetTypeFilter("All");
    setLegCountFilter("any");
    setOddsRange([-500, 2000]);
  };

  const activeFilterCount = [
    sportFilter !== "All",
    riskFilter !== "All",
    betTypeFilter !== "All",
    legCountFilter !== "any",
    oddsRange[0] !== -500 || oddsRange[1] !== 2000,
  ].filter(Boolean).length;

  // Not logged in
  if (!user) {
    return (
      <div className="min-h-dvh bg-background pb-nav-safe overflow-x-safe">
        <main className="max-w-lg mx-auto px-3 py-4">
          <div className="text-center py-12">
            <Lock className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h1 className="text-xl font-display text-foreground mb-2">SIGN IN REQUIRED</h1>
            <p className="text-muted-foreground mb-6">Sign in to access AI-powered parlay suggestions</p>
            <Button onClick={() => navigate('/auth')} className="touch-target-lg">Sign In</Button>
          </div>
        </main>
        <BottomNav />
      </div>
    );
  }

  // Not subscribed
  if (!isSubscribed && !isAdmin) {
    return (
      <div className="min-h-dvh bg-background pb-nav-safe overflow-x-safe">
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
              <Button onClick={startCheckout} className="w-full gradient-fire touch-target-lg">
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
    <div className="min-h-dvh bg-background pb-nav-safe overflow-x-safe">
      <main className="max-w-lg mx-auto px-3 py-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-primary" />
            <h1 className="text-xl font-display text-foreground">AI SUGGESTIONS</h1>
          </div>
          <div className="flex items-center gap-2">
            {(activeTab === "suggestions" || activeTab === "sharp-props") && (
              <>
                {activeTab === "suggestions" && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowFilters(!showFilters)}
                    className={cn(activeFilterCount > 0 && "border-primary")}
                  >
                    <Filter className="w-4 h-4" />
                    {activeFilterCount > 0 && (
                      <Badge variant="secondary" className="ml-1 h-5 w-5 p-0 text-xs">
                        {activeFilterCount}
                      </Badge>
                    )}
                  </Button>
                )}
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
              </>
            )}
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-4">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="suggestions" className="flex items-center gap-1 text-xs">
              <Sparkles className="w-3 h-3" />
              All
            </TabsTrigger>
            <TabsTrigger value="sharp-props" className="flex items-center gap-1 text-xs">
              <Zap className="w-3 h-3" />
              Sharp Props
            </TabsTrigger>
            <TabsTrigger value="history" className="flex items-center gap-1 text-xs">
              <History className="w-3 h-3" />
              History
            </TabsTrigger>
          </TabsList>

          <TabsContent value="suggestions" className="mt-4 space-y-4">
            {/* AI Suggestion Performance Stats */}
            <SuggestionPerformanceCard />

            {/* AI Calibration Dashboard */}
            <CalibrationDashboard compact />

            {/* AI Learning Insights Banner */}
            {learningInsights && (learningInsights.bestPatterns.length > 0 || learningInsights.avoidPatterns.length > 0) && (
              <Card className="bg-gradient-to-br from-primary/10 to-primary/5 border-primary/20">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-display flex items-center gap-2">
                    <Lightbulb className="w-4 h-4 text-primary" />
                    AI LEARNING INSIGHTS
                    <Badge variant="secondary" className="text-xs ml-auto">
                      {learningInsights.totalBets} bets • {learningInsights.overallWinRate}% win rate
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Best Patterns */}
                  {learningInsights.bestPatterns.length > 0 && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                        <CheckCircle className="w-3 h-3 text-neon-green" />
                        AI is focusing on (your winning patterns):
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {learningInsights.bestPatterns.map((pattern, idx) => (
                          <Badge 
                            key={idx} 
                            variant="outline" 
                            className="bg-neon-green/10 text-neon-green border-neon-green/30"
                          >
                            {pattern.sport} ({pattern.winRate}% • {pattern.record})
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Avoid Patterns */}
                  {learningInsights.avoidPatterns.length > 0 && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                        <XCircle className="w-3 h-3 text-neon-red" />
                        AI is avoiding (learned from losses):
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {learningInsights.avoidPatterns.map((pattern, idx) => (
                          <Badge 
                            key={idx} 
                            variant="outline" 
                            className="bg-neon-red/10 text-neon-red border-neon-red/30"
                          >
                            {pattern.sport} ({pattern.winRate}% • {pattern.record})
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {learningInsights.message && (
                    <div className="flex items-start gap-2 p-2 rounded bg-muted/30 border border-border/30">
                      <Brain className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                      <p className="text-xs text-muted-foreground italic">
                        {learningInsights.message}
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* User Pattern Analytics */}
            {userPattern && (
              <Card className="bg-card/50 border-border/50">
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

            {/* Enhanced Filters */}
            {showFilters && (
              <Card className="bg-card/50 border-border/50">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-display">FILTERS</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Sport & Risk Row */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">Sport</label>
                      <Select value={sportFilter} onValueChange={setSportFilter}>
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="All">All Sports</SelectItem>
                          <SelectItem value="Football">🏈 Football (NFL/NCAAF)</SelectItem>
                          <SelectItem value="Basketball">🏀 Basketball (NBA/NCAAB)</SelectItem>
                          <SelectItem value="Hockey">🏒 Hockey (NHL)</SelectItem>
                          <SelectItem value="Baseball">⚾ Baseball (MLB)</SelectItem>
                          <SelectItem value="Soccer">⚽ Soccer</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">Risk Level</label>
                      <Select value={riskFilter} onValueChange={setRiskFilter}>
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="All">All Risks</SelectItem>
                          <SelectItem value="Low">🟢 Low (25%+ prob)</SelectItem>
                          <SelectItem value="Medium">🟡 Medium (10-25%)</SelectItem>
                          <SelectItem value="High">🔴 High (&lt;10%)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Bet Type & Leg Count Row */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">Bet Type</label>
                      <Select value={betTypeFilter} onValueChange={setBetTypeFilter}>
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {BET_TYPES.map(type => (
                            <SelectItem key={type} value={type}>{type}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">Leg Count</label>
                      <Select value={legCountFilter} onValueChange={setLegCountFilter}>
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {LEG_COUNTS.map(opt => (
                            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Odds Range */}
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
                      max={5000}
                      step={50}
                      className="w-full"
                    />
                  </div>

                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="w-full"
                    onClick={resetFilters}
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

                {filteredSuggestions.map((suggestion) => {
                  const riskInfo = getRiskLabel(suggestion.combined_probability);
                  return (
                    <Card 
                      key={suggestion.id} 
                      className="bg-card/50 border-border/50 hover:border-primary/30 transition-all"
                    >
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Flame className="w-4 h-4 text-primary" />
                            <CardTitle className="text-sm font-display">{suggestion.sport} PARLAY</CardTitle>
                            <Badge variant="outline" className="text-xs">
                              {suggestion.legs.length} legs
                            </Badge>
                          </div>
                          <div className="flex items-center gap-1">
                            <Badge 
                              variant="outline" 
                              className={cn("text-xs", riskInfo.color)}
                            >
                              {riskInfo.label}
                            </Badge>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {/* Legs */}
                        <div className="space-y-2">
                          {suggestion.legs.map((leg, index) => {
                            const betBadge = getBetTypeBadge(leg.betType);
                            const BetIcon = betBadge.icon;
                            return (
                              <div 
                                key={index}
                                className="flex items-center justify-between text-sm bg-muted/30 rounded-lg px-3 py-2"
                              >
                                <div className="flex-1 min-w-0">
                                  <p className="text-foreground truncate">{leg.description}</p>
                                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                                    <span>{leg.sport}</span>
                                    <span>•</span>
                                    <div className="flex items-center gap-1">
                                      <BetIcon className="w-3 h-3" />
                                      <span>{betBadge.label}</span>
                                    </div>
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
                            );
                          })}
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
                  );
                })}
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
          </TabsContent>

          {/* Sharp Props Tab */}
          <TabsContent value="sharp-props" className="mt-4 space-y-4">
            {/* Sharp Props Header */}
            <Card className="bg-gradient-to-br from-orange-500/10 to-yellow-500/10 border-orange-500/30">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-orange-500/20 flex items-center justify-center">
                    <Zap className="w-5 h-5 text-orange-500" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground">Sharp Money Analysis</h3>
                    <p className="text-xs text-muted-foreground">
                      AI-verified real vs fake sharp movements with pick/fade recommendations
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Sharp Props Parlays */}
            {(() => {
              // Filter for verified real sharp parlays
              const verifiedSharpParlays = suggestions.filter(s => 
                s.suggestion_reason.toLowerCase().includes('verified sharp') ||
                s.suggestion_reason.toLowerCase().includes('✅')
              );
              
              // Filter for sharp money parlays with player props
              const sharpPropsParlays = suggestions.filter(s => {
                const isSharpParlay = s.suggestion_reason.toLowerCase().includes('sharp') && 
                                     !s.suggestion_reason.toLowerCase().includes('fade');
                const hasPlayerProps = s.legs.some(leg => 
                  leg.betType?.toLowerCase().includes('player') || 
                  leg.betType?.toLowerCase().includes('prop')
                );
                return isSharpParlay || hasPlayerProps;
              });
              
              // Filter for fade parlays
              const fadeParlays = suggestions.filter(s => 
                s.suggestion_reason.toLowerCase().includes('fade') ||
                s.suggestion_reason.toLowerCase().includes('🚨')
              );

              if (isLoading) {
                return (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                  </div>
                );
              }

              const hasAnySharp = sharpPropsParlays.length > 0 || fadeParlays.length > 0;

              if (!hasAnySharp) {
                return (
                  <Card className="bg-card/50 border-border/50">
                    <CardContent className="p-8 text-center">
                      <Zap className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                      <h3 className="font-semibold text-foreground mb-2">No Sharp Analysis Available</h3>
                      <p className="text-sm text-muted-foreground mb-6">
                        Sharp money parlays and fade recommendations will appear here when detected. Generate new suggestions to find the latest sharp action.
                      </p>
                      <Button onClick={generateSuggestions} disabled={isGenerating}>
                        {isGenerating ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Scanning...
                          </>
                        ) : (
                          <>
                            <Zap className="w-4 h-4 mr-2" />
                            Find Sharp Action
                          </>
                        )}
                      </Button>
                    </CardContent>
                  </Card>
                );
              }

              return (
                <div className="space-y-6">
                  {/* Verified Real Sharp Section */}
                  {verifiedSharpParlays.length > 0 && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <CheckCircle className="w-4 h-4 text-green-500" />
                        <h4 className="font-semibold text-sm text-green-500">VERIFIED REAL SHARP ({verifiedSharpParlays.length})</h4>
                        <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/30 text-xs">
                          <ThumbsUp className="w-3 h-3 mr-1" />
                          PICK
                        </Badge>
                      </div>
                      
                      {verifiedSharpParlays.map((suggestion) => {
                        const riskInfo = getRiskLabel(suggestion.combined_probability);
                        return (
                          <Card 
                            key={suggestion.id} 
                            className="bg-gradient-to-br from-green-500/5 to-emerald-500/5 border-2 border-green-500/30 hover:border-green-500/50 transition-all"
                          >
                            <CardHeader className="pb-2">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <CheckCircle className="w-4 h-4 text-green-500" />
                                  <CardTitle className="text-sm font-display text-green-500">VERIFIED SHARP</CardTitle>
                                  <Badge variant="outline" className="text-xs">
                                    {suggestion.legs.length} legs
                                  </Badge>
                                </div>
                                <Badge variant="outline" className={cn("text-xs", riskInfo.color)}>
                                  {riskInfo.label}
                                </Badge>
                              </div>
                            </CardHeader>
                            <CardContent className="space-y-3">
                              <div className="space-y-2">
                                {suggestion.legs.map((leg, index) => (
                                  <div key={index} className="flex items-center justify-between text-sm bg-green-500/10 rounded-lg px-3 py-2">
                                    <div className="flex-1 min-w-0">
                                      <p className="text-foreground truncate">{leg.description}</p>
                                      <p className="text-xs text-muted-foreground">{leg.sport}</p>
                                    </div>
                                    <Badge variant="secondary">{formatOdds(leg.odds)}</Badge>
                                  </div>
                                ))}
                              </div>
                              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border/30">
                                <div className="text-center">
                                  <p className="text-xs text-muted-foreground">Total Odds</p>
                                  <p className="text-lg font-bold text-green-500">{formatOdds(suggestion.total_odds)}</p>
                                </div>
                                <div className="text-center">
                                  <p className="text-xs text-muted-foreground">Win Prob</p>
                                  <p className="text-lg font-bold">{(suggestion.combined_probability * 100).toFixed(1)}%</p>
                                </div>
                                <div className="text-center">
                                  <p className="text-xs text-muted-foreground">$10 Wins</p>
                                  <p className="text-lg font-bold text-neon-green">
                                    ${suggestion.total_odds > 0 
                                      ? ((suggestion.total_odds / 100) * 10 + 10).toFixed(0)
                                      : ((100 / Math.abs(suggestion.total_odds)) * 10 + 10).toFixed(0)}
                                  </p>
                                </div>
                              </div>
                              <div className="bg-green-500/5 border border-green-500/20 rounded-lg p-3">
                                <p className="text-xs text-muted-foreground">{suggestion.suggestion_reason}</p>
                              </div>
                              <Button onClick={() => handleAnalyze(suggestion)} className="w-full bg-green-500 hover:bg-green-600">
                                Analyze Verified Sharp <ChevronRight className="w-4 h-4 ml-1" />
                              </Button>
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  )}
                  
                  {/* Fade Parlays Section */}
                  {fadeParlays.length > 0 && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <XCircle className="w-4 h-4 text-red-500" />
                        <h4 className="font-semibold text-sm text-red-500">FADE PARLAYS ({fadeParlays.length})</h4>
                        <Badge variant="outline" className="bg-red-500/10 text-red-500 border-red-500/30 text-xs">
                          <ThumbsDown className="w-3 h-3 mr-1" />
                          BET AGAINST TRAPS
                        </Badge>
                      </div>
                      
                      {fadeParlays.map((suggestion) => {
                        const riskInfo = getRiskLabel(suggestion.combined_probability);
                        return (
                          <Card 
                            key={suggestion.id} 
                            className="bg-gradient-to-br from-red-500/5 to-orange-500/5 border-2 border-red-500/30 hover:border-red-500/50 transition-all"
                          >
                            <CardHeader className="pb-2">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <ThumbsDown className="w-4 h-4 text-red-500" />
                                  <CardTitle className="text-sm font-display text-red-500">FADE PARLAY</CardTitle>
                                  <Badge variant="outline" className="text-xs">
                                    {suggestion.legs.length} legs
                                  </Badge>
                                </div>
                                <Badge variant="outline" className={cn("text-xs", riskInfo.color)}>
                                  {riskInfo.label}
                                </Badge>
                              </div>
                            </CardHeader>
                            <CardContent className="space-y-3">
                              <div className="space-y-2">
                                {suggestion.legs.map((leg, index) => (
                                  <div key={index} className="flex items-center justify-between text-sm bg-red-500/10 rounded-lg px-3 py-2">
                                    <div className="flex-1 min-w-0">
                                      <p className="text-foreground truncate">{leg.description}</p>
                                      <p className="text-xs text-muted-foreground">{leg.sport}</p>
                                    </div>
                                    <Badge variant="secondary">{formatOdds(leg.odds)}</Badge>
                                  </div>
                                ))}
                              </div>
                              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border/30">
                                <div className="text-center">
                                  <p className="text-xs text-muted-foreground">Total Odds</p>
                                  <p className="text-lg font-bold text-red-500">{formatOdds(suggestion.total_odds)}</p>
                                </div>
                                <div className="text-center">
                                  <p className="text-xs text-muted-foreground">Win Prob</p>
                                  <p className="text-lg font-bold">{(suggestion.combined_probability * 100).toFixed(1)}%</p>
                                </div>
                                <div className="text-center">
                                  <p className="text-xs text-muted-foreground">$10 Wins</p>
                                  <p className="text-lg font-bold text-neon-green">
                                    ${suggestion.total_odds > 0 
                                      ? ((suggestion.total_odds / 100) * 10 + 10).toFixed(0)
                                      : ((100 / Math.abs(suggestion.total_odds)) * 10 + 10).toFixed(0)}
                                  </p>
                                </div>
                              </div>
                              <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-3">
                                <div className="flex items-start gap-2">
                                  <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                                  <p className="text-xs text-muted-foreground">{suggestion.suggestion_reason}</p>
                                </div>
                              </div>
                              <Button onClick={() => handleAnalyze(suggestion)} className="w-full bg-red-500 hover:bg-red-600">
                                Analyze Fade Parlay <ChevronRight className="w-4 h-4 ml-1" />
                              </Button>
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  )}

                  {/* Other Sharp Props Parlays */}
                  {sharpPropsParlays.filter(s => 
                    !s.suggestion_reason.toLowerCase().includes('verified') && 
                    !s.suggestion_reason.toLowerCase().includes('fade') &&
                    !s.suggestion_reason.includes('✅') &&
                    !s.suggestion_reason.includes('🚨')
                  ).length > 0 && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <Zap className="w-4 h-4 text-orange-500" />
                        <h4 className="font-semibold text-sm text-orange-500">SHARP PROPS</h4>
                      </div>
                      
                      {sharpPropsParlays.filter(s => 
                        !s.suggestion_reason.toLowerCase().includes('verified') && 
                        !s.suggestion_reason.toLowerCase().includes('fade') &&
                        !s.suggestion_reason.includes('✅') &&
                        !s.suggestion_reason.includes('🚨')
                      ).map((suggestion) => {
                        const riskInfo = getRiskLabel(suggestion.combined_probability);
                        const propLegsCount = suggestion.legs.filter(leg => 
                          leg.betType?.toLowerCase().includes('player') || 
                          leg.betType?.toLowerCase().includes('prop')
                        ).length;

                        return (
                          <Card 
                            key={suggestion.id} 
                            className="bg-gradient-to-br from-orange-500/5 to-yellow-500/5 border-2 border-orange-500/30 hover:border-orange-500/50 transition-all"
                          >
                            <CardHeader className="pb-2">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <Zap className="w-4 h-4 text-orange-500" />
                                  <CardTitle className="text-sm font-display">SHARP PROPS PARLAY</CardTitle>
                                  <Badge variant="outline" className="text-xs">
                                    {suggestion.legs.length} legs
                                  </Badge>
                                  {propLegsCount > 0 && (
                                    <Badge variant="secondary" className="text-xs bg-primary/10 text-primary">
                                      {propLegsCount} prop{propLegsCount > 1 ? 's' : ''}
                                    </Badge>
                                  )}
                                </div>
                                <Badge variant="outline" className={cn("text-xs", riskInfo.color)}>
                                  {riskInfo.label}
                                </Badge>
                              </div>
                            </CardHeader>
                            <CardContent className="space-y-3">
                              <div className="space-y-2">
                                {suggestion.legs.map((leg, index) => {
                                  const isPropLeg = leg.betType?.toLowerCase().includes('player') || 
                                                   leg.betType?.toLowerCase().includes('prop');
                                  return (
                                    <div 
                                      key={index}
                                      className={cn(
                                        "flex items-center justify-between text-sm rounded-lg px-3 py-2",
                                        isPropLeg ? "bg-primary/10 border border-primary/20" : "bg-muted/30"
                                      )}
                                    >
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                          {isPropLeg && <User className="w-3 h-3 text-primary" />}
                                          <p className="text-foreground truncate">{leg.description}</p>
                                        </div>
                                        <p className="text-xs text-muted-foreground">{leg.sport}</p>
                                      </div>
                                      <Badge variant="secondary">{formatOdds(leg.odds)}</Badge>
                                    </div>
                                  );
                                })}
                              </div>
                              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border/30">
                                <div className="text-center">
                                  <p className="text-xs text-muted-foreground">Total Odds</p>
                                  <p className="text-lg font-bold text-orange-500">{formatOdds(suggestion.total_odds)}</p>
                                </div>
                                <div className="text-center">
                                  <p className="text-xs text-muted-foreground">Win Prob</p>
                                  <p className="text-lg font-bold">{(suggestion.combined_probability * 100).toFixed(1)}%</p>
                                </div>
                                <div className="text-center">
                                  <p className="text-xs text-muted-foreground">$10 Wins</p>
                                  <p className="text-lg font-bold text-neon-green">
                                    ${suggestion.total_odds > 0 
                                      ? ((suggestion.total_odds / 100) * 10 + 10).toFixed(0)
                                      : ((100 / Math.abs(suggestion.total_odds)) * 10 + 10).toFixed(0)}
                                  </p>
                                </div>
                              </div>
                              <div className="bg-orange-500/5 border border-orange-500/20 rounded-lg p-3">
                                <p className="text-xs text-muted-foreground">{suggestion.suggestion_reason}</p>
                              </div>
                              <Button onClick={() => handleAnalyze(suggestion)} className="w-full bg-orange-500 hover:bg-orange-600">
                                Analyze Sharp Parlay <ChevronRight className="w-4 h-4 ml-1" />
                              </Button>
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}
          </TabsContent>

          <TabsContent value="history" className="mt-4 space-y-4">
            <StrategyPerformanceCard />
            <SuggestionHistoryFeed />
          </TabsContent>
        </Tabs>
      </main>
      <BottomNav />
    </div>
  );
};

export default Suggestions;
