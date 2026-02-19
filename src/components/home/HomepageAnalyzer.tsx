import React, { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { createLeg, simulateParlay } from "@/lib/parlay-calculator";
import { ParlaySimulation, DEGEN_TIERS } from "@/types/parlay";
import { WolfLoader } from "@/components/ui/wolf-loader";
import { toast } from "sonner";
import { Upload, Camera, Type, Lock, Zap, TrendingUp, AlertTriangle, ChevronDown, ChevronUp, X, Check, Shield } from "lucide-react";
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

  const isPaid = searchParams.get("analysis_paid") === "true";
  const sessionId = searchParams.get("session_id");

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
      const match = line.match(/^(.+?)\s*@\s*([+-]?\d+)$/);
      if (match) return { description: match[1].trim(), odds: match[2] };
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
        body: { priceId: PRICE_ID, legs: extractedLegs },
      });
      if (error) throw error;
      if (data?.url) window.open(data.url, "_blank");
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
  const winProbPct = simulation ? Math.round(simulation.combinedProbability * 100) : 0;

  const getRiskColor = (level: string) => {
    if (level === "low") return "border-l-neon-green";
    if (level === "medium") return "border-l-neon-yellow";
    if (level === "high") return "border-l-neon-orange";
    return "border-l-neon-red";
  };

  const getRiskBarColor = (level: string) => {
    if (level === "low") return "bg-neon-green";
    if (level === "medium") return "bg-neon-yellow";
    if (level === "high") return "bg-neon-orange";
    return "bg-neon-red";
  };

  return (
    <section className="relative w-full bg-gradient-to-b from-background via-primary/5 to-background py-12 md:py-20 overflow-hidden">
      {/* Background grid pattern */}
      <div className="absolute inset-0 sportsbook-grid pointer-events-none" />

      <div className="relative max-w-2xl mx-auto px-4">
        {/* Header */}
        <div className="text-center mb-8">
          <h2 className="font-display text-4xl md:text-5xl lg:text-6xl text-gradient-neon tracking-wide">
            DROP YOUR SLIP
          </h2>
          <div className="flex items-center justify-center gap-2 mt-3">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-neon-green opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-neon-green" />
            </span>
            <span className="text-sm font-medium text-muted-foreground">
              AI-Powered — Instant Analysis
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-2">
            No account needed. Upload or type your parlay.
          </p>
        </div>

        {/* Main Card */}
        <div className="neon-border rounded-2xl p-5 md:p-6 space-y-5">
          {/* Reset button when not idle */}
          {state !== "idle" && state !== "extracting" && state !== "simulating" && state !== "unlocking" && (
            <div className="flex justify-end">
              <Button variant="ghost" size="sm" onClick={resetAnalyzer} className="h-8 w-8 p-0">
                <X className="w-4 h-4" />
              </Button>
            </div>
          )}

          {/* === INPUT SECTION === */}
          {state === "idle" && (
            <div className="space-y-4">
              {/* Segmented Pill Toggle */}
              <div className="flex rounded-xl bg-muted/50 p-1">
                <button
                  onClick={() => setMode("upload")}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200",
                    mode === "upload"
                      ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Camera className="w-4 h-4" /> Screenshot
                </button>
                <button
                  onClick={() => setMode("manual")}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200",
                    mode === "manual"
                      ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Type className="w-4 h-4" /> Type It
                </button>
              </div>

              {mode === "upload" ? (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="group relative border-2 border-dashed border-primary/30 rounded-2xl p-8 md:p-10 text-center cursor-pointer hover:border-primary/60 transition-all duration-300 animate-pulse-glow"
                >
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center group-hover:scale-110 transition-transform">
                      <Upload className="w-7 h-7 text-primary" />
                    </div>
                    <div>
                      <p className="text-base font-semibold">Drop your bet slip here</p>
                      <p className="text-xs text-muted-foreground mt-1">PNG, JPG, or screenshot — we'll read it instantly</p>
                    </div>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleFileUpload}
                  />
                </div>
              ) : (
                <div className="space-y-3">
                  <Textarea
                    value={manualText}
                    onChange={(e) => setManualText(e.target.value)}
                    placeholder={"LeBron James Over 25.5 Pts @ -115\nSteph Curry Over 4.5 3PM @ +120\nJokic Over 10.5 Reb @ -130"}
                    rows={5}
                    className="bg-muted/30 border-border/50 font-mono text-sm placeholder:font-mono"
                  />
                  <Button
                    className="w-full animate-pulse-glow"
                    variant="neon"
                    size="lg"
                    onClick={handleManualSubmit}
                    disabled={!manualText.trim()}
                  >
                    <Zap className="w-4 h-4" />
                    Analyze Parlay
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* === LOADING === */}
          {(state === "extracting" || state === "simulating") && (
            <div className="py-10 flex flex-col items-center gap-3">
              <WolfLoader size="sm" text={state === "extracting" ? "Reading your slip..." : "Running 10,000 simulations..."} />
            </div>
          )}

          {/* === RESULTS === */}
          {(state === "results" || state === "advanced") && simulation && tier && (
            <div className="space-y-4">
              {/* Risk Banner */}
              <div
                className="animate-slide-up flex items-center gap-3 p-4 rounded-xl border"
                style={{
                  borderColor: tier.color || "hsl(var(--border))",
                  background: `linear-gradient(135deg, hsl(var(--card)), hsl(var(--card) / 0.8))`,
                }}
              >
                <span className="text-3xl">{tier.emoji}</span>
                <div className="flex-1">
                  <p className="font-display text-xl tracking-wide">{tier.label}</p>
                  <p className="text-xs text-muted-foreground">{tier.subtext}</p>
                </div>
              </div>

              {/* Stats Tiles */}
              <div className="grid grid-cols-3 gap-3">
                {/* Win Prob Tile with Conic Ring */}
                <div className="bounce-in flex flex-col items-center p-3 rounded-xl bg-card border border-border/50" style={{ animationDelay: "0.1s" }}>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Win Prob</p>
                  <div className="relative w-16 h-16">
                    <div
                      className="conic-ring w-full h-full"
                      style={{ "--progress": `${winProbPct}%` } as React.CSSProperties}
                    />
                    <div className="absolute inset-[4px] rounded-full bg-card flex items-center justify-center">
                      <span className="font-display text-lg text-neon-green">{winProbPct}%</span>
                    </div>
                  </div>
                </div>

                {/* Payout Tile */}
                <div className="bounce-in flex flex-col items-center justify-center p-3 rounded-xl bg-card border border-border/50" style={{ animationDelay: "0.2s" }}>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">$10 Pays</p>
                  <div className="w-full h-0.5 bg-primary rounded-full mb-2" />
                  <p className="font-display text-2xl text-primary">${simulation.potentialPayout.toFixed(0)}</p>
                </div>

                {/* EV Tile */}
                <div className="bounce-in flex flex-col items-center justify-center p-3 rounded-xl bg-card border border-border/50" style={{ animationDelay: "0.3s" }}>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Exp. Value</p>
                  <div className={cn(
                    "w-full h-0.5 rounded-full mb-2",
                    simulation.expectedValue >= 0 ? "bg-neon-green" : "bg-destructive"
                  )} />
                  <p className={cn(
                    "font-display text-2xl",
                    simulation.expectedValue >= 0 ? "text-neon-green" : "text-destructive"
                  )}>
                    {simulation.expectedValue >= 0 ? "+" : ""}${simulation.expectedValue.toFixed(2)}
                  </p>
                </div>
              </div>

              {/* Leg Breakdown — Bet Slip Style */}
              <div className="space-y-1.5" style={{ animationDelay: "0.4s" }}>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">
                  Bet Slip Breakdown
                </p>
                {legsToShow?.map((leg, i) => {
                  const impliedPct = Math.round(leg.impliedProbability * 100);
                  return (
                    <div
                      key={leg.id}
                      className={cn(
                        "slide-up flex items-center gap-3 p-3 rounded-lg bg-card/80 border-l-4",
                        getRiskColor(leg.riskLevel)
                      )}
                      style={{ animationDelay: `${0.4 + i * 0.08}s` }}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{leg.description}</p>
                        {/* Mini progress bar for implied prob */}
                        <div className="flex items-center gap-2 mt-1">
                          <div className="flex-1 h-1 rounded-full bg-muted/50 overflow-hidden">
                            <div
                              className={cn("h-full rounded-full transition-all duration-700", getRiskBarColor(leg.riskLevel))}
                              style={{ width: `${impliedPct}%` }}
                            />
                          </div>
                          <span className="text-[10px] text-muted-foreground w-8 text-right">{impliedPct}%</span>
                        </div>
                      </div>
                      <span className={cn(
                        "text-sm font-bold font-mono px-2 py-1 rounded-lg",
                        leg.odds > 0
                          ? "bg-neon-green/10 text-neon-green"
                          : "bg-muted/50 text-foreground"
                      )}>
                        {leg.odds > 0 ? "+" : ""}{leg.odds}
                      </span>
                    </div>
                  );
                })}
                {simulation.legs.length > 3 && (
                  <button
                    onClick={() => setShowAllLegs(!showAllLegs)}
                    className="flex items-center gap-1 text-xs text-primary hover:underline pt-1 mx-auto"
                  >
                    {showAllLegs ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    {showAllLegs ? "Show less" : `+${simulation.legs.length - 3} more legs`}
                  </button>
                )}
              </div>

              {/* Sharp Alert Verdict */}
              <div className="slide-up p-4 rounded-xl bg-gradient-to-r from-primary/10 to-neon-cyan/10 border border-primary/20" style={{ animationDelay: "0.6s" }}>
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-primary mb-1">Sharp Alert</p>
                    <p className="text-sm text-foreground/90">
                      {simulation.combinedProbability > 0.15
                        ? `${simulation.legs.filter(l => l.riskLevel === "low" || l.riskLevel === "medium").length} of ${simulation.legs.length} legs look strong. Consider reducing high-risk legs for a safer play.`
                        : "This parlay is a long shot — the combined probability is low. Proceed with caution or reduce leg count."}
                    </p>
                  </div>
                </div>
              </div>

              {/* === PREMIUM GATE / ADVANCED === */}
              {state === "advanced" && advancedResults ? (
                <div className="space-y-3 border-t border-primary/20 pt-4 slide-up">
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
                        <div className="mt-1 p-2 rounded bg-neon-green/10 border border-neon-green/20">
                          <p className="text-xs font-semibold text-neon-green">💡 Swap Suggestion</p>
                          <p className="text-xs">{la.swapSuggestion}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : state === "results" ? (
                <div className="relative mt-2">
                  {/* Blurred preview teaser */}
                  <div className="filter blur-sm pointer-events-none select-none space-y-2 opacity-50">
                    <div className="p-3 rounded-lg bg-muted/30">
                      <p className="text-sm font-semibold">AI Leg Analysis</p>
                      <p className="text-xs text-muted-foreground">• Trap detection signals found on 2 legs</p>
                      <p className="text-xs text-muted-foreground">• Fatigue factor: moderate impact</p>
                    </div>
                    <div className="p-3 rounded-lg bg-neon-green/10">
                      <p className="text-sm font-semibold text-neon-green">💡 Smart Swap Suggestions</p>
                      <p className="text-xs">Replace weak legs with our data-backed picks</p>
                    </div>
                  </div>

                  {/* VIP Gate Overlay */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center rounded-xl overflow-hidden">
                    {/* Shimmer border */}
                    <div className="absolute inset-0 p-[2px] rounded-xl shimmer-border">
                      <div className="w-full h-full rounded-xl bg-background/95 backdrop-blur-md" />
                    </div>
                    {/* Content */}
                    <div className="relative z-10 flex flex-col items-center p-6 text-center">
                      <Lock className="w-7 h-7 text-muted-foreground mb-3" />
                      <p className="font-display text-2xl tracking-wide mb-2">UNLOCK ADVANCED ANALYSIS</p>
                      <div className="flex flex-col gap-1.5 mb-4 text-left">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Check className="w-3.5 h-3.5 text-neon-green" /> AI Leg Scores & Insights
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Check className="w-3.5 h-3.5 text-neon-green" /> Smart Swap Suggestions
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Check className="w-3.5 h-3.5 text-neon-green" /> Trap Detection Signals
                        </div>
                      </div>
                      <Button
                        onClick={handleUnlockCheckout}
                        variant="neon"
                        size="lg"
                        className="animate-pulse-glow gap-2"
                      >
                        <Zap className="w-4 h-4" />
                        Unlock for $20
                      </Button>
                      <p className="text-[10px] text-muted-foreground mt-3 flex items-center gap-1">
                        <Shield className="w-3 h-3" /> Powered by proprietary AI models
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {/* Unlocking state */}
          {state === "unlocking" && (
            <div className="py-10 flex flex-col items-center gap-3">
              <WolfLoader size="sm" text="Verifying payment..." />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
