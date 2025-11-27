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
import { ArrowLeft, RotateCcw } from "lucide-react";
import { ParlaySimulation } from "@/types/parlay";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

const Results = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const simulation = location.state?.simulation as ParlaySimulation | undefined;
  const [aiRoasts, setAiRoasts] = useState<string[] | null>(null);
  const [isLoadingRoasts, setIsLoadingRoasts] = useState(true);

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

        {/* Run Another */}
        <div className="mt-6 text-center">
          <Link to="/upload">
            <Button variant="neon" size="lg" className="font-display">
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
