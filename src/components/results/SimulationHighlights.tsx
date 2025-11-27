import { FeedCard } from "../FeedCard";
import { SimulationHighlight } from "@/types/parlay";

interface SimulationHighlightsProps {
  highlights: SimulationHighlight[];
  delay?: number;
}

export function SimulationHighlights({ highlights, delay = 0 }: SimulationHighlightsProps) {
  return (
    <FeedCard delay={delay}>
      <p className="text-sm text-muted-foreground uppercase tracking-wider mb-4">
        📊 Simulation Highlights
      </p>
      
      <div className="space-y-3">
        {highlights.map((highlight, idx) => (
          <div 
            key={idx}
            className="flex items-start gap-3 p-4 rounded-xl bg-muted/50 border border-border/50 slide-up"
            style={{ animationDelay: `${delay + (idx * 100)}ms` }}
          >
            <span className="text-3xl shrink-0">{highlight.emoji}</span>
            <p className="text-foreground/90 leading-relaxed">
              {highlight.message}
            </p>
          </div>
        ))}
      </div>
    </FeedCard>
  );
}
