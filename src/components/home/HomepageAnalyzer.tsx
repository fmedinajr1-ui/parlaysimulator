import React, { useState, useCallback, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { createLeg, simulateParlay } from "@/lib/parlay-calculator";
import { ParlaySimulation, DEGEN_TIERS } from "@/types/parlay";
import { WolfLoader } from "@/components/ui/wolf-loader";
import { toast } from "sonner";
import { Upload, Camera, Type, Lock, Zap, TrendingUp, AlertTriangle, ChevronDown, ChevronUp, X } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { cn } from "@/lib/utils";

const PRICE_ID = "price_1T2fxS9D6r1PTCBBa2p8P3wY";

interface ExtractedLeg {
  description: string;
  odds: string;
  player?: string;
  propType?: string;
  line?: number;
  side?: string;
}

type InputMode = "upload" | "manual";
type AnalyzerState = "idle" | "extracting" | "simulating" | "results" | "unlocking" | "advanced";

interface AdvancedResults {
  legAnalyses: any[];
  swapSuggestions: any[];
  overallAssessment: string;
}

export function HomepageAnalyzer() {
  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState<InputMode>("upload");
  const [state, setState] = useState<AnalyzerState>("idle");
  const [extractedLegs, setExtractedLegs] = useState<ExtractedLeg[]>([]);
  const [manualText, setManualText] = useState("");
  const [simulation, setSimulation] = useState<ParlaySimulation | null>(null);
  const [advancedResults, setAdvancedResults] = useState<AdvancedResults | null>(null);
  const [showAllLegs, setShowAllLegs] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Check for payment redirect
  const isPaid = searchParams.get("analysis_paid") === "true";
  const sessionId = searchParams.get("session_id");

  // Handle payment verification on mount
  React.useEffect(() => {
    if (isPaid && sessionId && state === "idle") {
      verifyPaymentAndUnlock(sessionId);
    }
  }, [isPaid, sessionId]);

  const verifyPaymentAndUnlock = async (sid: string) => {
    setState("unlocking");
    try {
      const { data, error } = await supabase.functions.invoke("verify-analysis-payment", {
        body: { sessionId: sid },
      });
      if (error) throw error;
      if (data?.legs) {
        setExtractedLegs(data.legs);
        const parlayLegs = data.legs.map((l: ExtractedLeg) => createLeg(l.description, parseInt(l.odds) || -110));
        setSimulation(simulateParlay(parlayLegs, 10));
      }
      if (data?.advanced) {
        setAdvancedResults(data.advanced);
        setState("advanced");
      } else {
        setState("results");
      }
    } catch (err: any) {
      toast.error("Payment verification failed. Please contact support.");
      setState("idle");
    }
  };

  const compressImage = async (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          const maxDim = 1200;
          let w = img.width, h = img.height;
          if (w > maxDim || h > maxDim) {
            const ratio = Math.min(maxDim / w, maxDim / h);
            w = Math.round(w * ratio);
            h = Math.round(h * ratio);
          }
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d")!;
          ctx.drawImage(img, 0, 0, w, h);
          const base64 = canvas.toDataURL("image/jpeg", 0.8).split(",")[1];
          resolve(base64);
        };
        img.onerror = reject;
        img.src = e.target?.result as string;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setState("extracting");
    try {
      const base64 = await compressImage(file);
      const { data, error } = await supabase.functions.invoke("extract-parlay", {
        body: { imageBase64: base64 },
      });
      if (error) throw error;
      if (!data?.legs?.length) {
        toast.error("Couldn't detect a bet slip. Try a clearer image.");
        setState("idle");
        return;
      }
      setExtractedLegs(data.legs);
      runSimulation(data.legs, data.totalOdds);
    } catch (err: any) {
      toast.error(err.message || "Failed to extract parlay");
      setState("idle");
    }
  };

  const handleManualSubmit = () => {
    const lines = manualText.trim().split("\n").filter(Boolean);
    if (lines.length < 2) {
      toast.error("Enter at least 2 legs (one per line)");
      return;
    }
    const legs: ExtractedLeg[] = lines.map((line) => {
      // Try to parse "description @ odds" format
      const match = line.match(/^(.+?)\s*@\s*([+-]?\d+)$/);
      if (match) {
        return { description: match[1].trim(), odds: match[2] };
      }
      return { description: line.trim(), odds: "-110" };
    });
    setExtractedLegs(legs);
    runSimulation(legs);
  };

  const runSimulation = (legs: ExtractedLeg[], totalOdds?: string) => {
    setState("simulating");
    try {
      const parlayLegs = legs.map((l) => createLeg(l.description, parseInt(l.odds) || -110));
      const providedTotal = totalOdds ? parseInt(totalOdds.replace("+", "")) : undefined;
      const sim = simulateParlay(parlayLegs, 10, providedTotal);
      setSimulation(sim);
      setState("results");
    } catch {
      toast.error("Simulation failed");
      setState("idle");
    }
  };

  const handleUnlockCheckout = async () => {
    setState("unlocking");
    try {
      const { data, error } = await supabase.functions.invoke("create-analysis-checkout", {
        body: {
          priceId: PRICE_ID,
          legs: extractedLegs,
        },
      });
      if (error) throw error;
      if (data?.url) {
        window.open(data.url, "_blank");
      }
    } catch (err: any) {
      toast.error(err.message || "Checkout failed");
    } finally {
      setState("results");
    }
  };

  const resetAnalyzer = () => {
    setState("idle");
    setExtractedLegs([]);
    setSimulation(null);
    setAdvancedResults(null);
    setManualText("");
    setShowAllLegs(false);
  };

  const tier = simulation ? DEGEN_TIERS[simulation.degenerateLevel] : null;
  const legsToShow = showAllLegs ? simulation?.legs : simulation?.legs.slice(0, 3);

  return (
    <Card className="border-primary/30 bg-card/80 backdrop-blur overflow-hidden">
      <CardContent className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-display text-lg font-bold flex items-center gap-2">
              <Zap className="w-5 h-5 text-primary" />
              Free Parlay Analyzer
            </h3>
            <p className="text-xs text-muted-foreground">No account needed • Instant results</p>
          </div>
          {state !== "idle" && (
            <Button variant="ghost" size="sm" onClick={resetAnalyzer} className="h-8 w-8 p-0">
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>

        {/* Input Section */}
        {state === "idle" && (
          <>
            {/* Mode Toggle */}
            <div className="flex gap-2">
              <Button
                variant={mode === "upload" ? "default" : "outline"}
                size="sm"
                className="flex-1 gap-2"
                onClick={() => setMode("upload")}
              >
                <Camera className="w-4 h-4" /> Screenshot
              </Button>
              <Button
                variant={mode === "manual" ? "default" : "outline"}
                size="sm"
                className="flex-1 gap-2"
                onClick={() => setMode("manual")}
              >
                <Type className="w-4 h-4" /> Type It
              </Button>
            </div>

            {mode === "upload" ? (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-primary/30 rounded-xl p-6 text-center cursor-pointer hover:border-primary/60 transition-colors active:scale-[0.98]"
              >
                <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm font-medium">Upload your bet slip</p>
                <p className="text-xs text-muted-foreground mt-1">PNG, JPG, or screenshot</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFileUpload}
                />
              </div>
            ) : (
              <div className="space-y-2">
                <Textarea
                  value={manualText}
                  onChange={(e) => setManualText(e.target.value)}
                  placeholder={"LeBron James Over 25.5 Pts @ -115\nSteph Curry Over 4.5 3PM @ +120\nJokic Over 10.5 Reb @ -130"}
                  rows={4}
                  className="text-sm"
                />
                <Button className="w-full" onClick={handleManualSubmit} disabled={!manualText.trim()}>
                  🎯 Analyze Parlay
                </Button>
              </div>
            )}
          </>
        )}

        {/* Loading States */}
        {(state === "extracting" || state === "simulating") && (
          <div className="py-6 flex flex-col items-center gap-3">
            <WolfLoader size="sm" text={state === "extracting" ? "Reading your slip..." : "Running simulation..."} />
          </div>
        )}

        {/* Free Results */}
        {(state === "results" || state === "advanced") && simulation && tier && (
          <div className="space-y-3">
            {/* Risk Label */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <div className="flex items-center gap-2">
                <span className="text-xl">{tier.emoji}</span>
                <div>
                  <p className="text-sm font-bold">{tier.label}</p>
                  <p className="text-xs text-muted-foreground">{tier.subtext}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-lg font-bold text-primary">
                  {(simulation.combinedProbability * 100).toFixed(1)}%
                </p>
                <p className="text-xs text-muted-foreground">Win Prob</p>
              </div>
            </div>

            {/* Stats Row */}
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="p-2 rounded-lg bg-muted/30">
                <p className="text-xs text-muted-foreground">Odds</p>
                <p className="text-sm font-bold">
                  {simulation.totalOdds > 0 ? "+" : ""}{simulation.totalOdds}
                </p>
              </div>
              <div className="p-2 rounded-lg bg-muted/30">
                <p className="text-xs text-muted-foreground">$10 Pays</p>
                <p className="text-sm font-bold text-primary">${simulation.potentialPayout.toFixed(2)}</p>
              </div>
              <div className="p-2 rounded-lg bg-muted/30">
                <p className="text-xs text-muted-foreground">EV</p>
                <p className={cn("text-sm font-bold", simulation.expectedValue >= 0 ? "text-chart-2" : "text-destructive")}>
                  {simulation.expectedValue >= 0 ? "+" : ""}${simulation.expectedValue.toFixed(2)}
                </p>
              </div>
            </div>

            {/* Leg Breakdown */}
            <div className="space-y-1">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Leg Breakdown</p>
              {legsToShow?.map((leg, i) => (
                <div key={leg.id} className="flex items-center justify-between p-2 rounded-md bg-muted/20 text-sm">
                  <span className="truncate flex-1 mr-2">{leg.description}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-muted-foreground">
                      {(leg.impliedProbability * 100).toFixed(0)}%
                    </span>
                    <span className={cn(
                      "text-xs font-mono px-1.5 py-0.5 rounded",
                      leg.riskLevel === "low" ? "bg-chart-2/20 text-chart-2" :
                      leg.riskLevel === "medium" ? "bg-chart-4/20 text-chart-4" :
                      leg.riskLevel === "high" ? "bg-chart-5/20 text-chart-5" :
                      "bg-destructive/20 text-destructive"
                    )}>
                      {leg.odds > 0 ? "+" : ""}{leg.odds}
                    </span>
                  </div>
                </div>
              ))}
              {simulation.legs.length > 3 && (
                <button
                  onClick={() => setShowAllLegs(!showAllLegs)}
                  className="flex items-center gap-1 text-xs text-primary hover:underline pt-1"
                >
                  {showAllLegs ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  {showAllLegs ? "Show less" : `+${simulation.legs.length - 3} more legs`}
                </button>
              )}
            </div>

            {/* Verdict */}
            <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
              <p className="text-sm">
                <span className="font-semibold">Verdict: </span>
                {simulation.combinedProbability > 0.15
                  ? `${simulation.legs.filter(l => l.riskLevel === "low" || l.riskLevel === "medium").length} of ${simulation.legs.length} legs look strong`
                  : "This parlay is a long shot — proceed with caution"}
              </p>
            </div>

            {/* Advanced Section — locked or unlocked */}
            {state === "advanced" && advancedResults ? (
              <div className="space-y-3 border-t border-primary/20 pt-3">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-primary" />
                  <p className="text-sm font-bold text-primary">Advanced Analysis Unlocked</p>
                </div>
                {advancedResults.legAnalyses?.map((la: any, i: number) => (
                  <div key={i} className="p-3 rounded-lg bg-muted/30 space-y-1">
                    <p className="text-sm font-semibold">{la.description || `Leg ${i + 1}`}</p>
                    {la.insights?.map((insight: string, j: number) => (
                      <p key={j} className="text-xs text-muted-foreground">• {insight}</p>
                    ))}
                    {la.swapSuggestion && (
                      <div className="mt-1 p-2 rounded bg-chart-2/10 border border-chart-2/20">
                        <p className="text-xs font-semibold text-chart-2">💡 Swap Suggestion</p>
                        <p className="text-xs">{la.swapSuggestion}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : state === "results" ? (
              <div className="relative">
                {/* Blurred preview */}
                <div className="filter blur-sm pointer-events-none select-none space-y-2 opacity-60">
                  <div className="p-3 rounded-lg bg-muted/30">
                    <p className="text-sm font-semibold">AI Leg Analysis</p>
                    <p className="text-xs text-muted-foreground">• Trap detection signals found on 2 legs</p>
                    <p className="text-xs text-muted-foreground">• Fatigue factor: moderate impact</p>
                  </div>
                  <div className="p-3 rounded-lg bg-chart-2/10">
                    <p className="text-sm font-semibold text-chart-2">💡 Smart Swap Suggestions</p>
                    <p className="text-xs">Replace weak legs with our data-backed picks</p>
                  </div>
                </div>
                {/* Overlay CTA */}
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/60 backdrop-blur-sm rounded-lg">
                  <Lock className="w-6 h-6 text-muted-foreground mb-2" />
                  <p className="text-sm font-bold mb-1">Advanced Analysis</p>
                  <p className="text-xs text-muted-foreground mb-3">AI insights, swap picks & trap detection</p>
                  <Button
                    onClick={handleUnlockCheckout}
                    disabled={false}
                    className="gap-2"
                    variant="neon"
                    size="sm"
                  >
                    <Zap className="w-4 h-4" />
                    Unlock for $20
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        )}

        {/* Unlocking state */}
        {state === "unlocking" && (
          <div className="py-6 flex flex-col items-center gap-3">
            <WolfLoader size="sm" text="Verifying payment..." />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
