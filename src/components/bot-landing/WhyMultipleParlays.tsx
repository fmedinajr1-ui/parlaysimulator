import { Target, BarChart3, Shield } from "lucide-react";

const reasons = [
  {
    icon: <Target className="w-6 h-6 text-primary" />,
    title: "Diversified Risk",
    description: "Instead of betting everything on one parlay, spreading across multiple daily parlays reduces variance and creates a more stable equity curve.",
  },
  {
    icon: <BarChart3 className="w-6 h-6 text-accent" />,
    title: "Statistical Edge Compounds",
    description: "Each parlay is built using independent scoring models. More parlays per day means more opportunities for your edge to materialize over time.",
  },
  {
    icon: <Shield className="w-6 h-6 text-secondary" />,
    title: "AI-Optimized Selection",
    description: "Our engine avoids correlated legs and weak matchups. Every parlay passes strict composite scoring, edge validation, and conflict detection filters.",
  },
];

export function WhyMultipleParlays() {
  return (
    <section className="py-12 px-4 sm:px-6 bg-muted/30">
      <div className="max-w-3xl mx-auto">
        <h2 className="text-2xl font-bold text-foreground mb-8 text-center font-bebas tracking-wide">
          Why Multiple Parlays?
        </h2>
        <div className="grid sm:grid-cols-3 gap-6">
          {reasons.map((reason) => (
            <div key={reason.title} className="bg-card border border-border rounded-xl p-5">
              <div className="mb-3">{reason.icon}</div>
              <h3 className="font-semibold text-foreground mb-2">{reason.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{reason.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
