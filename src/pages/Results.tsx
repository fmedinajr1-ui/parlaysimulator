import { useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { BottomNav } from "@/components/BottomNav";
import { ProbabilityCard } from "@/components/results/ProbabilityCard";
import { DegenerateMeter } from "@/components/results/DegenerateMeter";
import { TrashTalkThread } from "@/components/results/TrashTalkThread";
import { SimulationHighlights } from "@/components/results/SimulationHighlights";
import { BankrollCard } from "@/components/results/BankrollCard";
import { LegBreakdown } from "@/components/results/LegBreakdown";
import { ShareableMeme } from "@/components/results/ShareableMeme";
import { Button } from "@/components/ui/button";
import { ArrowLeft, RotateCcw, Save, Loader2, LogIn } from "lucide-react";
import { ParlaySimulation } from "@/types/parlay";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";

const Results = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const simulation = location.state?.simulation as ParlaySimulation | undefined;
  const [aiRoasts, setAiRoasts] = useState<string[] | null>(null);
  const [isLoadingRoasts, setIsLoadingRoasts] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);

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

    setIsSaving(true);
    try {
      // Calculate degen score for this parlay (inverse of probability * 100)
      const degenScore = Math.min(100, (1 - simulation.combinedProbability) * 100);

      const { error } = await supabase.from('parlay_history').insert({
        user_id: user.id,
        legs: simulation.legs.map(leg => ({
          description: leg.description,
          odds: leg.odds
        })),
        stake: simulation.stake,
        potential_payout: simulation.potentialPayout,
        combined_probability: simulation.combinedProbability,
        degenerate_level: simulation.degenerateLevel,
        ai_roasts: aiRoasts
      });

      if (error) throw error;

      // Update profile stats
      const { data: profile } = await supabase
        .from('profiles')
        .select('total_staked, lifetime_degenerate_score')
        .eq('user_id', user.id)
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
          .eq('user_id', user.id);
      }

      setIsSaved(true);
      toast({
        title: "Parlay saved! 🔥",
        description: "Check your profile to track your degen history."
      });
    } catch (error: any) {
      toast({
        title: "Save failed",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background pb-24 touch-pan-y">
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

        {/* Results Feed */}
        <div className="space-y-3">
          <ProbabilityCard 
            probability={simulation.combinedProbability} 
            degenerateLevel={simulation.degenerateLevel}
            delay={0}
          />
          
          <DegenerateMeter 
            probability={simulation.combinedProbability}
            degenerateLevel={simulation.degenerateLevel}
            delay={100}
          />
          
          <TrashTalkThread 
            trashTalk={displayRoasts}
            isLoading={isLoadingRoasts}
            isAiGenerated={!!aiRoasts}
            delay={200}
          />
          
          <SimulationHighlights 
            highlights={simulation.simulationHighlights}
            delay={300}
          />
          
          <BankrollCard 
            stake={simulation.stake}
            potentialPayout={simulation.potentialPayout}
            expectedValue={simulation.expectedValue}
            probability={simulation.combinedProbability}
            delay={400}
          />
          
          <LegBreakdown 
            legs={simulation.legs}
            delay={500}
          />
          
          <ShareableMeme 
            probability={simulation.combinedProbability}
            degenerateLevel={simulation.degenerateLevel}
            legCount={simulation.legs.length}
            delay={600}
          />
        </div>

        {/* Save to Profile */}
        <div className="mt-6 space-y-3">
          {user ? (
            <Button
              variant="outline"
              size="lg"
              className="w-full font-display"
              onClick={handleSaveParlay}
              disabled={isSaving || isSaved}
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  SAVING...
                </>
              ) : isSaved ? (
                '✅ SAVED TO PROFILE'
              ) : (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  SAVE TO PROFILE
                </>
              )}
            </Button>
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

      <BottomNav />
    </div>
  );
};

export default Results;
