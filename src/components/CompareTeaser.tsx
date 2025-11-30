import { FeedCard } from "./FeedCard";
import { Button } from "./ui/button";
import { Scale, ArrowRight, Upload, TrendingUp } from "lucide-react";
import { Link } from "react-router-dom";

export function CompareTeaser() {
  return (
    <FeedCard variant="neon" className="mb-5">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center shrink-0">
          <Scale className="w-6 h-6 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-display text-lg text-foreground mb-1">
            COMPARE PARLAYS ⚖️
          </h3>
          <p className="text-sm text-muted-foreground mb-3">
            Upload up to 4 slips and find your best bet with Monte Carlo simulation.
          </p>
          
          {/* Mini preview of features */}
          <div className="flex flex-wrap gap-2 mb-4">
            <span className="inline-flex items-center gap-1 text-xs bg-muted/50 px-2 py-1 rounded-full">
              <Upload className="w-3 h-3" />
              Upload Slips
            </span>
            <span className="inline-flex items-center gap-1 text-xs bg-muted/50 px-2 py-1 rounded-full">
              <TrendingUp className="w-3 h-3" />
              10K Simulations
            </span>
            <span className="inline-flex items-center gap-1 text-xs bg-primary/20 text-primary px-2 py-1 rounded-full">
              🎯 Best Pick
            </span>
          </div>

          <Link to="/compare">
            <Button size="sm" className="w-full gradient-neon">
              Compare Now
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </Link>
        </div>
      </div>
    </FeedCard>
  );
}
