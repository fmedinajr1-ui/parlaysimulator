import { useState } from "react";
import { X, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type FarmTier = "pup" | "top_dog" | "kennel_club";

const TIER_META: Record<FarmTier, { title: string; price: string; trial: string; cta: string }> = {
  pup:          { title: "🐶 The Pup",        price: "Free",      trial: "Card on file — never charged unless you upgrade", cta: "Verify card & join" },
  top_dog:      { title: "🐕 Top Dog",        price: "$29.99/mo", trial: "7-day free trial · $50 auth hold",                cta: "Start 7-day trial" },
  kennel_club:  { title: "🏆 Kennel Club",    price: "$99/mo",    trial: "3-day free trial · $50 auth hold",                cta: "Start 3-day trial" },
};

interface Props {
  open: boolean;
  tier: FarmTier | null;
  onClose: () => void;
}

export function EmailCaptureModal({ open, tier, onClose }: Props) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  if (!open || !tier) return null;
  const meta = TIER_META[tier];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.includes("@")) {
      toast.error("Enter a valid email");
      return;
    }
    setLoading(true);
    try {
      const fnName = tier === "pup" ? "create-free-signup" : "create-bot-checkout";
      const body: Record<string, string> = { email, tier };
      const { data, error } = await supabase.functions.invoke(fnName, { body });
      if (error) throw error;
      if (data?.url) {
        window.open(data.url, "_blank");
        onClose();
      } else {
        throw new Error("Checkout did not return a URL");
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to start checkout");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 farm-theme" onClick={onClose}>
      <div className="farm-panel max-w-md w-full p-6 relative" onClick={(e) => e.stopPropagation()} style={{ background: "hsl(var(--farm-panel))" }}>
        <button onClick={onClose} className="absolute top-3 right-3 text-[hsl(var(--farm-muted))] hover:text-[hsl(var(--farm-text))]">
          <X className="w-5 h-5" />
        </button>
        <div className="mb-4">
          <div className="text-xs uppercase tracking-widest text-[hsl(var(--sharp-green))] mb-1">Joining</div>
          <h3 className="farm-display text-2xl font-bold">{meta.title}</h3>
          <div className="text-sm text-[hsl(var(--farm-muted))] mt-1">{meta.price} · {meta.trial}</div>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="email"
            placeholder="you@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading}
            className="w-full bg-[hsl(var(--farm-bg))] border border-[hsl(var(--farm-line))] rounded-lg px-4 py-3 text-[hsl(var(--farm-text))] focus:border-[hsl(var(--sharp-green))] focus:outline-none"
            autoFocus
          />
          <button type="submit" disabled={loading} className="farm-btn-primary w-full flex items-center justify-center gap-2">
            {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Opening secure checkout…</> : meta.cta}
          </button>
          <p className="text-xs text-[hsl(var(--farm-muted))] text-center pt-2">
            Card verification by Stripe. Secure & encrypted. Cancel anytime.
          </p>
        </form>
      </div>
    </div>
  );
}
