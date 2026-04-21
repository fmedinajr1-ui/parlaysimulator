import { Eye, ShieldAlert, GitMerge, Bell, Upload, Zap } from "lucide-react";

const FEATURES = [
  { icon: Eye,         title: "Sharp tracker",     desc: "See where pro money's running before the books move the line." },
  { icon: ShieldAlert, title: "Trap detection",    desc: "We catch the games books are baiting public money into." },
  { icon: GitMerge,    title: "Correlation alerts", desc: "Stop stacking legs that secretly cancel each other out." },
  { icon: Bell,        title: "Barn alerts",       desc: "Real-time notifications when a tailed sharp moves." },
  { icon: Upload,      title: "Free slip grading", desc: "Drop any slip, get a real verdict in 3 seconds. No signup." },
  { icon: Zap,         title: "Sub-3s verdicts",   desc: "Faster than reading the matchup. Built for in-game decisions." },
];

export function FeatureGrid() {
  return (
    <section className="relative py-24 px-5">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-14">
          <div className="text-xs uppercase tracking-widest text-[hsl(var(--sharp-green))] mb-2">Why the farm works</div>
          <h2 className="farm-display text-4xl md:text-5xl font-bold">Six edges. One barn.</h2>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="farm-panel p-6 hover:border-[hsl(var(--sharp-green)/0.5)] transition-colors">
              <f.icon className="w-7 h-7 mb-4" style={{ color: "hsl(var(--sharp-green))" }} />
              <h3 className="farm-display text-lg font-bold mb-1.5">{f.title}</h3>
              <p className="text-sm text-[hsl(var(--farm-muted))]">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
