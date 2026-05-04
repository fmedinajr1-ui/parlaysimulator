import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Leg {
  player?: string;
  player_name?: string;
  team?: string;
  prop?: string;
  prop_type?: string;
  line?: number | string;
  side?: string;
  engine_side?: string;
  fade_side?: string;
  odds?: number | string;
}

interface Props {
  parlay: {
    risk_mode?: string;
    mode?: string;
    combined_odds?: number | string;
    legs?: Leg[];
    summary?: string;
    rationale?: string;
    fade_mode?: boolean;
    spike_hit_pct?: number;
    fade_hit_pct?: number;
  };
}

const riskEmoji: Record<string, string> = {
  aggressive: "🔥",
  smart: "🧠",
  safe: "🛡️",
};

export function AIParlayCard({ parlay }: Props) {
  const legs = parlay.legs ?? [];
  const isFade = !!parlay.fade_mode || parlay.mode === "fade";

  if (isFade) {
    return (
      <Card className="p-3 bg-card/80 border-2 border-destructive/60">
        <div className="flex items-center justify-between mb-2">
          <Badge variant="destructive" className="text-xs">🚫 FADE THIS</Badge>
          {parlay.combined_odds != null && (
            <span className="text-sm font-mono text-destructive">{parlay.combined_odds}</span>
          )}
        </div>
        <p className="text-[11px] uppercase tracking-wide text-destructive/90 mb-2 font-semibold">
          Reverse psychology — bet the OPPOSITE of every leg
        </p>
        <ul className="space-y-1.5 text-sm">
          {legs.map((l, i) => {
            const player = l.player_name || l.player || l.team;
            const prop = l.prop_type || l.prop;
            const engine = l.engine_side || l.side;
            const fade = l.fade_side;
            return (
              <li key={i} className="flex flex-col gap-0.5">
                <span className="truncate">
                  <span className="line-through text-muted-foreground">
                    {player} {prop} {engine} {l.line}
                  </span>
                </span>
                {fade && (
                  <span className="text-destructive font-semibold">
                    → bet {fade} {l.line}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        {(parlay.spike_hit_pct != null || parlay.fade_hit_pct != null) && (
          <p className="mt-2 text-xs text-muted-foreground">
            Spike's ticket: ~{parlay.spike_hit_pct ?? "?"}% to hit · Your fade: ~{parlay.fade_hit_pct ?? "?"}%
          </p>
        )}
        {parlay.rationale && (
          <p className="mt-1 text-[11px] text-muted-foreground italic">{parlay.rationale}</p>
        )}
      </Card>
    );
  }

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
              {l.player_name || l.player || l.team} {l.prop_type || l.prop} {l.side} {l.line}
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