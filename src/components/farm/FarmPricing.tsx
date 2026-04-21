import { Check, Star } from "lucide-react";
import type { FarmTier } from "./EmailCaptureModal";

interface Props {
  onSelect: (tier: FarmTier) => void;
}

const TIERS: Array<{
  id: FarmTier;
  name: string;
  emoji: string;
  price: string;
  priceSuffix: string;
  trial: string;
  cta: string;
  features: string[];
  featured?: boolean;
}> = [
  {
    id: "pup",
    name: "The Pup",
    emoji: "🐶",
    price: "Free",
    priceSuffix: "card on file",
    trial: "Card verified, never charged unless you upgrade",
    cta: "Verify card & join free",
    features: ["1 free slip grade per day", "Basic sharp tracker (delayed)", "Community access", "Email verdicts"],
  },
  {
    id: "top_dog",
    name: "Top Dog",
    emoji: "🐕",
    price: "$29.99",
    priceSuffix: "/mo",
    trial: "7-day free trial",
    cta: "Start 7-day free trial",
    featured: true,
    features: [
      "Unlimited slip grading",
      "Live Sharp Tracker (real-time)",
      "Trap & correlation alerts",
      "Daily AI parlay picks",
      "Telegram alerts",
    ],
  },
  {
    id: "kennel_club",
    name: "Kennel Club",
    emoji: "🏆",
    price: "$99",
    priceSuffix: "/mo",
    trial: "3-day free trial",
    cta: "Start 3-day free trial",
    features: [
      "Everything in Top Dog",
      "Full Parlay Bot access",
      "Scout War Room (live games)",
      "Premium AI parlays + locks",
      "Priority support",
    ],
  },
];

export function FarmPricing({ onSelect }: Props) {
  return (
    <section id="pricing" className="relative py-24 px-5">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-14">
          <div className="text-xs uppercase tracking-widest text-[hsl(var(--sharp-green))] mb-2">Pricing</div>
          <h2 className="farm-display text-4xl md:text-5xl font-bold">Pick your pen.</h2>
          <p className="text-[hsl(var(--farm-muted))] mt-3">Card verified at signup. Cancel anytime, no hassle.</p>
        </div>

        <div className="grid md:grid-cols-3 gap-5">
          {TIERS.map((t) => (
            <div
              key={t.id}
              className={`farm-panel p-7 relative flex flex-col ${
                t.featured ? "green-glow border-[hsl(var(--sharp-green)/0.6)]" : ""
              }`}
            >
              {t.featured && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[hsl(var(--sharp-green))] text-[hsl(var(--farm-bg))] text-xs font-bold px-3 py-1 rounded-full inline-flex items-center gap-1">
                  <Star className="w-3 h-3" /> MOST POPULAR
                </div>
              )}
              <div className="text-3xl mb-2">{t.emoji}</div>
              <h3 className="farm-display text-2xl font-bold">{t.name}</h3>
              <div className="mt-3 mb-1">
                <span className="farm-display text-4xl font-bold">{t.price}</span>
                <span className="text-[hsl(var(--farm-muted))] text-sm ml-1">{t.priceSuffix}</span>
              </div>
              <div className="text-xs text-[hsl(var(--barn-amber))] mb-5">{t.trial}</div>

              <ul className="space-y-2.5 mb-7 flex-1">
                {t.features.map((f) => (
                  <li key={f} className="flex gap-2 text-sm">
                    <Check className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "hsl(var(--sharp-green))" }} />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              <button
                onClick={() => onSelect(t.id)}
                className={t.featured ? "farm-btn-primary w-full" : "farm-btn-ghost w-full"}
              >
                {t.cta}
              </button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
