import { useRef, useState } from "react";
import { toPng } from "html-to-image";
import { FeedCard } from "../FeedCard";
import { DEGEN_TIERS, DegenerateLevel, ParlayLeg } from "@/types/parlay";
import { Share2, Download, Twitter, Instagram, Copy, Loader2 } from "lucide-react";
import { Button } from "../ui/button";
import { toast } from "@/hooks/use-toast";
import { ShareableImageCard } from "./ShareableImageCard";

interface ShareableMemeProps {
  probability: number;
  degenerateLevel: DegenerateLevel;
  legCount: number;
  legs: ParlayLeg[];
  stake: number;
  potentialPayout: number;
  roast?: string;
  delay?: number;
}

export function ShareableMeme({ 
  probability, 
  degenerateLevel, 
  legCount, 
  legs,
  stake,
  potentialPayout,
  roast,
  delay = 0 
}: ShareableMemeProps) {
  const tier = DEGEN_TIERS[degenerateLevel];
  const pct = probability * 100;
  const cardRef = useRef<HTMLDivElement>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);

  const generateImage = async (): Promise<string | null> => {
    if (!cardRef.current) return null;
    
    setIsGenerating(true);
    try {
      const dataUrl = await toPng(cardRef.current, {
        quality: 1,
        pixelRatio: 2,
        backgroundColor: "#0f1015",
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
    link.download = `parlay-${pct.toFixed(0)}pct-degen.png`;
    link.href = dataUrl;
    link.click();
    
    toast({
      title: "Downloaded! 📸",
      description: "Share your degen score everywhere",
    });
  };

  const handleTwitterShare = async () => {
    const shareText = `🎟️ My ${legCount}-leg parlay has a ${pct.toFixed(1)}% chance to hit\n\n${tier.emoji} ${tier.label}\n\n${roast ? `"${roast}"\n\n` : ""}Roasted by Parlay Farm 🔥`;
    
    // Generate image for user to download first
    await generateImage();
    
    const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`;
    window.open(twitterUrl, "_blank", "noopener,noreferrer");
    
    toast({
      title: "Opening Twitter 🐦",
      description: "Download the image below to attach it to your tweet!",
    });
  };

  const handleInstagramShare = async () => {
    const dataUrl = generatedImage || await generateImage();
    if (!dataUrl) return;

    // Download the image since Instagram doesn't support direct sharing via URL
    const link = document.createElement("a");
    link.download = `parlay-${pct.toFixed(0)}pct-degen.png`;
    link.href = dataUrl;
    link.click();
    
    toast({
      title: "Image downloaded! 📸",
      description: "Open Instagram and share from your camera roll",
    });
  };

  const handleNativeShare = async () => {
    const shareText = `🎟️ My ${legCount}-leg parlay has a ${pct.toFixed(1)}% chance to hit\n\n${tier.emoji} ${tier.label}\n\n${roast ? `"${roast}"\n\n` : ""}Roasted by Parlay Farm 🔥`;
    
    if (navigator.share) {
      try {
        const dataUrl = generatedImage || await generateImage();
        
        if (dataUrl) {
          // Convert data URL to blob for sharing
          const response = await fetch(dataUrl);
          const blob = await response.blob();
          const file = new File([blob], "parlay-score.png", { type: "image/png" });
          
          await navigator.share({
            title: "Parlay Farm Results",
            text: shareText,
            files: [file],
          });
        } else {
          await navigator.share({
            title: "Parlay Farm Results",
            text: shareText,
          });
        }
      } catch (err) {
        // User cancelled or error - fallback to copy
        if ((err as Error).name !== "AbortError") {
          await navigator.clipboard.writeText(shareText);
          toast({
            title: "Copied to clipboard! 📋",
            description: "Share your degen score with friends",
          });
        }
      }
    } else {
      await navigator.clipboard.writeText(shareText);
      toast({
        title: "Copied to clipboard! 📋",
        description: "Share your degen score with friends",
      });
    }
  };

  const handleCopy = async () => {
    const shareText = `🎟️ ${pct.toFixed(1)}% win chance | ${tier.emoji} ${tier.label} | ${legCount} legs\n\n${roast ? `"${roast}"` : ""}`;
    await navigator.clipboard.writeText(shareText);
    toast({
      title: "Copied! 📋",
      description: "Now paste it everywhere",
    });
  };

  return (
    <FeedCard variant="neon" delay={delay} className="text-center overflow-hidden relative">
      {/* Background decoration */}
      <div className="absolute inset-0 bg-gradient-to-br from-neon-purple/10 via-transparent to-neon-green/10 -z-10" />
      
      <p className="text-sm text-muted-foreground uppercase tracking-wider mb-4">
        📸 Share Your Score
      </p>
      
      {/* Hidden shareable card for image generation */}
      <div className="absolute -left-[9999px] -top-[9999px]">
        <ShareableImageCard
          ref={cardRef}
          probability={probability}
          degenerateLevel={degenerateLevel}
          legs={legs}
          stake={stake}
          potentialPayout={potentialPayout}
          roast={roast}
        />
      </div>

      {/* Preview of the shareable card */}
      <div className="bg-card rounded-2xl p-6 mb-4 border border-border/50">
        <p className="font-display text-xl text-muted-foreground mb-2">
          MY {legCount}-LEG PARLAY
        </p>
        
        <div className="flex items-center justify-center gap-4 mb-4">
          <span className="font-display text-5xl text-foreground">{pct.toFixed(1)}%</span>
          <span className="text-4xl">{tier.emoji}</span>
        </div>
        
        <p className="font-display text-2xl text-secondary mb-4">
          {tier.label}
        </p>
        
        {roast && (
          <p className="text-muted-foreground italic text-sm">
            "{roast}"
          </p>
        )}
        
        <div className="mt-4 pt-4 border-t border-border/30">
          <p className="text-xs text-muted-foreground">
            🔥 Roasted by Parlay Farm
          </p>
        </div>
      </div>

      {/* Generated image preview */}
      {generatedImage && (
        <div className="mb-4">
          <p className="text-xs text-muted-foreground mb-2">Preview (tap to download)</p>
          <img 
            src={generatedImage} 
            alt="Shareable parlay card" 
            className="rounded-xl mx-auto cursor-pointer max-w-[280px] border border-border/50"
            onClick={handleDownload}
          />
        </div>
      )}

      {/* Action buttons */}
      <div className="space-y-3">
        {/* Primary share buttons */}
        <div className="flex gap-2 justify-center">
          <Button 
            variant="outline" 
            size="lg" 
            onClick={handleTwitterShare}
            disabled={isGenerating}
            className="flex-1 max-w-[140px]"
          >
            <Twitter className="w-4 h-4" />
            Twitter
          </Button>
          <Button 
            variant="outline" 
            size="lg" 
            onClick={handleInstagramShare}
            disabled={isGenerating}
            className="flex-1 max-w-[140px]"
          >
            <Instagram className="w-4 h-4" />
            Instagram
          </Button>
        </div>

        {/* Secondary actions */}
        <div className="flex gap-2 justify-center">
          <Button 
            variant="purple" 
            size="lg" 
            onClick={handleNativeShare}
            disabled={isGenerating}
            className="flex-1"
          >
            {isGenerating ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Share2 className="w-5 h-5" />
            )}
            Share
          </Button>
          <Button 
            variant="muted" 
            size="lg" 
            onClick={handleDownload}
            disabled={isGenerating}
          >
            {isGenerating ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Download className="w-5 h-5" />
            )}
          </Button>
          <Button 
            variant="muted" 
            size="lg" 
            onClick={handleCopy}
          >
            <Copy className="w-5 h-5" />
          </Button>
        </div>
      </div>
    </FeedCard>
  );
}
