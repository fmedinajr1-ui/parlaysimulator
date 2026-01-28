import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { calculateGrade } from "@/lib/accuracy-calculator";

interface CategoryHitRate {
  category: string;
  hits: number;
  misses: number;
  pushes: number;
  total_settled: number;
  hit_rate: number;
}

const CATEGORY_DISPLAY_NAMES: Record<string, string> = {
  'THREE_POINT_SHOOTER': '3PT Shooters',
  'STAR_FLOOR_OVER': 'Star Floor Overs',
  'ROLE_PLAYER_REB': 'Role Player Rebounds',
  'LOW_SCORER_UNDER': 'Low Scorer Unders',
  'ASSIST_SPECIALIST': 'Assist Specialists',
  'BIG_MAN_BOARDS': 'Big Man Boards',
  'SCORING_LEADER': 'Scoring Leaders',
  'COMBO_STAT_OVER': 'Combo Stat Overs',
  'BOUNCE_BACK': 'Bounce Back Plays',
  'HOT_STREAK': 'Hot Streak Plays',
};

export function SystemCategoryBreakdown() {
  const { data: categories, isLoading } = useQuery({
    queryKey: ['category-hit-rates'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_category_hit_rates');
      if (error) throw error;
      return (data || []) as CategoryHitRate[];
    },
    staleTime: 1000 * 60 * 5,
  });

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-2">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-12 bg-muted/30 rounded-lg" />
        ))}
      </div>
    );
  }

  if (!categories || categories.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No category data available yet
      </div>
    );
  }

  // Sort by hit rate descending
  const sortedCategories = [...categories].sort((a, b) => (b.hit_rate || 0) - (a.hit_rate || 0));

  return (
    <Accordion type="single" collapsible className="w-full">
      {sortedCategories.map((cat) => {
        const hitRate = cat.hit_rate || 0;
        const { grade, color } = calculateGrade(hitRate, cat.total_settled || 0);
        const displayName = CATEGORY_DISPLAY_NAMES[cat.category] || cat.category.replace(/_/g, ' ');

        return (
          <AccordionItem key={cat.category} value={cat.category} className="border-border/50">
            <AccordionTrigger className="hover:no-underline py-3">
              <div className="flex items-center justify-between w-full pr-4">
                <span className="text-sm font-medium">{displayName}</span>
                <div className="flex items-center gap-3">
                  <span className={cn("text-sm font-bold", color)}>{grade}</span>
                  <span className={cn(
                    "text-sm font-semibold",
                    hitRate >= 55 ? "text-green-400" : hitRate >= 50 ? "text-yellow-400" : "text-red-400"
                  )}>
                    {hitRate.toFixed(1)}%
                  </span>
                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 pb-2">
                {/* Progress bar */}
                <div className="relative">
                  <Progress value={Math.min(100, hitRate)} className="h-2" />
                  <div 
                    className="absolute top-0 h-2 w-0.5 bg-yellow-500/80"
                    style={{ left: '52.4%' }}
                    title="52.4% Breakeven"
                  />
                </div>

                {/* Record */}
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Record</span>
                  <div className="flex items-center gap-2">
                    <span className="text-green-400">{cat.hits}W</span>
                    <span className="text-muted-foreground">-</span>
                    <span className="text-red-400">{cat.misses}L</span>
                    {cat.pushes > 0 && (
                      <>
                        <span className="text-muted-foreground">-</span>
                        <span className="text-yellow-400">{cat.pushes}P</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Total picks */}
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{cat.total_settled} settled picks</span>
                  <span>
                    {hitRate >= 52.4 
                      ? `+${(hitRate - 52.4).toFixed(1)}% vs breakeven` 
                      : `${(hitRate - 52.4).toFixed(1)}% vs breakeven`}
                  </span>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        );
      })}
    </Accordion>
  );
}
