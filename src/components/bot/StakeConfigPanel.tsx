import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Settings, Save, RefreshCw, Target, TrendingUp, DollarSign, Zap } from "lucide-react";

interface StakeConfig {
  id: string;
  execution_stake: number;
  validation_stake: number;
  exploration_stake: number;
  bankroll_doubler_stake: number;
  max_daily_parlays_execution: number;
  max_daily_parlays_validation: number;
  max_daily_parlays_exploration: number;
  block_two_leg_parlays: boolean;
  updated_at: string;
}

interface CategoryWeight {
  category: string;
  side: string;
  sport: string;
  total_picks: number;
  total_hits: number;
  weight: number;
  is_blocked: boolean;
}

// Derive an "accuracy confidence score" (0–100) from category weights
function computeAccuracyScore(weights: CategoryWeight[]): number {
  const active = weights.filter(w => !w.is_blocked && w.total_picks >= 5);
  if (!active.length) return 50;
  const avgHR = active.reduce((s, w) => s + (w.total_hits / w.total_picks), 0) / active.length;
  return Math.round(avgHR * 100);
}

// Return recommended stake amounts scaled to accuracy + bankroll
function getRecommendedStakes(accuracyScore: number, bankroll: number) {
  // Kelly-inspired: bet more when edge is high, scale to bankroll
  const edgeFactor = Math.max(0.5, (accuracyScore - 50) / 50); // 0.5–1.0
  const execBase = Math.round(bankroll * 0.025 * edgeFactor / 50) * 50; // ~2.5% bankroll
  return {
    execution: Math.max(200, Math.min(1000, execBase)),
    validation: Math.max(100, Math.min(400, Math.round(execBase * 0.4 / 25) * 25)),
    exploration: Math.max(50, Math.min(150, Math.round(execBase * 0.15 / 25) * 25)),
  };
}

export function StakeConfigPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [bankroll, setBankroll] = useState(10000);

  const { data: config, isLoading } = useQuery({
    queryKey: ["bot-stake-config"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bot_stake_config")
        .select("*")
        .order("updated_at", { ascending: false })
        .limit(1)
        .single();
      if (error) throw error;
      return data as StakeConfig;
    },
  });

  const { data: categoryWeights = [] } = useQuery({
    queryKey: ["category-weights-for-stake"],
    queryFn: async () => {
      const { data } = await supabase
        .from("bot_category_weights")
        .select("category, side, sport, total_picks, total_hits, weight, is_blocked")
        .gte("total_picks", 5);
      return (data ?? []) as CategoryWeight[];
    },
  });

  const [form, setForm] = useState<Partial<StakeConfig>>({});
  const values = { ...config, ...form };

  const mutation = useMutation({
    mutationFn: async (updates: Partial<StakeConfig>) => {
      if (!config?.id) throw new Error("No config row found");
      const { error } = await supabase
        .from("bot_stake_config")
        .update(updates)
        .eq("id", config.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bot-stake-config"] });
      setForm({});
      toast({ title: "Stake config saved", description: "Bot will use new stakes on next generation run." });
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const handleSave = () => mutation.mutate(form);

  const accuracyScore = computeAccuracyScore(categoryWeights);
  const recommended = getRecommendedStakes(accuracyScore, bankroll);

  // Top performing categories for display
  const topCategories = [...categoryWeights]
    .filter(w => !w.is_blocked && w.total_picks >= 5)
    .sort((a, b) => (b.total_hits / b.total_picks) - (a.total_hits / a.total_picks))
    .slice(0, 4);

  const applyRecommended = () => {
    setForm(prev => ({
      ...prev,
      execution_stake: recommended.execution,
      validation_stake: recommended.validation,
      exploration_stake: recommended.exploration,
      max_daily_parlays_execution: 3,
      max_daily_parlays_validation: 5,
      max_daily_parlays_exploration: 8,
      block_two_leg_parlays: true,
    }));
    toast({ title: "Recommended stakes applied", description: "Review and save to lock them in." });
  };

  const field = (key: keyof StakeConfig, label: string, prefix = "$", note?: string) => (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground uppercase tracking-wide">{label}</Label>
      <div className="flex items-center gap-2">
        {prefix && <span className="text-muted-foreground text-sm">{prefix}</span>}
        <Input
          type="number"
          value={String(values[key] ?? "")}
          onChange={(e) =>
            setForm((prev) => ({ ...prev, [key]: Number(e.target.value) }))
          }
          className="text-sm"
        />
      </div>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  );

  if (isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle>Stake Override Panel</CardTitle></CardHeader>
        <CardContent>
          <div className="h-48 bg-muted animate-pulse rounded-lg" />
        </CardContent>
      </Card>
    );
  }

  const hasChanges = Object.keys(form).length > 0;

  // Accuracy tier label
  const accLabel = accuracyScore >= 65 ? "High Confidence"
    : accuracyScore >= 55 ? "Moderate"
    : "Cautious";

  return (
    <div className="space-y-4">
      {/* === ACCURACY INTELLIGENCE PANEL === */}
      <Card className="border-primary/30 bg-primary/5">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Target className="h-5 w-5 text-primary" />
            Accuracy-Weighted Stake Intelligence
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Stakes calibrated to live category hit rates — bet bigger when your edge is real.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Accuracy score */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-background border border-border">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Current System Accuracy</p>
                  <p className="text-2xl font-bold text-primary">{accuracyScore}%</p>
              <p className="text-xs font-medium text-primary">{accLabel}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Best categories</p>
              {topCategories.slice(0, 2).map(c => (
                <p key={`${c.category}-${c.side}`} className="text-xs font-medium text-primary">
                  {c.category.replace(/_/g, ' ')} {c.side.toUpperCase()} — {Math.round(c.total_hits / c.total_picks * 100)}%
                </p>
              ))}
            </div>
          </div>

          {/* Top categories breakdown */}
          {topCategories.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Live Edge Leaders</p>
              {topCategories.map(c => {
                const hr = Math.round(c.total_hits / c.total_picks * 100);
                return (
                  <div key={`${c.category}-${c.side}`} className="flex items-center gap-2">
                    <div className="flex-1">
                      <div className="flex justify-between text-xs mb-0.5">
                        <span className="font-medium">{c.category.replace(/_/g, ' ')} <span className="text-muted-foreground">{c.side}</span></span>
                        <span className={hr >= 70 ? "text-primary font-bold" : hr >= 55 ? "text-foreground font-medium" : "text-muted-foreground"}>{hr}%</span>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${hr >= 70 ? "bg-primary" : hr >= 55 ? "bg-foreground/60" : "bg-muted-foreground"}`}
                          style={{ width: `${hr}%` }}
                        />
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground w-12 text-right">{c.total_picks} picks</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Bankroll input + recommended stakes */}
          <div className="border-t border-border/50 pt-3 space-y-3">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">Your Bankroll</Label>
              <Input
                type="number"
                value={bankroll}
                onChange={e => setBankroll(Number(e.target.value))}
                className="h-7 text-sm w-32 ml-auto"
              />
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                { label: "Execution", value: recommended.execution, note: "3 parlays/day", color: "border-green-500/40 bg-green-500/5" },
                { label: "Validation", value: recommended.validation, note: "5 parlays/day", color: "border-yellow-500/40 bg-yellow-500/5" },
                { label: "Exploration", value: recommended.exploration, note: "8 parlays/day", color: "border-border bg-muted/30" },
              ].map(t => (
                <div key={t.label} className={`rounded-xl border p-2 ${t.color}`}>
                  <p className="text-xs text-muted-foreground">{t.label}</p>
                  <p className="text-lg font-bold">${t.value}</p>
                  <p className="text-xs text-muted-foreground">{t.note}</p>
                </div>
              ))}
            </div>
            <Button variant="outline" size="sm" onClick={applyRecommended} className="w-full border-primary/30 text-primary hover:bg-primary/10">
              <Zap className="h-3.5 w-3.5 mr-1.5" />
              Apply Accuracy-Recommended Stakes
            </Button>
          </div>

          {/* When we win, we win big — payout preview */}
          <div className="border-t border-border/50 pt-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">When We Win, We Win Big</p>
            <div className="space-y-1.5">
              {[
                { label: "3-Leg Execution hit", stake: values.execution_stake ?? 500, odds: 596, prob: 0.37 },
                { label: "4-Leg Validation hit", stake: values.validation_stake ?? 200, odds: 1228, prob: 0.22 },
                { label: "3-Leg Exploration hit", stake: values.exploration_stake ?? 75, odds: 596, prob: 0.37 },
              ].map(t => {
                const payout = t.stake * (1 + t.odds / 100);
                const profit = payout - t.stake;
                const evPerDay = (t.prob * profit) - ((1 - t.prob) * t.stake);
                return (
                  <div key={t.label} className="flex justify-between items-center text-xs">
                    <span className="text-muted-foreground">{t.label} (+{t.odds})</span>
                    <div className="text-right">
                      <span className="text-primary font-bold">+${Math.round(profit).toLocaleString()}</span>
                      <span className="text-muted-foreground ml-2">EV: {evPerDay >= 0 ? "+" : ""}${Math.round(evPerDay)}/day</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* === MANUAL OVERRIDE PANEL === */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Manual Override
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Fine-tune stakes and limits. Bot reads these at generation time.
          </p>
          {config?.updated_at && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <RefreshCw className="h-3 w-3" />
              Last updated: {new Date(config.updated_at).toLocaleString()}
            </p>
          )}
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Stakes */}
          <div>
            <p className="text-sm font-semibold mb-3">Stake Per Parlay</p>
            <div className="grid grid-cols-2 gap-4">
              {field("execution_stake", "Execution", "$", "High-confidence 3-leg parlays")}
              {field("validation_stake", "Validation", "$", "Confirmed pattern parlays")}
              {field("exploration_stake", "Exploration", "$", "Edge discovery parlays")}
              {field("bankroll_doubler_stake", "Bankroll Doubler", "$", "6-leg mega parlay")}
            </div>
          </div>

          {/* Max parlays */}
          <div>
            <p className="text-sm font-semibold mb-3">Max Parlays Per Day</p>
            <div className="grid grid-cols-3 gap-4">
              {field("max_daily_parlays_execution", "Execution", "", "Max execution parlays")}
              {field("max_daily_parlays_validation", "Validation", "", "Max validation parlays")}
              {field("max_daily_parlays_exploration", "Exploration", "", "Max exploration parlays")}
            </div>
          </div>

          {/* Block 2-leg toggle */}
          <div className="flex items-center justify-between p-3 rounded-xl border border-border bg-muted/40">
            <div>
              <p className="text-sm font-semibold">Block 2-Leg Parlays</p>
              <p className="text-xs text-muted-foreground">2-leg parlays have 11.8% win rate — worst performer</p>
            </div>
            <button
              onClick={() =>
                setForm((prev) => ({
                  ...prev,
                  block_two_leg_parlays: !(values.block_two_leg_parlays ?? true),
                }))
              }
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                values.block_two_leg_parlays ? "bg-primary" : "bg-muted-foreground/40"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-background shadow transition-transform ${
                  values.block_two_leg_parlays ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>

          {/* Save button */}
          <Button
            onClick={handleSave}
            disabled={!hasChanges || mutation.isPending}
            className="w-full"
          >
            <Save className="h-4 w-4 mr-2" />
            {mutation.isPending ? "Saving..." : hasChanges ? "Save Changes" : "No Changes"}
          </Button>

          {/* Projected EV preview */}
          <div className="border-t border-border pt-4">
            <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Projected Daily EV at Current Stakes</p>
            <div className="space-y-1 text-xs">
              {[
                { label: "Execution", stake: values.execution_stake ?? 500, count: values.max_daily_parlays_execution ?? 3, wr: 0.37, odds: 6 },
                { label: "Validation", stake: values.validation_stake ?? 200, count: values.max_daily_parlays_validation ?? 5, wr: 0.33, odds: 7 },
                { label: "Exploration", stake: values.exploration_stake ?? 75, count: values.max_daily_parlays_exploration ?? 8, wr: 0.30, odds: 8 },
              ].map((t) => {
                const ev = t.count * t.wr * t.stake * t.odds - t.count * (1 - t.wr) * t.stake;
                return (
                  <div key={t.label} className="flex justify-between text-muted-foreground">
                    <span>{t.label}: {t.count} × ${t.stake}</span>
                    <span className={ev >= 0 ? "text-primary" : "text-destructive"}>
                      {ev >= 0 ? "+" : ""}${Math.round(ev).toLocaleString()}/day EV
                    </span>
                  </div>
                );
              })}
              <div className="flex justify-between font-semibold border-t border-border pt-1 mt-1">
                <span>Total Daily EV</span>
                <span className="text-primary">
                  +${Math.round(
                    ((values.max_daily_parlays_execution ?? 3) * 0.37 * (values.execution_stake ?? 500) * 6 - (values.max_daily_parlays_execution ?? 3) * 0.63 * (values.execution_stake ?? 500)) +
                    ((values.max_daily_parlays_validation ?? 5) * 0.33 * (values.validation_stake ?? 200) * 7 - (values.max_daily_parlays_validation ?? 5) * 0.67 * (values.validation_stake ?? 200)) +
                    ((values.max_daily_parlays_exploration ?? 8) * 0.30 * (values.exploration_stake ?? 75) * 8 - (values.max_daily_parlays_exploration ?? 8) * 0.70 * (values.exploration_stake ?? 75))
                  ).toLocaleString()}/day
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
