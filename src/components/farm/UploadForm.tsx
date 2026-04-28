import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Upload, Loader2, CheckCircle2, Sparkles, Zap, ShieldCheck, Star } from "lucide-react";
import { ExampleSlipsCarousel } from "./ExampleSlipsCarousel";

export function UploadForm() {
  const [email, setEmail] = useState("");
  const [slip, setSlip] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.includes("@") || slip.trim().length < 5) {
      toast.error("Enter your email and paste your slip text.");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.from("leads").insert({
        email,
        slip_text: slip,
        source: "free_slip_upload",
        metadata: { user_agent: navigator.userAgent },
      });
      if (error) throw error;
      setDone(true);
      toast.success("Slip dropped! We'll email your verdict shortly.");
    } catch (err: any) {
      toast.error(err.message || "Couldn't drop slip");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section id="upload" className="relative py-20 px-5 overflow-hidden">
      {/* Ambient glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% 0%, hsl(var(--sharp-green) / 0.12), transparent 60%)",
        }}
      />
      <div className="max-w-3xl mx-auto">
        {/* Heading */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[hsl(var(--sharp-green)/0.4)] bg-[hsl(var(--sharp-green)/0.08)] mb-4">
            <Sparkles className="w-3.5 h-3.5 text-[hsl(var(--sharp-green))]" />
            <span className="text-[11px] uppercase tracking-widest text-[hsl(var(--sharp-green))] font-bold">
              Free · No signup · 60 seconds
            </span>
          </div>
          <h2 className="farm-display text-4xl md:text-6xl font-black leading-[1.05]">
            Is your slip <span className="text-[hsl(var(--sharp-green))]">cooked</span>
            <br className="hidden sm:block" />
            <span className="sm:hidden"> </span>or a <span className="italic">lock</span>?
          </h2>
          <p className="text-[hsl(var(--farm-muted))] mt-4 text-base md:text-lg max-w-xl mx-auto">
            Drop your parlay. Our AI grades every leg in seconds — and tells you exactly which one is killing your ticket. 🐕
          </p>

          {/* Social proof row */}
          <div className="mt-6 flex items-center justify-center gap-4 flex-wrap text-xs text-[hsl(var(--farm-muted))]">
            <div className="flex items-center gap-1">
              <div className="flex -space-x-1.5">
                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-orange-400 to-pink-500 border-2 border-[hsl(var(--farm-bg))]" />
                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-cyan-400 to-blue-600 border-2 border-[hsl(var(--farm-bg))]" />
                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-purple-400 to-pink-500 border-2 border-[hsl(var(--farm-bg))]" />
                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-green-400 to-emerald-600 border-2 border-[hsl(var(--farm-bg))]" />
              </div>
              <span className="ml-1.5"><span className="text-[hsl(var(--farm-text))] font-bold">12,400+</span> slips graded</span>
            </div>
            <div className="flex items-center gap-1">
              <Star className="w-3.5 h-3.5 fill-yellow-400 text-yellow-400" />
              <Star className="w-3.5 h-3.5 fill-yellow-400 text-yellow-400" />
              <Star className="w-3.5 h-3.5 fill-yellow-400 text-yellow-400" />
              <Star className="w-3.5 h-3.5 fill-yellow-400 text-yellow-400" />
              <Star className="w-3.5 h-3.5 fill-yellow-400 text-yellow-400" />
              <span className="ml-1"><span className="text-[hsl(var(--farm-text))] font-bold">4.9</span> from bettors</span>
            </div>
          </div>
        </div>

        {/* Example verdicts carousel — social proof before upload */}
        {!done && <ExampleSlipsCarousel />}

        {done ? (
          <div className="farm-panel p-10 text-center">
            <CheckCircle2 className="w-12 h-12 mx-auto mb-4" style={{ color: "hsl(var(--sharp-green))" }} />
            <h3 className="farm-display text-2xl font-bold mb-2">Slip dropped 🐕</h3>
            <p className="text-[hsl(var(--farm-muted))]">
              Verdict heading to <span className="text-[hsl(var(--farm-text))] font-semibold">{email}</span> within minutes.
            </p>
            <p className="text-xs text-[hsl(var(--farm-muted))] mt-4">Tip: check your spam — and whitelist us so you never miss a verdict.</p>
          </div>
        ) : (
          <div className="relative">
            {/* Glow halo behind card */}
            <div
              aria-hidden
              className="absolute -inset-1 rounded-2xl opacity-60 blur-xl"
              style={{
                background:
                  "linear-gradient(135deg, hsl(var(--sharp-green) / 0.4), transparent 60%)",
              }}
            />
            <form
              onSubmit={handleSubmit}
              className="farm-panel relative p-5 sm:p-7 space-y-4 border border-[hsl(var(--farm-line))]"
            >
              {/* Ribbon */}
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-[hsl(var(--sharp-green))] text-black text-[10px] font-black uppercase tracking-widest shadow-lg">
                🎁 100% Free Verdict
              </div>

              <div className="border-2 border-dashed border-[hsl(var(--farm-line))] rounded-xl p-6 text-center hover:border-[hsl(var(--sharp-green)/0.6)] hover:bg-[hsl(var(--sharp-green)/0.04)] transition-all group">
                <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-[hsl(var(--sharp-green)/0.1)] flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Upload className="w-5 h-5 text-[hsl(var(--sharp-green))]" />
                </div>
                <p className="text-sm font-semibold text-[hsl(var(--farm-text))]">
                  Paste your slip text below
                </p>
                <p className="text-xs text-[hsl(var(--farm-muted))] mt-1">
                  📸 Screenshot OCR coming soon
                </p>
              </div>

              <textarea
                value={slip}
                onChange={(e) => setSlip(e.target.value)}
                placeholder={"Tatum Over 27.5 Pts -115\nLakers ML +150\nDavis Over 11.5 Reb -110…"}
                rows={5}
                className="w-full bg-[hsl(var(--farm-bg))] border border-[hsl(var(--farm-line))] rounded-lg px-4 py-3 text-sm font-mono focus:border-[hsl(var(--sharp-green))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--sharp-green)/0.2)] transition-all"
              />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@email.com — verdict lands here 📬"
                className="w-full bg-[hsl(var(--farm-bg))] border border-[hsl(var(--farm-line))] rounded-lg px-4 py-3 focus:border-[hsl(var(--sharp-green))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--sharp-green)/0.2)] transition-all"
              />
              <button
                type="submit"
                disabled={loading}
                className="farm-btn-primary w-full text-base flex items-center justify-center gap-2 py-4 font-black tracking-wide hover:scale-[1.01] active:scale-[0.99] transition-transform shadow-lg shadow-[hsl(var(--sharp-green)/0.25)]"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Grading your slip…
                  </>
                ) : (
                  <>
                    🐕 Grade my slip — FREE
                    <Zap className="w-4 h-4" />
                  </>
                )}
              </button>

              {/* Trust row */}
              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-[hsl(var(--farm-line))]">
                <div className="flex flex-col items-center gap-1 text-center">
                  <Zap className="w-4 h-4 text-[hsl(var(--sharp-green))]" />
                  <span className="text-[10px] text-[hsl(var(--farm-muted))] font-semibold">Verdict in 60s</span>
                </div>
                <div className="flex flex-col items-center gap-1 text-center">
                  <ShieldCheck className="w-4 h-4 text-[hsl(var(--sharp-green))]" />
                  <span className="text-[10px] text-[hsl(var(--farm-muted))] font-semibold">No spam, ever</span>
                </div>
                <div className="flex flex-col items-center gap-1 text-center">
                  <Sparkles className="w-4 h-4 text-[hsl(var(--sharp-green))]" />
                  <span className="text-[10px] text-[hsl(var(--farm-muted))] font-semibold">All sports</span>
                </div>
              </div>
            </form>
          </div>
        )}

        {/* Testimonial */}
        {!done && (
          <div className="mt-8 max-w-xl mx-auto text-center">
            <p className="text-sm text-[hsl(var(--farm-muted))] italic">
              "Saved me from a 5-leg disaster. The AI flagged the bait leg in 30 seconds."
            </p>
            <p className="text-xs text-[hsl(var(--farm-text))] font-semibold mt-2">
              — Marcus T. <span className="text-[hsl(var(--sharp-green))]">· cashed +$840 last week</span>
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
