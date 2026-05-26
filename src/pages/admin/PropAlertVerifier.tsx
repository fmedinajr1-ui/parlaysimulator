import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface Verdict {
  id: string;
  alert_id: string;
  source_table: string;
  player_name: string | null;
  sport: string | null;
  prop_type: string | null;
  side: string | null;
  line: number | null;
  verdict: "APPROVE" | "CAUTION" | "REJECT";
  verdict_confidence: number | null;
  confidence_multiplier: number;
  reasoning: string | null;
  flags: string[];
  research_model: string | null;
  judge_model: string | null;
  created_at: string;
}

const verdictColor: Record<string, string> = {
  APPROVE: "bg-green-600",
  CAUTION: "bg-yellow-600",
  REJECT: "bg-red-600",
};

export default function PropAlertVerifier() {
  const [rows, setRows] = useState<Verdict[]>([]);
  const [loading, setLoading] = useState(true);
  const [sportFilter, setSportFilter] = useState<string>("ALL");
  const [verdictFilter, setVerdictFilter] = useState<string>("ALL");

  async function load() {
    setLoading(true);
    let q = supabase.from("prop_alert_verdicts").select("*").order("created_at", { ascending: false }).limit(200);
    if (sportFilter !== "ALL") q = q.eq("sport", sportFilter);
    if (verdictFilter !== "ALL") q = q.eq("verdict", verdictFilter);
    const { data } = await q;
    setRows((data ?? []) as Verdict[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, [sportFilter, verdictFilter]);

  async function reverify(r: Verdict) {
    await supabase.functions.invoke("prop-alert-verifier", {
      body: { alert_id: r.alert_id, source_table: r.source_table },
    });
    setTimeout(load, 2000);
  }

  const counts = {
    APPROVE: rows.filter(r => r.verdict === "APPROVE").length,
    CAUTION: rows.filter(r => r.verdict === "CAUTION").length,
    REJECT: rows.filter(r => r.verdict === "REJECT").length,
  };

  return (
    <div className="container mx-auto px-4 py-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">🔍 Prop Alert Verifier</h1>
        <p className="text-muted-foreground text-sm">Deep-research second opinion on every inbound prop alert.</p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card className="p-4"><div className="text-xs text-muted-foreground">APPROVE</div><div className="text-2xl font-bold text-green-500">{counts.APPROVE}</div></Card>
        <Card className="p-4"><div className="text-xs text-muted-foreground">CAUTION</div><div className="text-2xl font-bold text-yellow-500">{counts.CAUTION}</div></Card>
        <Card className="p-4"><div className="text-xs text-muted-foreground">REJECT</div><div className="text-2xl font-bold text-red-500">{counts.REJECT}</div></Card>
      </div>

      <div className="flex gap-2 items-center">
        <select className="border rounded px-2 py-1 bg-background" value={sportFilter} onChange={e => setSportFilter(e.target.value)}>
          <option value="ALL">All sports</option><option value="NBA">NBA</option><option value="MLB">MLB</option><option value="NHL">NHL</option>
        </select>
        <select className="border rounded px-2 py-1 bg-background" value={verdictFilter} onChange={e => setVerdictFilter(e.target.value)}>
          <option value="ALL">All verdicts</option><option value="APPROVE">APPROVE</option><option value="CAUTION">CAUTION</option><option value="REJECT">REJECT</option>
        </select>
        <Button size="sm" variant="outline" onClick={load}>Refresh</Button>
      </div>

      {loading ? <div>Loading…</div> : (
        <div className="space-y-2">
          {rows.map(r => (
            <Card key={r.id} className="p-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className={verdictColor[r.verdict]}>{r.verdict}</Badge>
                  <span className="font-semibold">{r.player_name ?? "?"}</span>
                  <span className="text-muted-foreground">{r.sport} · {r.prop_type} {r.side} {r.line}</span>
                  <Badge variant="outline">×{Number(r.confidence_multiplier).toFixed(2)}</Badge>
                  {(r.flags ?? []).map(f => <Badge key={f} variant="secondary">{f}</Badge>)}
                </div>
                <Button size="sm" variant="ghost" onClick={() => reverify(r)}>Re-verify</Button>
              </div>
              {r.reasoning && <div className="text-sm mt-2 text-muted-foreground">{r.reasoning}</div>}
              <div className="text-xs mt-1 text-muted-foreground">
                {new Date(r.created_at).toLocaleString()} · {r.research_model ?? "no research"} → {r.judge_model ?? "?"}
              </div>
            </Card>
          ))}
          {rows.length === 0 && <div className="text-muted-foreground">No verdicts yet.</div>}
        </div>
      )}
    </div>
  );
}