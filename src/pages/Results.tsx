import { useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState, useMemo } from "react";
import { ProbabilityCard } from "@/components/results/ProbabilityCard";
import { TrashTalkThread } from "@/components/results/TrashTalkThread";
import { SimulationHighlights } from "@/components/results/SimulationHighlights";
import { BankrollCard } from "@/components/results/BankrollCard";
import { LegBreakdown } from "@/components/results/LegBreakdown";
import { ShareableMeme } from "@/components/results/ShareableMeme";
import { LegBreakdownScorecard } from "@/components/results/LegBreakdownScorecard";
import { LegIntelligenceCard } from "@/components/results/LegIntelligenceCard";

import { BookEdgeCard } from "@/components/results/BookEdgeCard";
import { HistoricalInsightsCard } from "@/components/results/HistoricalInsightsCard";
import { HistoricalComparisonCard } from "@/components/results/HistoricalComparisonCard";
import { CelebrationEffect } from "@/components/results/CelebrationEffect";
import { TrapAvoidanceCard } from "@/components/results/TrapAvoidanceCard";
import { ParlayHealthCard } from "@/components/results/ParlayHealthCard";
import { ParlayOptimizer } from "@/components/results/ParlayOptimizer";
import { SmartLegSwapCard } from "@/components/results/SmartLegSwapCard";
import { FatigueImpactCard } from "@/components/results/FatigueImpactCard";
import { UsageAnalysisSection } from "@/components/results/UsageAnalysisSection";
import { DoubleDownCard } from "@/components/results/DoubleDownCard";
import { KellyStakeCard } from "@/components/results/KellyStakeCard";
import { VarianceWarningCard } from "@/components/results/VarianceWarningCard";
import { EnsembleConsensusCard } from "@/components/results/EnsembleConsensusCard";
import { CoachingInsightsCard } from "@/components/results/CoachingInsightsCard";
import { CollapsibleSection } from "@/components/results/CollapsibleSection";
import { ConsolidatedVerdictCard } from "@/components/results/ConsolidatedVerdictCard";
import { SafeComponent } from "@/components/results/ComponentErrorBoundary";
import { Button } from "@/components/ui/button";
import { ArrowLeft, RotateCcw, Save, Loader2, LogIn, BarChart3, Zap, FileText } from "lucide-react";
import { ParlaySimulation, ParlayAnalysis, LegAnalysis } from "@/types/parlay";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";

const Results = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const simulation = location.state?.simulation as ParlaySimulation | undefined;
  const extractedGameTime = location.state?.extractedGameTime as string | undefined;
  const suggestedParlayId = location.state?.suggestedParlayId as string | undefined;
  const [aiRoasts, setAiRoasts] = useState<string[] | null>(null);
  const [isLoadingRoasts, setIsLoadingRoasts] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  
  // AI Analysis state
  const [aiAnalysis, setAiAnalysis] = useState<ParlayAnalysis | null>(null);
  const [isLoadingAnalysis, setIsLoadingAnalysis] = useState(true);
  
  // Historical context state
  const [historicalContext, setHistoricalContext] = useState<{
    legContexts: any[];
    userOverall: { totalBets: number; totalWins: number; hitRate: string | number };
    aiOverall: { totalPredictions: number; correctPredictions: number; accuracy: string | number };
  } | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);

  useEffect(() => {
    if (!simulation) {
      navigate('/upload');
    }
  }, [simulation, navigate]);

  // Fetch AI-generated roasts
  useEffect(() => {
    if (!simulation) return;

    const fetchRoasts = async () => {
      setIsLoadingRoasts(true);
      try {
        const { data, error } = await supabase.functions.invoke('generate-roasts', {
          body: {
            legs: simulation.legs.map(leg => ({
              description: leg.description,
              odds: leg.odds,
              impliedProbability: leg.impliedProbability,
            })),
            probability: simulation.combinedProbability,
            degenerateLevel: simulation.degenerateLevel,
            stake: simulation.stake,
            potentialPayout: simulation.potentialPayout,
          }
        });

        if (error) {
          console.error('Error fetching roasts:', error);
          // Fall back to static roasts
          setAiRoasts(null);
        } else if (data?.roasts && Array.isArray(data.roasts)) {
          setAiRoasts(data.roasts);
        } else {
          setAiRoasts(null);
        }
      } catch (err) {
        console.error('Failed to fetch AI roasts:', err);
        setAiRoasts(null);
      } finally {
        setIsLoadingRoasts(false);
      }
    };

    fetchRoasts();
  }, [simulation]);

  // Fetch AI-powered leg analysis
  useEffect(() => {
    if (!simulation) return;

    const fetchAnalysis = async () => {
      setIsLoadingAnalysis(true);
      try {
        const { data, error } = await supabase.functions.invoke('analyze-parlay', {
          body: {
            legs: simulation.legs.map(leg => ({
              description: leg.description,
              odds: leg.odds,
              impliedProbability: leg.impliedProbability,
            })),
            stake: simulation.stake,
            combinedProbability: simulation.combinedProbability,
            userId: user?.id, // Pass user ID for historical context
          }
        });

        if (error) {
          console.error('Error fetching analysis:', error);
          if (error.message?.includes('429') || error.message?.includes('Rate limit')) {
            toast({
              title: "Rate limited",
              description: "Too many requests. Analysis will retry shortly.",
              variant: "destructive",
            });
          }
          setAiAnalysis(null);
        } else if (data?.error) {
          console.error('Analysis error:', data.error);
          setAiAnalysis(null);
        } else if (data?.legAnalyses) {
          setAiAnalysis(data as ParlayAnalysis);
        } else {
          setAiAnalysis(null);
        }
      } catch (err) {
        console.error('Failed to fetch AI analysis:', err);
        setAiAnalysis(null);
      } finally {
        setIsLoadingAnalysis(false);
      }
    };

    fetchAnalysis();
  }, [simulation]);

  // Fetch historical context
  useEffect(() => {
    if (!simulation || !user) {
      setIsLoadingHistory(false);
      return;
    }

    const fetchHistory = async () => {
      setIsLoadingHistory(true);
      try {
        const { data, error } = await supabase.functions.invoke('ai-learning-engine', {
          body: {
            action: 'get_historical_context',
            userId: user.id,
            legs: simulation.legs.map(leg => ({
              description: leg.description,
              sport: leg.aiAnalysis?.sport,
              betType: leg.aiAnalysis?.betType
            }))
          }
        });

        if (error) {
          console.error('Error fetching historical context:', error);
        } else if (data) {
          setHistoricalContext({
            legContexts: data.legContexts || [],
            userOverall: data.userOverall || { totalBets: 0, totalWins: 0, hitRate: 0 },
            aiOverall: data.aiOverall || { totalPredictions: 0, correctPredictions: 0, accuracy: 0 }
          });
        }
      } catch (err) {
        console.error('Failed to fetch historical context:', err);
      } finally {
        setIsLoadingHistory(false);
      }
    };

    fetchHistory();
  }, [simulation, user]);

  if (!simulation) {
    return null;
  }

  // Use AI roasts if available, otherwise fall back to static ones
  const displayRoasts = aiRoasts || simulation.trashTalk;

  const handleSaveParlay = async () => {
    if (!user) {
      navigate('/auth');
      return;
    }

    // Force refresh session to ensure it's valid
    const { data: { session }, error: sessionError } = await supabase.auth.refreshSession();
    if (sessionError || !session) {
      console.error('Session error:', sessionError);
      toast({
        title: "Session expired",
        description: "Please log in again to save your parlay.",
        variant: "destructive"
      });
      navigate('/auth');
      return;
    }

    setIsSaving(true);
    try {
      // Calculate degen score for this parlay (inverse of probability * 100)
      const degenScore = Math.min(100, (1 - simulation.combinedProbability) * 100);

      console.log('Saving parlay for user:', session.user.id);

      // Parse extracted game time to ISO timestamp
      let eventStartTime: string | null = null;
      if (extractedGameTime) {
        try {
          // Try to parse common date formats from betting slips
          const parsed = new Date(extractedGameTime);
          if (!isNaN(parsed.getTime())) {
            eventStartTime = parsed.toISOString();
            console.log('Parsed game time:', eventStartTime);
          }
        } catch (e) {
          console.error('Failed to parse game time:', e);
        }
      }

      const { data: parlayData, error } = await supabase.from('parlay_history').insert({
        user_id: session.user.id, // Use fresh session user ID
        legs: simulation.legs.map(leg => ({
          description: leg.description,
          odds: leg.odds
        })),
        stake: simulation.stake,
        potential_payout: simulation.potentialPayout,
        combined_probability: simulation.combinedProbability,
        degenerate_level: simulation.degenerateLevel,
        ai_roasts: aiRoasts,
        event_start_time: eventStartTime,
        suggested_parlay_id: suggestedParlayId || null
      }).select().single();

      if (error) {
        console.error('Parlay save error:', JSON.stringify(error, null, 2));
        throw error;
      }

      console.log('Parlay saved successfully:', parlayData.id);

      // Save training data for each leg with AI analysis
      if (parlayData) {
        const trainingData = simulation.legs.map((leg, idx) => {
          const legAnalysis = aiAnalysis?.legAnalyses?.find(la => la.legIndex === idx);
          const isCorrelated = aiAnalysis?.correlatedLegs?.some(
            cl => cl.indices.includes(idx)
          );
          
          // Log AI analysis data being captured
          console.log(`Leg ${idx} AI data:`, {
            sport: legAnalysis?.sport,
            betType: legAnalysis?.betType,
            confidence: legAnalysis?.confidenceLevel,
            adjustedProb: legAnalysis?.adjustedProbability
          });
          
          return {
            parlay_history_id: parlayData.id,
            user_id: session.user.id,
            leg_index: idx,
            description: leg.description,
            odds: leg.odds,
            implied_probability: leg.impliedProbability,
            sport: legAnalysis?.sport || null,
            bet_type: legAnalysis?.betType || null,
            team: legAnalysis?.team || null,
            player: legAnalysis?.player || null,
            ai_adjusted_probability: legAnalysis?.adjustedProbability || null,
            ai_confidence: legAnalysis?.confidenceLevel || null,
            ai_trend_direction: legAnalysis?.trendDirection || null,
            vegas_juice: legAnalysis?.vegasJuice || null,
            is_correlated: isCorrelated || false
          };
        });

        const { error: trainingError } = await supabase
          .from('parlay_training_data')
          .insert(trainingData);

        if (trainingError) {
          console.error('Training data save error:', JSON.stringify(trainingError, null, 2));
        } else {
          console.log('Training data saved with AI analysis:', trainingData.length, 'legs');
        }

        // Track suggestion performance if this came from an AI suggestion
        if (suggestedParlayId) {
          const { error: perfError } = await supabase
            .from('suggestion_performance')
            .insert({
              suggested_parlay_id: suggestedParlayId,
              user_id: session.user.id,
              parlay_history_id: parlayData.id,
              was_followed: true,
              stake: simulation.stake,
              outcome: null // Will be updated when parlay is settled
            });

          if (perfError) {
            console.error('Suggestion performance tracking error:', perfError);
          } else {
            console.log('Suggestion performance tracked for:', suggestedParlayId);
          }
        }
      }

      // Update profile stats
      const { data: profile } = await supabase
        .from('profiles')
        .select('total_staked, lifetime_degenerate_score')
        .eq('user_id', session.user.id)
        .single();

      if (profile) {
        const currentStaked = Number(profile.total_staked);
        const currentDegenScore = Number(profile.lifetime_degenerate_score);
        // Running average of degen score
        const newDegenScore = currentStaked > 0 
          ? ((currentDegenScore * currentStaked) + (degenScore * simulation.stake)) / (currentStaked + simulation.stake)
          : degenScore;

        await supabase
          .from('profiles')
          .update({
            total_staked: currentStaked + simulation.stake,
            lifetime_degenerate_score: newDegenScore
          })
          .eq('user_id', session.user.id);
      }

      setIsSaved(true);
      toast({
        title: "Parlay saved! 🔥",
        description: `Saved ${simulation.legs.length} legs for AI learning.`
      });
    } catch (error: any) {
      console.error('Save failed:', error);
      toast({
        title: "Save failed",
        description: error.message || "Please try again",
        variant: "destructive"
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-dvh bg-background pb-nav-safe touch-pan-y overflow-x-safe">
      <main className="max-w-lg mx-auto px-3 py-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <Link to="/upload">
            <Button variant="ghost" size="default" className="min-w-[44px]">
              <ArrowLeft className="w-5 h-5" />
              Back
            </Button>
          </Link>
          <h1 className="font-display text-xl text-foreground">YOUR RESULTS</h1>
          <Link to="/upload">
            <Button variant="ghost" size="default" className="min-w-[44px]">
              <RotateCcw className="w-5 h-5" />
              New
            </Button>
          </Link>
        </div>

        {/* Results Feed - Reorganized for better hierarchy */}
        <div className="space-y-3">
          {/* === SECTION 1: QUICK SUMMARY (Always Visible) === */}
          <SafeComponent name="ProbabilityCard">
            <ProbabilityCard 
              probability={simulation.combinedProbability} 
              degenerateLevel={simulation.degenerateLevel}
              delay={0}
              simulation={simulation}
              aiAnalysis={aiAnalysis}
            />
          </SafeComponent>
          
          {/* Shareable Scorecard with Celebration Effect */}
          <SafeComponent name="LegBreakdownScorecard">
            <CelebrationEffect isActive={(() => {
              // Check if all legs are PICK/LEAN
              if (!aiAnalysis?.legAnalyses) return false;
              return simulation.legs.every((_, idx) => {
                const analysis = aiAnalysis.legAnalyses?.find((la) => la.legIndex === idx);
                if (analysis?.researchSummary) {
                  const verdict = analysis.researchSummary.overallVerdict;
                  return verdict === 'STRONG_PICK' || verdict === 'LEAN_PICK';
                }
                return analysis?.sharpRecommendation === 'pick';
              });
            })()}>
              <LegBreakdownScorecard
                legs={simulation.legs}
                legAnalyses={aiAnalysis?.legAnalyses}
                probability={simulation.combinedProbability}
                delay={50}
              />
            </CelebrationEffect>
          </SafeComponent>

          {/* Historical Comparison - How this parlay stacks up */}
          <SafeComponent name="HistoricalComparisonCard">
            <HistoricalComparisonCard
              legCount={simulation.legs.length}
              degenerateLevel={simulation.degenerateLevel}
              probability={simulation.combinedProbability}
              delay={75}
            />
          </SafeComponent>
          

          {/* Consolidated AI Verdict - Shows pick/fade/caution counts and overall recommendation */}
          <SafeComponent name="ConsolidatedVerdictCard">
            <ConsolidatedVerdictCard
              legs={simulation.legs}
              aiAnalysis={aiAnalysis}
              combinedProbability={simulation.combinedProbability}
              delay={110}
            />
          </SafeComponent>

          {/* Parlay Health Score Dashboard */}
          <SafeComponent name="ParlayHealthCard">
            <ParlayHealthCard 
              legAnalyses={aiAnalysis?.legAnalyses}
              delay={130}
            />
          </SafeComponent>

          {/* Ensemble Consensus */}
          <SafeComponent name="EnsembleConsensusCard">
            <EnsembleConsensusCard
              legs={simulation.legs}
              legAnalyses={aiAnalysis?.legAnalyses}
              delay={140}
            />
          </SafeComponent>

          {/* Coaching Tendencies - Now in main view */}
          <SafeComponent name="CoachingInsightsCard">
            <CoachingInsightsCard
              legs={simulation.legs}
              legAnalyses={aiAnalysis?.legAnalyses}
              delay={145}
            />
          </SafeComponent>

          {/* Double Down Recommendation */}
          <SafeComponent name="DoubleDownCard">
            <DoubleDownCard
              legs={simulation.legs}
              legAnalyses={aiAnalysis?.legAnalyses}
              stake={simulation.stake}
              delay={150}
            />
          </SafeComponent>

          {/* Trap Avoidance - Show prominently if traps detected */}
          <SafeComponent name="TrapAvoidanceCard">
            <TrapAvoidanceCard 
              legAnalyses={aiAnalysis?.legAnalyses}
              delay={160}
            />
          </SafeComponent>

          {/* === SECTION 2: DETAILED ANALYSIS (Collapsible) === */}
          <SafeComponent name="DetailedAnalysisSection">
            <CollapsibleSection
              title="Detailed Analysis"
              icon={<BarChart3 className="w-4 h-4 text-neon-cyan" />}
              defaultOpen={false}
              badge={<Badge variant="outline" className="text-xs ml-2">{simulation.legs.length} legs</Badge>}
              preview={
                <p className="text-xs text-muted-foreground">
                  Usage analysis, book edge, fatigue impact, coaching tendencies, variance & Kelly
                </p>
              }
            >
              {/* Usage Analysis Section */}
              <SafeComponent name="UsageAnalysisSection">
                <UsageAnalysisSection
                  legs={simulation.legs}
                  legAnalyses={aiAnalysis?.legAnalyses}
                  isLoading={isLoadingAnalysis}
                  delay={0}
                />
              </SafeComponent>

              {/* Smart Leg Swap - Find better alternatives for weak legs */}
              <SafeComponent name="SmartLegSwapCard">
                <SmartLegSwapCard
                  legs={simulation.legs}
                  legAnalyses={aiAnalysis?.legAnalyses}
                  delay={40}
                />
              </SafeComponent>

              {/* Parlay Optimizer */}
              <SafeComponent name="ParlayOptimizer">
                <ParlayOptimizer 
                  legs={simulation.legs}
                  legAnalyses={aiAnalysis?.legAnalyses}
                  stake={simulation.stake}
                  combinedProbability={simulation.combinedProbability}
                  potentialPayout={simulation.potentialPayout}
                  delay={50}
                />
              </SafeComponent>

              {/* AI-Powered Intelligence Section */}
              <SafeComponent name="LegIntelligenceCard">
                <LegIntelligenceCard 
                  legs={simulation.legs}
                  legAnalyses={aiAnalysis?.legAnalyses}
                  isLoading={isLoadingAnalysis}
                  delay={100}
                />
              </SafeComponent>


              <SafeComponent name="BookEdgeCard">
                <BookEdgeCard 
                  legs={simulation.legs}
                  legAnalyses={aiAnalysis?.legAnalyses}
                  delay={150}
                />
              </SafeComponent>

              {/* NBA Fatigue Impact */}
              <SafeComponent name="FatigueImpactCard">
                <FatigueImpactCard 
                  legs={simulation.legs}
                  legAnalyses={aiAnalysis?.legAnalyses}
                  delay={175}
                />
              </SafeComponent>


              {/* Historical Insights - only show if user is logged in */}
              {user && (
                <SafeComponent name="HistoricalInsightsCard">
                  <HistoricalInsightsCard
                    legContexts={historicalContext?.legContexts || []}
                    userOverall={historicalContext?.userOverall || { totalBets: 0, totalWins: 0, hitRate: 0 }}
                    aiOverall={historicalContext?.aiOverall || { totalPredictions: 0, correctPredictions: 0, accuracy: 0 }}
                    isLoading={isLoadingHistory}
                    delay={225}
                  />
                </SafeComponent>
              )}
            </CollapsibleSection>
          </SafeComponent>

          {/* === SECTION 3: STAKE & RISK (Collapsible) === */}
          <SafeComponent name="StakeRiskSection">
            <CollapsibleSection
              title="Stake & Risk Analysis"
              icon={<Zap className="w-4 h-4 text-neon-yellow" />}
              defaultOpen={false}
              preview={
                <p className="text-xs text-muted-foreground">
                  Kelly stake calculator, variance warning, bankroll impact
                </p>
              }
            >
              <SafeComponent name="BankrollCard">
                <BankrollCard 
                  stake={simulation.stake}
                  potentialPayout={simulation.potentialPayout}
                  expectedValue={simulation.expectedValue}
                  probability={simulation.combinedProbability}
                  delay={0}
                />
              </SafeComponent>

              {/* Kelly Stake Recommendation */}
              <SafeComponent name="KellyStakeCard">
                <KellyStakeCard
                  winProbability={simulation.combinedProbability}
                  americanOdds={simulation.legs.reduce((acc, leg) => {
                    const combinedDecimal = simulation.potentialPayout / simulation.stake;
                    if (combinedDecimal >= 2) {
                      return (combinedDecimal - 1) * 100;
                    } else {
                      return -100 / (combinedDecimal - 1);
                    }
                  }, 0)}
                  userStake={simulation.stake}
                  delay={50}
                />
              </SafeComponent>

              {/* Variance Warning */}
              <SafeComponent name="VarianceWarningCard">
                <VarianceWarningCard
                  winProbability={simulation.combinedProbability}
                  americanOdds={(() => {
                    const combinedDecimal = simulation.potentialPayout / simulation.stake;
                    if (combinedDecimal >= 2) {
                      return (combinedDecimal - 1) * 100;
                    } else {
                      return -100 / (combinedDecimal - 1);
                    }
                  })()}
                  stake={simulation.stake}
                  delay={100}
                />
              </SafeComponent>

              <SafeComponent name="SimulationHighlights">
                <SimulationHighlights 
                  highlights={simulation.simulationHighlights}
                  delay={150}
                />
              </SafeComponent>
            </CollapsibleSection>
          </SafeComponent>

          {/* === SECTION 4: FULL LEG BREAKDOWN (Collapsible) === */}
          <SafeComponent name="LegBreakdownSection">
            <CollapsibleSection
              title="Detailed Leg Analysis"
              icon={<FileText className="w-4 h-4 text-neon-purple" />}
              defaultOpen={false}
              preview={
                <p className="text-xs text-muted-foreground">
                  Complete analysis for each leg with sharp signals, injuries, and probabilities
                </p>
              }
            >
              <SafeComponent name="LegBreakdown">
                <LegBreakdown 
                  legs={simulation.legs}
                  legAnalyses={aiAnalysis?.legAnalyses}
                  delay={0}
                />
              </SafeComponent>
            </CollapsibleSection>
          </SafeComponent>

          {/* === SECTION 5: FUN STUFF (Always Visible at Bottom) === */}
          <SafeComponent name="TrashTalkThread">
            <TrashTalkThread 
              trashTalk={displayRoasts}
              isLoading={isLoadingRoasts}
              isAiGenerated={!!aiRoasts}
              delay={250}
            />
          </SafeComponent>
          
          <SafeComponent name="ShareableMeme">
            <ShareableMeme 
              probability={simulation.combinedProbability}
              degenerateLevel={simulation.degenerateLevel}
              legCount={simulation.legs.length}
              legs={simulation.legs}
              stake={simulation.stake}
              potentialPayout={simulation.potentialPayout}
              roast={displayRoasts?.[0]}
              delay={300}
            />
          </SafeComponent>
        </div>

        {/* Save to Profile */}
        <div className="mt-6 space-y-3">
          {user ? (
            <>
              {isLoadingAnalysis && !isSaved && (
                <p className="text-xs text-muted-foreground text-center">
                  ⏳ Waiting for AI analysis to complete for better learning data...
                </p>
              )}
              <Button
                variant="outline"
                size="lg"
                className="w-full font-display"
                onClick={handleSaveParlay}
                disabled={isSaving || isSaved || isLoadingAnalysis}
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    SAVING...
                  </>
                ) : isSaved ? (
                  '✅ SAVED TO PROFILE'
                ) : isLoadingAnalysis ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ANALYZING...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4 mr-2" />
                    SAVE TO PROFILE
                  </>
                )}
              </Button>
            </>
          ) : (
            <Link to="/auth" className="block">
              <Button variant="outline" size="lg" className="w-full font-display">
                <LogIn className="w-4 h-4 mr-2" />
                LOG IN TO SAVE
              </Button>
            </Link>
          )}

          <Link to="/upload" className="block">
            <Button variant="neon" size="lg" className="w-full font-display">
              🎟️ ANALYZE ANOTHER SLIP
            </Button>
          </Link>
        </div>
      </main>
    </div>
  );
};

export default Results;
