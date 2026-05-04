import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAdminRole } from "@/hooks/useAdminRole";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { SlidersHorizontal, RotateCcw, Save } from "lucide-react";

const SPORTS = ["ALL", "NBA", "MLB", "NFL", "NHL"] as const;
const AXES = ["form", "defense", "pace", "juice", "model_edge"] as const;
const FIELDS = ["aligned_over", "aligned_under", "against_over", "against_under", "neutral_band"] as const;

const DEFAULTS: Record<string, Record<string, Record<string, number | null>>> = {
  ALL: {
    form:       { aligned_over: 0.55, aligned_under: 0.55, against_over: 0.25, against_under: 0.25, neutral_band: null },
    defense:    { aligned_over: 20,   aligned_under: 13,   against_over: 12,   against_under: 20,   neutral_band: null },
    pace:       { aligned_over: 220,  aligned_under: 213,  against_over: 213,  against_under: 220,  neutral_band: null },
    juice:      { aligned_over: 20,   aligned_under: 20,   against_over: 5,    against_under: 5,    neutral_band: null },
    model_edge: { aligned_over: 0.5,  aligned_under: 0.5,  against_over: -0.5, against_under: -0.5, neutral_band: null },
  },
  MLB: {
    pace: { aligned_over: 9, aligned_under: 7.5, against_over: 7.5, against_under: 9, neutral_band: null },
  },
};

function defaultsFor(sport: string, axis: string) {
  return DEFAULTS[sport]?.[axis] ?? DEFAULTS.ALL[axis];
}

type Row = {
  id?: string;
  sport: string;
  axis: string;
  aligned_over: number | null;
  aligned_under: number | null;
  against_over: number | null;
  against_under: number | null;
  neutral_band: number | null;
  notes: string | null;
  updated_at: string;
  updated_by: string | null;
};

export default function AlertThresholds() {
  const { user } = useAuth();
  const { isAdmin, isLoading: roleLoading } = useAdminRole();
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: rows, isLoading } = useQuery({
    queryKey: ["alert_thresholds"],
    queryFn: async () => {
      const { data, error } = await supabase.from("alert_thresholds").select("*").order("sport").order("axis");
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    enabled: isAdmin,
  });

  const { data: audit } = useQuery({
    queryKey: ["alert_thresholds_audit"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("alert_thresholds_audit")
        .select("sport, axis, source, actor, changed_at, new_values")
        .order("changed_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
    enabled: isAdmin,
  });

  // Local edit buffer keyed by `${sport}:${axis}:${field}`
  const [edits, setEdits] = useState<Record<string, string>>({});
  useEffect(() => { setEdits({}); }, [rows?.length]);

  const rowMap = useMemo(() => {
    const m = new Map<string, Row>();
    for (const r of rows ?? []) m.set(`${r.sport}:${r.axis}`, r);
    return m;
  }, [rows]);

  const cellValue = (sport: string, axis: string, field: string): string => {
    const k = `${sport}:${axis}:${field}`;
    if (k in edits) return edits[k];
    const row = rowMap.get(`${sport}:${axis}`);
    const v = row ? (row as any)[field] : defaultsFor(sport, axis)?.[field];
    return v == null ? "" : String(v);
  };

  const isDirty = (sport: string) => Object.keys(edits).some((k) => k.startsWith(sport + ":"));

  const saveSport = useMutation({
    mutationFn: async (sport: string) => {
      const updates: any[] = [];
      for (const axis of AXES) {
        const existing = rowMap.get(`${sport}:${axis}`);
        const def = defaultsFor(sport, axis);
        const next: any = {
          sport, axis,
          aligned_over:  parseFloat(cellValue(sport, axis, "aligned_over")),
          aligned_under: parseFloat(cellValue(sport, axis, "aligned_under")),
          against_over:  parseFloat(cellValue(sport, axis, "against_over")),
          against_under: parseFloat(cellValue(sport, axis, "against_under")),
          neutral_band:  cellValue(sport, axis, "neutral_band") === "" ? null : parseFloat(cellValue(sport, axis, "neutral_band")),
          updated_by: `web:${user?.id ?? "unknown"}`,
          updated_at: new Date().toISOString(),
        };
        const dirty = FIELDS.some((f) => `${sport}:${axis}:${f}` in edits);
        if (!dirty && !existing) continue;
        // Validate finiteness
        for (const f of ["aligned_over","aligned_under","against_over","against_under"]) {
          if (!Number.isFinite(next[f])) throw new Error(`${sport} ${axis}.${f} is not a number`);
        }
        updates.push(next);
      }
      if (updates.length === 0) return;
      const { error } = await supabase.from("alert_thresholds").upsert(updates, { onConflict: "sport,axis" });
      if (error) throw error;
    },
    onSuccess: (_v, sport) => {
      toast({ title: `Saved ${sport}` });
      setEdits((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !k.startsWith(sport + ":"))));
      qc.invalidateQueries({ queryKey: ["alert_thresholds"] });
      qc.invalidateQueries({ queryKey: ["alert_thresholds_audit"] });
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const resetAxis = useMutation({
    mutationFn: async ({ sport, axis }: { sport: string; axis: string }) => {
      const def = defaultsFor(sport, axis);
      if (!def) throw new Error("no default");
      const { error } = await supabase.from("alert_thresholds").upsert({
        sport, axis, ...def,
        updated_by: `web:${user?.id ?? "unknown"}`,
        updated_at: new Date().toISOString(),
      }, { onConflict: "sport,axis" });
      if (error) throw error;
    },
    onSuccess: (_v, vars) => {
      toast({ title: `Reset ${vars.sport} ${vars.axis}` });
      qc.invalidateQueries({ queryKey: ["alert_thresholds"] });
    },
    onError: (e: any) => toast({ title: "Reset failed", description: e.message, variant: "destructive" }),
  });

  if (roleLoading) return <div className="p-6 text-sm text-muted-foreground">Checking access…</div>;
  if (!isAdmin) return <div className="p-6 text-sm text-destructive">Admin only.</div>;

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-4 max-w-5xl">
      <div className="flex items-center gap-2">
        <SlidersHorizontal className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-semibold">Cascade Alert Thresholds</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Tune alignment cutoffs without redeploying. Changes propagate to all engines within ~60s.
        Also editable from Telegram via <code>/thresholds</code>, <code>/set</code>, <code>/reset</code>, <code>/audit</code>.
      </p>

      <Tabs defaultValue="editor">
        <TabsList>
          <TabsTrigger value="editor">Editor</TabsTrigger>
          <TabsTrigger value="audit">Audit log</TabsTrigger>
        </TabsList>

        <TabsContent value="editor" className="space-y-4">
          {SPORTS.map((sport) => (
            <Card key={sport}>
              <CardHeader className="pb-3 flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base">{sport}</CardTitle>
                  <CardDescription className="text-xs">Per-axis cutoffs. Empty = inherit ALL or default.</CardDescription>
                </div>
                <Button size="sm" disabled={!isDirty(sport) || saveSport.isPending} onClick={() => saveSport.mutate(sport)}>
                  <Save className="w-3 h-3 mr-1" /> Save {sport}
                </Button>
              </CardHeader>
              <CardContent className="space-y-3">
                {AXES.map((axis) => (
                  <div key={axis} className="border border-border/50 rounded-lg p-3 bg-muted/20">
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-medium text-sm capitalize">{axis.replace("_"," ")}</div>
                      <Button size="sm" variant="ghost" onClick={() => resetAxis.mutate({ sport, axis })}>
                        <RotateCcw className="w-3 h-3 mr-1" /> Reset
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                      {FIELDS.map((field) => {
                        const k = `${sport}:${axis}:${field}`;
                        const dirty = k in edits;
                        return (
                          <div key={field} className="space-y-1">
                            <label className="text-[10px] uppercase text-muted-foreground tracking-wide">{field}</label>
                            <Input
                              type="number"
                              step="0.01"
                              className={dirty ? "border-primary" : ""}
                              value={cellValue(sport, axis, field)}
                              onChange={(e) => setEdits((prev) => ({ ...prev, [k]: e.target.value }))}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="audit">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Recent changes</CardTitle></CardHeader>
            <CardContent>
              {isLoading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : (audit?.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground">No audit entries yet.</p>
              ) : (
                <div className="space-y-1">
                  {audit!.map((a: any, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs border-b border-border/40 py-2">
                      <Badge variant="outline" className="text-[10px]">{a.source}</Badge>
                      <span className="font-mono">{a.sport}/{a.axis}</span>
                      <span className="text-muted-foreground">{a.actor}</span>
                      <span className="ml-auto text-muted-foreground">{new Date(a.changed_at).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}