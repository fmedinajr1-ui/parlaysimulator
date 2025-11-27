import { FeedCard } from "./FeedCard";
import { Upload, Cpu, Flame } from "lucide-react";

const steps = [
  {
    icon: Upload,
    title: "Upload Your Slip",
    description: "Drop your betting slip or manually enter your legs",
    emoji: "📸"
  },
  {
    icon: Cpu,
    title: "AI Analysis",
    description: "We crunch the numbers and run 10,000 simulations",
    emoji: "🧠"
  },
  {
    icon: Flame,
    title: "Get Roasted",
    description: "Receive your probability, roast thread, and degen score",
    emoji: "🔥"
  }
];

export function HowItWorks() {
  return (
    <FeedCard variant="default" className="mb-6">
      <h2 className="font-display text-2xl text-foreground mb-4 text-center">
        HOW IT WORKS 🎯
      </h2>
      <div className="space-y-4">
        {steps.map((step, idx) => (
          <div key={idx} className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl gradient-neon flex items-center justify-center shrink-0">
              <span className="text-xl">{step.emoji}</span>
            </div>
            <div>
              <p className="font-semibold text-foreground">{step.title}</p>
              <p className="text-sm text-muted-foreground">{step.description}</p>
            </div>
          </div>
        ))}
      </div>
    </FeedCard>
  );
}
