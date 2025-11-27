import { HeroBanner } from "@/components/HeroBanner";
import { ExampleCard } from "@/components/ExampleCard";
import { HowItWorks } from "@/components/HowItWorks";
import { FeatureTeaser } from "@/components/FeatureTeaser";
import { BottomNav } from "@/components/BottomNav";
import { SampleParlayButton } from "@/components/SampleParlayButton";

const Index = () => {
  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Main content */}
      <main className="max-w-lg mx-auto px-4 py-6">
        <HeroBanner />
        
        {/* Quick Actions */}
        <div className="flex justify-center gap-3 mb-6">
          <SampleParlayButton />
        </div>
        
        {/* Example Cards */}
        <div className="space-y-4 mb-6">
          <ExampleCard type="roast" delay={100} />
          <ExampleCard type="meter" delay={200} />
          <ExampleCard type="highlight" delay={300} />
        </div>

        <HowItWorks />
        <FeatureTeaser />
      </main>

      <BottomNav />
    </div>
  );
};

export default Index;
