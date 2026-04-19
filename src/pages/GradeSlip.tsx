import { useState, useRef } from "react";
import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Upload, Type, Edit3, Loader2, Plus, Trash2, ArrowLeft } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { GradeReveal } from "@/components/grade/GradeReveal";
import { EmailGate } from "@/components/grade/EmailGate";
import { ShareCard } from "@/components/grade/ShareCard";

interface Leg {
  description?: string;
  odds?: string;
  player?: string;
  propType?: string;
  line?: number;
  side?: string;
}

interface GradeResult {
  letter_grade: string;
  headline: string;
  composite_score: number;
  breakdown: Array<{ leg: string; odds?: string; verdict: string; fix?: string; score: number }>;
  fix_suggestion: string;
  share_card_id: string;
}

type Mode = "paste" | "upload" | "manual";
type Stage = "input" | "grading" | "preview" | "unlocked";

export default function GradeSlip() {
  const [mode, setMode] = useState<Mode>("paste");
  const [stage, setStage] = useState<Stage>("input");
  const [pasteText, setPasteText] = useState("");
  const [manualLegs, setManualLegs] = useState<Leg[]>([
    { player: "", propType: "", line: 0, side: "OVER", odds: "-110" },
  ]);
  const [legs, setLegs] = useState<Leg[]>([]);
  const [result, setResult] = useState<GradeResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const parsePastedText = (text: string): Leg[] => {
    // Simple parser: split by newlines, look for odds patterns
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const oddsMatch = line.match(/([+-]\d{2,4})/);
        return {
          description: line,
          odds: oddsMatch ? oddsMatch[1] : "-110",
        };
      });
  };

  const handleScreenshotUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setStage("grading");
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(",")[1];
        const { data, error } = await supabase.functions.invoke("extract-parlay", {
          body: { image: base64 },
        });
        if (error) throw error;
        const extractedLegs: Leg[] = data?.legs || [];
        if (!extractedLegs.length) throw new Error("Couldn't read any legs from that image");
        await gradeLegs(extractedLegs);
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      toast.error(err.message || "Upload failed");
      setStage("input");
    }
  };

  const gradeLegs = async (legsToGrade: Leg[]) => {
    setStage("grading");
    setLegs(legsToGrade);
    try {
      const { data, error } = await supabase.functions.invoke("grade-slip", {
        body: { legs: legsToGrade },
      });
      if (error) throw error;
      setResult(data as GradeResult);
      setStage("preview");
    } catch (err: any) {
      toast.error(err.message || "Grading failed");
      setStage("input");
    }
  };

  const handlePasteSubmit = () => {
    const parsed = parsePastedText(pasteText);
    if (!parsed.length) {
      toast.error("Paste some legs first");
      return;
    }
    gradeLegs(parsed);
  };

  const handleManualSubmit = () => {
    const valid = manualLegs.filter((l) => l.player && l.propType);
    if (!valid.length) {
      toast.error("Fill in at least one leg");
      return;
    }
    gradeLegs(
      valid.map((l) => ({
        ...l,
        description: `${l.player} ${l.side} ${l.line} ${l.propType}`,
      })),
    );
  };

  const reset = () => {
    setStage("input");
    setResult(null);
    setLegs([]);
    setPasteText("");
    setManualLegs([{ player: "", propType: "", line: 0, side: "OVER", odds: "-110" }]);
  };

  return (
    <>
      <Helmet>
        <title>Free Slip Grader — We'll Tell You Why It'll Lose | ParlayFarm</title>
        <meta
          name="description"
          content="Paste your parlay slip. Get a brutal honest A–F grade plus 7 days of free picks. No signup required to grade."
        />
        <link rel="canonical" href="https://parlayfarm.com/grade" />
      </Helmet>

      <div className="min-h-screen bg-background text-foreground">
        <div className="max-w-3xl mx-auto px-4 py-8 sm:py-12">
          <Link
            to="/"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6"
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </Link>

          {/* Hero */}
          <header className="text-center mb-8 sm:mb-10">
            <div className="text-xs font-mono uppercase tracking-widest text-primary mb-3">
              Free Slip Grader
            </div>
            <h1 className="font-display text-4xl sm:text-6xl font-black leading-tight mb-4">
              Paste your slip.
              <br />
              <span className="text-destructive">We'll tell you why it'll lose.</span>
            </h1>
            <p className="text-muted-foreground text-base sm:text-lg max-w-xl mx-auto">
              Brutally honest A–F grade in 5 seconds. Plus 7 days of free picks if you want
              the breakdown.
            </p>
          </header>

          <AnimatePresence mode="wait">
            {stage === "input" && (
              <motion.div
                key="input"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                className="space-y-4"
              >
                {/* Mode tabs */}
                <div className="flex gap-2 p-1 bg-muted rounded-xl">
                  {[
                    { id: "paste", icon: Type, label: "Paste" },
                    { id: "upload", icon: Upload, label: "Screenshot" },
                    { id: "manual", icon: Edit3, label: "Manual" },
                  ].map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setMode(m.id as Mode)}
                      className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-semibold transition ${
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
                  <div className="space-y-3">
                    <Textarea
                      value={pasteText}
                      onChange={(e) => setPasteText(e.target.value)}
                      placeholder={"Paste your slip text here. One leg per line, e.g.:\nLuka Doncic OVER 8.5 Assists -110\nJokic OVER 25.5 Pts +105"}
                      rows={8}
                      className="font-mono text-sm"
                    />
                    <Button onClick={handlePasteSubmit} variant="neon" size="lg" className="w-full">
                      Grade my slip
                    </Button>
                  </div>
                )}

                {mode === "upload" && (
                  <div className="space-y-3">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleScreenshotUpload}
                      className="hidden"
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full border-2 border-dashed border-border rounded-2xl p-12 text-center hover:border-primary transition"
                    >
                      <Upload className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                      <div className="font-semibold mb-1">Drop a screenshot</div>
                      <div className="text-sm text-muted-foreground">
                        DraftKings, FanDuel, BetMGM, anything
                      </div>
                    </button>
                  </div>
                )}

                {mode === "manual" && (
                  <div className="space-y-3">
                    {manualLegs.map((leg, i) => (
                      <div key={i} className="grid grid-cols-12 gap-2 p-3 bg-card rounded-xl border">
                        <div className="col-span-12 sm:col-span-4">
                          <Label className="text-xs">Player</Label>
                          <Input
                            value={leg.player || ""}
                            onChange={(e) => {
                              const next = [...manualLegs];
                              next[i].player = e.target.value;
                              setManualLegs(next);
                            }}
                            placeholder="Luka Doncic"
                          />
                        </div>
                        <div className="col-span-6 sm:col-span-3">
                          <Label className="text-xs">Prop</Label>
                          <Input
                            value={leg.propType || ""}
                            onChange={(e) => {
                              const next = [...manualLegs];
                              next[i].propType = e.target.value;
                              setManualLegs(next);
                            }}
                            placeholder="Points"
                          />
                        </div>
                        <div className="col-span-3 sm:col-span-2">
                          <Label className="text-xs">Line</Label>
                          <Input
                            type="number"
                            value={leg.line || ""}
                            onChange={(e) => {
                              const next = [...manualLegs];
                              next[i].line = parseFloat(e.target.value);
                              setManualLegs(next);
                            }}
                          />
                        </div>
                        <div className="col-span-3 sm:col-span-2">
                          <Label className="text-xs">Side</Label>
                          <select
                            value={leg.side}
                            onChange={(e) => {
                              const next = [...manualLegs];
                              next[i].side = e.target.value;
                              setManualLegs(next);
                            }}
                            className="w-full h-12 rounded-xl border border-input bg-background px-3 text-base"
                          >
                            <option>OVER</option>
                            <option>UNDER</option>
                          </select>
                        </div>
                        <div className="col-span-9 sm:col-span-1">
                          <Label className="text-xs">Odds</Label>
                          <Input
                            value={leg.odds || ""}
                            onChange={(e) => {
                              const next = [...manualLegs];
                              next[i].odds = e.target.value;
                              setManualLegs(next);
                            }}
                            placeholder="-110"
                          />
                        </div>
                        <div className="col-span-3 sm:col-span-12 flex sm:justify-end items-end">
                          {manualLegs.length > 1 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setManualLegs(manualLegs.filter((_, idx) => idx !== i))}
                            >
                              <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        onClick={() =>
                          setManualLegs([
                            ...manualLegs,
                            { player: "", propType: "", line: 0, side: "OVER", odds: "-110" },
                          ])
                        }
                        className="gap-2"
                      >
                        <Plus className="w-4 h-4" /> Add leg
                      </Button>
                      <Button onClick={handleManualSubmit} variant="neon" className="flex-1">
                        Grade my slip
                      </Button>
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {stage === "grading" && (
              <motion.div
                key="grading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-center py-16"
              >
                <Loader2 className="w-12 h-12 mx-auto animate-spin text-primary mb-4" />
                <div className="font-display text-2xl font-bold">Grading your slip…</div>
                <div className="text-muted-foreground text-sm mt-1">
                  Running it past the bot. Hold tight.
                </div>
              </motion.div>
            )}

            {stage === "preview" && result && (
              <motion.div
                key="preview"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-6"
              >
                <GradeReveal
                  letter={result.letter_grade}
                  headline={result.headline}
                  composite={result.composite_score}
                />
                <EmailGate
                  letterGrade={result.letter_grade}
                  headline={result.headline}
                  legCount={legs.length}
                  breakdown={result.breakdown}
                  fixSuggestion={result.fix_suggestion}
                  shareCardId={result.share_card_id}
                  onUnlocked={() => setStage("unlocked")}
                />
                <div className="text-center">
                  <Button variant="ghost" onClick={reset} size="sm">
                    Grade another slip
                  </Button>
                </div>
              </motion.div>
            )}

            {stage === "unlocked" && result && (
              <motion.div
                key="unlocked"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-6"
              >
                <GradeReveal
                  letter={result.letter_grade}
                  headline={result.headline}
                  composite={result.composite_score}
                />

                <div className="rounded-2xl border bg-card p-5 sm:p-6">
                  <h3 className="font-display text-xl font-bold mb-4">
                    Per-leg breakdown
                  </h3>
                  <div className="space-y-3">
                    {result.breakdown.map((b, i) => (
                      <div key={i} className="border-l-2 border-primary/40 pl-4 py-1">
                        <div className="font-semibold text-sm">
                          {i + 1}. {b.leg}{" "}
                          <span className="text-muted-foreground font-mono text-xs">
                            ({b.odds})
                          </span>
                        </div>
                        <div className="text-sm text-muted-foreground mt-0.5">{b.verdict}</div>
                        {b.fix && (
                          <div className="text-xs text-primary mt-1 font-medium">
                            → {b.fix}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="mt-5 p-4 rounded-lg bg-primary/10 border border-primary/30">
                    <div className="text-xs font-mono uppercase tracking-widest text-primary mb-1">
                      The fix
                    </div>
                    <div className="text-sm font-semibold">{result.fix_suggestion}</div>
                  </div>
                </div>

                <div className="rounded-2xl border bg-card p-5 sm:p-6">
                  <h3 className="font-display text-xl font-bold mb-3">
                    Brag about it (or warn your friends)
                  </h3>
                  <ShareCard
                    letterGrade={result.letter_grade}
                    headline={result.headline}
                    legCount={legs.length}
                    shareCardId={result.share_card_id}
                  />
                </div>

                <div className="text-center">
                  <Button variant="neon" onClick={reset} size="lg">
                    Grade another slip
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </>
  );
}
