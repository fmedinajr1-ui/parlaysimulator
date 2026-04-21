import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Upload, Loader2, CheckCircle2 } from "lucide-react";

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
    <section id="upload" className="relative py-24 px-5">
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-10">
          <div className="text-xs uppercase tracking-widest text-[hsl(var(--sharp-green))] mb-2">Free slip upload</div>
          <h2 className="farm-display text-4xl md:text-5xl font-bold">Drop a slip. Get a verdict.</h2>
          <p className="text-[hsl(var(--farm-muted))] mt-3">No signup. We'll email your AI grade.</p>
        </div>

        {done ? (
          <div className="farm-panel p-10 text-center">
            <CheckCircle2 className="w-12 h-12 mx-auto mb-4" style={{ color: "hsl(var(--sharp-green))" }} />
            <h3 className="farm-display text-2xl font-bold mb-2">Slip dropped 🐕</h3>
            <p className="text-[hsl(var(--farm-muted))]">Verdict heading to <span className="text-[hsl(var(--farm-text))] font-semibold">{email}</span> within minutes.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="farm-panel p-6 space-y-4">
            <div className="border-2 border-dashed border-[hsl(var(--farm-line))] rounded-lg p-6 text-center hover:border-[hsl(var(--sharp-green)/0.5)] transition-colors">
              <Upload className="w-7 h-7 mx-auto mb-2 text-[hsl(var(--farm-muted))]" />
              <p className="text-sm text-[hsl(var(--farm-muted))]">Paste your slip text below — or screenshot OCR coming soon</p>
            </div>
            <textarea
              value={slip}
              onChange={(e) => setSlip(e.target.value)}
              placeholder="Tatum Over 27.5 Pts -115&#10;Lakers ML +150&#10;Davis Over 11.5 Reb -110…"
              rows={5}
              className="w-full bg-[hsl(var(--farm-bg))] border border-[hsl(var(--farm-line))] rounded-lg px-4 py-3 text-sm font-mono focus:border-[hsl(var(--sharp-green))] focus:outline-none"
            />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@email.com"
              className="w-full bg-[hsl(var(--farm-bg))] border border-[hsl(var(--farm-line))] rounded-lg px-4 py-3 focus:border-[hsl(var(--sharp-green))] focus:outline-none"
            />
            <button type="submit" disabled={loading} className="farm-btn-primary w-full text-base flex items-center justify-center gap-2">
              {loading ? <><Loader2 className="w-4 h-4 animate-spin" />Dropping…</> : "🐕 Drop slip — get free verdict"}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
