import { HeroBanner } from "@/components/HeroBanner";
import { ExampleCarousel } from "@/components/ExampleCarousel";
import { HowItWorks } from "@/components/HowItWorks";
import { FeatureTeaser } from "@/components/FeatureTeaser";
import { SampleParlayButton } from "@/components/SampleParlayButton";
import { SuggestedParlays } from "@/components/suggestions/SuggestedParlays";
import { OddsMovementCard } from "@/components/results/OddsMovementCard";
import { CompareTeaser } from "@/components/CompareTeaser";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";

const Index = () => {
  return (
    <div className="min-h-dvh bg-background pb-nav-safe touch-pan-y overflow-x-safe scroll-smooth-ios">
      {/* Main content */}
      <main className="max-w-lg mx-auto px-3 sm:px-4 py-3 sm:py-4">
        <HeroBanner />
        
        {/* Quick Actions - Compact on mobile */}
        <div className="flex flex-col items-center gap-2 sm:gap-3 mb-4 sm:mb-5">
          <Link to="/upload" className="w-full max-w-[280px] sm:max-w-xs">
            <Button variant="neon" size="lg" className="w-full font-display text-base sm:text-lg tracking-wider touch-target">
              🎯 Analyze Your Parlay
            </Button>
          </Link>
          <SampleParlayButton />
        </div>
        
        {/* Example Cards - Carousel on mobile */}
        <ExampleCarousel />

        {/* Compare Parlays */}
        <CompareTeaser />

        {/* AI Suggested Parlays */}
        <div className="mb-4 sm:mb-5">
          <SuggestedParlays />
        </div>

        {/* Live Line Movements */}
        <div className="mb-4 sm:mb-5">
          <Link to="/odds" className="block">
            <OddsMovementCard compact showSharpOnly delay={200} />
          </Link>
          <p className="text-xs text-muted-foreground text-center mt-1.5 sm:mt-2">
            Tap to view full odds dashboard →
          </p>
        </div>

        <HowItWorks />
        <FeatureTeaser />
      </main>
    </div>
  );
};

export default Index;
