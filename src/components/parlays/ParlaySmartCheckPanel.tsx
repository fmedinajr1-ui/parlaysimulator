import React, { useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { 
  Activity, TrendingDown, AlertTriangle, Shield, Crosshair,
  Loader2, ChevronDown, ChevronUp, Zap, Check, X
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

interface LegCheck {
  parlay_id: string;
  leg_index: number;
  player_name: string;
  prop_type: string;
  line: number;
  side: string;
  team: string | null;
  risk_tags: string[];
  recommendation: 'KEEP' | 'FLIP' | 'DROP' | 'CAUTION';
  details: Record<string, any>;
  quality_score: number;
}

interface ParlayCheckResult {
  parlay_id: string;
  strategy_name: string;
  tier: string | null;
  leg_count: number;
  legs: LegCheck[];
  summary: { keeps: number; flips: number; drops: number; cautions: number };
  avg_quality: number;
}

function qualityColor(score: number) {
  if (score < 30) return 'bg-red-500/20 text-red-400 border-red-500/40';
  if (score <= 60) return 'bg-amber-500/20 text-amber-400 border-amber-500/40';
  return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40';
}

interface SmartCheckResponse {
  results: ParlayCheckResult[];
  checks_run: string[];
  parlays_checked: number;
  total_issues: number;
  checked_at: string;
}

type CheckType = 'l3' | 'blowout' | 'injury' | 'bidirectional';

const CHECK_CONFIG: Record<CheckType, { label: string; icon: React.ReactNode; color: string }> = {
  l3: { label: 'L3 Filter', icon: <TrendingDown className="h-3.5 w-3.5" />, color: 'text-amber-400' },
  blowout: { label: 'Blowout', icon: <AlertTriangle className="h-3.5 w-3.5" />, color: 'text-red-400' },
  injury: { label: 'Injuries', icon: <Shield className="h-3.5 w-3.5" />, color: 'text-rose-400' },
  bidirectional: { label: 'BiDir', icon: <Crosshair className="h-3.5 w-3.5" />, color: 'text-blue-400' },
};

const RECOMMENDATION_STYLES: Record<string, { bg: string; text: string; icon: React.ReactNode }> = {
  KEEP: { bg: 'bg-emerald-500/20', text: 'text-emerald-400', icon: <Check className="h-3 w-3" /> },
  FLIP: { bg: 'bg-amber-500/20', text: 'text-amber-400', icon: <Activity className="h-3 w-3" /> },
  DROP: { bg: 'bg-red-500/20', text: 'text-red-400', icon: <X className="h-3 w-3" /> },
  CAUTION: { bg: 'bg-orange-500/20', text: 'text-orange-400', icon: <AlertTriangle className="h-3 w-3" /> },
};

export function ParlaySmartCheckPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [results, setResults] = useState<SmartCheckResponse | null>(null);
  const [runningChecks, setRunningChecks] = useState<Set<CheckType>>(new Set());
  const [isApplying, setIsApplying] = useState(false);
  const [selectedActions, setSelectedActions] = useState<Map<string, 'flip' | 'drop' | 'keep'>>(new Map());
  const queryClient = useQueryClient();

  const runChecks = useCallback(async (checks: CheckType[]) => {
    setRunningChecks(new Set(checks));
    try {
      const { data, error } = await supabase.functions.invoke('bot-parlay-smart-check', {
        body: { checks },
      });

      if (error) throw error;

      setResults(data as SmartCheckResponse);

      // Auto-select recommended actions
      const autoSelected = new Map<string, 'flip' | 'drop' | 'keep'>();
      (data as SmartCheckResponse).results.forEach(parlay => {
        parlay.legs.forEach(leg => {
          if (leg.recommendation !== 'KEEP') {
            const key = `${leg.parlay_id}::${leg.leg_index}`;
            const action = leg.recommendation === 'FLIP' ? 'flip' :
                           leg.recommendation === 'DROP' ? 'drop' : 'keep';
            autoSelected.set(key, action);
          }
        });
      });
      setSelectedActions(autoSelected);

      toast({
        title: "Smart Check Complete",
        description: `${(data as SmartCheckResponse).parlays_checked} parlays checked, ${(data as SmartCheckResponse).total_issues} issues found`,
      });
    } catch (err: any) {
      toast({ title: "Check Failed", description: err.message, variant: "destructive" });
    } finally {
      setRunningChecks(new Set());
    }
  }, []);

  const runAll = () => runChecks(['l3', 'blowout', 'injury', 'bidirectional']);

  const toggleAction = (key: string, action: 'flip' | 'drop') => {
    setSelectedActions(prev => {
      const next = new Map(prev);
      if (next.get(key) === action) {
        next.delete(key);
      } else {
        next.set(key, action);
      }
      return next;
    });
  };

  const applySelected = async () => {
    if (selectedActions.size === 0) return;
    setIsApplying(true);

    try {
      const actions = Array.from(selectedActions.entries()).map(([key, action]) => {
        const [parlay_id, leg_index] = key.split('::');
        return { parlay_id, leg_index: parseInt(leg_index), action };
      });

      const { data, error } = await supabase.functions.invoke('bot-parlay-auto-apply', {
        body: { actions },
      });

      if (error) throw error;

      toast({
        title: "Changes Applied",
        description: `${data.total_applied} parlays updated`,
      });

      // Refresh parlays
      queryClient.invalidateQueries({ queryKey: ['bot-daily-parlays'] });
      setResults(null);
      setSelectedActions(new Map());
    } catch (err: any) {
      toast({ title: "Apply Failed", description: err.message, variant: "destructive" });
    } finally {
      setIsApplying(false);
    }
  };

  const isRunning = runningChecks.size > 0;
  const hasIssues = results && results.total_issues > 0;
  const flaggedLegs = results?.results.flatMap(r => r.legs.filter(l => l.recommendation !== 'KEEP')) || [];

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card className="border-primary/10 bg-card/50">
        <CollapsibleTrigger asChild>
          <button className="w-full p-3 flex items-center justify-between text-left hover:bg-muted/30 transition-colors">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">Smart Check</span>
              {results && (
                <Badge 
                  variant="outline" 
                  className={hasIssues ? "border-amber-500/50 text-amber-400 text-xs" : "border-emerald-500/50 text-emerald-400 text-xs"}
                >
                  {hasIssues ? `${results.total_issues} issues` : '✓ Clean'}
                </Badge>
              )}
            </div>
            {isOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="pt-0 pb-3 px-3 space-y-3">
            {/* Check Buttons */}
            <div className="flex flex-wrap gap-2">
              {(Object.entries(CHECK_CONFIG) as [CheckType, typeof CHECK_CONFIG[CheckType]][]).map(([key, cfg]) => (
                <Button
                  key={key}
                  variant="outline"
                  size="sm"
                  className={`gap-1.5 text-xs ${cfg.color}`}
                  disabled={isRunning}
                  onClick={() => runChecks([key])}
                >
                  {runningChecks.has(key) ? <Loader2 className="h-3 w-3 animate-spin" /> : cfg.icon}
                  {cfg.label}
                </Button>
              ))}
              <Button
                variant="default"
                size="sm"
                className="gap-1.5 text-xs ml-auto"
                disabled={isRunning}
                onClick={runAll}
              >
                {isRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Activity className="h-3.5 w-3.5" />}
                Run All
              </Button>
            </div>

            {/* Results */}
            {results && flaggedLegs.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs text-muted-foreground font-medium">
                  {flaggedLegs.length} legs flagged across {results.parlays_checked} parlays
                </div>

                <div className="space-y-1.5 max-h-80 overflow-y-auto">
                  {results.results.map(parlay => {
                    const flagged = parlay.legs
                      .filter(l => l.recommendation !== 'KEEP')
                      .sort((a, b) => a.quality_score - b.quality_score);
                    return flagged.map(leg => {
                        const key = `${leg.parlay_id}::${leg.leg_index}`;
                        const selected = selectedActions.get(key);
                        const recStyle = RECOMMENDATION_STYLES[leg.recommendation];

                        return (
                          <div key={key} className="rounded-lg border border-border/50 bg-background/50 p-2.5 space-y-1.5">
                            {/* Player + Recommendation */}
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium">{leg.player_name}</span>
                                <span className="text-xs text-muted-foreground uppercase">
                                  {leg.side} {leg.line} {leg.prop_type}
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${qualityColor(leg.quality_score)}`}>
                                  Q:{leg.quality_score}
                                </Badge>
                                <Badge className={`${recStyle.bg} ${recStyle.text} text-xs gap-1`}>
                                  {recStyle.icon}
                                  {leg.recommendation}
                                </Badge>
                              </div>
                            </div>

                            {/* Risk Tags */}
                            <div className="flex flex-wrap gap-1">
                              {leg.risk_tags.map((tag, i) => (
                                <Badge key={i} variant="outline" className="text-[10px] px-1.5 py-0">
                                  {tag}
                                </Badge>
                              ))}
                            </div>

                            {/* Details */}
                            {leg.details.l3_avg != null && (
                              <div className="text-xs text-muted-foreground">
                                L3: {leg.details.l3_avg} | L10: {leg.details.l10_avg} | Hit: {leg.details.l10_hit_rate != null ? `${(leg.details.l10_hit_rate * 100).toFixed(0)}%` : 'N/A'}
                              </div>
                            )}
                            {leg.details.spread != null && (
                              <div className="text-xs text-muted-foreground">
                                Spread: {leg.details.spread > 0 ? '+' : ''}{leg.details.spread}
                              </div>
                            )}
                            {leg.details.injury_status && (
                              <div className="text-xs text-red-400">
                                Status: {leg.details.injury_status}
                              </div>
                            )}
                            {leg.details.flip_reason && (
                              <div className="text-xs text-amber-400">
                                {leg.details.flip_reason}
                              </div>
                            )}

                            {/* Action Checkboxes */}
                            <div className="flex items-center gap-3 pt-1">
                              {leg.recommendation === 'FLIP' && (
                                <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                                  <Checkbox
                                    checked={selected === 'flip'}
                                    onCheckedChange={() => toggleAction(key, 'flip')}
                                  />
                                  <span>Flip side</span>
                                </label>
                              )}
                              {(leg.recommendation === 'DROP' || leg.recommendation === 'CAUTION') && (
                                <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                                  <Checkbox
                                    checked={selected === 'drop'}
                                    onCheckedChange={() => toggleAction(key, 'drop')}
                                  />
                                  <span>Drop leg</span>
                                </label>
                              )}
                              {leg.recommendation === 'CAUTION' && (
                                <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                                  <Checkbox
                                    checked={selected === 'flip'}
                                    onCheckedChange={() => toggleAction(key, 'flip')}
                                  />
                                  <span>Flip instead</span>
                                </label>
                              )}

                              {/* Strategy context */}
                              <span className="text-[10px] text-muted-foreground ml-auto">
                                {parlay.strategy_name} • {parlay.tier || 'n/a'}
                              </span>
                            </div>
                          </div>
                        );
                      })
                  ))}
                </div>

                {/* Auto-Apply Button */}
                {selectedActions.size > 0 && (
                  <Button
                    className="w-full gap-2"
                    size="sm"
                    onClick={applySelected}
                    disabled={isApplying}
                  >
                    {isApplying ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Zap className="h-4 w-4" />
                    )}
                    Auto-Apply {selectedActions.size} Recommendation{selectedActions.size > 1 ? 's' : ''}
                  </Button>
                )}
              </div>
            )}

            {/* Clean State */}
            {results && flaggedLegs.length === 0 && (
              <div className="text-center py-4">
                <Check className="h-8 w-8 text-emerald-400 mx-auto mb-2" />
                <p className="text-sm text-emerald-400 font-medium">All parlays look clean</p>
                <p className="text-xs text-muted-foreground">{results.parlays_checked} parlays, {results.checks_run.length} checks</p>
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
