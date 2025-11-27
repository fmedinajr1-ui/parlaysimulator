import { FeedCard } from "../FeedCard";
import { DEGEN_TIERS, DegenerateLevel } from "@/types/parlay";
import { Share2, Download, Copy } from "lucide-react";
import { Button } from "../ui/button";
import { toast } from "@/hooks/use-toast";

interface ShareableMemeProps {
  probability: number;
  degenerateLevel: DegenerateLevel;
  legCount: number;
  delay?: number;
}

const funnyQuotes = [
  "I didn't choose the degen life. The degen life chose me.",
  "It's not gambling if you BELIEVE.",
  "Just one more parlay and I'm done...",
  "This one's different, I can feel it.",
  "My gut says yes. My wallet says no.",
  "Rent can wait. This parlay can't.",
];

export function ShareableMeme({ probability, degenerateLevel, legCount, delay = 0 }: ShareableMemeProps) {
  const tier = DEGEN_TIERS[degenerateLevel];
  const pct = probability * 100;
  const randomQuote = funnyQuotes[Math.floor(Math.random() * funnyQuotes.length)];

  const handleShare = async () => {
    const shareText = `🎟️ My ${legCount}-leg parlay has a ${pct.toFixed(1)}% chance to hit\n\n${tier.emoji} ${tier.label}\n\n"${randomQuote}"\n\nRoasted by Parlay Simulator 🔥`;
    
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Parlay Simulator Results',
          text: shareText,
        });
      } catch (err) {
        // User cancelled or error
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
    const shareText = `🎟️ ${pct.toFixed(1)}% win chance | ${tier.emoji} ${tier.label} | ${legCount} legs\n\n"${randomQuote}"`;
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
      
      {/* Meme Card */}
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
        
        <p className="text-muted-foreground italic text-sm">
          "{randomQuote}"
        </p>
        
        <div className="mt-4 pt-4 border-t border-border/30">
          <p className="text-xs text-muted-foreground">
            🔥 Roasted by Parlay Simulator
          </p>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-3 justify-center">
        <Button variant="purple" size="lg" onClick={handleShare}>
          <Share2 className="w-5 h-5" />
          Share
        </Button>
        <Button variant="muted" size="lg" onClick={handleCopy}>
          <Copy className="w-5 h-5" />
          Copy
        </Button>
      </div>
    </FeedCard>
  );
}
