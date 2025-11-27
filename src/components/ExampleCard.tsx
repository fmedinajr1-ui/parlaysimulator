import { FeedCard } from "./FeedCard";
import { Link } from "react-router-dom";

interface ExampleCardProps {
  type: 'roast' | 'meter' | 'highlight';
  delay?: number;
}

export function ExampleCard({ type, delay = 0 }: ExampleCardProps) {
  if (type === 'roast') {
    return (
      <Link to="/upload">
        <FeedCard variant="purple" delay={delay} className="hover:scale-[1.02] cursor-pointer transition-transform">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full gradient-purple flex items-center justify-center text-lg">
              🤖
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-semibold text-foreground">AI Handicapper</span>
                <span className="text-muted-foreground text-sm">@BookieKillerAI</span>
              </div>
              <p className="text-foreground/90 mb-2">
                "This parlay has more red flags than a Miami club." 🚩
              </p>
              <p className="text-muted-foreground text-sm">
                Example roast • Tap to see your own →
              </p>
            </div>
          </div>
        </FeedCard>
      </Link>
    );
  }

  if (type === 'meter') {
    return (
      <Link to="/upload">
        <FeedCard variant="glow" delay={delay} className="hover:scale-[1.02] cursor-pointer transition-transform">
          <p className="text-sm text-muted-foreground uppercase tracking-wider mb-3">
            😈 Degenerate Meter
          </p>
          <div className="relative h-4 rounded-full bg-muted overflow-hidden mb-3">
            <div 
              className="absolute inset-y-0 left-0 rounded-full gradient-fire transition-all duration-1000"
              style={{ width: '75%' }}
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="font-display text-xl text-neon-orange">SWEAT SEASON 😰</span>
            <span className="text-muted-foreground text-sm">Tap to analyze →</span>
          </div>
        </FeedCard>
      </Link>
    );
  }

  return (
    <Link to="/upload">
      <FeedCard delay={delay} className="hover:scale-[1.02] cursor-pointer transition-transform">
        <p className="text-sm text-muted-foreground uppercase tracking-wider mb-3">
          📊 Simulation Highlight
        </p>
        <div className="space-y-3">
          <div className="flex items-start gap-3 p-3 rounded-xl bg-muted/50">
            <span className="text-2xl">💀</span>
            <p className="text-foreground/90">
              Leg 3 misses in 78% of sims. This one needs Jesus.
            </p>
          </div>
          <p className="text-muted-foreground text-sm text-center">
            Upload your slip to see your highlights →
          </p>
        </div>
      </FeedCard>
    </Link>
  );
}
