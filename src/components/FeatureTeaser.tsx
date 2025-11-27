import { FeedCard } from "./FeedCard";
import { Lock } from "lucide-react";

const features = [
  { name: "Degenerate Pro", emoji: "👑", desc: "Advanced analytics" },
  { name: "Betting Edge Finder", emoji: "🎯", desc: "Find +EV bets" },
  { name: "My Saved Slips", emoji: "📁", desc: "Track your history" },
  { name: "Connect Sportsbook", emoji: "🔗", desc: "Auto-import slips" },
];

export function FeatureTeaser() {
  return (
    <FeedCard className="mb-20">
      <h2 className="font-display text-xl text-muted-foreground mb-4 text-center">
        COMING SOON 🚀
      </h2>
      <div className="grid grid-cols-2 gap-3">
        {features.map((feature) => (
          <div
            key={feature.name}
            className="relative p-4 rounded-xl bg-muted/50 border border-border/50 opacity-60"
          >
            <Lock className="absolute top-2 right-2 w-4 h-4 text-muted-foreground" />
            <span className="text-2xl mb-2 block">{feature.emoji}</span>
            <p className="font-semibold text-sm text-foreground">{feature.name}</p>
            <p className="text-xs text-muted-foreground">{feature.desc}</p>
          </div>
        ))}
      </div>
    </FeedCard>
  );
}
