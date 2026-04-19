import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Sparkles, Loader2, Type, Upload } from "lucide-react";
import { GradeReveal } from "./GradeReveal";
import { EmailGate } from "./EmailGate";

interface GradeResult {
  letter_grade: string;
  headline: string;
  composite_score: number;
  breakdown: Array<{ leg: string; verdict: string; fix?: string }>;
  fix_suggestion: string;
  share_card_id: string;
}

type Mode = "paste" | "upload";

export function InlineSlipGraderPromo() {
  const [mode, setMode] = useState<Mode>("paste");
  const [slipText, setSlipText] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<GradeResult | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const gradeLegs = async (legs: Array<{ description?: string; odds?: string; player?: string; propType?: string; line?: number; side?: string }>) => {
    const { data, error } = await supabase.functions.invoke("grade-slip", {
      body: { legs },
    });
    if (error) throw error;
    setResult(data as GradeResult);
  };

  const handleGrade = async () => {
    if (slipText.trim().length < 10) {
      toast.error("Paste a real slip — at least one leg.");
      return;
    }
    setLoading(true);
    try {
      const legs = slipText
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .map((line) => {
          const oddsMatch = line.match(/[+-]\d{2,4}/);
          return {
            description: line,
            odds: oddsMatch ? oddsMatch[0] : "-110",
          };
        });

      if (legs.length === 0) {
        toast.error("Couldn't find any legs in that.");
        setLoading(false);
        return;
      }

      await gradeLegs(legs);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Grader broke. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleScreenshotUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64 = (reader.result as string).split(",")[1];
          const { data, error } = await supabase.functions.invoke("extract-parlay", {
            body: { image: base64 },
          });
          if (error) throw error;
          const extractedLegs = data?.legs || [];
          if (!extractedLegs.length) {
            toast.error("Couldn't read any legs from that image. Try pasting instead.");
            setLoading(false);
            return;
          }
          await gradeLegs(extractedLegs);
        } catch (err: any) {
          console.error(err);
          toast.error(err.message || "Upload failed");
        } finally {
          setLoading(false);
        }
      };
      reader.onerror = () => {
        toast.error("Couldn't read that file");
        setLoading(false);
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Upload failed");
      setLoading(false);
    }
  };

  const handleReset = () => {
    setSlipText("");
    setResult(null);
    setUnlocked(false);
    setMode("paste");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border-2 border-primary/40 bg-gradient-to-br from-primary/15 via-primary/5 to-background p-5 sm:p-7">
      <div className="absolute top-3 right-3 text-xs font-bold uppercase tracking-wider bg-primary text-primary-foreground px-2 py-1 rounded-full z-10">
        Free
      </div>

      {!result && (
        <>
          <div className="flex items-start gap-3 mb-4">
            <div className="text-3xl sm:text-4xl shrink-0">🎓</div>
            <div className="flex-1 min-w-0">
              <h2 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-foreground mb-1">
                Free Slip Grader
              </h2>
              <p className="text-sm text-muted-foreground">
                Paste your slip or drop a screenshot. We'll tell you why it'll lose — and send you 7 days of free picks.
              </p>
            </div>
          </div>

          {/* Mode tabs */}
          <div className="flex gap-1 p-1 bg-muted/50 rounded-xl mb-3">
            {[
              { id: "paste", icon: Type, label: "Paste" },
              { id: "upload", icon: Upload, label: "Screenshot" },
            ].map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id as Mode)}
                className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold transition ${
                  mode === m.id
                    ? "bg-background text-foreground shadow"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <m.icon className="w-4 h-4" /> {m.label}
              </button>
            ))}
          </div>

          {mode === "paste" && (
            <>
              <Textarea
                value={slipText}
                onChange={(e) => setSlipText(e.target.value)}
                placeholder={`Paste your slip here, one leg per line. e.g.\nLuka Doncic Over 28.5 Pts -115\nJayson Tatum Over 5.5 Ast +100`}
                className="min-h-[120px] mb-3 font-mono text-sm bg-background/50"
              />
              <Button
                onClick={handleGrade}
                disabled={loading}
                variant="neon"
                size="lg"
                className="w-full gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Grading...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    Grade my slip free
                  </>
                )}
              </Button>
            </>
          )}

          {mode === "upload" && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleScreenshotUpload}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={loading}
                className="w-full border-2 border-dashed border-border rounded-xl p-8 text-center hover:border-primary hover:bg-background/30 transition disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="w-8 h-8 text-primary animate-spin" />
                    <div className="font-semibold text-sm">Reading your slip...</div>
                  </div>
                ) : (
                  <>
                    <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                    <div className="font-semibold text-sm mb-1">Tap to upload a screenshot</div>
                    <div className="text-xs text-muted-foreground">
                      DraftKings, FanDuel, BetMGM, PrizePicks — anything
                    </div>
                  </>
                )}
              </button>
            </>
          )}
        </>
      )}

      {result && (
        <div className="space-y-4">
          <GradeReveal
            letter={result.letter_grade}
            headline={result.headline}
            composite={result.composite_score}
          />

          {!unlocked ? (
            <EmailGate
              letterGrade={result.letter_grade}
              headline={result.headline}
              legCount={result.breakdown.length}
              breakdown={result.breakdown}
              fixSuggestion={result.fix_suggestion}
              shareCardId={result.share_card_id}
              onUnlocked={() => setUnlocked(true)}
            />
          ) : (
            <div className="rounded-xl border border-primary/30 bg-background/50 p-4 space-y-3">
              <h3 className="font-display text-lg font-bold">Per-leg breakdown</h3>
              {result.breakdown.map((b, i) => (
                <div key={i} className="text-sm border-l-2 border-primary/40 pl-3">
                  <div className="font-semibold text-foreground">{b.leg}</div>
                  <div className="text-muted-foreground">{b.verdict}</div>
                  {b.fix && (
                    <div className="text-primary text-xs mt-1">→ {b.fix}</div>
                  )}
                </div>
              ))}
              <div className="pt-2 text-sm font-semibold text-foreground border-t border-border">
                Fix: <span className="text-muted-foreground font-normal">{result.fix_suggestion}</span>
              </div>
            </div>
          )}

          <Button onClick={handleReset} variant="outline" size="sm" className="w-full">
            Grade another slip
          </Button>
        </div>
      )}
    </div>
  );
}
