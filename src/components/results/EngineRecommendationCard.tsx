import { FeedCard } from "../FeedCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check, AlertTriangle, RefreshCw, Ban, ArrowRight, Copy } from "lucide-react";
import { ParlayAnalysis } from "@/types/parlay";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { getSportEmoji } from "./SportPropIcon";

interface Props {
  analysis: ParlayAnalysis | null;
  loading?: boolean;
  delay?: number;
}

const ACTION_CONFIG = {
  TAIL: {
    icon: Check,
    label: "TAIL THIS SLIP",
    sub: "Engines align — this is a real ticket",
    color: "text-neon-green",
    bg: "bg-neon-green/10",
    border: "border-neon-green/40",
  },
  TAIL_WITH_SWAPS: {
    icon: RefreshCw,
    label: "TAIL WITH SWAPS",
    sub: "Mostly sharp — fix the weak legs",
    color: "text-neon-cyan",
    bg: "bg-neon-cyan/10",
    border: "border-neon-cyan/40",
  },
  REBUILD: {
    icon: AlertTriangle,
    label: "REBUILD",
    sub: "Mixed signals — trim and swap",
    color: "text-neon-yellow",
    bg: "bg-neon-yellow/10",
    border: "border-neon-yellow/40",
  },
  PASS: {
    icon: Ban,
    label: "PASS",
    sub: "Books are licking their chops",
    color: "text-neon-red",
    bg: "bg-neon-red/10",
    border: "border-neon-red/40",
  },
} as const;

export function EngineRecommendationCard({ analysis, loading, delay = 0 }: Props) {
  if (loading) {
    return (
      <FeedCard className="slide-up" style={{ animationDelay: `${delay}ms` }}>
        <div className="flex items-center gap-3 py-2">
          <div className="w-10 h-10 rounded-full bg-muted/30 animate-pulse" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-32 rounded bg-muted/30 animate-pulse" />
            <div className="h-3 w-48 rounded bg-muted/20 animate-pulse" />
          </div>
        </div>
      </FeedCard>
    );
  }

  if (!analysis?.recommendedAction) return null;

  const cfg = ACTION_CONFIG[analysis.recommendedAction];
  const Icon = cfg.icon;
  const counts = analysis.verdictCounts;
  const swaps = analysis.suggestedSwaps ?? [];
  const sports = analysis.sportsDetected ?? [];

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied 📋", description: "Sharper pick copied to clipboard" });
  };

  return (
    <FeedCard
      className={cn("slide-up border-2", cfg.bg, cfg.border)}
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* Hero verdict */}
      <div className="flex items-start gap-3 mb-3">
        <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center shrink-0", cfg.bg, "border", cfg.border)}>
          <Icon className={cn("w-6 h-6", cfg.color)} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className={cn("font-display text-lg tracking-wide", cfg.color)}>{cfg.label}</h3>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Engine verdict</span>
          </div>
          <p className="text-xs text-muted-foreground">{cfg.sub}</p>
        </div>
      </div>

      {/* Plain English summary */}
      {analysis.summary && (
        <p className="text-sm text-foreground/90 leading-relaxed mb-3">{analysis.summary}</p>
      )}

      {/* Sports cross-referenced */}
      {sports.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap mb-3">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            Cross-referenced:
          </span>
          {sports.map((sp) => (
            <Badge
              key={sp}
              variant="outline"
              className="text-[11px] bg-card/60 border-border/40 gap-1"
            >
              <span>{getSportEmoji(sp)}</span>
              <span>{sp}</span>
            </Badge>
          ))}
        </div>
      )}

      {/* Verdict counts */}
      {counts && (counts.picks + counts.fades + counts.neutral > 0) && (
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <Badge variant="outline" className="text-xs text-neon-green bg-neon-green/10 border-neon-green/30">
            <Check className="w-3 h-3 mr-1" />
            {counts.picks} keep
          </Badge>
          {counts.neutral > 0 && (
            <Badge variant="outline" className="text-xs text-muted-foreground bg-muted/20">
              {counts.neutral} neutral
            </Badge>
          )}
          {counts.fades > 0 && (
            <Badge variant="outline" className="text-xs text-neon-red bg-neon-red/10 border-neon-red/30">
              <AlertTriangle className="w-3 h-3 mr-1" />
              {counts.fades} swap/drop
            </Badge>
          )}
        </div>
      )}

      {/* Concrete swap suggestions */}
      {swaps.length > 0 && (
        <div className="space-y-2 pt-3 border-t border-border/30">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            Sharper alternatives ({swaps.length})
          </p>
          {swaps.map((swap, i) => (
            <div
              key={i}
              className="flex items-center gap-2 p-2 rounded-lg bg-card/60 border border-border/30"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground line-through truncate">
                  Leg {swap.legIndex + 1}: {swap.original}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <ArrowRight className="w-3 h-3 text-neon-cyan shrink-0" />
                  <span className="text-sm font-medium text-foreground truncate">
                    {swap.suggestion.description}
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5">{swap.suggestion.reason}</p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 shrink-0"
                onClick={() => handleCopy(swap.suggestion.description)}
              >
                <Copy className="w-3 h-3" />
              </Button>
            </div>
          ))}
          {typeof analysis.expectedValueDelta === 'number' && analysis.expectedValueDelta > 0 && (
            <p className="text-[11px] text-neon-green font-medium pt-1">
              Apply all swaps → est. +{(analysis.expectedValueDelta * 100).toFixed(0)}% projected EV gain
            </p>
          )}
        </div>
      )}
    </FeedCard>
  );
}