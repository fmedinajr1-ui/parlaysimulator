import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { calculateGrade } from "@/lib/accuracy-calculator";
import { Target, TrendingUp, TrendingDown, ShieldCheck, ShieldAlert, ShieldX, Loader2 } from "lucide-react";

interface PropAccuracyRow {
  category: string;
  hits: number;
  misses: number;
  pushes: number;
  total_settled: number;
  hit_rate: number;
}

interface PropGroup {
  label: string;
  emoji: string;
  keys: string[];
  color: string;
  bgColor: string;
}

const PROP_GROUPS: PropGroup[] = [
  {
    label: 'Points',
    emoji: '🏀',
    keys: ['SCORING_LEADER', 'STAR_FLOOR_OVER', 'LOW_SCORER_UNDER'],
    color: 'text-orange-400',
    bgColor: 'bg-orange-500/10 border-orange-500/20',
  },
  {
    label: '3-Pointers',
    emoji: '🎯',
    keys: ['THREE_POINT_SHOOTER'],
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/10 border-blue-500/20',
  },
  {
    label: 'Rebounds',
    emoji: '💪',
    keys: ['ROLE_PLAYER_REB', 'BIG_MAN_BOARDS'],
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10 border-emerald-500/20',
  },
  {
    label: 'Assists',
    emoji: '🤝',
    keys: ['ASSIST_SPECIALIST'],
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/10 border-purple-500/20',
  },
  {
    label: 'Combos',
    emoji: '🔗',
    keys: ['COMBO_STAT_OVER'],
    color: 'text-cyan-400',
    bgColor: 'bg-cyan-500/10 border-cyan-500/20',
  },
];

function getVerdict(hitRate: number, total: number): { label: string; icon: typeof ShieldCheck; color: string; bgColor: string } {
  if (total < 10) return { label: 'NEEDS DATA', icon: ShieldAlert, color: 'text-muted-foreground', bgColor: 'bg-muted/30' };
  if (hitRate >= 58) return { label: 'TRUST — BOOST', icon: ShieldCheck, color: 'text-green-400', bgColor: 'bg-green-500/20' };
  if (hitRate >= 52.4) return { label: 'PROFITABLE', icon: TrendingUp, color: 'text-emerald-400', bgColor: 'bg-emerald-500/15' };
  if (hitRate >= 48) return { label: 'CAUTION', icon: ShieldAlert, color: 'text-yellow-400', bgColor: 'bg-yellow-500/15' };
  return { label: 'AVOID — FADE', icon: ShieldX, color: 'text-red-400', bgColor: 'bg-red-500/20' };
}

function PropGroupRow({ group, rows }: { group: PropGroup; rows: PropAccuracyRow[] }) {
  const matched = rows.filter(r => group.keys.includes(r.category));
  
  const totals = matched.reduce(
    (acc, r) => ({
      hits: acc.hits + (r.hits || 0),
      misses: acc.misses + (r.misses || 0),
      pushes: acc.pushes + (r.pushes || 0),
      total: acc.total + (r.total_settled || 0),
    }),
    { hits: 0, misses: 0, pushes: 0, total: 0 }
  );

  const hitRate = totals.total > 0 ? (totals.hits / totals.total) * 100 : 0;
  const { grade, color: gradeColor } = calculateGrade(hitRate, totals.total);
  const verdict = getVerdict(hitRate, totals.total);
  const VerdictIcon = verdict.icon;
  const vsBreakeven = hitRate - 52.4;

  return (
    <div className={cn("rounded-xl border p-4", group.bgColor)}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">{group.emoji}</span>
          <div>
            <h4 className={cn("font-bold text-sm", group.color)}>{group.label}</h4>
            <span className="text-[10px] text-muted-foreground">{totals.total} verified picks</span>
          </div>
        </div>
        <div className="text-right flex items-center gap-2">
          <div>
            <span className={cn("text-2xl font-bold block leading-none", gradeColor)}>{grade}</span>
            <span className={cn("text-xs font-semibold",
              hitRate >= 55 ? "text-green-400" : hitRate >= 50 ? "text-yellow-400" : "text-red-400"
            )}>
              {totals.total > 0 ? `${hitRate.toFixed(1)}%` : '--'}
            </span>
          </div>
        </div>
      </div>

      {/* Hit rate bar */}
      <div className="relative mb-2">
        <Progress value={Math.min(100, hitRate)} className="h-2.5" />
        <div
          className="absolute top-0 h-2.5 w-0.5 bg-yellow-500/80"
          style={{ left: '52.4%' }}
          title="52.4% Breakeven"
        />
      </div>

      {/* Record + Verdict */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-green-400 font-semibold">{totals.hits}W</span>
          <span className="text-muted-foreground">-</span>
          <span className="text-red-400 font-semibold">{totals.misses}L</span>
          {totals.pushes > 0 && (
            <>
              <span className="text-muted-foreground">-</span>
              <span className="text-yellow-400 font-semibold">{totals.pushes}P</span>
            </>
          )}
          {totals.total >= 20 && (
            <span className={cn(
              "text-[10px] font-medium ml-1",
              vsBreakeven >= 0 ? "text-green-400" : "text-red-400"
            )}>
              ({vsBreakeven >= 0 ? '+' : ''}{vsBreakeven.toFixed(1)}% edge)
            </span>
          )}
        </div>

        <Badge className={cn("text-[10px] px-2 py-0.5 gap-1 border-0", verdict.bgColor, verdict.color)}>
          <VerdictIcon className="w-3 h-3" />
          {verdict.label}
        </Badge>
      </div>

      {/* Sub-categories if multiple */}
      {matched.length > 1 && totals.total > 0 && (
        <div className="mt-3 space-y-1 border-t border-border/20 pt-2">
          {matched.map((m) => {
            const subRate = m.total_settled > 0 ? (m.hits / m.total_settled) * 100 : 0;
            const displayName = m.category.replace(/_/g, ' ').toLowerCase();
            return (
              <div key={m.category} className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground capitalize">{displayName}</span>
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "font-semibold",
                    subRate >= 55 ? "text-green-400" : subRate >= 50 ? "text-yellow-400" : "text-red-400"
                  )}>
                    {subRate.toFixed(1)}%
                  </span>
                  <span className="text-muted-foreground">({m.hits}-{m.misses})</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function PropTypeAccuracyCard() {
  const { data: categories, isLoading } = useQuery({
    queryKey: ['category-hit-rates'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_category_hit_rates');
      if (error) throw error;
      return (data || []) as PropAccuracyRow[];
    },
    staleTime: 1000 * 60 * 5,
  });

  if (isLoading) {
    return (
      <Card className="p-4 bg-card/50 border-border/50">
        <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Loading prop accuracy…</span>
        </div>
      </Card>
    );
  }

  const rows = categories || [];

  // Find best and worst
  const allGroupStats = PROP_GROUPS.map(g => {
    const matched = rows.filter(r => g.keys.includes(r.category));
    const total = matched.reduce((s, r) => s + (r.total_settled || 0), 0);
    const hits = matched.reduce((s, r) => s + (r.hits || 0), 0);
    const hitRate = total > 0 ? (hits / total) * 100 : 0;
    return { label: g.label, hitRate, total };
  }).filter(s => s.total >= 10);

  const best = allGroupStats.length > 0 ? allGroupStats.reduce((a, b) => a.hitRate > b.hitRate ? a : b) : null;
  const worst = allGroupStats.length > 0 ? allGroupStats.reduce((a, b) => a.hitRate < b.hitRate ? a : b) : null;

  return (
    <Card className="p-4 bg-card/50 border-border/50">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-sm flex items-center gap-2">
          <Target className="w-4 h-4 text-primary" />
          Prop Type Accuracy
        </h3>
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
          Bettor Decision Guide
        </span>
      </div>

      {/* Quick verdict banner */}
      {best && worst && best.label !== worst.label && (
        <div className="flex gap-2 mb-4">
          <div className="flex-1 rounded-lg bg-green-500/10 border border-green-500/20 p-2 text-center">
            <span className="text-[10px] text-green-400 font-semibold block">🔥 BEST BET</span>
            <span className="text-xs font-bold text-green-400">{best.label} — {best.hitRate.toFixed(1)}%</span>
          </div>
          <div className="flex-1 rounded-lg bg-red-500/10 border border-red-500/20 p-2 text-center">
            <span className="text-[10px] text-red-400 font-semibold block">⚠️ WEAKEST</span>
            <span className="text-xs font-bold text-red-400">{worst.label} — {worst.hitRate.toFixed(1)}%</span>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {PROP_GROUPS.map((group) => (
          <PropGroupRow key={group.label} group={group} rows={rows} />
        ))}
      </div>

      <div className="mt-4 text-[10px] text-muted-foreground bg-muted/20 rounded-lg p-2.5">
        <strong>How to read:</strong> TRUST picks with 55%+ hit rates and 20+ verified. 
        FADE or avoid categories below 48%. The breakeven line (52.4%) is your baseline — 
        anything above it means we're making money on standard -110 odds.
      </div>
    </Card>
  );
}
