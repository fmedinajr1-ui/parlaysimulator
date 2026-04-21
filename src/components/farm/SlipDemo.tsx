import { useEffect, useRef, useState } from "react";
import { Sparkles, AlertTriangle, TrendingUp, Shield } from "lucide-react";

const LEGS = [
  { player: "Jayson Tatum",   line: "Over 27.5 Pts",      odds: "-115" },
  { player: "Lakers",         line: "ML",                 odds: "+150" },
  { player: "Anthony Davis",  line: "Over 11.5 Reb",      odds: "-110" },
  { player: "Luka Dončić",    line: "Over 8.5 Ast",       odds: "-120" },
  { player: "Suns/Heat",      line: "Under 218.5",        odds: "-108" },
];

const SIGNALS = [
  { icon: Shield,         label: "Trap detected on Lakers ML — 71% public, line moved away. Fade.", color: "hsl(var(--trap-red))" },
  { icon: TrendingUp,     label: "Sharp action on Tatum Over — 78% pro money, line ticked up.",     color: "hsl(var(--sharp-green))" },
  { icon: AlertTriangle,  label: "Correlation warning: Davis Reb + Lakers ML overlap by 0.34.",     color: "hsl(var(--barn-amber))" },
];

export function SlipDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const [scanning, setScanning] = useState(false);
  const [verdictOpen, setVerdictOpen] = useState(false);

  useEffect(() => {
    if (!ref.current) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !verdictOpen) {
          setScanning(true);
          setTimeout(() => {
            setScanning(false);
            setVerdictOpen(true);
          }, 2400);
        }
      },
      { threshold: 0.4 }
    );
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [verdictOpen]);

  return (
    <section className="relative py-24 px-5" ref={ref}>
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <div className="text-xs uppercase tracking-widest text-[hsl(var(--sharp-green))] mb-2">Live AI Demo</div>
          <h2 className="farm-display text-4xl md:text-5xl font-bold">Watch us grade a real slip.</h2>
        </div>

        <div className="grid lg:grid-cols-2 gap-6 items-start">
          {/* Slip card */}
          <div className="farm-panel p-6 relative overflow-hidden">
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs text-[hsl(var(--farm-muted))] uppercase tracking-wider">Submitted slip · 5 legs</span>
              <span className="text-xs farm-display text-[hsl(var(--barn-amber))]">+1,847</span>
            </div>
            <div className="space-y-3">
              {LEGS.map((l) => (
                <div key={l.player} className="flex items-center justify-between border-b border-[hsl(var(--farm-line))] pb-3 last:border-0">
                  <div>
                    <div className="font-semibold">{l.player}</div>
                    <div className="text-sm text-[hsl(var(--farm-muted))]">{l.line}</div>
                  </div>
                  <div className="farm-display text-[hsl(var(--sharp-green))]">{l.odds}</div>
                </div>
              ))}
            </div>
            {scanning && (
              <div className="absolute inset-x-0 top-0 h-full pointer-events-none overflow-hidden">
                <div className="scan-beam" />
              </div>
            )}
          </div>

          {/* Verdict card */}
          <div className={`farm-panel p-6 transition-opacity duration-700 ${verdictOpen ? "opacity-100" : "opacity-30"}`}>
            <div className="flex items-center gap-2 mb-4">
              <Sparkles className="w-5 h-5" style={{ color: "hsl(var(--sharp-green))" }} />
              <span className="text-xs uppercase tracking-wider text-[hsl(var(--sharp-green))]">AI Verdict</span>
            </div>
            <div className="farm-display text-4xl font-bold mb-1">62 / 100</div>
            <div className="text-sm text-[hsl(var(--farm-muted))] mb-5">⚠️ Fixable — drop 1 leg, swap 1, and you're at 81.</div>

            <div className="space-y-3 mb-5">
              {SIGNALS.map((s, i) => (
                <div key={i} className="flex gap-3 text-sm">
                  <s.icon className="w-4 h-4 mt-0.5 shrink-0" style={{ color: s.color }} />
                  <span>{s.label}</span>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="farm-panel p-2"><div className="farm-display text-base text-[hsl(var(--sharp-green))]">3</div><div className="text-[hsl(var(--farm-muted))]">Tail</div></div>
              <div className="farm-panel p-2"><div className="farm-display text-base text-[hsl(var(--trap-red))]">1</div><div className="text-[hsl(var(--farm-muted))]">Fade</div></div>
              <div className="farm-panel p-2"><div className="farm-display text-base text-[hsl(var(--barn-amber))]">1</div><div className="text-[hsl(var(--farm-muted))]">Swap</div></div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
