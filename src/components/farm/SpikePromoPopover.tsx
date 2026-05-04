import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { X, Sparkles } from "lucide-react";
import dogPortrait from "@/assets/parlayfarm-dog-avatar.png";

const DISMISS_KEY = "spike_promo_dismissed_v1";

export function SpikePromoPopover() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (localStorage.getItem(DISMISS_KEY) === "1") return;

    let shown = false;
    const show = () => {
      if (shown) return;
      shown = true;
      setOpen(true);
    };

    const t = window.setTimeout(show, 6000);
    const onScroll = () => {
      const pct =
        window.scrollY / Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      if (pct > 0.25) show();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  const dismiss = () => {
    setOpen(false);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {}
  };

  if (!open) return null;

  return (
    <div
      className="fixed z-50 right-3 left-3 sm:left-auto sm:right-6 max-w-sm sm:w-[340px] animate-in slide-in-from-bottom-4 fade-in duration-500"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 88px)" }}
      role="dialog"
      aria-label="Meet Spike"
    >
      <div className="relative rounded-2xl border border-primary/40 bg-card/95 backdrop-blur-md shadow-2xl shadow-primary/20 overflow-hidden">
        {/* Glow accent */}
        <div className="absolute -top-12 -right-12 w-32 h-32 rounded-full bg-primary/30 blur-3xl pointer-events-none" />

        <button
          onClick={dismiss}
          className="absolute top-2 right-2 z-10 w-7 h-7 rounded-full flex items-center justify-center bg-background/60 hover:bg-background text-muted-foreground hover:text-foreground transition"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="relative p-4 flex gap-3 items-start">
          <div className="relative shrink-0">
            <div className="absolute inset-0 rounded-full bg-primary/40 blur-md animate-pulse" />
            <img
              src={dogPortrait}
              alt="Spike, the ParlayFarm AI handicapper"
              className="relative w-14 h-14 rounded-full object-cover border-2 border-primary"
            />
            <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-emerald-500 border-2 border-card" />
          </div>

          <div className="flex-1 min-w-0 pr-5">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-primary font-bold">
              <Sparkles className="w-3 h-3" /> Live now
            </div>
            <h3 className="font-bold text-base text-foreground leading-tight mt-0.5">
              Talk to Spike
            </h3>
            <p className="text-xs text-muted-foreground mt-1 leading-snug">
              Your AI handicapper. Try a free sample — no signup needed.
            </p>
          </div>
        </div>

        <div className="px-4 pb-4 flex gap-2">
          <Link
            to="/live-ai?sample=1"
            onClick={() => setOpen(false)}
            className="flex-1 inline-flex items-center justify-center rounded-xl bg-primary text-primary-foreground text-sm font-semibold py-2.5 hover:opacity-90 transition shadow-lg shadow-primary/30"
          >
            Try Spike Free
          </Link>
          <button
            onClick={dismiss}
            className="px-3 rounded-xl text-sm text-muted-foreground hover:text-foreground transition"
          >
            Later
          </button>
        </div>
      </div>
    </div>
  );
}
