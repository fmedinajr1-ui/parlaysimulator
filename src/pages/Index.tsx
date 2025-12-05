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
import { AppShell } from "@/components/layout/AppShell";
import { Zap, BarChart3, Sparkles } from "lucide-react";

const Index = () => {
  return (
    <AppShell className="pt-safe">
      <HeroBanner />
      
      {/* Quick Actions - FanDuel style horizontal scroll */}
      <div className="mb-5">
        <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-2 -mx-4 px-4">
          <Link to="/upload" className="shrink-0">
            <div className="quick-action min-w-[140px]">
              <BarChart3 className="w-5 h-5 text-primary" />
              <span>Analyze</span>
            </div>
          </Link>
          <Link to="/sharp" className="shrink-0">
            <div className="quick-action min-w-[140px]">
              <Zap className="w-5 h-5 text-neon-yellow" />
              <span>Sharp Money</span>
            </div>
          </Link>
          <Link to="/suggestions" className="shrink-0">
            <div className="quick-action min-w-[140px]">
              <Sparkles className="w-5 h-5 text-neon-purple" />
              <span>AI Picks</span>
            </div>
          </Link>
        </div>
      </div>

      {/* Main CTA */}
      <div className="flex flex-col items-center gap-3 mb-6">
        <Link to="/upload" className="w-full">
          <Button variant="neon" size="lg" className="w-full font-display text-lg tracking-wider touch-target-lg h-14">
            🎯 Analyze Your Parlay
          </Button>
        </Link>
        <SampleParlayButton />
      </div>
      
      {/* Example Cards */}
      <ExampleCarousel />

      {/* Compare Parlays */}
      <CompareTeaser />

      {/* AI Suggested Parlays */}
      <div className="mb-5">
        <SuggestedParlays />
      </div>

      {/* Live Line Movements */}
      <div className="mb-5">
        <Link to="/sharp" className="block">
          <OddsMovementCard compact showSharpOnly delay={200} />
        </Link>
        <p className="text-xs text-muted-foreground text-center mt-2">
          Tap to view sharp money dashboard →
        </p>
      </div>

      <HowItWorks />
      <FeatureTeaser />
    </AppShell>
  );
};

export default Index;
