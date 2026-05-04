import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Leg {
  player?: string;
  team?: string;
  prop?: string;
  line?: number | string;
  side?: string;
  odds?: number | string;
}

interface Props {
  parlay: {
    risk_mode?: string;
    combined_odds?: number | string;
    legs?: Leg[];
    summary?: string;
  };
}

const riskEmoji: Record<string, string> = {
  aggressive: "🔥",
  smart: "🧠",
  safe: "🛡️",
};

export function AIParlayCard({ parlay }: Props) {
  const legs = parlay.legs ?? [];
  return (
    <Card className="p-3 bg-card/80 border-primary/30">
      <div className="flex items-center justify-between mb-2">
        <Badge variant="secondary" className="text-xs">
          {riskEmoji[parlay.risk_mode ?? "smart"] ?? "🧠"} {parlay.risk_mode ?? "smart"}
        </Badge>
        {parlay.combined_odds != null && (
          <span className="text-sm font-mono text-primary">{parlay.combined_odds}</span>
        )}
      </div>
      <ul className="space-y-1 text-sm">
        {legs.map((l, i) => (
          <li key={i} className="flex justify-between gap-2">
            <span className="truncate">
              {l.player || l.team} {l.prop} {l.side} {l.line}
            </span>
            {l.odds != null && <span className="font-mono text-muted-foreground">{l.odds}</span>}
          </li>
        ))}
      </ul>
      {parlay.summary && (
        <p className="mt-2 text-xs text-muted-foreground italic">{parlay.summary}</p>
      )}
    </Card>
  );
}