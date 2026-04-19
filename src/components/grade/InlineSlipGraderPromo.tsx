import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Sparkles, Loader2 } from "lucide-react";
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

export function InlineSlipGraderPromo() {
  const [slipText, setSlipText] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<GradeResult | null>(null);
  const [unlocked, setUnlocked] = useState(false);

  const handleGrade = async () => {
    if (slipText.trim().length < 10) {
      toast.error("Paste a real slip — at least one leg.");
      return;
    }
    setLoading(true);
    try {
      // Naive parse: split lines, treat each line as a leg description
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

      const { data, error } = await supabase.functions.invoke("grade-slip", {
        body: { legs },
      });
      if (error) throw error;
      setResult(data as GradeResult);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Grader broke. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setSlipText("");
    setResult(null);
    setUnlocked(false);
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
                Paste your slip. We'll tell you why it'll lose — and send you 7 days of free picks.
              </p>
            </div>
          </div>

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
