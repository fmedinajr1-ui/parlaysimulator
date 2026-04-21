interface Props {
  onJoin: () => void;
  onUpload: () => void;
}

const TICKER_ITEMS = [
  "🟢 Bills +2.5 — sharps 82% / public 28%",
  "🟢 Under 8.5 Dodgers/Padres — line dropped 9 → 8.5",
  "🟡 Trap alert: Lakers ML — 71% public, line moved away",
  "🟢 Josh Allen Over 264.5 Pass Yds — 85% sharp",
  "🐕 14 sharps tailed in last 24h",
  "💰 +18.4 units this week on tracked sharps",
];

export function FarmHero({ onJoin, onUpload }: Props) {
  return (
    <section id="top" className="relative overflow-hidden min-h-[92vh] flex flex-col justify-center pt-24 pb-12">
      {/* Background orbs + grid */}
      <div className="absolute inset-0 crop-grid opacity-60" />
      <div className="orb" style={{ width: 420, height: 420, background: "hsl(var(--sharp-green) / 0.45)", top: "-100px", left: "-80px" }} />
      <div className="orb" style={{ width: 360, height: 360, background: "hsl(var(--barn-amber) / 0.32)", bottom: "-80px", right: "10%", animationDelay: "-6s" }} />
      <div className="orb" style={{ width: 280, height: 280, background: "hsl(var(--sharp-green) / 0.25)", top: "30%", right: "-60px", animationDelay: "-12s" }} />

      <div className="relative z-10 max-w-5xl mx-auto px-5 text-center">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-[hsl(var(--sharp-green)/0.4)] bg-[hsl(var(--sharp-green)/0.08)] text-xs font-semibold tracking-widest uppercase text-[hsl(var(--sharp-green))] mb-7">
          <span className="w-2 h-2 rounded-full bg-[hsl(var(--sharp-green))] animate-pulse" />
          🐕 Live · Track Sharps · Tail Winners
        </div>

        <h1 className="farm-display text-5xl sm:text-6xl md:text-7xl font-bold leading-[1.05] mb-6">
          The farm where{" "}
          <span className="italic" style={{ color: "hsl(var(--sharp-green))" }}>
            underdogs become top dogs.
          </span>{" "}
          🐕
        </h1>

        <p className="text-lg md:text-xl text-[hsl(var(--farm-muted))] max-w-2xl mx-auto mb-10">
          Drop a slip. Our AI sniffs out traps, tracks sharp money, and tells you who's about to hit. Free to start.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-3 mb-14">
          <button onClick={onJoin} className="farm-btn-primary text-base">
            🐕 See How It Works
          </button>
          <button onClick={onUpload} className="farm-btn-ghost text-base">
            📤 Upload Free Slip
          </button>
          <a href="#sharp-tracker" className="farm-btn-ghost text-base">
            👀 Peek the Tracker
          </a>
        </div>

        {/* 4-stat strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-3xl mx-auto mb-12">
          {[
            { v: "73%", l: "Sharp pick hit rate" },
            { v: "+18.4u", l: "Tracked this week" },
            { v: "2,841", l: "Slips graded today" },
            { v: "<3s", l: "AI verdict speed" },
          ].map((s) => (
            <div key={s.l} className="farm-panel p-4">
              <div className="farm-display text-2xl font-bold" style={{ color: "hsl(var(--sharp-green))" }}>{s.v}</div>
              <div className="text-xs text-[hsl(var(--farm-muted))] mt-1">{s.l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Infinite ticker */}
      <div className="relative z-10 overflow-hidden border-y border-[hsl(var(--farm-line))] bg-[hsl(var(--farm-panel)/0.6)] py-3">
        <div className="ticker-track text-sm text-[hsl(var(--farm-muted))]">
          {[...TICKER_ITEMS, ...TICKER_ITEMS].map((t, i) => (
            <span key={i} className="px-2">{t}</span>
          ))}
        </div>
      </div>
    </section>
  );
}
