import { FeedCard, FeedCardHeader } from "@/components/FeedCard";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useHighConvictionPlays, type HighConvictionPlay } from "@/hooks/useHighConvictionPlays";
import { Crosshair, Check, AlertTriangle, Loader2 } from "lucide-react";

const ENGINE_COLORS: Record<string, string> = {
  risk: 'bg-orange-500',
  propv2: 'bg-blue-500',
  sharp: 'bg-emerald-500',
  heat: 'bg-red-500',
  mlb_cross_ref: 'bg-purple-500',
  bot_parlay: 'bg-cyan-500',
};

const ENGINE_LABELS: Record<string, string> = {
  risk: 'Risk',
  propv2: 'PropV2',
  sharp: 'Sharp',
  heat: 'Heat',
  mlb_cross_ref: 'MLB XRef',
  bot_parlay: 'Bot',
};

const TIER_CLASSES: Record<string, string> = {
  ELITE: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  HIGH: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  MEDIUM: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
};

function ConvictionRow({ play }: { play: HighConvictionPlay }) {
  const maxScore = 30;
  const pct = Math.min((play.convictionScore / maxScore) * 100, 100);
  const isOver = play.signal.toUpperCase() === 'OVER';

  return (
    <div className="py-3 border-b border-border/30 last:border-0">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <p className="font-semibold text-sm text-foreground truncate">{play.player_name}</p>
          <p className="text-xs text-muted-foreground capitalize">{play.prop_type} — {play.current_line}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Badge className={`text-[10px] px-1.5 py-0 border ${TIER_CLASSES[play.confidence_tier] || TIER_CLASSES.MEDIUM}`}>
            {play.confidence_tier}
          </Badge>
          <Badge className={`text-[10px] px-1.5 py-0 ${isOver ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
            {isOver ? '▲' : '▼'} {play.edge_pct > 0 ? '+' : ''}{play.edge_pct.toFixed(0)}%
          </Badge>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        {/* Engine dots */}
        <div className="flex items-center gap-1">
          {play.engines.map((e, i) => (
            <span key={i} className="flex items-center gap-0.5" title={`${ENGINE_LABELS[e.engine]} — ${e.side}`}>
              <span className={`w-2 h-2 rounded-full ${ENGINE_COLORS[e.engine] || 'bg-muted'}`} />
              <span className="text-[10px] text-muted-foreground">{ENGINE_LABELS[e.engine]}</span>
            </span>
          ))}
          {play.sideAgreement ? (
            <Check className="w-3.5 h-3.5 text-emerald-400 ml-1" />
          ) : (
            <AlertTriangle className="w-3.5 h-3.5 text-yellow-400 ml-1" />
          )}
        </div>

        {/* Conviction bar */}
        <div className="w-20">
          <Progress value={pct} className="h-1.5 bg-muted" />
        </div>
      </div>
    </div>
  );
}

export function HighConvictionCard() {
  const { data, isLoading } = useHighConvictionPlays();

  const plays = data?.plays || [];
  const stats = data?.stats;

  return (
    <FeedCard variant="highlight" delay={100}>
      <FeedCardHeader
        title="High Conviction Plays"
        subtitle={stats ? `${stats.total} overlaps • ${stats.allAgree} all-agree` : 'Cross-engine analysis'}
        icon={<Crosshair className="w-5 h-5" />}
      />

      {isLoading ? (
        <div className="flex items-center justify-center py-8 text-muted-foreground gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Scanning engines…</span>
        </div>
      ) : plays.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">
          No cross-engine overlaps today — check back when all engines have run.
        </p>
      ) : (
        <div className="max-h-[400px] overflow-y-auto scrollbar-hide">
          {plays.slice(0, 20).map((play, i) => (
            <ConvictionRow key={`${play.player_name}-${play.prop_type}-${i}`} play={play} />
          ))}
          {plays.length > 20 && (
            <p className="text-xs text-muted-foreground text-center py-2">
              +{plays.length - 20} more overlaps
            </p>
          )}
        </div>
      )}
    </FeedCard>
  );
}
