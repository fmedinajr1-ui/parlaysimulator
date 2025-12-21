import { useRef, useState } from "react";
import { toPng } from "html-to-image";
import { FeedCard } from "../FeedCard";
import { ParlayLeg, LegAnalysis } from "@/types/parlay";
import { Share2, Download, Twitter, Instagram, Copy, Loader2, Check, X, AlertTriangle, TrendingUp, TrendingDown, Minus } from "lucide-react";
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
}

export function LegBreakdownScorecard({ 
  legs, 
  legAnalyses, 
  probability,
  delay = 0 
}: LegBreakdownScorecardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
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
          const VerdictIcon = verdict.icon;
          const strengthScore = analysis?.researchSummary?.strengthScore;

          return (
            <div 
              key={leg.id}
              className={cn(
                "flex items-center gap-3 p-3 rounded-xl border transition-all",
                verdict.bg,
                "border-border/30 hover:border-border/50"
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
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-muted-foreground">
                    {leg.odds > 0 ? '+' : ''}{leg.odds}
                  </span>
                  {strengthScore !== undefined && (
                    <span className={cn(
                      "text-xs font-medium",
                      strengthScore >= 70 ? "text-neon-green" :
                      strengthScore >= 50 ? "text-neon-cyan" :
                      strengthScore >= 30 ? "text-neon-yellow" : "text-neon-red"
                    )}>
                      • {strengthScore}/100
                    </span>
                  )}
                </div>
              </div>

              {/* Edge & Verdict */}
              <div className="text-right shrink-0">
                <Badge variant="outline" className={cn("text-xs", verdict.color, verdict.bg, "border-current/30")}>
                  {verdict.label}
                </Badge>
                {edge && (
                  <p className={cn("text-xs font-mono mt-1", edge.color)}>
                    {edge.display}
                  </p>
                )}
              </div>
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