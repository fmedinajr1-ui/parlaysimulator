import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Settings, Save, RefreshCw } from "lucide-react";

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

export function StakeConfigPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

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

  const handleSave = () => {
    mutation.mutate(form);
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="h-5 w-5" />
          Stake Override Panel
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Update stakes and limits without any code deploys. Bot reads these at generation time.
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
            {field("validation_stake", "Validation", "$", "Confirmed pattern 3-leg parlays")}
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
              { label: "Execution", stake: values.execution_stake ?? 300, count: values.max_daily_parlays_execution ?? 5, wr: 0.37, odds: 6 },
              { label: "Validation", stake: values.validation_stake ?? 150, count: values.max_daily_parlays_validation ?? 8, wr: 0.33, odds: 7 },
              { label: "Exploration", stake: values.exploration_stake ?? 50, count: values.max_daily_parlays_exploration ?? 10, wr: 0.30, odds: 8 },
            ].map((t) => {
              const ev = t.count * t.wr * t.stake * t.odds - t.count * (1 - t.wr) * t.stake;
              return (
                <div key={t.label} className="flex justify-between text-muted-foreground">
                  <span>{t.label}: {t.count} parlays × ${t.stake}</span>
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
                  ((values.max_daily_parlays_execution ?? 5) * 0.37 * (values.execution_stake ?? 300) * 6 - (values.max_daily_parlays_execution ?? 5) * 0.63 * (values.execution_stake ?? 300)) +
                  ((values.max_daily_parlays_validation ?? 8) * 0.33 * (values.validation_stake ?? 150) * 7 - (values.max_daily_parlays_validation ?? 8) * 0.67 * (values.validation_stake ?? 150)) +
                  ((values.max_daily_parlays_exploration ?? 10) * 0.30 * (values.exploration_stake ?? 50) * 8 - (values.max_daily_parlays_exploration ?? 10) * 0.70 * (values.exploration_stake ?? 50))
                ).toLocaleString()}/day
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
