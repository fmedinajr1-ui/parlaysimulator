import { HeroBanner } from "@/components/HeroBanner";
import { ExampleCard } from "@/components/ExampleCard";
import { HowItWorks } from "@/components/HowItWorks";
import { FeatureTeaser } from "@/components/FeatureTeaser";
import { BottomNav } from "@/components/BottomNav";
import { SampleParlayButton } from "@/components/SampleParlayButton";
import { SuggestedParlays } from "@/components/suggestions/SuggestedParlays";
import { OddsMovementCard } from "@/components/results/OddsMovementCard";
import { CompareTeaser } from "@/components/CompareTeaser";

const Index = () => {
  return (
    <div className="min-h-screen bg-background pb-24 touch-pan-y">
      {/* Main content */}
      <main className="max-w-lg mx-auto px-3 py-4">
        <HeroBanner />
        
        {/* Quick Actions */}
        <div className="flex justify-center gap-3 mb-5">
          <SampleParlayButton />
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
