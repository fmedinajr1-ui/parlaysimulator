import { useRef, useState } from "react";
import { toPng } from "html-to-image";
import { FeedCard } from "../FeedCard";
import { ParlayLeg, LegAnalysis } from "@/types/parlay";
import { Share2, Download, Twitter, Instagram, Copy, Loader2, Check, X, AlertTriangle, TrendingUp, TrendingDown, Minus, ChevronDown, DollarSign, Activity, Flame, Shield, Zap } from "lucide-react";
import { Button } from "../ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { ShareableScorecard } from "./ShareableScorecard";
import { cn } from "@/lib/utils";
import { SportPropIcon } from "./SportPropIcon";

interface LegBreakdownScorecardProps {
  legs: ParlayLeg[];
  legAnalyses?: Array<LegAnalysis & { legIndex: number }>;
  probability: number;
  delay?: number;
  stake?: number;
}

export function LegBreakdownScorecard({ 
  legs, 
  legAnalyses, 
  probability,
  delay = 0,
  stake = 10,
}: LegBreakdownScorecardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [expandedLeg, setExpandedLeg] = useState<string | null>(null);
  const pct = probability * 100;

  const getLegAnalysis = (legIndex: number) => {
    return legAnalyses?.find(la => la.legIndex === legIndex);
  };

  const getVerdictConfig = (analysis: LegAnalysis | undefined) => {
    if (analysis?.researchSummary) {
      const verdict = analysis.researchSummary.overallVerdict;
      switch (verdict) {
        case 'STRONG_PICK':
          return { icon: Check, color: 'text-neon-green', bg: 'bg-neon-green/10', label: 'PICK', emoji: '✅' };
        case 'LEAN_PICK':
          return { icon: TrendingUp, color: 'text-neon-cyan', bg: 'bg-neon-cyan/10', label: 'LEAN', emoji: '📈' };
        case 'NEUTRAL':
          return { icon: Minus, color: 'text-muted-foreground', bg: 'bg-muted/20', label: 'HOLD', emoji: '➖' };
        case 'LEAN_FADE':
          return { icon: TrendingDown, color: 'text-neon-orange', bg: 'bg-neon-orange/10', label: 'CAUTION', emoji: '⚠️' };
        case 'STRONG_FADE':
          return { icon: X, color: 'text-neon-red', bg: 'bg-neon-red/10', label: 'FADE', emoji: '❌' };
      }
    }

    if (!analysis) {
      return { icon: Minus, color: 'text-muted-foreground', bg: 'bg-muted/20', label: 'N/A', emoji: '➖' };
    }
    
    const isTrap = analysis.sharpRecommendation === 'fade' && 
      analysis.sharpSignals?.some(s => ['BOTH_SIDES_MOVED', 'PRICE_ONLY_MOVE_TRAP'].includes(s));
    
    if (isTrap) {
      return { icon: AlertTriangle, color: 'text-neon-red', bg: 'bg-neon-red/10', label: 'TRAP', emoji: '🚨' };
    }
    
    switch (analysis.sharpRecommendation) {
      case 'pick':
        return { icon: Check, color: 'text-neon-green', bg: 'bg-neon-green/10', label: 'PICK', emoji: '✅' };
      case 'fade':
        return { icon: X, color: 'text-neon-red', bg: 'bg-neon-red/10', label: 'FADE', emoji: '❌' };
      case 'caution':
        return { icon: AlertTriangle, color: 'text-neon-yellow', bg: 'bg-neon-yellow/10', label: 'CAUTION', emoji: '⚠️' };
      default:
        return { icon: Minus, color: 'text-muted-foreground', bg: 'bg-muted/20', label: 'HOLD', emoji: '➖' };
    }
  };

  const getEdge = (analysis: LegAnalysis | undefined, leg: ParlayLeg) => {
    if (!analysis?.adjustedProbability) return null;
    const edge = ((analysis.adjustedProbability - leg.impliedProbability) * 100);
    return {
      value: edge,
      display: `${edge >= 0 ? '+' : ''}${edge.toFixed(1)}%`,
      color: edge >= 2 ? 'text-neon-green' : edge >= 0 ? 'text-neon-cyan' : 'text-neon-red'
    };
  };

  // Per-leg expected value in $ assuming equal-share stake allocation.
  // EV = (adjustedProb * payout) - ((1 - adjustedProb) * legStake)
  const getLegEV = (analysis: LegAnalysis | undefined, leg: ParlayLeg) => {
    if (!analysis?.adjustedProbability) return null;
    const legStake = stake / legs.length;
    const decimal = leg.odds > 0 ? leg.odds / 100 + 1 : 100 / Math.abs(leg.odds) + 1;
    const profit = legStake * (decimal - 1);
    const p = analysis.adjustedProbability;
    const ev = p * profit - (1 - p) * legStake;
    return {
      value: ev,
      display: `${ev >= 0 ? '+' : ''}$${ev.toFixed(2)}`,
      color: ev >= 0.5 ? 'text-neon-green' : ev >= 0 ? 'text-neon-cyan' : 'text-neon-red',
      bg: ev >= 0.5 ? 'bg-neon-green/10' : ev >= 0 ? 'bg-neon-cyan/10' : 'bg-neon-red/10',
      Icon: ev >= 0 ? TrendingUp : TrendingDown,
    };
  };

  const generateImage = async (): Promise<string | null> => {
    if (!cardRef.current) return null;
    
    setIsGenerating(true);
    try {
      const dataUrl = await toPng(cardRef.current, {
        quality: 1,
        pixelRatio: 2,
        backgroundColor: "#0a0b0f",
      });
      setGeneratedImage(dataUrl);
      return dataUrl;
    } catch (err) {
      console.error("Failed to generate image:", err);
      toast({
        title: "Image generation failed",
        description: "Could not create shareable image",
        variant: "destructive",
      });
      return null;
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownload = async () => {
    const dataUrl = generatedImage || await generateImage();
    if (!dataUrl) return;

    const link = document.createElement("a");
    link.download = `parlay-scorecard-${legs.length}legs.png`;
    link.href = dataUrl;
    link.click();
    
    toast({
      title: "Downloaded! 📸",
      description: "Your scorecard is ready to share",
    });
  };

  const handleTwitterShare = async () => {
    const verdicts = legs.map((leg, idx) => {
      const analysis = getLegAnalysis(idx);
      const verdict = getVerdictConfig(analysis);
      return verdict.emoji;
    }).join(' ');

    const shareText = `📊 My ${legs.length}-leg parlay scorecard\n\n${verdicts}\n\n${pct.toFixed(1)}% win probability\n\nAnalyzed by Parlay Farm 🔥`;
    
    await generateImage();
    
    const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`;
    window.open(twitterUrl, "_blank", "noopener,noreferrer");
    
    toast({
      title: "Opening Twitter 🐦",
      description: "Download the image to attach to your tweet!",
    });
  };

  const handleInstagramShare = async () => {
    const dataUrl = generatedImage || await generateImage();
    if (!dataUrl) return;

    const link = document.createElement("a");
    link.download = `parlay-scorecard-${legs.length}legs.png`;
    link.href = dataUrl;
    link.click();
    
    toast({
      title: "Image downloaded! 📸",
      description: "Open Instagram and share from your camera roll",
    });
  };

  const handleNativeShare = async () => {
    const verdicts = legs.map((leg, idx) => {
      const analysis = getLegAnalysis(idx);
      const verdict = getVerdictConfig(analysis);
      return `${verdict.emoji} ${leg.description.slice(0, 40)}`;
    }).join('\n');

    const shareText = `📊 My ${legs.length}-leg parlay scorecard\n\n${verdicts}\n\n${pct.toFixed(1)}% win probability\n\n🔥 parlayfarm.com`;
    
    if (navigator.share) {
      try {
        const dataUrl = generatedImage || await generateImage();
        
        if (dataUrl) {
          const response = await fetch(dataUrl);
          const blob = await response.blob();
          const file = new File([blob], "parlay-scorecard.png", { type: "image/png" });
          
          await navigator.share({
            title: "Parlay Scorecard",
            text: shareText,
            files: [file],
          });
        } else {
          await navigator.share({
            title: "Parlay Scorecard",
            text: shareText,
          });
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          await navigator.clipboard.writeText(shareText);
          toast({
            title: "Copied to clipboard! 📋",
            description: "Share your scorecard with friends",
          });
        }
      }
    } else {
      await navigator.clipboard.writeText(shareText);
      toast({
        title: "Copied to clipboard! 📋",
        description: "Share your scorecard with friends",
      });
    }
  };

  const handleCopy = async () => {
    const verdictLines = legs.map((leg, idx) => {
      const analysis = getLegAnalysis(idx);
      const verdict = getVerdictConfig(analysis);
      const edge = getEdge(analysis, leg);
      return `${verdict.emoji} ${verdict.label}: ${leg.description}${edge ? ` (${edge.display})` : ''}`;
    }).join('\n');

    const shareText = `📊 Parlay Scorecard - ${pct.toFixed(1)}% Win Prob\n\n${verdictLines}`;
    await navigator.clipboard.writeText(shareText);
    toast({
      title: "Copied! 📋",
      description: "Scorecard copied to clipboard",
    });
  };

  // Count verdicts for summary
  const verdictCounts = legs.reduce((acc, _, idx) => {
    const analysis = getLegAnalysis(idx);
    const verdict = getVerdictConfig(analysis);
    if (verdict.label === 'PICK' || verdict.label === 'LEAN') acc.picks++;
    else if (verdict.label === 'FADE' || verdict.label === 'TRAP') acc.fades++;
    else acc.neutral++;
    return acc;
  }, { picks: 0, fades: 0, neutral: 0 });

  return (
    <FeedCard 
      variant="full-bleed" 
      className="slide-up overflow-hidden"
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* Hidden shareable card for image generation */}
      <div className="absolute -left-[9999px] -top-[9999px]">
        <ShareableScorecard
          ref={cardRef}
          probability={probability}
          legs={legs}
          legAnalyses={legAnalyses}
        />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-xl">📊</span>
          <h3 className="font-display text-lg text-foreground">PARLAY SCORECARD</h3>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs text-neon-green bg-neon-green/10 border-neon-green/30">
            {verdictCounts.picks} picks
          </Badge>
          {verdictCounts.fades > 0 && (
            <Badge variant="outline" className="text-xs text-neon-red bg-neon-red/10 border-neon-red/30">
              {verdictCounts.fades} fades
            </Badge>
          )}
        </div>
      </div>

      {/* Legs */}
      <div className="space-y-2 mb-4">
        {legs.map((leg, idx) => {
          const analysis = getLegAnalysis(idx);
          const verdict = getVerdictConfig(analysis);
          const edge = getEdge(analysis, leg);
          const ev = getLegEV(analysis, leg);
          const VerdictIcon = verdict.icon;
          const strengthScore = analysis?.researchSummary?.strengthScore;
          const isExpanded = expandedLeg === leg.id;
          const hasRiskDetail =
            !!analysis &&
            (
              (analysis.riskFactors?.length ?? 0) > 0 ||
              (analysis.sharpSignals?.length ?? 0) > 0 ||
              (analysis.injuryAlerts?.length ?? 0) > 0 ||
              !!analysis.fatigueData ||
              !!analysis.juiceData ||
              !!analysis.trendDirection ||
              !!analysis.confidenceLevel
            );

          return (
            <div
              key={leg.id}
              className={cn(
                "rounded-xl border transition-all overflow-hidden",
                verdict.bg,
                isExpanded ? "border-current/40" : "border-border/30 hover:border-border/50"
              )}
            >
            <button
              type="button"
              onClick={() => hasRiskDetail && setExpandedLeg(isExpanded ? null : leg.id)}
              aria-expanded={isExpanded}
              disabled={!hasRiskDetail}
              className={cn(
                "w-full flex items-center gap-3 p-3 text-left",
                hasRiskDetail ? "cursor-pointer" : "cursor-default"
              )}
            >
              {/* Leg number */}
              <span className="w-6 h-6 rounded-full bg-card flex items-center justify-center text-xs font-bold text-muted-foreground shrink-0">
                {idx + 1}
              </span>

              {/* Verdict Icon */}
              <div className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
                verdict.bg
              )}>
                <VerdictIcon className={cn("w-4 h-4", verdict.color)} />
              </div>

              {/* Leg Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <SportPropIcon 
                    sport={analysis?.sport} 
                    betType={analysis?.betType}
                  />
                  <p className="text-sm font-medium text-foreground truncate flex-1">
                    {leg.description}
                  </p>
                </div>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span className="text-xs text-muted-foreground">
                    {leg.odds > 0 ? '+' : ''}{leg.odds}
                  </span>
                  {ev && (
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px] font-mono px-1.5 py-0 h-4 border-current/30",
                        ev.color,
                        ev.bg
                      )}
                    >
                      <ev.Icon className="w-2.5 h-2.5 mr-0.5" />
                      EV {ev.display}
                    </Badge>
                  )}
                  {edge && (
                    <span className={cn("text-[10px] font-mono", edge.color)}>
                      edge {edge.display}
                    </span>
                  )}
                  {strengthScore !== undefined && (
                    <span className={cn(
                      "text-[10px] font-medium",
                      strengthScore >= 70 ? "text-neon-green" :
                      strengthScore >= 50 ? "text-neon-cyan" :
                      strengthScore >= 30 ? "text-neon-yellow" : "text-neon-red"
                    )}>
                      • {strengthScore}/100
                    </span>
                  )}
                </div>
              </div>

              {/* Verdict + expand chevron */}
              <div className="flex items-center gap-2 shrink-0">
                <Badge variant="outline" className={cn("text-xs", verdict.color, verdict.bg, "border-current/30")}>
                  {verdict.label}
                </Badge>
                {hasRiskDetail && (
                  <ChevronDown
                    className={cn(
                      "w-4 h-4 text-muted-foreground transition-transform",
                      isExpanded && "rotate-180"
                    )}
                  />
                )}
              </div>
            </button>

            {/* Tap-to-expand risk breakdown */}
            {isExpanded && hasRiskDetail && (
              <div className="px-3 pb-3 pt-0 space-y-2 border-t border-border/20 bg-card/30">
                {/* Quick risk meters row */}
                <div className="grid grid-cols-3 gap-2 mt-2">
                  {analysis?.confidenceLevel && (
                    <div className="flex flex-col items-center justify-center p-2 rounded-lg bg-card/60">
                      <Shield className={cn(
                        "w-3.5 h-3.5 mb-0.5",
                        analysis.confidenceLevel === 'high' ? 'text-neon-green' :
                        analysis.confidenceLevel === 'medium' ? 'text-neon-yellow' : 'text-neon-red'
                      )} />
                      <span className="text-[9px] uppercase text-muted-foreground tracking-wider">Confidence</span>
                      <span className="text-[10px] font-bold capitalize">{analysis.confidenceLevel}</span>
                    </div>
                  )}
                  {analysis?.trendDirection && (
                    <div className="flex flex-col items-center justify-center p-2 rounded-lg bg-card/60">
                      <Activity className={cn(
                        "w-3.5 h-3.5 mb-0.5",
                        analysis.trendDirection === 'favorable' ? 'text-neon-green' :
                        analysis.trendDirection === 'unfavorable' ? 'text-neon-red' : 'text-muted-foreground'
                      )} />
                      <span className="text-[9px] uppercase text-muted-foreground tracking-wider">Trend</span>
                      <span className="text-[10px] font-bold capitalize">{analysis.trendDirection}</span>
                    </div>
                  )}
                  {typeof analysis?.vegasJuice === 'number' && (
                    <div className="flex flex-col items-center justify-center p-2 rounded-lg bg-card/60">
                      <DollarSign className={cn(
                        "w-3.5 h-3.5 mb-0.5",
                        analysis.vegasJuice <= 5 ? 'text-neon-green' :
                        analysis.vegasJuice <= 8 ? 'text-neon-yellow' : 'text-neon-red'
                      )} />
                      <span className="text-[9px] uppercase text-muted-foreground tracking-wider">Juice</span>
                      <span className="text-[10px] font-bold">{analysis.vegasJuice.toFixed(1)}%</span>
                    </div>
                  )}
                </div>

                {/* Injury alerts */}
                {analysis?.injuryAlerts && analysis.injuryAlerts.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Injury Watch</p>
                    {analysis.injuryAlerts.map((inj, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs p-1.5 rounded bg-neon-red/5 border border-neon-red/20">
                        <AlertTriangle className="w-3 h-3 text-neon-red shrink-0" />
                        <span className="text-foreground/80">
                          <span className="font-semibold">{inj.player}</span> · {inj.status} · {inj.injuryType}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Risk factors */}
                {analysis?.riskFactors && analysis.riskFactors.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Risk Factors</p>
                    <ul className="space-y-1">
                      {analysis.riskFactors.map((rf, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-xs text-foreground/80">
                          <span className="text-neon-orange mt-0.5">•</span>
                          <span>{rf}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Sharp signals */}
                {analysis?.sharpSignals && analysis.sharpSignals.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Sharp Signals</p>
                    <div className="flex flex-wrap gap-1">
                      {analysis.sharpSignals.map((sig, i) => (
                        <Badge key={i} variant="outline" className="text-[10px] bg-card/60">
                          <Zap className="w-2.5 h-2.5 mr-0.5 text-neon-yellow" />
                          {sig.replace(/_/g, ' ').toLowerCase()}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Fatigue */}
                {analysis?.fatigueData && (
                  <div className="flex items-center gap-2 text-xs p-1.5 rounded bg-card/60">
                    <Flame className="w-3 h-3 text-neon-orange shrink-0" />
                    <span className="text-muted-foreground">Fatigue:</span>
                    <span className="font-medium">{analysis.fatigueData.fatigueCategory}</span>
                    {analysis.fatigueData.isBackToBack && (
                      <Badge variant="outline" className="text-[9px] text-neon-orange border-neon-orange/30 bg-neon-orange/10">B2B</Badge>
                    )}
                  </div>
                )}

                {/* EV math footer */}
                {ev && (
                  <div className="flex items-center justify-between pt-2 mt-1 border-t border-border/20">
                    <span className="text-[10px] text-muted-foreground">
                      Allocated stake ${(stake / legs.length).toFixed(2)} · win prob {((analysis?.adjustedProbability ?? 0) * 100).toFixed(0)}%
                    </span>
                    <span className={cn("text-xs font-mono font-bold", ev.color)}>
                      EV {ev.display}
                    </span>
                  </div>
                )}
              </div>
            )}
            </div>
          );
        })}
      </div>

      {/* Generated image preview */}
      {generatedImage && (
        <div className="mb-4 p-3 bg-card/50 rounded-xl">
          <p className="text-xs text-muted-foreground mb-2 text-center">Preview (tap to download)</p>
          <img 
            src={generatedImage} 
            alt="Shareable scorecard" 
            className="rounded-lg mx-auto cursor-pointer max-w-full border border-border/50"
            onClick={handleDownload}
          />
        </div>
      )}

      {/* Share buttons */}
      <div className="space-y-2 pt-3 border-t border-border/30">
        <div className="flex gap-2">
          <Button 
            variant="outline" 
            size="default" 
            onClick={handleTwitterShare}
            disabled={isGenerating}
            className="flex-1"
          >
            <Twitter className="w-4 h-4" />
            Twitter
          </Button>
          <Button 
            variant="outline" 
            size="default" 
            onClick={handleInstagramShare}
            disabled={isGenerating}
            className="flex-1"
          >
            <Instagram className="w-4 h-4" />
            Instagram
          </Button>
        </div>

        <div className="flex gap-2">
          <Button 
            variant="purple" 
            size="default" 
            onClick={handleNativeShare}
            disabled={isGenerating}
            className="flex-1"
          >
            {isGenerating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Share2 className="w-4 h-4" />
            )}
            Share
          </Button>
          <Button 
            variant="muted" 
            size="default" 
            onClick={handleDownload}
            disabled={isGenerating}
          >
            {isGenerating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
          </Button>
          <Button 
            variant="muted" 
            size="default" 
            onClick={handleCopy}
          >
            <Copy className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </FeedCard>
  );
}