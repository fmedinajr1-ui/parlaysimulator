import { HeroBanner } from "@/components/HeroBanner";
import { ExampleCard } from "@/components/ExampleCard";
import { HowItWorks } from "@/components/HowItWorks";
import { FeatureTeaser } from "@/components/FeatureTeaser";
import { BottomNav } from "@/components/BottomNav";
import { SampleParlayButton } from "@/components/SampleParlayButton";
import { SuggestedParlays } from "@/components/suggestions/SuggestedParlays";
import { OddsMovementCard } from "@/components/results/OddsMovementCard";
import { CompareTeaser } from "@/components/CompareTeaser";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";

const Index = () => {
  return (
    <div className="min-h-dvh bg-background pb-nav-safe touch-pan-y overflow-x-safe">
      {/* Main content */}
      <main className="max-w-lg mx-auto px-3 py-4">
        <HeroBanner />
        
        {/* Quick Actions */}
        <div className="flex flex-col items-center gap-3 mb-5">
          {/* Primary CTA - Analyze Your Parlay */}
          <Link to="/upload" className="w-full max-w-xs">
            <Button variant="neon" size="lg" className="w-full font-display text-lg tracking-wider">
              🎯 Analyze Your Parlay
            </Button>
          </Link>
          
          {/* Secondary action */}
          <div className="flex gap-3">
            <SampleParlayButton />
          </div>
        </div>
        
        {/* Example Cards */}
        <div className="space-y-3 mb-5">
          <ExampleCard type="roast" delay={50} />
          <ExampleCard type="meter" delay={100} />
          <ExampleCard type="highlight" delay={150} />
        </div>

        {/* Compare Parlays */}
        <CompareTeaser />

        {/* AI Suggested Parlays */}
        <div className="mb-5">
          <SuggestedParlays />
        </div>

        {/* Live Line Movements */}
        <div className="mb-5">
          <a href="/odds" className="block">
            <OddsMovementCard compact showSharpOnly delay={200} />
          </a>
          <p className="text-xs text-muted-foreground text-center mt-2">
            Tap to view full odds dashboard →
          </p>
        </div>

        <HowItWorks />
        <FeatureTeaser />
      </main>

      <BottomNav />
    </div>
  );
};

export default Index;
