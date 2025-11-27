import { useLocation, useNavigate } from "react-router-dom";
import { useEffect } from "react";
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

const Results = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const simulation = location.state?.simulation as ParlaySimulation | undefined;

  useEffect(() => {
    if (!simulation) {
      navigate('/upload');
    }
  }, [simulation, navigate]);

  if (!simulation) {
    return null;
  }

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
            trashTalk={simulation.trashTalk}
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
