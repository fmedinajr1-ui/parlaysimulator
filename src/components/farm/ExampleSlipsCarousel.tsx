import { useCallback, useEffect, useState } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { ChevronLeft, ChevronRight, Sparkles, ArrowDown } from "lucide-react";
import { EXAMPLE_SLIPS, TIER_META, type ExampleSlip } from "./exampleSlipsData";

const STATUS_DOT: Record<"hit" | "lean" | "miss", string> = {
  hit: "hsl(var(--sharp-green))",
  lean: "#f5c451",
  miss: "#ff4d6d",
};

function GradeRing({ grade, color }: { grade: number; color: string }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  const offset = c - (grade / 100) * c;
  return (
    <div className="relative w-14 h-14 shrink-0">
      <svg className="w-14 h-14 -rotate-90" viewBox="0 0 56 56">
        <circle cx="28" cy="28" r={r} stroke="hsl(var(--farm-line))" strokeWidth="4" fill="none" />
        <circle
          cx="28"
          cy="28"
          r={r}
          stroke={color}
          strokeWidth="4"
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.6s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-sm font-black leading-none" style={{ color }}>
          {grade}
        </span>
        <span className="text-[8px] text-[hsl(var(--farm-muted))] leading-none mt-0.5">/100</span>
      </div>
    </div>
  );
}

function ExampleSlipCard({ slip }: { slip: ExampleSlip }) {
  const tier = TIER_META[slip.tier];
  return (
    <div
      className="farm-panel relative p-4 sm:p-5 h-full flex flex-col gap-3 border"
      style={{
        borderColor: tier.color,
        boxShadow: `0 0 32px ${tier.glow}, inset 0 0 0 1px ${tier.glow}`,
      }}
    >
      {/* Tier ribbon */}
      <div
        className="absolute -top-3 left-4 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest shadow-lg flex items-center gap-1"
        style={{ backgroundColor: tier.color, color: "#0a0a0a" }}
      >
        <span>{tier.emoji}</span>
        <span>{tier.label}</span>
      </div>

      {/* Header: sport + grade ring + payout */}
      <div className="flex items-center justify-between pt-2">
        <div className="flex items-center gap-2">
          <span className="text-xl">{slip.sportEmoji}</span>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-[hsl(var(--farm-muted))] font-bold">
              {slip.sport}
            </div>
            <div className="text-xs text-[hsl(var(--farm-text))] font-semibold">
              {slip.legs.length}-leg parlay
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-widest text-[hsl(var(--farm-muted))] font-bold">
              Payout
            </div>
            <div className="text-sm font-black text-[hsl(var(--farm-text))]">{slip.payout}</div>
          </div>
          <GradeRing grade={slip.grade} color={tier.color} />
        </div>
      </div>

      {/* Legs */}
      <div className="space-y-1.5">
        {slip.legs.map((leg, i) => {
          const isKiller = i === slip.killerLegIndex;
          return (
            <div
              key={i}
              className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg bg-[hsl(var(--farm-bg))] border transition-all"
              style={{
                borderColor: isKiller ? "#ff4d6d" : "hsl(var(--farm-line))",
                boxShadow: isKiller ? "0 0 16px rgba(255,77,109,0.25)" : "none",
              }}
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: STATUS_DOT[leg.status], boxShadow: `0 0 6px ${STATUS_DOT[leg.status]}` }}
                />
                <span className="text-xs font-bold text-[hsl(var(--farm-text))] truncate">
                  {leg.player}
                </span>
                <span className="text-[11px] text-[hsl(var(--farm-muted))] truncate">{leg.line}</span>
              </div>
              <span className="text-[10px] font-mono text-[hsl(var(--farm-muted))] shrink-0">{leg.odds}</span>
            </div>
          );
        })}
      </div>

      {/* AI verdict line */}
      <div
        className="mt-auto rounded-lg p-2.5 flex items-start gap-2"
        style={{ backgroundColor: `${tier.glow}`, border: `1px solid ${tier.color}` }}
      >
        <Sparkles className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: tier.color }} />
        <p className="text-[11px] leading-snug text-[hsl(var(--farm-text))] font-medium">
          {slip.verdict}
        </p>
      </div>
    </div>
  );
}

export function ExampleSlipsCarousel() {
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: true, align: "center" });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  const onSelect = useCallback(() => {
    if (!emblaApi) return;
    setSelectedIndex(emblaApi.selectedScrollSnap());
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    onSelect();
    emblaApi.on("select", onSelect);
    emblaApi.on("reInit", onSelect);
    return () => {
      emblaApi.off("select", onSelect);
      emblaApi.off("reInit", onSelect);
    };
  }, [emblaApi, onSelect]);

  // Autoplay
  useEffect(() => {
    if (!emblaApi || isPaused) return;
    const id = setInterval(() => emblaApi.scrollNext(), 5000);
    return () => clearInterval(id);
  }, [emblaApi, isPaused]);

  return (
    <div className="mb-8">
      <div className="text-center mb-4">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[hsl(var(--farm-line))] bg-[hsl(var(--farm-card))] mb-2">
          <Sparkles className="w-3 h-3 text-[hsl(var(--sharp-green))]" />
          <span className="text-[10px] uppercase tracking-widest text-[hsl(var(--farm-muted))] font-bold">
            Real verdicts · Real slips
          </span>
        </div>
        <h3 className="farm-display text-xl sm:text-2xl font-black text-[hsl(var(--farm-text))]">
          See what your verdict looks like 🎯
        </h3>
        <p className="text-xs text-[hsl(var(--farm-muted))] mt-1">
          Swipe through real graded slips across every sport
        </p>
      </div>

      <div
        className="relative"
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
        onTouchStart={() => setIsPaused(true)}
      >
        <div className="overflow-hidden rounded-2xl" ref={emblaRef}>
          <div className="flex touch-pan-y">
            {EXAMPLE_SLIPS.map((slip) => (
              <div
                key={slip.id}
                className="flex-[0_0_88%] sm:flex-[0_0_70%] md:flex-[0_0_55%] min-w-0 px-2"
              >
                <ExampleSlipCard slip={slip} />
              </div>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={() => emblaApi?.scrollPrev()}
          className="hidden sm:flex absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1 w-9 h-9 items-center justify-center rounded-full bg-[hsl(var(--farm-card))] border border-[hsl(var(--farm-line))] text-[hsl(var(--farm-text))] hover:bg-[hsl(var(--sharp-green)/0.15)] hover:border-[hsl(var(--sharp-green))] transition-all z-10 shadow-lg"
          aria-label="Previous slip"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => emblaApi?.scrollNext()}
          className="hidden sm:flex absolute right-0 top-1/2 -translate-y-1/2 translate-x-1 w-9 h-9 items-center justify-center rounded-full bg-[hsl(var(--farm-card))] border border-[hsl(var(--farm-line))] text-[hsl(var(--farm-text))] hover:bg-[hsl(var(--sharp-green)/0.15)] hover:border-[hsl(var(--sharp-green))] transition-all z-10 shadow-lg"
          aria-label="Next slip"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Dots */}
      <div className="flex justify-center gap-1.5 mt-4">
        {EXAMPLE_SLIPS.map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => emblaApi?.scrollTo(i)}
            className="h-1.5 rounded-full transition-all duration-300"
            style={{
              width: i === selectedIndex ? 20 : 6,
              backgroundColor:
                i === selectedIndex ? "hsl(var(--sharp-green))" : "hsl(var(--farm-line))",
            }}
            aria-label={`Go to slip ${i + 1}`}
          />
        ))}
      </div>

      {/* Caption pointing to upload form */}
      <div className="mt-5 flex flex-col items-center gap-1 text-center">
        <p className="text-sm text-[hsl(var(--farm-muted))]">
          Yours grades just like this — drop it below 👇
        </p>
        <ArrowDown className="w-4 h-4 text-[hsl(var(--sharp-green))] animate-bounce" />
      </div>
    </div>
  );
}
