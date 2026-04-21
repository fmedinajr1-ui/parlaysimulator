import { useState, useEffect } from "react";

interface Props {
  onCtaClick: () => void;
}

export function FarmNav({ onCtaClick }: Props) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-200 ${
        scrolled ? "backdrop-blur-md bg-[hsl(var(--farm-bg)/0.85)] border-b border-[hsl(var(--farm-line))]" : ""
      }`}
    >
      <div className="max-w-7xl mx-auto flex items-center justify-between px-5 py-3">
        <a href="#top" className="flex items-center gap-2 farm-display font-bold text-lg">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-[hsl(var(--sharp-green))] text-[hsl(var(--farm-bg))] text-base">🐕</span>
          ParlayFarm
        </a>
        <div className="hidden md:flex items-center gap-7 text-sm">
          <a href="#sharp-tracker" className="text-[hsl(var(--farm-muted))] hover:text-[hsl(var(--farm-text))]">Sharp Tracker</a>
          <a href="/dashboard" className="text-[hsl(var(--farm-muted))] hover:text-[hsl(var(--farm-text))]">The Farm</a>
          <a href="#pricing" className="text-[hsl(var(--farm-muted))] hover:text-[hsl(var(--farm-text))]">Pricing</a>
        </div>
        <button onClick={onCtaClick} className="farm-btn-primary text-sm py-2 px-4">
          Join the Farm
        </button>
      </div>
    </nav>
  );
}
