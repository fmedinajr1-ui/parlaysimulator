import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface Row {
  verdict: string;
  surface: string | null;
  tournament: string | null;
  edge_pct: number;
  line: number;
  actual_total_games: number | null;
  result: string | null;
  matchup: string | null;
  commence_at: string;
}

interface Bucket { label: string; wins: number; losses: number; pushes: number }

function rate(b: Bucket): string {
  const decided = b.wins + b.losses;
  if (decided === 0) return "—";
  return ((100 * b.wins) / decided).toFixed(1) + "%";
}

function roiUnits(b: Bucket): string {
  // Assume -110 odds → win +0.909u, loss -1u
  const profit = b.wins * 0.909 - b.losses;
  const staked = b.wins + b.losses;
  if (staked === 0) return "—";
  return ((100 * profit) / staked).toFixed(1) + "%";
}

function bucketBy(rows: Row[], key: (r: Row) => string): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const r of rows) {
    const k = key(r);
    const b = map.get(k) ?? { label: k, wins: 0, losses: 0, pushes: 0 };
    if (r.result === "WIN") b.wins++;
    else if (r.result === "LOSS") b.losses++;
    else if (r.result === "PUSH") b.pushes++;
    map.set(k, b);
  }
  return Array.from(map.values()).sort((a, b) => (b.wins + b.losses) - (a.wins + a.losses));
}

function edgeBucket(pct: number): string {
  const a = Math.abs(pct);
  if (a >= 15) return "15%+";
  if (a >= 10) return "10–15%";
  if (a >= 7) return "7–10%";
  return "<7%";
}

function tierFromTournament(t: string | null): string {
  if (!t) return "unknown";
  const s = t.toLowerCase();
  if (/roland|wimbledon|us open|australian|melbourne|flushing/.test(s)) return "grand_slam";
  if (/madrid|miami|indian wells|cincinnati|rome|monte carlo|shanghai|paris masters|toronto|montreal|masters 1000|wta 1000/.test(s)) return "masters_1000";
  if (/atp 500|wta 500|dubai|barcelona|vienna|basel|rotterdam|queens|halle|hamburg|tokyo|beijing|doha/.test(s)) return "500";
  if (/challenger|atp 125|atp 100|atp 75/.test(s)) return "challenger";
  if (/itf|m15|m25|w15|w25|w35|w50|w60|w75|w100/.test(s)) return "itf";
  return "250/other";
}

export default function CourtEdgeAccuracy() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [settling, setSettling] = useState(false);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("court_edge_picks")
      .select("verdict,surface,tournament,edge_pct,line,actual_total_games,result,matchup,commence_at")
      .eq("graded", true)
      .in("verdict", ["STRONG_OVER", "STRONG_UNDER", "LEAN_OVER", "LEAN_UNDER"])
      .order("commence_at", { ascending: false })
      .limit(1000);
    if (error) console.error(error);
    setRows((data as Row[]) || []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function runSettle() {
    setSettling(true);
    try {
      const { data, error } = await supabase.functions.invoke("court-edge-settle", { body: { limit: 200 } });
      if (error) console.error(error);
      else console.log("settle result", data);
      await load();
    } finally { setSettling(false); }
  }

  const total: Bucket = { label: "OVERALL", wins: 0, losses: 0, pushes: 0 };
  for (const r of rows) {
    if (r.result === "WIN") total.wins++;
    else if (r.result === "LOSS") total.losses++;
    else if (r.result === "PUSH") total.pushes++;
  }

  const byVerdict = bucketBy(rows, (r) => r.verdict);
  const bySurface = bucketBy(rows, (r) => r.surface ?? "unknown");
  const byTier = bucketBy(rows, (r) => tierFromTournament(r.tournament));
  const byEdge = bucketBy(rows, (r) => edgeBucket(Number(r.edge_pct)));

  const Section = ({ title, buckets }: { title: string; buckets: Bucket[] }) => (
    <Card className="p-4">
      <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">{title}</h3>
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr><th className="text-left py-1">Bucket</th><th className="text-right">W</th><th className="text-right">L</th><th className="text-right">P</th><th className="text-right">Hit</th><th className="text-right">ROI</th></tr>
        </thead>
        <tbody>
          {buckets.map((b) => {
            const r = rate(b);
            const decided = b.wins + b.losses;
            const hitNum = decided > 0 ? (100 * b.wins) / decided : 0;
            const cls = decided < 10 ? "text-muted-foreground"
              : hitNum >= 55 ? "text-green-500"
              : hitNum >= 50 ? "text-foreground"
              : "text-red-500";
            return (
              <tr key={b.label} className="border-t border-border/40">
                <td className="py-1.5 font-mono">{b.label}</td>
                <td className="text-right">{b.wins}</td>
                <td className="text-right">{b.losses}</td>
                <td className="text-right">{b.pushes}</td>
                <td className={`text-right font-semibold ${cls}`}>{r}</td>
                <td className="text-right text-xs">{roiUnits(b)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );

  return (
    <div className="p-6 space-y-4 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Court.Edge Accuracy</h1>
          <p className="text-sm text-muted-foreground">Graded tennis picks, broken down by tier · ROI assumes -110.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={load} disabled={loading}>Refresh</Button>
          <Button onClick={runSettle} disabled={settling}>{settling ? "Settling…" : "Run settle now"}</Button>
        </div>
      </div>

      <Card className="p-4 flex items-center gap-6">
        <div>
          <div className="text-xs text-muted-foreground uppercase">Sample</div>
          <div className="text-2xl font-bold">{total.wins + total.losses + total.pushes}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground uppercase">Wins / Losses</div>
          <div className="text-2xl font-bold">{total.wins}–{total.losses}<span className="text-sm text-muted-foreground ml-2">({total.pushes} push)</span></div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground uppercase">Hit rate</div>
          <div className="text-2xl font-bold">{rate(total)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground uppercase">ROI (-110)</div>
          <div className="text-2xl font-bold">{roiUnits(total)}</div>
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Section title="By Verdict" buckets={byVerdict} />
        <Section title="By Edge magnitude" buckets={byEdge} />
        <Section title="By Surface" buckets={bySurface} />
        <Section title="By Tournament tier" buckets={byTier} />
      </div>

      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">Last 25 graded</h3>
        <table className="w-full text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="text-left py-1">Match</th>
              <th>Verdict</th>
              <th>Line</th>
              <th>Actual</th>
              <th>Edge</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 25).map((r, i) => (
              <tr key={i} className="border-t border-border/40">
                <td className="py-1 truncate max-w-[260px]">{r.matchup}</td>
                <td className="text-center"><Badge variant="outline" className="text-[10px]">{r.verdict.replace("_", " ")}</Badge></td>
                <td className="text-center">{r.line}</td>
                <td className="text-center">{r.actual_total_games ?? "—"}</td>
                <td className="text-center">{Number(r.edge_pct).toFixed(1)}</td>
                <td className="text-center">
                  <Badge className={r.result === "WIN" ? "bg-green-600" : r.result === "LOSS" ? "bg-red-600" : "bg-muted"}>
                    {r.result}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}