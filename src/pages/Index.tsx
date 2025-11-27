import { HeroBanner } from "@/components/HeroBanner";
import { ExampleCard } from "@/components/ExampleCard";
import { HowItWorks } from "@/components/HowItWorks";
import { FeatureTeaser } from "@/components/FeatureTeaser";
import { BottomNav } from "@/components/BottomNav";
import { SampleParlayButton } from "@/components/SampleParlayButton";

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

        <HowItWorks />
        <FeatureTeaser />
      </main>

      <BottomNav />
    </div>
  );
};

export default Index;
