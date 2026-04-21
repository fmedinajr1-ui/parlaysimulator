interface Props { onJoin: () => void; }

export function FinalCTA({ onJoin }: Props) {
  return (
    <section className="relative py-28 px-5 text-center overflow-hidden">
      <div className="absolute inset-0 crop-grid opacity-50" />
      <div className="orb" style={{ width: 500, height: 500, background: "hsl(var(--sharp-green) / 0.35)", top: "-100px", left: "50%", transform: "translateX(-50%)" }} />
      <div className="relative z-10 max-w-3xl mx-auto">
        <h2 className="farm-display text-4xl md:text-6xl font-bold leading-[1.05] mb-6">
          Tired of being the underdog?
          <br />
          <span style={{ color: "hsl(var(--sharp-green))" }}>Come be a top dog.</span>
        </h2>
        <p className="text-[hsl(var(--farm-muted))] text-lg mb-8 max-w-xl mx-auto">
          Free card-verified signup. Your first slip graded in seconds.
        </p>
        <button onClick={onJoin} className="farm-btn-primary text-lg px-8 py-4">
          🐕 Join the Farm
        </button>
      </div>
    </section>
  );
}
