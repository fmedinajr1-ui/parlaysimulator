import { Upload, ScanSearch, CheckCircle2 } from "lucide-react";

const STEPS = [
  { icon: Upload,        title: "Drop your slip",       desc: "Paste, type, or upload a screenshot. Free, no signup needed.", accent: "hsl(var(--sharp-green))" },
  { icon: ScanSearch,    title: "AI sniffs it out",     desc: "We cross-check sharp money, line movement, traps, and correlation in under 3 seconds.", accent: "hsl(var(--barn-amber))" },
  { icon: CheckCircle2,  title: "Get the verdict",      desc: "Tail it, fade it, or fix it. Every leg graded with the why.", accent: "hsl(var(--sharp-green))" },
];

export function Steps() {
  return (
    <section className="relative py-24 px-5">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-14">
          <div className="text-xs uppercase tracking-widest text-[hsl(var(--sharp-green))] mb-2">How the farm runs</div>
          <h2 className="farm-display text-4xl md:text-5xl font-bold">Three steps. Zero guesswork.</h2>
        </div>
        <div className="grid md:grid-cols-3 gap-5">
          {STEPS.map((s, i) => (
            <div key={s.title} className="farm-panel p-7 relative overflow-hidden">
              <div className="text-xs farm-display text-[hsl(var(--farm-muted))] mb-4">STEP {i + 1}</div>
              <s.icon className="w-9 h-9 mb-4" style={{ color: s.accent }} />
              <h3 className="farm-display text-xl font-bold mb-2">{s.title}</h3>
              <p className="text-sm text-[hsl(var(--farm-muted))] leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
