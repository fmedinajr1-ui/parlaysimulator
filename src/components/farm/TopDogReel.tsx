const DOGS = [
  { name: "@TailMaster",  result: "+12.4u",  pick: "NBA 4-leg lock — 3 sharp tails", grad: "linear-gradient(135deg, hsl(var(--sharp-green)/0.4), hsl(var(--barn-amber)/0.25))" },
  { name: "@FadeKing",    result: "+8.7u",   pick: "Faded 3 trap moneylines",         grad: "linear-gradient(135deg, hsl(var(--barn-amber)/0.4), hsl(var(--trap-red)/0.2))" },
  { name: "@SharpDog",    result: "+15.1u",  pick: "Reverse line + sharp side combo", grad: "linear-gradient(135deg, hsl(var(--sharp-green)/0.45), hsl(220 70% 40%/0.3))" },
  { name: "@BarnBoss",    result: "+6.2u",   pick: "Under 8.5 swept the night",       grad: "linear-gradient(135deg, hsl(280 70% 50%/0.35), hsl(var(--sharp-green)/0.3))" },
  { name: "@PupHustle",   result: "+4.9u",   pick: "First parlay = first cash",       grad: "linear-gradient(135deg, hsl(var(--barn-amber)/0.5), hsl(var(--sharp-green)/0.25))" },
  { name: "@KennelKing",  result: "+22.3u",  pick: "Stacked 6 sharp tails this week", grad: "linear-gradient(135deg, hsl(var(--sharp-green)/0.5), hsl(180 80% 40%/0.3))" },
];

export function TopDogReel() {
  return (
    <section className="relative py-24 overflow-hidden">
      <div className="text-center mb-10 px-5">
        <div className="text-xs uppercase tracking-widest text-[hsl(var(--sharp-green))] mb-2">Top Dog reel</div>
        <h2 className="farm-display text-4xl md:text-5xl font-bold">This week's biggest barks.</h2>
      </div>
      <div className="overflow-hidden">
        <div className="reel-track">
          {[...DOGS, ...DOGS].map((d, i) => (
            <div key={i} className="farm-panel p-6 w-72 shrink-0 relative overflow-hidden">
              <div className="absolute inset-0" style={{ background: d.grad, opacity: 0.7 }} />
              <div className="relative z-10">
                <div className="text-xs text-[hsl(var(--farm-muted))] mb-1">{d.name}</div>
                <div className="farm-display text-3xl font-bold mb-2" style={{ color: "hsl(var(--sharp-green))" }}>{d.result}</div>
                <div className="text-sm text-[hsl(var(--farm-text))]">{d.pick}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
